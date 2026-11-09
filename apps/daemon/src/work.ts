import { publicRequestEvent } from './request-provenance.js';
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import { getDefaultRedactor } from "./redact.js";

export const workStatuses = ["working", "needs_input", "needs_approval", "completed", "incomplete", "failed", "interrupted", "cancelled"] as const;
export type WorkStatus = typeof workStatuses[number];
export const workReport = z.object({
  nextStep: z.string().trim().min(1).max(500).optional(),
  needsInput: z.boolean().optional(),
  plan: z.array(z.object({ title: z.string().trim().min(1).max(200), state: z.enum(["pending", "in_progress", "completed"]) }).strict()).max(32).optional(),
}).strict();
export type WorkReport = z.infer<typeof workReport>;
export const workCreation = z.object({
  title:z.string().trim().min(1).max(120),
  description:z.string().trim().min(1).max(8000),
  assignee:z.string().min(1).max(100).optional(),
}).strict();
interface Row {
  seq: number; id: string; room_id: string; bot_id: string; request_id: number; parent_id: string | null; delegation_id: string | null;
  title: string; request: string; status: WorkStatus; next_step: string; plan_json: string; needs_input: number; progress_json: string;
  creation_key:string|null;origin_message_id:number|null;origin_turn_id:string|null;
  continued_from:string|null;revision: number; cancel_requested_at: number | null; created_at: number; updated_at: number;
}
export interface WorkItem {
  seq: number; id: string; roomId: string; botId: string; requestId: number; parentId: string | null; delegationId: string | null;
  title: string; request: string; status: WorkStatus; nextStep: string; plan: WorkReport["plan"]; planIsExecutionEvidence: false; progress: Record<string, number>;
  readyToStart:boolean;explicit:boolean;originMessageId:number|null;originTurnId:string|null;
  continuedFrom:string|null;revision: number; cancelRequestedAt: number | null; createdAt: number; updatedAt: number;
}
const workView = (r: Row,readyToStart=false): WorkItem => ({ seq: r.seq, id: r.id, roomId: r.room_id, botId: r.bot_id, requestId: r.request_id,
  readyToStart,explicit:!!r.creation_key,originMessageId:r.origin_message_id,originTurnId:r.origin_turn_id,
  parentId: r.parent_id, delegationId: r.delegation_id, title: r.title, request: r.request, status: r.status,
  nextStep: r.next_step, plan: JSON.parse(r.plan_json), planIsExecutionEvidence: false, progress: JSON.parse(r.progress_json), continuedFrom:r.continued_from, revision: r.revision,
  cancelRequestedAt: r.cancel_requested_at, createdAt: r.created_at, updatedAt: r.updated_at });
export class WorkError extends Error { constructor(message: string, public status = 400) { super(message); } }
const terminal = new Set<WorkStatus>(["completed", "incomplete", "failed", "interrupted", "cancelled"]);

export function createWork(db: Db, ledger: Ledger) {
  const redactor = getDefaultRedactor();
  const view=(r:Row)=>workView(r,ready(r.id));
  const row = (id: string) => db.prepare("SELECT * FROM work WHERE id=?").get(id) as Row | undefined;
  const run = (id: string) => db.prepare("SELECT * FROM work_runs WHERE id=?").get(id) as { id: string; work_id: string; status: string } | undefined;
  const progressFor = (id: string): Record<string, number> => {
    const turns = db.prepare(`SELECT count(r.turn_id) AS turns, coalesce(sum(t.status='finished'),0) AS finishedTurns FROM work_runs r LEFT JOIN turns t ON t.id=r.turn_id WHERE r.work_id=?`).get(id) as Record<string, number>;
    const tools = db.prepare(`WITH calls AS (
      SELECT r.turn_id,coalesce(l.canonical_id,json_extract(e.payload_json,'$.toolCallId'),json_extract(e.payload_json,'$.tool'),json_extract(e.payload_json,'$.title'),'unknown') AS call_key,
        max(CASE WHEN e.type='tool_call' THEN e.id END) AS call_id,max(CASE WHEN e.type='tool_result' OR json_extract(e.payload_json,'$.status') IN ('completed','failed') THEN e.id END) AS result_id
      FROM work_runs r JOIN events e ON json_extract(e.payload_json,'$.turnId')=r.turn_id
      LEFT JOIN work_tool_links l ON l.turn_id=r.turn_id AND l.call_id=json_extract(e.payload_json,'$.toolCallId')
      WHERE r.work_id=? AND e.type IN ('tool_call','tool_result') GROUP BY r.turn_id,call_key HAVING max(coalesce(json_extract(e.payload_json,'$.control'),'')='request_input')=0
    ) SELECT count(*) AS tools,coalesce(sum(result_id IS NULL AND coalesce(ar.outcome,'')!='unknown'),0) AS pendingTools,
      coalesce(sum((json_extract(e.payload_json,'$.ok')=1 OR json_extract(e.payload_json,'$.status') IN ('ok','completed')) AND coalesce(json_extract(e.payload_json,'$.executionOutcome'),'')!='unknown' AND coalesce(ar.outcome,'')!='unknown'),0) AS completedTools,
      coalesce(sum(result_id IS NOT NULL AND coalesce(json_extract(e.payload_json,'$.stopReason'),'') NOT IN ('tool_limit','step_limit','context_limit','output_truncated','unresolved_calls','unknown_stop','provider_backoff','deadline','provider_interrupted') AND coalesce(ar.outcome,'')!='unknown' AND NOT(coalesce(json_extract(e.payload_json,'$.ok'),0)=1 OR coalesce(json_extract(e.payload_json,'$.status'),'') IN ('ok','completed'))),0) AS unsuccessfulTools,
      coalesce(sum(json_extract(e.payload_json,'$.executionOutcome')='unknown'),0) AS unknownTools
      FROM calls LEFT JOIN events e ON e.id=calls.result_id LEFT JOIN action_receipts ar ON ar.turn_id=calls.turn_id AND ar.tool_call_id=coalesce(json_extract(e.payload_json,'$.toolCallId'),calls.call_key)`).get(id) as Record<string, number>;
    const unknown = db.prepare("SELECT count(*) n FROM action_receipts WHERE work_id=? AND outcome='unknown'").get(id) as {n:number};
    return { ...turns, ...tools,unknownTools:Math.max(unknown.n,tools.unknownTools??0) };
  };
  function changed(id: string, previousStatus?: WorkStatus) {
    const r = row(id)!;
    ledger.append(r.room_id, r.bot_id, "work_updated", { workId: id, parentId: r.parent_id, revision: r.revision, status: r.status, ...(previousStatus !== undefined && previousStatus !== r.status ? { previousStatus } : {}) });
  }
  function refresh(id: string): void {
    const r = row(id); if (!r) return;
    const restored = db.prepare("SELECT id,turn_id FROM work_runs WHERE work_id=? AND status='draining' AND reason='Waiting for delegated recovery.'").all(id) as { id: string;turn_id:string|null }[];
    if (restored.length) {
      const children = db.prepare("SELECT id,status,delegation_id FROM work WHERE parent_id=?").all(id) as { id: string; status: WorkStatus; delegation_id: string | null }[];
      if (children.every(child => terminal.has(child.status))) {
        const missingReturn = children.some(child => child.status === "completed" && child.delegation_id && !db.prepare("SELECT 1 FROM work_runs r JOIN turns t ON t.id=r.turn_id WHERE r.work_id=? AND json_extract(t.state_json,'$.resultFor')=?").get(id, child.delegation_id));
        for (const restoredRun of restored) {
          const missingSharedReturn=!!db.prepare("SELECT 1 FROM events e WHERE e.type='route' AND json_extract(e.payload_json,'$.turnId')=? AND json_extract(e.payload_json,'$.delegatedBy') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM work_runs r JOIN turns t ON t.id=r.turn_id WHERE r.work_id=? AND json_extract(t.state_json,'$.resultFor')=json_extract(e.payload_json,'$.delegationId'))").get(restoredRun.turn_id,id);
          const missing=missingReturn||missingSharedReturn;
          db.prepare("UPDATE work_runs SET status=?,reason=?,updated_at=? WHERE id=?").run(missing ? "interrupted" : "completed", missing ? "A delegated result was not handed back before shutdown. Review before continuing." : null, Date.now(), restoredRun.id);
        }
      }
    }
    const runs = db.prepare("SELECT status,reason FROM work_runs WHERE work_id=?").all(id) as { status: string; reason: string | null }[];
    const children = db.prepare("SELECT status FROM work WHERE parent_id=?").all(id) as { status: WorkStatus }[];
    const pending = (db.prepare("SELECT count(*) AS n FROM approvals a JOIN work_runs r ON r.turn_id=a.turn_id WHERE r.work_id=? AND a.status='pending'").get(id) as { n: number }).n;
    const question=db.prepare("SELECT coalesce(prompt,context) next FROM work_questions WHERE work_id=? AND status='open'").get(id) as {next:string}|undefined;
    const active = runs.some(x => ["queued", "running", "draining"].includes(x.status)) || children.some(x => !terminal.has(x.status));
    const progress = progressFor(id);
    let status: WorkStatus; let next: string;
    if (r.cancel_requested_at !== null && active) { status = "working"; next = "Cancellation requested; waiting for execution to stop."; }
    else if (r.cancel_requested_at !== null) {
      const uncertain = progress.pendingTools > 0 || progress.unknownTools > 0 || runs.some(x => x.status === "interrupted") || children.some(x => x.status === "interrupted");
      status = uncertain ? "interrupted" : "cancelled";
      next = uncertain ? "Cancellation could not confirm every tool stopped. Inspect its target before any retry." : "Execution stopped. Earlier side effects are not undone.";
    } else if (pending || children.some(x => x.status === "needs_approval")) { status = "needs_approval"; next = "Review the pending action before execution can continue."; }
    else if (question || r.needs_input || children.some(x => x.status === "needs_input")) { status = "needs_input"; next = question?.next ?? (r.needs_input ? r.next_step : "A delegated assignment needs input."); }
    else if (active) { status = "working"; next = r.status === "needs_approval" ? "Execution resumed after the decision." : r.next_step; }
    else if (progress.unknownTools > 0) { status = "interrupted"; next = "An action has an unknown outcome. No automatic retry was made."; }
    else if (runs.some(x => x.status === "interrupted") || progress.pendingTools > 0 || children.some(x => x.status === "interrupted")) { status = "interrupted"; next = "Execution was interrupted. Inspect the last tool outcome before continuing."; }
    else if (runs.some(x => x.status === "failed") || progress.unsuccessfulTools > 0 || children.some(x => x.status === "failed")) { status = "failed"; next = runs.find(x => x.status === "failed")?.reason ?? "A tool or delegated assignment did not complete successfully."; }
    else if(runs.some(x=>x.status==='cancelled')||children.some(x=>x.status==='cancelled')) {status='cancelled';next='Execution was cancelled. Earlier effects are not undone.';}
    else if(runs.some(x=>x.status==='incomplete')||children.some(x=>x.status==='incomplete')) {status='incomplete';next=runs.find(x=>x.status==='incomplete')?.reason??'Execution stopped with unresolved work. Review partial results before continuing.';}
    else { status = "completed"; next = "The linked execution finished. See tool results for action outcomes."; }
    const json = JSON.stringify(progress);
    if (r.status !== status || r.next_step !== next || r.progress_json !== json) {
      db.prepare("UPDATE work SET status=?,next_step=?,progress_json=?,revision=revision+1,updated_at=? WHERE id=?").run(status, next, json, Date.now(), id);
      changed(id, r.status);
    }
    if (r.parent_id) refresh(r.parent_id);
  }
  const refreshAtomic = (id: string) => ledger.atomic(() => refresh(id));
  const cancelled = (id: string) => row(id)?.cancel_requested_at !== null;
  const ready=(id:string)=>!!db.prepare("SELECT 1 FROM work_runs r JOIN work w ON w.id=r.work_id WHERE w.id=? AND r.message_id=w.request_id AND w.creation_key IS NOT NULL AND w.cancel_requested_at IS NULL AND r.status='queued' AND r.turn_id IS NULL AND r.dispatch_claimed=0").get(id);
  const publicRow = (id: string) => { const r = row(id); return r && !r.room_id.startsWith("_") ? r : undefined; };
  function begin(input: { roomId: string; botId: string; messageId: number; workId?: string; parentId?: string; delegationId?: string; turnId?: string;claim?:boolean;continuedFrom?:string }) {
    return ledger.atomic(() => {
      const message = ledger.get(input.messageId);
      if (!message || message.roomId !== input.roomId || message.type !== "message") throw new WorkError("request does not belong to this room");
      if (!db.prepare("SELECT 1 FROM room_members WHERE room_id=? AND bot_id=?").get(input.roomId, input.botId)) throw new WorkError("bot is not a room member");
      const existingRun = input.turnId ? db.prepare("SELECT id,work_id FROM work_runs WHERE turn_id=?").get(input.turnId) as { id: string; work_id: string } | undefined : undefined;
      let w = existingRun ? row(existingRun.work_id) : input.workId ? row(input.workId) : db.prepare("SELECT * FROM work WHERE room_id=? AND bot_id=? AND request_id=?").get(input.roomId, input.botId, input.messageId) as Row | undefined;
      if (input.workId && !w) throw new WorkError("work not found", 404);
      const delegated=w&&(db.prepare("SELECT 1 FROM events e JOIN work_runs r ON r.turn_id=json_extract(e.payload_json,'$.turnId') JOIN json_each(json_extract(e.payload_json,'$.targets')) target WHERE e.room_id=? AND e.type='route' AND json_extract(e.payload_json,'$.messageId')=? AND target.value=? AND r.work_id=?").get(input.roomId,input.messageId,input.botId,w.id)||db.prepare('SELECT 1 FROM work_questions WHERE work_id=? AND room_id=? AND bot_id=? AND answer_message_id=?').get(w.id,input.roomId,input.botId,input.messageId));
      if (w && (w.room_id !== input.roomId || (w.bot_id !== input.botId&&!delegated))) throw new WorkError("work context mismatch");
      const parent = input.parentId ? row(input.parentId) : undefined;
      if (input.parentId && (!parent || parent.room_id !== input.roomId)) throw new WorkError("parent work context mismatch");
      if (!w) {
        const id = randomUUID(); const now = Date.now();
        const request = redactor.redactString(String((message.payload as { text?: unknown })?.text ?? "")).slice(0, 8000);
        db.prepare(`INSERT INTO work(id,room_id,bot_id,request_id,parent_id,delegation_id,title,request,status,next_step,cancel_requested_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'working','Waiting to execute.',?,?,?)`).run(id, input.roomId, input.botId, input.messageId, input.parentId ?? null, input.delegationId ?? null, request.slice(0, 120) || "Agent assignment", request, parent?.cancel_requested_at ?? null, now, now);
        if(input.continuedFrom)db.prepare("UPDATE work SET continued_from=? WHERE id=?").run(input.continuedFrom,id);
        w = row(id)!; changed(id);
      }
      if (existingRun) {
        const active = run(existingRun.id);
        if (active && ["queued", "running", "draining"].includes(active.status)) return { workId: w.id, runId: existingRun.id, duplicate: true };
        db.prepare("UPDATE work_runs SET status='queued',reason=NULL,updated_at=? WHERE id=?").run(Date.now(), existingRun.id);
        refresh(w.id); return { workId: w.id, runId: existingRun.id };
      }
      if (!input.turnId) {
        const previous=db.prepare("SELECT id,status,dispatch_claimed FROM work_runs WHERE work_id=? AND message_id=? ORDER BY seq LIMIT 1").get(w.id,input.messageId) as {id:string;status:string;dispatch_claimed:number}|undefined;
        if(previous){
          if(input.claim&&previous.status==='queued'&&!previous.dispatch_claimed){db.prepare("UPDATE work_runs SET dispatch_claimed=1 WHERE id=?").run(previous.id);db.prepare("UPDATE work SET next_step='Execution queued.',revision=revision+1,updated_at=? WHERE id=? AND creation_key IS NOT NULL").run(Date.now(),w.id);changed(w.id);return {workId:w.id,runId:previous.id};}
          return {workId:w.id,runId:previous.id,duplicate:true};
        }
      }
      const id = randomUUID(); const now = Date.now();
      db.prepare("INSERT INTO work_runs(id,work_id,message_id,status,created_at,updated_at) VALUES(?,?,?,'queued',?,?)").run(id, w.id, input.messageId, now, now);
      if(input.claim)db.prepare("UPDATE work_runs SET dispatch_claimed=1 WHERE id=?").run(id);
      refresh(w.id); return { workId: w.id, runId: id };
    });
  }
  function updateRun(id: string, status: string, reason?: string, turnId?: string) {
    ledger.atomic(() => {
      const r = run(id); if (!r) throw new WorkError("work run not found", 404);
      db.prepare("UPDATE work_runs SET status=?,reason=coalesce(?,reason),turn_id=coalesce(?,turn_id),updated_at=? WHERE id=?").run(status, reason ? redactor.redactString(reason).slice(0, 500) : null, turnId ?? null, Date.now(), id);
      refresh(r.work_id);
    });
  }
  function report(id: string, value: unknown) {
    const parsed = workReport.safeParse(value); if (!parsed.success) throw new WorkError("invalid work report");
    ledger.atomic(() => {
      const r = row(id); if (!r || r.cancel_requested_at !== null) return;
      const safe = redactor.redact(parsed.data) as WorkReport;
      db.prepare("UPDATE work SET next_step=?,needs_input=?,plan_json=?,revision=revision+1,updated_at=? WHERE id=?").run(safe.nextStep ?? r.next_step, safe.needsInput === undefined ? r.needs_input : Number(safe.needsInput), safe.plan ? JSON.stringify(safe.plan) : r.plan_json, Date.now(), id);
      changed(id); refresh(id);
    });
  }
  function requestCancel(id: string, revision?: number) {
    return ledger.atomic(() => {
      const w = publicRow(id); if (!w) throw new WorkError("work not found", 404);
      if (w.cancel_requested_at !== null) return descendants(id);
      if (revision !== undefined && w.revision !== revision) throw new WorkError("work changed; refresh before cancelling", 409);
      if (terminal.has(w.status) && w.status !== "interrupted") throw new WorkError("work is already finished", 409);
      const ids = descendants(id);
      for (const workId of ids) {
        const current = row(workId)!;
        if (terminal.has(current.status) && current.status !== "interrupted") continue;
        db.prepare("UPDATE work SET cancel_requested_at=coalesce(cancel_requested_at,?),revision=revision+1,updated_at=? WHERE id=?").run(Date.now(), Date.now(), workId);
        db.prepare("UPDATE work_runs SET status='cancelled',updated_at=? WHERE work_id=? AND (status='queued' OR (status='interrupted' AND reason='Daemon stopped before execution settled.'))").run(Date.now(), workId);
        changed(workId); refresh(workId);
      }
      return ids;
    });
  }
  function descendants(id: string): string[] {
    return (db.prepare("WITH RECURSIVE tree(id) AS (SELECT id FROM work WHERE id=? UNION ALL SELECT w.id FROM work w JOIN tree t ON w.parent_id=t.id) SELECT id FROM tree").all(id) as { id: string }[]).map(r => r.id);
  }
  const off = ledger.subscribe("*", event => {
    if (!["approval_requested", "approval_decided", "tool_call", "tool_result", "receipt_updated", "question_updated"].includes(event.type)) return;
    const payload=event.payload as {turnId?:unknown;workId?:unknown};
    const r=typeof payload?.turnId==='string'?db.prepare("SELECT work_id FROM work_runs WHERE turn_id=?").get(payload.turnId) as {work_id:string}|undefined:typeof payload?.workId==='string'&&row(payload.workId)?{work_id:payload.workId}:undefined;
    if(!r)return;
    refreshAtomic(r.work_id);
    if(!['tool_call','tool_result'].includes(event.type))ledger.atomic(()=>{
      let id:string|null=r.work_id;
      while(id){const current=row(id);if(!current)break;db.prepare("UPDATE work SET revision=revision+1 WHERE id=?").run(id);changed(id);id=current.parent_id;}
    });
  });
  return {
    begin, updateRun, report, cancelled, requestCancel, close: off,
    create(scope:{roomId:string;botId:string;messageId:number;turnId:string},raw:unknown,creationKey:string){
      const input=workCreation.parse(raw),assignee=input.assignee??scope.botId;
      return ledger.atomic(()=>{
        if(scope.roomId.startsWith('_')||!db.prepare("SELECT 1 FROM turns WHERE id=? AND room_id=? AND bot_id=? AND status='running' AND json_extract(state_json,'$.messageId')=?").get(scope.turnId,scope.roomId,scope.botId,scope.messageId))throw new WorkError('Work creation requires its active originating conversation.');
        for(const id of [scope.botId,assignee])if(!db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND bot_id=?').get(scope.roomId,id))throw new WorkError('Assignee and caller must belong to this conversation.');
        const title=redactor.redactString(input.title),description=redactor.redactString(input.description);
        const existing=db.prepare('SELECT * FROM work WHERE creation_key=?').get(creationKey) as Row|undefined;
        if(existing){
          if(existing.room_id!==scope.roomId||existing.origin_message_id!==scope.messageId)throw new WorkError('This proposal belongs to another conversation.',409);
          return {...view(existing),alreadyCreated:true};
        }
        const message=ledger.append(scope.roomId,scope.botId,'message',{text:`Accepted Work: ${title}\n${description}`,originMessageId:scope.messageId,originTurnId:scope.turnId});
        const task=begin({roomId:scope.roomId,botId:assignee,messageId:message.id});
        db.prepare("UPDATE work SET title=?,request=?,next_step='Ready to start.',creation_key=?,origin_message_id=?,origin_turn_id=? WHERE id=?").run(title,description,creationKey,scope.messageId,scope.turnId,task.workId);
        changed(task.workId);return view(row(task.workId)!);
      });
    },
    ready,
    linkTool(turnId: string, callId: string, previousId: string) {
      ledger.atomic(() => {
        const previous = db.prepare("SELECT canonical_id FROM work_tool_links WHERE turn_id=? AND call_id=?").get(turnId, previousId) as { canonical_id: string } | undefined;
        db.prepare("INSERT OR IGNORE INTO work_tool_links(turn_id,call_id,canonical_id) VALUES(?,?,?)").run(turnId, callId, previous?.canonical_id ?? previousId);
      });
    },
    get: (id: string) => { const r = publicRow(id); return r ? view(r) : undefined; },
    list(opts: { roomId?: string; botId?: string; parentId?: string; status?: WorkStatus; q?: string; before?: number; limit: number }) {
      const rows = db.prepare(`SELECT * FROM work WHERE substr(room_id,1,1)!='_' AND (? IS NULL OR room_id=?) AND (? IS NULL OR bot_id=?) AND (? IS NULL OR parent_id=?) AND (? IS NULL OR status=?) AND (? IS NULL OR instr(lower(title||' '||request||' '||next_step||' '||bot_id||' '||room_id||' '||coalesce((SELECT name FROM bots WHERE id=work.bot_id),'')||' '||coalesce((SELECT name FROM rooms WHERE id=work.room_id),'')),lower(?))>0) AND (? IS NULL OR seq<?) ORDER BY seq DESC LIMIT ?`).all(opts.roomId ?? null, opts.roomId ?? null, opts.botId ?? null, opts.botId ?? null, opts.parentId ?? null, opts.parentId ?? null, opts.status ?? null, opts.status ?? null, opts.q ?? null, opts.q ?? null, opts.before ?? null, opts.before ?? null, opts.limit + 1) as Row[];
      return { work: rows.slice(0, opts.limit).map(r=>workView(r,ready(r.id))), nextCursor: rows.length > opts.limit ? rows[opts.limit - 1]!.seq : null };
    },
    links(id: string, before: number | undefined, limit: number) {
      if (!publicRow(id)) throw new WorkError("work not found", 404);
      const runs = db.prepare("SELECT seq,id,turn_id AS turnId,message_id AS messageId,status,reason FROM work_runs WHERE work_id=? AND (? IS NULL OR seq<?) ORDER BY seq DESC LIMIT ?").all(id, before ?? null, before ?? null, limit + 1) as { seq: number }[];
      return { runs: runs.slice(0, limit), nextCursor: runs.length > limit ? runs[limit - 1]!.seq : null };
    },
    activity(id: string, before: number | undefined, limit: number, after?: number) {
      const item = publicRow(id); if (!item) throw new WorkError("work not found", 404);
      const forward = after !== undefined;
      const rows = db.prepare(`SELECT e.id,e.room_id,e.actor,e.ts,e.type,substr(e.payload_json,1,4096) AS preview,length(e.payload_json)>4096 AS truncated,
        substr(json_extract(e.payload_json,'$.turnId'),1,200) AS turnId,substr(json_extract(e.payload_json,'$.manifestId'),1,100) AS manifestId,substr(json_extract(e.payload_json,'$.toolCallId'),1,200) AS toolCallId,
        substr(coalesce(json_extract(e.payload_json,'$.tool'),json_extract(e.payload_json,'$.title')),1,200) AS tool,
        substr(json_extract(e.payload_json,'$.status'),1,100) AS status,json_extract(e.payload_json,'$.ok') AS ok,
        substr(json_extract(e.payload_json,'$.message'),1,500) AS message,substr(json_extract(e.payload_json,'$.text'),1,500) AS text
        FROM events e WHERE e.room_id=? AND (e.id=? OR EXISTS(SELECT 1 FROM work_runs r WHERE r.work_id=? AND r.turn_id=json_extract(e.payload_json,'$.turnId')) OR (e.type='work_updated' AND json_extract(e.payload_json,'$.workId')=?)) AND (? IS NULL OR e.id<?) AND (? IS NULL OR e.id>?) ORDER BY e.id ${forward ? "ASC" : "DESC"} LIMIT ?`).all(item.room_id,item.request_id,id,id,before ?? null,before ?? null,after ?? null,after ?? null,limit+1) as {id:number;room_id:string;actor:string;ts:number;type:import("./ledger.js").EventType;preview:string;truncated:number;turnId:string|null;manifestId:string|null;toolCallId:string|null;tool:string|null;status:string|null;ok:number|null;message:string|null;text:string|null}[];
      return { events: (forward ? rows.slice(0,limit) : rows.slice(0,limit).reverse()).map(r => publicRequestEvent({id:r.id,roomId:r.room_id,actor:r.actor,ts:r.ts,type:r.type,payload:r.truncated ? {turnId:r.turnId,manifestId:r.manifestId,toolCallId:r.toolCallId,tool:r.tool,status:r.status,ok:r.ok===1,message:r.message,text:r.text,preview:r.preview.slice(0,2048),detailsTruncated:true} : JSON.parse(r.preview)})), nextCursor:rows.length>limit?rows[limit-1]!.id:null };
    },
    approvals(id: string, before: number | undefined, limit: number) {
      if (!publicRow(id)) throw new WorkError("work not found", 404);
      const rows = db.prepare("SELECT a.rowid AS cursor,a.id,a.turn_id AS turnId,a.status FROM approvals a JOIN work_runs r ON r.turn_id=a.turn_id WHERE r.work_id=? AND (? IS NULL OR a.rowid<?) ORDER BY a.rowid DESC LIMIT ?").all(id, before ?? null, before ?? null, limit + 1) as { cursor: number }[];
      return { approvals: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.cursor : null };
    },
    recover() {
      ledger.atomic(() => {
        const ids = db.prepare("SELECT DISTINCT work_id FROM work_runs WHERE status IN ('queued','running','draining')").all() as { work_id: string }[];
        db.prepare("UPDATE work_runs SET status=CASE WHEN status='draining' AND EXISTS(SELECT 1 FROM turns t WHERE t.id=work_runs.turn_id AND t.status='finished') THEN 'draining' ELSE 'interrupted' END,reason=CASE WHEN status='draining' AND EXISTS(SELECT 1 FROM turns t WHERE t.id=work_runs.turn_id AND t.status='finished') THEN 'Waiting for delegated recovery.' ELSE 'Daemon stopped before execution settled.' END,updated_at=? WHERE status IN ('queued','running','draining') AND NOT(status='queued' AND turn_id IS NULL AND dispatch_claimed=0 AND EXISTS(SELECT 1 FROM work w WHERE w.id=work_runs.work_id AND w.request_id=work_runs.message_id AND w.creation_key IS NOT NULL))").run(Date.now());
        for (const r of ids) refresh(r.work_id);
      });
    },
  };
}
export type Work = ReturnType<typeof createWork>;
