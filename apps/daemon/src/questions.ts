import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import { getDefaultRedactor } from "./redact.js";
export const inputPrompt = z.string().trim().min(1).max(2000);
export const inputAnswer = z.object({revision:z.number().int().positive(),answer:z.string().trim().min(1).max(8000)}).strict();
export const questionAnswerContext=(question:{context:string;prompt:string|null},answer:string,request=question.context)=>`Continue the existing matter using this answer; it is information, not action permission.\nOriginal request: ${request}\nQuestion: ${question.prompt??question.context}\nAnswer: ${answer}`;
export class QuestionError extends Error { constructor(message:string,public status=409){super(message);} }
interface Row {id:string;seq:number;work_id:string|null;room_id:string;bot_id:string;source_turn_id:string|null;source_tool_call_id:string|null;prompt:string|null;context:string;source:"question"|"work-report";status:"open"|"answered"|"cancelled";revision:number;answer:string|null;answer_message_id:number|null;continuation_state:"queued"|"started"|"finished"|"cancelled"|null;created_at:number;answered_at:number|null}
const view=(r:Row)=>({id:r.id,seq:r.seq,workId:r.work_id,roomId:r.room_id,botId:r.bot_id,sourceTurnId:r.source_turn_id,prompt:r.prompt,context:r.context,source:r.source,status:r.status,revision:r.revision,answer:r.answer,messageId:r.answer_message_id,continuationState:r.continuation_state,createdAt:r.created_at,answeredAt:r.answered_at});
export function createQuestions(db:Db,ledger:Ledger){
 const redact=getDefaultRedactor();
 const row=(id:string)=>db.prepare("SELECT * FROM work_questions WHERE id=?").get(id) as Row|undefined;
 const changed=(r:Row)=>ledger.append(r.room_id,r.bot_id,"question_updated",{questionId:r.id,workId:r.work_id,turnId:r.source_turn_id,revision:r.revision,status:r.status});
 const publish=(r:Row)=>{
  if(!db.prepare("SELECT 1 FROM events WHERE room_id=? AND type='message' AND json_extract(payload_json,'$.questionId')=?").get(r.room_id,r.id))ledger.append(r.room_id,r.bot_id,'message',{text:r.prompt??r.context,questionId:r.id});
 };
 const work=(id:string)=>{
  const w=db.prepare("SELECT * FROM work WHERE id=? AND substr(room_id,1,1)!='_'").get(id) as {id:string;room_id:string;bot_id:string;next_step:string;cancel_requested_at:number|null}|undefined;
  if(!w)throw new QuestionError("work not found",404);return w;
 };
 return {
  get:(id:string)=>{const r=row(id);return r?view(r):undefined;},
  open:(workId:string)=>{const r=db.prepare("SELECT * FROM work_questions WHERE work_id=? AND status='open'").get(workId) as Row|undefined;return r?view(r):undefined;},
  request(workId:string|null,turnId:string|null,prompt:string|null,toolCallId?:string){
   return ledger.atomic(()=>{
    const chat=turnId?db.prepare("SELECT t.room_id,t.bot_id,coalesce(json_extract(e.payload_json,'$.text'),'') next_step FROM turns t JOIN events e ON e.id=json_extract(t.state_json,'$.messageId') WHERE t.id=? AND t.status='running' AND substr(t.room_id,1,1)!='_'").get(turnId) as {room_id:string;bot_id:string;next_step:string}|undefined:undefined;
    if(!workId&&!chat)throw new QuestionError('Input requires an active conversation.');
    const w=workId?{...work(workId),...(chat?{bot_id:chat.bot_id}:{})}:{...chat!,cancel_requested_at:null};if(w.cancel_requested_at!==null)throw new QuestionError("Work was cancelled.");
    const existing=db.prepare("SELECT * FROM work_questions WHERE status='open' AND ((? IS NOT NULL AND work_id=?) OR (? IS NULL AND source_turn_id=?))").get(workId,workId,workId,turnId) as Row|undefined;
    if(existing){if(existing.source_turn_id!==turnId)throw new QuestionError('Another turn has an open question for this Work. Finish it before asking another.');return view(existing);}
    if(turnId&&workId){const turn=db.prepare("SELECT 1 FROM work_runs r JOIN turns t ON t.id=r.turn_id WHERE r.work_id=? AND t.id=? AND t.status='running'").get(workId,turnId);if(!turn)throw new QuestionError("No active matching turn.");}
    if(db.prepare("SELECT 1 FROM approvals WHERE status='pending' AND turn_id=? LIMIT 1").get(turnId)||db.prepare("SELECT 1 FROM action_receipts WHERE outcome='pending' AND turn_id=? LIMIT 1").get(turnId))throw new QuestionError("Finish the current action review or execution before asking for input.");
    const id=randomUUID(),now=Date.now(),safe=prompt===null?null:redact.redactString(inputPrompt.parse(prompt));
    db.prepare("INSERT INTO work_questions(id,work_id,room_id,bot_id,source_turn_id,source_tool_call_id,prompt,context,source,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'open',?)").run(id,workId,w.room_id,w.bot_id,turnId,toolCallId??null,safe,redact.redactString(w.next_step).slice(0,8000),safe===null?"work-report":"question",now);
    db.prepare("UPDATE work SET needs_input=1,next_step=?,revision=revision+1,updated_at=? WHERE id=?").run(safe??w.next_step,now,workId);publish(row(id)!);changed(row(id)!);return view(row(id)!);
   });
  },
  answer(id:string,revision:number,answer:string,messageId:number){
   const r=row(id);if(!r)throw new QuestionError("question not found",404);
   const safe=redact.redactString(answer),w=r.work_id?work(r.work_id):undefined;
   if(r.status==='answered'&&r.answer===safe)return {question:view(r),duplicate:true};
   if(r.status!=='open'||r.revision!==revision||(w&&w.cancel_requested_at!==null))throw new QuestionError("This input request changed or was closed. Review its current state.");
   if(!db.prepare("SELECT 1 FROM room_members WHERE room_id=? AND bot_id=?").get(r.room_id,r.bot_id))throw new QuestionError("The original bot is no longer in this room.");
   db.prepare("UPDATE work_questions SET status='answered',revision=revision+1,answer=?,answer_message_id=?,continuation_state='queued',answered_at=? WHERE id=? AND status='open'").run(safe,messageId,Date.now(),id);
   db.prepare("UPDATE work SET needs_input=0,revision=revision+1,updated_at=? WHERE id=?").run(Date.now(),r.work_id);changed(row(id)!);return {question:view(row(id)!),duplicate:false};
  },
  delivery(messageId:number,botId:string,roomId:string){
   const r=db.prepare("SELECT * FROM work_questions WHERE answer_message_id=? AND bot_id=? AND room_id=? AND status='answered'").get(messageId,botId,roomId) as Row|undefined;
   if(!r)return;
   const state=(db.prepare("SELECT state_json FROM turns WHERE id=coalesce(?,(SELECT turn_id FROM work_runs WHERE work_id=? AND turn_id IS NOT NULL ORDER BY seq DESC LIMIT 1))").get(r.source_turn_id,r.work_id) as {state_json:string|null}|undefined)?.state_json;
   const original=state?JSON.parse(state):{};
   const meta=Object.fromEntries(["permissionParents","sourceWorkId","providerWait","historyAfterId","parentWorkId","resultFor","hop","delegatedBy","delegationId","unattended","allowApprovals","source","noIndex","noNetwork","isolated"].filter(k=>Object.hasOwn(original,k)).map(k=>[k,original[k]]));
   return {question:view(r),meta};
  },
  started(messageId:number){db.prepare("UPDATE work_questions SET continuation_state='started' WHERE answer_message_id=? AND continuation_state='queued'").run(messageId);},
  finished(messageId:number){const r=db.prepare("SELECT * FROM work_questions WHERE answer_message_id=?").get(messageId) as Row|undefined;if(r){db.prepare("UPDATE work_questions SET continuation_state='finished' WHERE id=? AND continuation_state='started'").run(r.id);changed(row(r.id)!);}},
  cancel(workIds:ReadonlySet<string>){for(const id of workIds){for(const r of db.prepare("SELECT * FROM work_questions WHERE work_id=? AND (status='open' OR continuation_state='queued')").all(id) as Row[]){db.prepare("UPDATE work_questions SET status=CASE WHEN status='open' THEN 'cancelled' ELSE status END,continuation_state='cancelled',revision=revision+1 WHERE id=?").run(r.id);changed(row(r.id)!);}}},
  recover(){
   // Older Work reports can retain a real input need without a question record.
   const legacy=db.prepare(`WITH RECURSIVE family(child,ancestor) AS (
     SELECT id,id FROM work UNION ALL SELECT f.child,w.parent_id FROM family f JOIN work w ON w.id=f.ancestor WHERE w.parent_id IS NOT NULL
   ) SELECT DISTINCT w.id FROM work w JOIN family f ON f.child=w.id JOIN work root ON root.id=f.ancestor JOIN events e ON e.id=root.request_id
   WHERE root.parent_id IS NULL AND (root.creation_key IS NOT NULL OR e.actor='user' OR json_extract(e.payload_json,'$.source')='slack')
   AND w.needs_input=1 AND w.cancel_requested_at IS NULL AND substr(w.room_id,1,1)!='_'
   AND NOT EXISTS(SELECT 1 FROM work_questions q WHERE q.work_id=w.id)
   AND NOT EXISTS(SELECT 1 FROM work_runs r JOIN turns t ON t.id=r.turn_id WHERE r.work_id=w.id AND (json_extract(t.state_json,'$.unattended')=1 OR json_extract(t.state_json,'$.isolated')=1))
   AND NOT EXISTS(SELECT 1 FROM approvals a JOIN work_runs r ON r.turn_id=a.turn_id WHERE r.work_id=w.id AND a.status='pending')
   AND NOT EXISTS(SELECT 1 FROM action_receipts a WHERE a.work_id=w.id AND a.outcome='pending')`).all() as {id:string}[];
   for(const r of legacy)this.request(r.id,null,null);
   for(const r of db.prepare("SELECT * FROM work_questions WHERE status='open' AND substr(room_id,1,1)!='_'").all() as Row[])publish(r);
   for(const r of db.prepare("SELECT q.* FROM work_questions q LEFT JOIN work w ON w.id=q.work_id WHERE q.source_turn_id IS NOT NULL AND w.cancel_requested_at IS NULL").all() as Row[]){
    db.prepare("UPDATE turns SET status='finished',updated_at=? WHERE id=? AND status IN ('running','interrupted')").run(Date.now(),r.source_turn_id);
    db.prepare("UPDATE work_runs SET status='completed',reason='Paused for input',updated_at=? WHERE turn_id=? AND status IN ('queued','running','interrupted','draining')").run(Date.now(),r.source_turn_id);
   }
   const pending=db.prepare("SELECT q.* FROM work_questions q JOIN work_runs r ON r.message_id=q.answer_message_id AND r.work_id=q.work_id JOIN work w ON w.id=q.work_id WHERE q.status='answered' AND q.continuation_state='queued' AND r.turn_id IS NULL AND r.status IN ('queued','interrupted') AND w.cancel_requested_at IS NULL").all() as Row[];
   for(const r of pending)db.prepare("UPDATE work_runs SET status='queued',dispatch_claimed=0 WHERE message_id=? AND work_id=? AND turn_id IS NULL").run(r.answer_message_id,r.work_id);
   const chatPending=db.prepare("SELECT q.* FROM work_questions q WHERE q.work_id IS NULL AND q.status='answered' AND q.continuation_state='queued' AND NOT EXISTS(SELECT 1 FROM turns t WHERE t.bot_id=q.bot_id AND t.room_id=q.room_id AND json_extract(t.state_json,'$.messageId')=q.answer_message_id)").all() as Row[];
   for(const r of chatPending)db.prepare('DELETE FROM chat_dispatches WHERE room_id=? AND bot_id=? AND message_id=? AND turn_id IS NULL').run(r.room_id,r.bot_id,r.answer_message_id);
   return [...pending,...chatPending].map(view);
  },
 };
}
export type Questions=ReturnType<typeof createQuestions>;
