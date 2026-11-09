import { effectScope, protectScope, scopesConflict, type EffectScope } from "./effect-scope.js";
import { classify } from "./policy.js";
import { createHash, randomUUID } from "node:crypto";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import { getDefaultRedactor, type Redactor } from "./redact.js";
import type { Approval, Decision } from "./approvals.js";

export type ExecutionOutcome = "pending" | "completed" | "failed" | "unknown" | "not-run";
export interface ExecutionEvidence { outcome: Exclude<ExecutionOutcome,"pending">; detail: string; reference?: string; result?: unknown; effectVerification?: "not-checked" }
export interface ActionReceipt {
  effectScope: EffectScope; permission: unknown | null; id: string; approvalId: string | null; reviewVersion: string; roomId: string; botId: string; workId: string | null;
  turnId: string | null; toolCallId: string | null; toolName: string; decision: Approval["status"] | "automatic";
  proposal: unknown; effective: unknown; outcome: ExecutionOutcome; evidence: unknown;
  decidedAt: number; startedAt: number | null; finishedAt: number | null; inspectedAt:number|null;inspection:{note:string;reference:string}|null;
}
export function conflictDetails(receipt:ActionReceipt,roomId:string) {
  const pending=receipt.outcome==='pending',own=receipt.roomId===roomId;
  return {reason:'receipt_conflict' as const,nextStep:pending?'wait' as const:'owner_inspection' as const,...(own?{blockingReceiptId:receipt.id}:{}),message:pending?`A conflicting action is still running.${own?' Receipt '+receipt.id+'.':''} Wait for its result before a fresh proposal.`:`A conflicting action${own?'':' in another conversation'} needs owner inspection.${own?' Receipt '+receipt.id+'.':''} Ask the owner to inspect the retained receipt before a fresh proposal; do not repeat it. Unrelated bounded reads remain available.`};
}
export class ActionFailure extends Error {
  constructor(message: string, public readonly outcome: "failed" | "not-run" = "failed", public readonly conflict?:ReturnType<typeof conflictDetails>) { super(message); }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(",")}}`;
}
interface ReceiptRow {
  effect_scope_json:string|null;seq:number;id:string;approval_id:string|null;tool_class:string;inspection_epoch:number;permission_session_id:string|null;permission_revision:number|null;permission_json:string|null;review_version:string;room_id:string;bot_id:string;work_id:string|null;turn_id:string|null;tool_call_id:string|null;
  tool_name:string;decision:Approval["status"]|"automatic";proposal_json:string;effective_json:string;outcome:ExecutionOutcome;evidence_json:string;
  decided_at:number;started_at:number|null;finished_at:number|null;inspected_at:number|null;inspection_json:string|null;
}
const rowView = (r: ReceiptRow): ActionReceipt => ({
  effectScope:r.effect_scope_json?effectScope(JSON.parse(r.effect_scope_json)):{kind:"opaque"},
  permission:r.permission_json?JSON.parse(r.permission_json):null,id:r.id,approvalId:r.approval_id,reviewVersion:r.review_version,roomId:r.room_id,botId:r.bot_id,workId:r.work_id,
  turnId:r.turn_id,toolCallId:r.tool_call_id,toolName:r.tool_name,decision:r.decision,
  proposal:JSON.parse(r.proposal_json),effective:JSON.parse(r.effective_json),outcome:r.outcome,evidence:JSON.parse(r.evidence_json),
  decidedAt:r.decided_at,startedAt:r.started_at,finishedAt:r.finished_at,inspectedAt:r.inspected_at,inspection:r.inspection_json?JSON.parse(r.inspection_json):null,
});
export function createActionReceipts(db: Db, ledger: Ledger, redactor: Redactor = getDefaultRedactor()) {
  const safe = (value: unknown) => redactor.redact(value ?? null);
  const key = (tool: string, args: unknown) => {
    const value = safe(args) as Record<string,unknown> | null;
    const target = value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(["path","file_path","command","url","to","recipient","destination","channel"].filter(k => Object.hasOwn(value,k)).map(k => [k,value[k]])) : {};
    return createHash("sha256").update(canonical([tool,Object.keys(target).length ? target : "opaque target; all calls to this tool require inspection"])).digest("hex");
  };
  const get = (id: string): ActionReceipt | undefined => {
    const row = db.prepare("SELECT * FROM action_receipts WHERE id=?").get(id) as ReceiptRow|undefined;
    return row ? rowView(row) : undefined;
  };
  const changed = (id: string) => {
    const r = get(id)!;
    ledger.append(r.roomId,"daemon","receipt_updated",{receiptId:id,approvalId:r.approvalId,workId:r.workId,turnId:r.turnId,toolCallId:r.toolCallId,outcome:r.outcome});
  };
  const storedScope = (scope: EffectScope): EffectScope => protectScope(scope,safe);
  const candidates = () => (db.prepare("SELECT * FROM action_receipts WHERE (outcome='unknown' AND inspected_at IS NULL) OR (outcome='pending' AND started_at IS NOT NULL) ORDER BY seq").all() as ReceiptRow[]).map(rowView);
  const inspectionEpoch=(scope: EffectScope = {kind:'opaque'})=> (db.prepare("SELECT * FROM action_receipts WHERE inspected_at IS NOT NULL").all() as ReceiptRow[]).map(rowView).filter(r=>scopesConflict(scope,r.effectScope)).length;
  const blocker = (scope: EffectScope) => candidates().find(r=>scopesConflict(scope,r.effectScope));
  const blocked = (_botId:string,_tool:string,_args:unknown,toolClass?:ReturnType<typeof classify>,scope?:EffectScope) => !!blocker(scope??{kind:'opaque'});
  return {
    get,
    blocked,
    blocker,
    inspectionEpoch,
    unknownWork:(id:string)=>!!db.prepare("SELECT 1 FROM action_receipts WHERE work_id=? AND outcome='unknown' AND inspected_at IS NULL LIMIT 1").get(id),
    unknownChat:(roomId:string)=>!!db.prepare("SELECT 1 FROM action_receipts WHERE room_id=? AND work_id IS NULL AND outcome='unknown' AND inspected_at IS NULL LIMIT 1").get(roomId),
    inspect(id:string,version:string,note:string,reference:string) {
      ledger.atomic(()=>{
        const r=get(id);
        if(!r||r.reviewVersion!==version||r.outcome!=="unknown"||r.inspectedAt!==null)throw new Error("Receipt changed or does not need inspection.");
        db.prepare("UPDATE action_receipts SET inspected_at=?,inspection_json=? WHERE id=? AND outcome='unknown' AND inspected_at IS NULL").run(Date.now(),JSON.stringify(safe({note,reference})),id);
        changed(id);
      });
      return get(id)!;
    },
    record(a: Approval, decision: Decision) {
      const effective = decision.kind === "edit" ? decision.payload : a.payload;
      const workId = a.turnId ? (db.prepare("SELECT work_id FROM work_runs WHERE turn_id=?").get(a.turnId) as {work_id:string}|undefined)?.work_id : null;
      const notRun = decision.kind === "ignore" || decision.kind === "respond";
      db.prepare(`INSERT INTO action_receipts(id,approval_id,tool_class,inspection_epoch,permission_session_id,permission_revision,permission_json,review_version,room_id,bot_id,work_id,turn_id,tool_call_id,tool_name,action_key,decision,proposal_json,effective_json,outcome,evidence_json,decided_at,finished_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.id,a.id,a.toolClass,(db.prepare("SELECT inspection_epoch FROM approvals WHERE id=?").get(a.id) as {inspection_epoch:number}).inspection_epoch,typeof a.review?.permissionSessionId==='string'?a.review.permissionSessionId:null,typeof a.review?.permissionRevision==='number'?a.review.permissionRevision:null,a.review?.permission?JSON.stringify(safe(a.review.permission)):null,a.reviewVersion,a.roomId,a.botId,workId??null,a.turnId,a.toolCallId,a.toolName,key(a.toolName,effective),a.status,JSON.stringify(safe(a.payload)),JSON.stringify(safe(effective)),notRun?"not-run":"pending",JSON.stringify({detail:notRun?"This decision did not authorize execution.":"Permission recorded; execution is not confirmed."}),a.decidedAt,notRun?Date.now():null);
      db.prepare("UPDATE action_receipts SET effect_scope_json=? WHERE id=?").run(JSON.stringify(storedScope(effectScope(a.review?.effectScope))),a.id);
      changed(a.id);
    },
    automatic(req:{roomId:string;botId:string;turnId:string;toolCallId:string;toolName:string;toolClass?:ReturnType<typeof classify>;args:unknown;workId?:string}, permission:import("./permissions.js").PermissionSession,execution?:import("./execution.js").ExecutionPolicy,context?:{effectScope?:EffectScope;approvalPolicy?:'ask'|'never';parents:readonly import("./permissions.js").PermissionReference[]}) {
      const id=randomUUID(),now=Date.now(),scope=storedScope(context?.effectScope??{kind:'opaque'});
      db.prepare(`INSERT INTO action_receipts(id,approval_id,review_version,room_id,bot_id,work_id,turn_id,tool_call_id,tool_name,tool_class,inspection_epoch,permission_session_id,permission_revision,permission_json,action_key,decision,proposal_json,effective_json,outcome,evidence_json,decided_at)
        VALUES(?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?, 'automatic',?,?,'pending',?,?)`).run(id,randomUUID(),req.roomId,req.botId,req.workId??null,req.turnId,req.toolCallId,req.toolName,req.toolClass??classify(req.toolName),inspectionEpoch(scope),permission.id,permission.revision,JSON.stringify(safe({preset:permission.preset,sessionId:permission.id,revision:permission.revision,execution,...context})),key(req.toolName,req.args),JSON.stringify(safe(req.args)),JSON.stringify(safe(req.args)),JSON.stringify({detail:'Authorized by the selected permission mode; no human approval occurred.'}),now);
      db.prepare("UPDATE action_receipts SET effect_scope_json=? WHERE id=?").run(JSON.stringify(scope),id);
      changed(id);return id;
    },
    start(id: string, turnId: string | null, toolCallId: string | null) {
      ledger.atomic(() => {
        const r = get(id);
        if (!r || r.outcome !== "pending" || r.startedAt !== null) throw new ActionFailure("This approval cannot execute again.","not-run");
        const approval=db.prepare("SELECT tool_class,inspection_epoch,permission_session_id FROM action_receipts WHERE id=?").get(id) as {tool_class:string;inspection_epoch:number;permission_session_id:string|null};
        if(approval.inspection_epoch!==inspectionEpoch(r.effectScope))throw new ActionFailure("A conflicting target inspection occurred after this proposal. Request a fresh proposal.","not-run");
        const blocking=blocker(r.effectScope);if(blocking){const conflict=conflictDetails(blocking,r.roomId);throw new ActionFailure(conflict.message,"not-run",conflict);}
        db.prepare("UPDATE action_receipts SET started_at=?,turn_id=coalesce(?,turn_id),tool_call_id=coalesce(?,tool_call_id) WHERE id=? AND outcome='pending' AND started_at IS NULL").run(Date.now(),turnId,toolCallId,id);
        changed(id);
      });
    },
    finish(id: string, evidence: ExecutionEvidence) {
      ledger.atomic(() => {
        const res=db.prepare("UPDATE action_receipts SET outcome=?,evidence_json=?,finished_at=? WHERE id=? AND outcome='pending'").run(evidence.outcome,JSON.stringify(safe({detail:evidence.detail.slice(0,1500),...(evidence.effectVerification?{effectVerification:evidence.effectVerification}:{}),...(evidence.reference?{reference:evidence.reference.slice(0,500)}:{}),...(evidence.result===undefined?{}:{result:evidence.result})})),Date.now(),id);
        if(res.changes)changed(id);
      });
    },
    recover(turnId?: string) {
      const rows=db.prepare("SELECT * FROM action_receipts WHERE outcome='pending' AND (? IS NULL OR turn_id=?)").all(turnId??null,turnId??null) as ReceiptRow[];
      for(const r of rows){const read=rowView(r).effectScope.kind==='read';this.finish(r.id,{outcome:r.started_at===null?"not-run":read?"failed":"unknown",detail:r.started_at===null?"Execution had not started before the turn ended.":read?"Read invocation ended without a result; no mutation was attempted.":"Execution started but no final evidence was recorded. Inspect the target; do not repeat blindly."});}
    },
    forWork(workId: string, before?: number) {
      const rows=db.prepare("SELECT * FROM action_receipts WHERE work_id=? AND (? IS NULL OR seq<?) ORDER BY seq DESC LIMIT 51").all(workId,before??null,before??null) as ReceiptRow[];
      return {receipts:rows.slice(0,50).map(rowView),nextCursor:rows.length>50?rows[49].seq:null};
    },
  };
}
export type ActionReceipts = ReturnType<typeof createActionReceipts>;
