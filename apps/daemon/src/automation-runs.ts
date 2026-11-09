import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {Db} from "./db/index.js";
import type {Ledger} from "./ledger.js";
import type {Automation} from "./automations.js";
import {getDefaultRedactor} from "./redact.js";
export type DiagnosticOutcome="missed"|"skipped"|"start_failed"|"coverage_gap";
export interface ScheduleAdmission { key:string; revision:string; dueAt:number; nextAt:number; }
export type RunOutcome="running"|"quiet"|"completed"|"incomplete"|"cancelled"|"failed"|"interrupted"|DiagnosticOutcome;
export const automationRunQuery=z.object({automationId:z.string().min(1).max(100).optional(),before:z.coerce.number().int().positive().optional(),limit:z.coerce.number().int().min(1).max(50).default(25)}).strict();
interface Row {seq:number;id:string;automation_id:string;snapshot_json:string;trigger:string;event:string|null;started_at:number|null;record_kind:"run"|"diagnostic";observed_at:number|null;scheduled_at:number|null;gap_until:number|null;reason:string|null;phase:string|null;occurrence_key:string|null;ended_at:number|null;outcome:RunOutcome;summary:string;execution_room_id:string|null;message_id:number|null;turn_id:string|null;work_id:string|null;wake_decision_id:number|null;delivery_json:string}
export interface RunDelivery {kind:"none"|"room"|"digest"|"ping"|"suppressed";destination?:string;referenceId?:number}
export function automationSnapshot(a:Automation){return getDefaultRedactor().redact({name:a.name,purpose:a.prompt,botId:a.botId,roomId:a.roomId,triggerKind:a.triggerKind,outputMode:a.outputMode,tz:a.tz,scheduleCron:a.scheduleCron,pollRepo:a.pollRepo,pollEveryMinutes:a.pollEveryMinutes,events:a.hookEvents,allowApprovals:a.allowApprovals,allowTools:a.allowTools});}
export function createAutomationRuns(db:Db,ledger:Ledger,now:()=>number=Date.now){
 const redact=getDefaultRedactor();
 const view=(r:Row)=>({seq:r.seq,id:r.id,automationId:r.automation_id,snapshot:JSON.parse(r.snapshot_json),trigger:r.trigger,event:r.event,recordKind:r.record_kind,observedAt:r.observed_at,scheduledAt:r.scheduled_at,gapUntil:r.gap_until,reason:r.reason,phase:r.phase,startedAt:r.started_at,endedAt:r.ended_at,outcome:r.outcome,summary:r.summary,roomId:r.execution_room_id?.startsWith('_')?null:r.execution_room_id,messageId:r.execution_room_id?.startsWith('_')?null:r.message_id,turnId:r.turn_id,workId:r.execution_room_id?.startsWith('_')?null:r.work_id,wakeDecisionId:r.wake_decision_id,delivery:JSON.parse(r.delivery_json) as RunDelivery});
 const row=(id:string)=>db.prepare("SELECT * FROM automation_runs WHERE id=?").get(id) as Row|undefined;
 const changed=(r:Row)=>ledger.append('_system','scheduler','automation_updated',{automationId:r.automation_id,runId:r.id,outcome:r.outcome});
 return {
  get:(id:string)=>{const r=row(id);return r?view(r):undefined;},
  list(query:z.infer<typeof automationRunQuery>){const rows=db.prepare("SELECT * FROM automation_runs WHERE (? IS NULL OR automation_id=?) AND (? IS NULL OR seq<?) ORDER BY seq DESC LIMIT ?").all(query.automationId??null,query.automationId??null,query.before??null,query.before??null,query.limit+1) as Row[];return {runs:rows.slice(0,query.limit).map(view),nextCursor:rows.length>query.limit?rows[query.limit-1]!.seq:null};},
  start(a:Automation,trigger:string,event?:string,schedule?:ScheduleAdmission){return ledger.atomic(()=>{
   const id=randomUUID(),snapshot=automationSnapshot(a);
   db.prepare("INSERT INTO automation_runs(id,automation_id,snapshot_json,trigger,event,started_at,outcome,observed_at,scheduled_at,occurrence_key) VALUES(?,?,?,?,?,?,'running',?,?,?)").run(id,a.id,JSON.stringify(snapshot),trigger,event?redact.redactString(event).slice(0,200):null,now(),now(),schedule?.dueAt??null,schedule?.key??null);
   if(schedule)db.prepare("UPDATE automation_schedule_state SET next_due=? WHERE automation_id=? AND revision=?").run(schedule.nextAt,a.id,schedule.revision);
   db.prepare("UPDATE automations SET last_run_at=?,last_status='running',last_turn_id=NULL,last_verdict=NULL WHERE id=?").run(now(),a.id);if(trigger==='webhook')ledger.append('_system','hook','config',{action:'automation_hook_fired',automationId:a.id,name:a.name,event:event??null});changed(row(id)!);return id;
  });},
  diagnostic(input:{automationId:string;snapshot:unknown;key:string;outcome:DiagnosticOutcome;reason:string;phase:string;dueAt?:number;gapUntil?:number;summary:string}){return ledger.atomic(()=>{
   const id=randomUUID();
   const inserted=db.prepare("INSERT INTO automation_runs(id,automation_id,snapshot_json,trigger,started_at,ended_at,outcome,summary,record_kind,observed_at,scheduled_at,gap_until,reason,phase,occurrence_key) VALUES(?,?,?,'schedule',NULL,?,?,?,'diagnostic',?,?,?,?,?,?) ON CONFLICT(occurrence_key) DO NOTHING").run(id,input.automationId,JSON.stringify(redact.redact(input.snapshot)),now(),input.outcome,redact.redactString(input.summary).slice(0,4000),now(),input.dueAt??null,input.gapUntil??null,input.reason,input.phase,input.key);
   if(inserted.changes)changed(row(id)!);
  });},
  link(id:string,roomId:string,messageId:number,turnId?:string){
   db.prepare("UPDATE automation_runs SET execution_room_id=?,message_id=?,turn_id=coalesce(?,turn_id),work_id=(SELECT id FROM work WHERE room_id=? AND request_id=? AND bot_id=json_extract(automation_runs.snapshot_json,'$.botId')) WHERE id=? AND outcome='running'").run(roomId,messageId,turnId??null,roomId,messageId,id);
  },
  finish(id:string,outcome:Exclude<RunOutcome,'running'>,summary:string,delivery:RunDelivery,wakeId?:number){ledger.atomic(()=>{
   const r=row(id);if(!r||r.outcome!=='running')return;
   db.prepare("UPDATE automation_runs SET outcome=?,summary=?,delivery_json=?,wake_decision_id=?,ended_at=? WHERE id=? AND outcome='running'").run(outcome,redact.redactString(summary).slice(0,4000),JSON.stringify(redact.redact(delivery)),wakeId??null,now(),id);
   db.prepare("UPDATE automations SET last_status=?,last_turn_id=?,last_verdict=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM automation_runs n WHERE n.automation_id=? AND n.seq>? AND n.record_kind='run')").run(outcome,r.turn_id,wakeId?(db.prepare('SELECT decision FROM wake_decisions WHERE id=?').get(wakeId) as {decision:string}|undefined)?.decision??null:null,r.automation_id,r.automation_id,r.seq);changed(row(id)!);
  });},
  evidence(id:string,delivery:RunDelivery,wakeId:number){db.prepare("UPDATE automation_runs SET delivery_json=?,wake_decision_id=? WHERE id=? AND outcome='running'").run(JSON.stringify(redact.redact(delivery)),wakeId,id);},
  recover(reason="Daemon restarted before this run settled. No action was replayed."){
   for(const r of db.prepare("SELECT * FROM automation_runs WHERE outcome='running'").all() as Row[]){
    const wake=r.turn_id?db.prepare("SELECT id,decision FROM wake_decisions WHERE turn_id=? ORDER BY id DESC LIMIT 1").get(r.turn_id) as {id:number;decision:string}|undefined:undefined;
    const publicOutput=r.turn_id&&r.execution_room_id&&!r.execution_room_id.startsWith('_')?db.prepare("SELECT id FROM events WHERE room_id=? AND type='bot_output' AND json_extract(payload_json,'$.turnId')=? ORDER BY id DESC LIMIT 1").get(r.execution_room_id,r.turn_id) as {id:number}|undefined:undefined;
    const ping=wake?.decision==='ping'?db.prepare("SELECT id,room_id FROM events WHERE type='message' AND room_id NOT LIKE '\\_%' ESCAPE '\\' AND json_extract(payload_json,'$.decisionId')=? AND json_extract(payload_json,'$.wake')=1 ORDER BY id DESC LIMIT 1").get(wake.id) as {id:number;room_id:string}|undefined:undefined;
    const digest=wake?.decision==='digest'?db.prepare("SELECT id FROM digest_items WHERE decision_id=?").get(wake.id) as {id:number}|undefined:undefined;
    const delivery:RunDelivery=ping?{kind:'ping',destination:ping.room_id,referenceId:ping.id}:digest?{kind:'digest',destination:'morning digest',referenceId:digest.id}:publicOutput?{kind:'room',destination:r.execution_room_id!,referenceId:publicOutput.id}:JSON.parse(r.delivery_json);
    this.finish(r.id,'interrupted',reason,delivery,wake?.id??r.wake_decision_id??undefined);
   }
  },
 };
}
