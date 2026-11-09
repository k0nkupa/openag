import { effectScope, protectScope, scopesConflict } from "./effect-scope.js";
import { canonical, createActionReceipts, type ActionReceipts } from "./action-receipts.js";
import { MemoryPayloadSchema, SkillPayloadSchema } from "./reflection-schema.js";
import { randomUUID } from "node:crypto";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import type { ToolClass } from "./policy.js";
import { getDefaultRedactor, type Redactor } from "./redact.js";

export class ApprovalError extends Error { constructor(message:string,public readonly status:400|409=409){super(message);} }

export type Decision =
  | { kind: "accept" }
  | { kind: "edit"; payload: unknown }
  | { kind: "respond"; text: string }
  | { kind: "ignore" };

export type ApprovalStatus = "pending" | "accepted" | "edited" | "responded" | "ignored";

export interface Approval {
  id: string;
  roomId: string;
  botId: string;
  turnId: string | null;
  toolName: string;
  toolClass: ToolClass;
  payload: unknown;
  status: ApprovalStatus;
  edit: unknown;
  responseText: string | null;
  /** Where the requesting turn came from (e.g. "slack:U0123456789"); null = the desk. */
  source: string | null;
  createdAt: number;
  decidedAt: number | null;
  reviewVersion: string;
  toolCallId: string | null;
  review: Record<string, unknown> | null;
  canEdit: boolean;
}

export interface ApprovalRequest {
  toolCallId?: string;
  review?: Record<string, unknown>;
  roomId: string;
  botId: string;
  turnId?: string;
  toolName: string;
  toolClass: ToolClass;
  payload?: unknown;
  source?: string | null;
}

export interface Approvals {
  request(req: ApprovalRequest): { approvalId: string; wait(): Promise<Decision> };
  receipts: ActionReceipts;
  inspectReceipt(id:string,version:string,note:string,reference:string):ReturnType<ActionReceipts["inspect"]>;
  setEditValidator(resolve: (name: string) => ((args: unknown, approval?: Approval) => unknown) | undefined): void;
  resolve(id: string, decision: Decision, reviewVersion: string): Approval;
  /** Ignores a still-pending approval as expired. Returns undefined when it is not pending (or unknown). */
  expire(id: string, reason?: string): Approval | undefined;
  get(id: string): Approval | undefined;
  listPending(): Approval[];
  /** Re-attach a waiter to an approval that survived a restart. */
  waitFor(id: string): Promise<Decision>;
}

interface Row {
  id: string;
  room_id: string;
  bot_id: string;
  turn_id: string | null;
  tool_name: string;
  tool_class: ToolClass;
  payload_json: string | null;
  status: ApprovalStatus;
  edit_json: string | null;
  response_text: string | null;
  source: string | null;
  created_at: number;
  decided_at: number | null;
  review_version: string;
  tool_call_id: string | null;
  review_json: string | null;
}

const toApproval = (r: Row): Approval => ({
  id: r.id,
  roomId: r.room_id,
  botId: r.bot_id,
  turnId: r.turn_id,
  toolName: r.tool_name,
  toolClass: r.tool_class,
  payload: r.payload_json ? JSON.parse(r.payload_json) : null,
  status: r.status,
  edit: r.edit_json ? JSON.parse(r.edit_json) : null,
  responseText: r.response_text,
  source: r.source ?? null,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  reviewVersion: r.review_version, toolCallId:r.tool_call_id,review:r.review_json?JSON.parse(r.review_json):null,canEdit:false,
});

const STATUS: Record<Decision["kind"], ApprovalStatus> = {
  accept: "accepted",
  edit: "edited",
  respond: "responded",
  ignore: "ignored",
};

// Stored payloads are redacted, so an edited decision made on a redacted payload carries placeholders. That fails safe.
export function createApprovals(db: Db, ledger: Ledger, redactor: Redactor = getDefaultRedactor()): Approvals {
  const receipts = createActionReceipts(db, ledger,redactor);
  let editValidator: (name: string) => ((args: unknown, approval?: Approval) => unknown) | undefined = () => undefined;
  const validator = (name: string) => name === "reflection_memory" ? (v: unknown) => MemoryPayloadSchema.parse(v) : name === "reflection_skill" ? (v: unknown) => SkillPayloadSchema.parse(v) : editValidator(name);
  const view = (row: Row): Approval => ({...toApproval(row),canEdit:!!validator(row.tool_name)});
  const waiters = new Map<string, { promise: Promise<Decision>; settle: (d: Decision) => void }>();

  const getRow = (id: string) => db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;

  function waiterFor(id: string) {
    let w = waiters.get(id);
    if (!w) {
      let settle!: (d: Decision) => void;
      const promise = new Promise<Decision>((res) => (settle = res));
      w = { promise, settle };
      waiters.set(id, w);
    }
    return w;
  }

  return {
    receipts,
    inspectReceipt(id,version,note,reference) {
      return ledger.atomic(()=>{
        const receipt=receipts.inspect(id,version,note,reference);
        const pending=db.prepare("SELECT id,review_json FROM approvals WHERE status='pending'").all() as {id:string}[];
        for(const approval of pending as {id:string;review_json:string|null}[])if(scopesConflict(receipt.effectScope,effectScope(approval.review_json?JSON.parse(approval.review_json).effectScope:null)))this.expire(approval.id,"A target inspection invalidated older external proposals. Request a fresh proposal.");
        return receipt;
      });
    },
    setEditValidator(resolve) { editValidator = resolve; },
    request(req) {
      const id = randomUUID();
      const now = Date.now();
      const payload = redactor.redact(req.payload ?? null);
      const scope=protectScope(req.review?.effectScope,value=>redactor.redact(value));
      const review={...redactor.redact(req.review??{}),effectScope:scope};
      if(Buffer.byteLength(JSON.stringify(payload))>65536)throw new Error("Proposal exceeds the 64 KiB review limit. Propose a smaller action.");
      if(Buffer.byteLength(JSON.stringify(redactor.redact(req.review??null)))>131072)throw new Error("File review exceeds the inspection limit. Propose a smaller change.");
      // Short, plain identifier only (it is shown in the Inbox and push text).
      const source = typeof req.source === "string" && /^[A-Za-z0-9:_-]{1,80}$/.test(req.source) ? req.source : null;
      // A ledger subscriber can decide before request() returns.
      const waiting = waiterFor(id);
      try {
      ledger.atomic(() => {
      db.prepare(
        `INSERT INTO approvals (id, room_id, bot_id, turn_id, tool_name, tool_class, payload_json, status, created_at, source,review_version,tool_call_id,review_json,inspection_epoch)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?,?,?,?,?)`,
      ).run(id, req.roomId, req.botId, req.turnId ?? null, req.toolName, req.toolClass, JSON.stringify(payload), now, source,randomUUID(),req.toolCallId??null,JSON.stringify(review),receipts.inspectionEpoch(scope));
      ledger.append(req.roomId, req.botId, "approval_requested", {
        approvalId: id,
        ...(req.toolCallId ? { toolCallId: req.toolCallId } : {}),
        turnId: req.turnId ?? null,
        toolName: req.toolName,
        toolClass: req.toolClass,
        payload,
        source,
      });
      });
      } catch (error) {
        waiters.delete(id);
        throw error;
      }
      return { approvalId: id, wait: () => waiting.promise };
    },

    resolve(id, decision, reviewVersion) {
      const existing=getRow(id);
      if(!existing)throw new Error("approval not found");
      if(!reviewVersion || existing.review_version!==reviewVersion)throw new Error("Approval changed. Reload and review it before deciding.");
      if(existing.status!=="pending")throw new Error("approval already resolved");
      if(decision.kind==="edit"){
        const validate=validator(existing.tool_name);
        if(!validate)throw new Error("This tool cannot validate edits. Respond to request a new proposal.");
        try{
          const normalized=validate(decision.payload,view(existing));
          if(canonical(normalized)!==canonical(decision.payload))throw new Error("The edit changes during tool validation. Use the exact validated fields, or Respond for a new proposal.");
          decision={kind:"edit",payload:normalized};
        }catch(error){throw new ApprovalError(error instanceof Error?error.message:"Invalid edited payload",400);}
        const review=existing.review_json?JSON.parse(existing.review_json):null;
        if(review?.baseDigest && (decision.payload as {path?:unknown})?.path!==review.path)throw new Error("The edited target changed. Respond to request a new proposal.");
      }
      const approval=ledger.atomic(() => {
      const status = STATUS[decision.kind];
      if (!status) throw new Error(`unknown decision kind`);
      const editJson = decision.kind === "edit" ? JSON.stringify(redactor.redact(decision.payload ?? null)) : null;
      const responseText = decision.kind === "respond" ? redactor.redactString(decision.text) : null;
      const res = db
        .prepare(
          `UPDATE approvals SET status = ?, edit_json = ?, response_text = ?, decided_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(
          status,
          editJson,
          responseText,
          Date.now(),
          id,
        );
      if (res.changes === 0) {
        throw new Error(getRow(id) ? `approval ${id} already resolved` : `approval ${id} not found`);
      }
      const row = getRow(id)!;
      receipts.record(view(row),decision);
      ledger.append(row.room_id, "user", "approval_decided", {
        approvalId: id,
        turnId: row.turn_id,
        decision,
        status,
      });
      return view(row);
      });
      const w=waiters.get(id);if(w){w.settle(decision);waiters.delete(id);}
      return approval;
    },

    expire(id, reason) {
      const approval=ledger.atomic(() => {
      // Same guarded UPDATE as resolve(): against a racing decision, exactly one of the two writes succeeds.
      const res = db
        .prepare(
          `UPDATE approvals SET status = 'ignored', response_text = 'expired', decided_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(Date.now(), id);
      if (res.changes === 0) return undefined;
      const row = getRow(id)!;
      receipts.record(view(row),{kind:"ignore"});
      ledger.append(row.room_id, "daemon", "approval_decided", {
        approvalId: id,
        turnId: row.turn_id,
        decision: { kind: "ignore", expired: true },
        status: "ignored",
        ...(reason ? { reason } : {}),
      });
      return view(row);
      });
      if(approval){const w=waiters.get(id);if(w){w.settle({kind:"ignore"});waiters.delete(id);}}
      return approval;
    },

    get(id) {
      const row = getRow(id);
      return row && view(row);
    },

    listPending() {
      return (db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at, rowid").all() as Row[]).map(
        view,
      );
    },

    waitFor(id) {
      if (getRow(id)?.status !== "pending") throw new Error(`approval ${id} is not pending`);
      return waiterFor(id).promise;
    },
  };
}
