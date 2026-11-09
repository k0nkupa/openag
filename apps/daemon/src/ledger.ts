import { questionAnswerContext } from "./questions.js";
import { EventEmitter } from "node:events";
import type { Db } from "./db/index.js";
import { getDefaultRedactor, type Redactor } from "./redact.js";

export type EventType =
  | "avatar_preview" | "avatar_library_updated"
  | "agent_request"
  | "mcp_interaction_updated"
  | "request_prepared" | "request_attempt"
  | "model_report"
  | "automation_updated"
  | "question_updated" | "attention_updated"
  | "receipt_updated"
  | "message"
  | "route"
  | "bot_output"
  | "tool_call"
  | "tool_result"
  | "approval_requested"
  | "approval_decided"
  | "turn_started"
  | "turn_finished"
  | "error"
  | "config"
  | "wake"
  | "takeover"
  | "reflection_started"
  | "reflection_finished"
  | "work_updated"
  | "result_saved";

export interface LedgerEvent {
  id: number;
  roomId: string;
  ts: number;
  actor: string;
  type: EventType;
  payload: unknown;
}

interface EventRow {
  id: number;
  room_id: string;
  ts: number;
  actor: string;
  type: EventType;
  payload_json: string;
}

const toEvent = (r: EventRow): LedgerEvent => ({
  id: r.id,
  roomId: r.room_id,
  ts: r.ts,
  actor: r.actor,
  type: r.type,
  payload: JSON.parse(r.payload_json),
});

export interface Ledger {
  atomic<T>(body: () => T): T;
  append(roomId: string, actor: string, type: EventType, payload?: unknown): LedgerEvent;
  get(id: number): LedgerEvent | undefined;
  list(roomId: string, opts?: { afterId?: number; limit?: number }): LedgerEvent[];
  conversationHistory(scope: { roomId:string;botId:string;messageId:number;throughId?:number;afterId?:number }): {throughId:number;messages:LedgerEvent[];omitted?:number;omittedRange?:{firstEligibleId:number;throughExclusive:number}};
  subscribe(roomId: string | "*", cb: (e: LedgerEvent) => void): () => void;
}

export function createLedger(db: Db, redactor: Redactor = getDefaultRedactor()): Ledger {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const insert = db.prepare(
    "INSERT INTO events (room_id, ts, actor, type, payload_json) VALUES (?, ?, ?, ?, ?)",
  );
  const listStmt = db.prepare(
    "SELECT * FROM events WHERE room_id = ? AND id > ? ORDER BY id LIMIT ?",
  );

  let pending: LedgerEvent[] | null = null;
  const publish = (event: LedgerEvent) => { emitter.emit(event.roomId, event); emitter.emit("*", event); };
  const getStmt = db.prepare("SELECT * FROM events WHERE id = ?");

  return {
    atomic<T>(body: () => T): T {
      if (pending) return body();
      const events: LedgerEvent[] = [];
      let result: T;
      try {
        pending = events;
        result = db.transaction(body).immediate();
      } finally { pending = null; }
      for (const event of events) publish(event);
      return result;
    },
    get(id) {
      const row = getStmt.get(id) as EventRow | undefined;
      return row && toEvent(row);
    },
    append(roomId, actor, type, payload = {}) {
      const ts = Date.now();
      const safePayload = redactor.redact(payload ?? {});
      const payloadJson = JSON.stringify(safePayload);
      const { lastInsertRowid } = insert.run(roomId, ts, actor, type, payloadJson);
      const event: LedgerEvent = {
        id: Number(lastInsertRowid),
        roomId,
        ts,
        actor,
        type,
        payload: JSON.parse(payloadJson),
      };
      if (pending) pending.push(event); else publish(event);
      return event;
    },
    list(roomId, { afterId = 0, limit = 500 } = {}) {
      return (listStmt.all(roomId, afterId, limit) as EventRow[]).map(toEvent);
    },
    conversationHistory({roomId,botId,messageId,throughId,afterId=0}) {
      const anchor=throughId??(db.prepare('SELECT coalesce(max(id),0) id FROM events WHERE room_id=?').get(roomId) as {id:number}).id;
      if(!Number.isSafeInteger(anchor)||anchor<0||!Number.isSafeInteger(afterId)||afterId<0)throw Error('Invalid conversation history boundary.');
      if(!db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND bot_id=?').get(roomId,botId))throw Error('Conversation membership unavailable.');
      if(roomId.startsWith('_'))return {throughId:anchor,messages:[]};
      // The numeric index narrows candidates; the original equality retains legacy coercion.
      const where=`e.room_id=? AND e.id<=? AND e.id>? AND e.type IN ('message','bot_output') AND (
        (e.type='message' AND e.id<? AND EXISTS(SELECT 1 FROM turns t WHERE t.room_id=e.room_id AND t.bot_id=? AND CAST(json_extract(t.state_json,'$.messageId') AS NUMERIC)=e.id AND json_extract(t.state_json,'$.messageId')=e.id
          AND coalesce(json_extract(t.state_json,'$.isolated'),0)=0 AND coalesce(json_extract(t.state_json,'$.noIndex'),0)=0 AND json_extract(t.state_json,'$.source') IS NULL))
        OR (e.type='bot_output' AND e.actor=? AND EXISTS(SELECT 1 FROM turns t WHERE t.id=json_extract(e.payload_json,'$.turnId') AND t.room_id=e.room_id AND t.bot_id=? AND t.status IN ('finished','incomplete')
          AND json_extract(t.state_json,'$.messageId')<? AND json_extract(t.state_json,'$.messageId')>? AND coalesce(json_extract(t.state_json,'$.isolated'),0)=0 AND coalesce(json_extract(t.state_json,'$.noIndex'),0)=0 AND json_extract(t.state_json,'$.source') IS NULL))
        OR (e.type='message' AND e.id<? AND EXISTS(SELECT 1 FROM agent_requests a WHERE a.origin_room_id=e.room_id AND a.initiator_bot_id=? AND a.kind='mention' AND (a.origin_message_id=e.id OR a.id=json_extract(e.payload_json,'$.agentRequestId'))))
      )`;
      const args=[roomId,anchor,afterId,messageId,botId,botId,botId,messageId,afterId,messageId,botId];
      const rows=db.prepare(`SELECT e.* FROM events e WHERE ${where} ORDER BY e.id DESC LIMIT 20`).all(...args) as EventRow[];
      // Keep selection bounded; count only the omitted prefix with indexed participation lookups.
      const older=rows.length===20?db.prepare(`SELECT count(*) AS count,min(e.id) AS first FROM events e WHERE ${where} AND e.id<?`).get(...args,rows.at(-1)!.id) as {count:number;first:number}:undefined;
      return {throughId:anchor,messages:[...rows].reverse().map(r=>{
        const event=toEvent(r);
        const question=event.type==='message'&&event.actor==='user'?db.prepare(`SELECT q.context,q.prompt,w.request FROM work_questions q LEFT JOIN work w ON w.id=q.work_id WHERE q.answer_message_id=? AND q.bot_id=? AND q.room_id=? AND q.status='answered'`).get(event.id,botId,roomId) as {context:string;prompt:string|null;request:string|null}|undefined:undefined;
        return question?{...event,payload:{...event.payload as object,text:questionAnswerContext(question,(event.payload as {text:string}).text,question.request??undefined)}}:event;
      }),omitted:older?.count??0,...(older?.count?{omittedRange:{firstEligibleId:older.first,throughExclusive:rows.at(-1)!.id}}:{})};
    },
    subscribe(roomId, cb) {
      emitter.on(roomId, cb);
      return () => {
        emitter.off(roomId, cb);
      };
    },
  };
}
