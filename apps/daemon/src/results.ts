import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import { getDefaultRedactor } from "./redact.js";

export const resultInput = z
  .object({
    id: z.string().uuid().optional(),
    baseVersion: z.number().int().positive().optional(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(
        (name) =>
          !/[\x00-\x1f\x7f/\\]/.test(name) &&
          /\.(txt|md|csv|json|diff|patch|ts|tsx|js|jsx|py|go|rs|sql|yaml|yml|css)$/i.test(
            name,
          ),
        "use a plain filename with a supported text/code extension",
      ),
    kind: z.enum(["comparison", "draft", "code", "note"]),
    content: z.string().min(1).max(262144),
  })
  .strict()
  .refine(
    (input) => !!input.id === (input.baseVersion !== undefined),
    "updating a result requires its ID and baseVersion",
  );
export interface ResultScope {
  botId: string;
  roomId: string;
  workId?: string;
  turnId: string;
  toolCallId: string;
}
interface Row {
  seq: number;
  id: string;
  version: number;
  work_id: string | null;
  room_id: string;
  bot_id: string;
  turn_id: string;
  tool_call_id: string|null;
  origin:"tool"|"investigation";
  investigation_id:string|null;
  name: string;
  kind: "comparison" | "draft" | "code" | "note";
  content: string;
  bytes: number;
  created_at: number;
}
export const resultPage = z
  .object({
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const resultQuery = resultPage.extend({
  workId: z.string().uuid().optional(),
  roomId: z.string().min(1).max(100).optional(),
  botId: z.string().min(1).max(100).optional(),
});
const view = (r: Row) => ({
  seq: r.seq,
  id: r.id,
  version: r.version,
  workId: r.work_id,
  roomId: r.room_id,
  botId: r.bot_id,
  turnId: r.turn_id,
  toolCallId: r.tool_call_id,
  name: r.name,
  kind: r.kind,
  bytes: r.bytes,
  createdAt: r.created_at,
  provenance: "proposed" as const,
  origin:r.origin,
  investigationId:r.investigation_id,
});
export type SavedResult = ReturnType<typeof view>;
export class ResultError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 413 = 400,
  ) {
    super(message);
  }
}

/** Text lives in SQLite under opaque IDs; no result path or source-file read is accepted. */
export interface ReadableScope {id:string;revision:number}
export const readableInvestigationsSQL="SELECT i.id FROM investigations i JOIN json_each(?) scope ON i.responsibility_id=json_extract(scope.value,'$.id') AND i.revision=json_extract(scope.value,'$.revision')";
export const readableResultIdsSQL=`SELECT id FROM saved_results WHERE substr(room_id,1,1)!='_' AND (origin='tool' OR investigation_id IN (${readableInvestigationsSQL}))`;
export function createResults(db: Db, ledger: Ledger, access?:{canReadInvestigation:(id:string)=>boolean;readableScopes?:()=>ReadableScope[]}) {
  const redactor = getDefaultRedactor();
  function get(id: string, version?: number) {
    return db
      .prepare(
        "SELECT * FROM saved_results WHERE id=? AND substr(room_id,1,1)!='_' AND (? IS NULL OR version=?) ORDER BY version DESC LIMIT 1",
      )
      .get(id, version ?? null, version ?? null) as Row | undefined;
  }
  const visible=(r:Row)=>r.origin!=='investigation'||!!(r.investigation_id&&access?.canReadInvestigation(r.investigation_id));
  return {
    settleInvestigation(id:string,content:string){return ledger.atomic(()=>{
      if(!access?.canReadInvestigation(id))throw new ResultError('Investigation scope is unavailable',409);
      const i=db.prepare("SELECT i.*,r.config_json FROM investigations i JOIN responsibilities r ON r.id=i.responsibility_id WHERE i.id=? AND i.status='running' AND i.revision=r.revision AND r.enabled=1").get(id) as {turn_id:string;config_json:string;result_id:string|null}|undefined;
      if(!i||!i.turn_id||!db.prepare("SELECT 1 FROM turns WHERE id=? AND status IN ('finished','incomplete')").get(i.turn_id))throw new ResultError('Investigation has no settled turn',409);
      const prior=db.prepare('SELECT * FROM saved_results WHERE investigation_id=?').get(id) as Row|undefined;if(prior)return view(prior);
      const safe=redactor.redactString(content),bytes=Buffer.byteLength(safe);if(!bytes||bytes>32768)throw new ResultError('Investigation report exceeds its allowance',413);
      const config=JSON.parse(i.config_json),resultId=randomUUID();
      db.prepare("INSERT INTO saved_results(id,version,room_id,bot_id,turn_id,tool_call_id,name,kind,content,bytes,created_at,origin,investigation_id) VALUES(?,1,?,?,?,NULL,'investigation.md','draft',?,?,?,'investigation',?)").run(resultId,config.roomId,config.botId,i.turn_id,safe,bytes,Date.now(),id);
      return view(db.prepare('SELECT * FROM saved_results WHERE id=?').get(resultId) as Row);
    });},
    save(scope: ResultScope, raw: unknown): SavedResult {
      const parsed = resultInput.safeParse(raw);
      if (!parsed.success)
        throw new ResultError(
          "invalid saved result: use a supported filename, kind and bounded text; updates require ID and baseVersion",
        );
      const input = parsed.data,
        content = redactor.redactString(input.content),
        name = redactor.redactString(input.name),
        bytes = Buffer.byteLength(content);
      if (!bytes || bytes > 262144)
        throw new ResultError(
          "result must contain 1 byte to 256 KiB after redaction",
          413,
        );
      return ledger.atomic(() => {
        if (
          scope.roomId.startsWith("_") ||
          !db.prepare("SELECT 1 FROM turns WHERE id=? AND room_id=? AND bot_id=? AND status='running'").get(scope.turnId,scope.roomId,scope.botId) ||
          (scope.workId!==undefined&&!db.prepare("SELECT 1 FROM work w JOIN work_runs r ON r.work_id=w.id JOIN turns t ON t.id=r.turn_id WHERE w.id=? AND w.room_id=? AND t.bot_id=? AND r.turn_id=? AND w.cancel_requested_at IS NULL").get(scope.workId,scope.roomId,scope.botId,scope.turnId))
        )
          throw new ResultError("result scope is not an active Work turn", 409);
        if (
          !db
            .prepare(
              "SELECT 1 FROM events WHERE room_id=? AND actor=? AND type='tool_call' AND json_extract(payload_json,'$.turnId')=? AND json_extract(payload_json,'$.toolCallId')=? AND json_extract(payload_json,'$.tool')='save_result'",
            )
            .get(scope.roomId, scope.botId, scope.turnId, scope.toolCallId)
        )
          throw new ResultError(
            "result must come from its gated save_result call",
            409,
          );
        const existingCall = db
          .prepare("SELECT * FROM saved_results WHERE tool_call_id=?")
          .get(scope.toolCallId) as Row | undefined;
        if (existingCall) return view(existingCall);
        const previous = input.id ? get(input.id) : undefined;
        if (
          input.id &&
          (!previous ||
            previous.work_id !== (scope.workId??null) ||
            previous.bot_id !== scope.botId ||
            previous.room_id !== scope.roomId)
        )
          throw new ResultError("result not found in this Work", 404);
        if(previous?.origin==='investigation')throw new ResultError('Investigation results are immutable; save a new conversation result',409);
        if (previous && previous.version !== input.baseVersion)
          throw new ResultError(
            "result version changed; read the current result before saving again",
            409,
          );
        if (
          (
            db
              .prepare(
                "SELECT COUNT(*) AS n FROM saved_results WHERE origin='tool' AND ((? IS NOT NULL AND work_id=?) OR (? IS NULL AND work_id IS NULL AND room_id=? AND bot_id=?))",
              )
              .get(scope.workId??null,scope.workId??null,scope.workId??null,scope.roomId,scope.botId) as { n: number }
          ).n >= 100
        )
          throw new ResultError(
            "Work result limit reached (100 saved versions)",
            413,
          );
        const id = previous?.id ?? randomUUID(),
          version = (previous?.version ?? 0) + 1;
        db.prepare(
          "INSERT INTO saved_results(id,version,work_id,room_id,bot_id,turn_id,tool_call_id,name,kind,content,bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          version,
          scope.workId??null,
          scope.roomId,
          scope.botId,
          scope.turnId,
          scope.toolCallId,
          name,
          input.kind,
          content,
          bytes,
          Date.now(),
        );
        const result = view(get(id)!);
        ledger.append(scope.roomId, scope.botId, "result_saved", {
          resultId: id,
          version,
          workId: scope.workId,
          turnId: scope.turnId,
          toolCallId: scope.toolCallId,
          name,
          kind: input.kind,
        });
        return result;
      });
    },
    list(opts: z.infer<typeof resultQuery>) {
      const scopes=JSON.stringify(access?.readableScopes?.()??[]);
      const rows=db.prepare(`SELECT r.* FROM saved_results r WHERE substr(r.room_id,1,1)!='_' AND r.seq=(SELECT MAX(v.seq) FROM saved_results v WHERE v.id=r.id) AND (r.origin='tool' OR r.investigation_id IN (${readableInvestigationsSQL})) AND (? IS NULL OR r.work_id=?) AND (? IS NULL OR r.room_id=?) AND (? IS NULL OR r.bot_id=?) AND (? IS NULL OR r.seq<?) ORDER BY r.seq DESC LIMIT ?`).all(scopes,opts.workId??null,opts.workId??null,opts.roomId??null,opts.roomId??null,opts.botId??null,opts.botId??null,opts.before??null,opts.before??null,opts.limit+1) as Row[];
      return {results:rows.slice(0,opts.limit).map(view),nextCursor:rows.length>opts.limit?rows[opts.limit-1]!.seq:null};
    },

    get(id: string, version?: number) {
      const r = get(id, version);
      if (!r||!visible(r)) throw new ResultError("result not found", 404);
      return { result: view(r), content: r.content };
    },
    versions(id: string, before: number | undefined, limit: number) {
      const latest=get(id);
      if (!latest||!visible(latest)) throw new ResultError("result not found", 404);
      const rows = db
        .prepare(
          "SELECT * FROM saved_results WHERE id=? AND (? IS NULL OR seq<?) ORDER BY seq DESC LIMIT ?",
        )
        .all(id, before ?? null, before ?? null, limit + 1) as Row[];
      return {
        results: rows.slice(0, limit).map(view),
        nextCursor: rows.length > limit ? rows[limit - 1]!.seq : null,
      };
    },
  };
}
export type Results = ReturnType<typeof createResults>;
