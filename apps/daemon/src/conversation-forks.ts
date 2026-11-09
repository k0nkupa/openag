import { z } from 'zod';
import type { Db } from './db/index.js';
import type { Ledger } from './ledger.js';
import { getRoom } from './rooms.js';
import { createDeskRoom, readRoomCreation, RoomCreationError } from './roomcreation.js';
import { getDefaultRedactor } from './redact.js';

const schema = z.object({requestId:z.string().uuid(),throughId:z.number().int().positive().safe()}).strict();
type Line = {actor:string;type:'message'|'bot_output';text:string;eventId:number;attachments?:string[]};

/** Owner-selected text snapshot. Execution evidence and grants stay in the source conversation. */
export function forkConversation(db:Db,ledger:Ledger,sourceId:string,body:unknown) {
  const parsed=schema.safeParse(body);
  if(!parsed.success)throw new RoomCreationError('A creation request id and message checkpoint are required.');
  const {requestId,throughId}=parsed.data;
  return ledger.atomic(()=>{
    const prior=readRoomCreation(db,requestId);
    if(prior){
      const fork=db.prepare('SELECT source_room_id,through_id FROM conversation_forks WHERE room_id=?').get(prior.id) as {source_room_id:string;through_id:number}|undefined;
      if(!fork||fork.source_room_id!==sourceId||fork.through_id!==throughId)throw new RoomCreationError('This creation request belongs to another checkpoint.',409);
      return {room:prior,created:false};
    }
    const source=getRoom(db,sourceId),checkpoint=ledger.get(throughId);
    if(!source||sourceId.startsWith('_')||!checkpoint||checkpoint.roomId!==sourceId||!['message','bot_output'].includes(checkpoint.type)||typeof (checkpoint.payload as {text?:unknown}|null)?.text!=='string'||(checkpoint.payload as {internalConsultation?:boolean}|null)?.internalConsultation)throw new RoomCreationError('Checkpoint must be a visible conversation message.');
    const rows=db.prepare("SELECT id,actor,type,payload_json FROM events WHERE room_id=? AND id<=? AND type IN ('message','bot_output') ORDER BY id LIMIT 201").all(sourceId,throughId) as Array<{id:number;actor:string;type:Line['type'];payload_json:string}>;
    const lines:Line[]=[];
    for(const row of rows){
      const p=JSON.parse(row.payload_json);
      if(!p||typeof p!=='object'||Array.isArray(p)||p.internalConsultation||typeof p.text!=='string')continue;
      const attachments=Array.isArray(p.attachments)?p.attachments.filter((a:unknown)=>a&&typeof a==='object'&&typeof (a as {name?:unknown}).name==='string').map((a:{name:string})=>a.name):[];
      lines.push({actor:row.actor,type:row.type,text:p.text,eventId:row.id,...(attachments.length?{attachments}:{})});
    }
    const transcript=getDefaultRedactor().redact(lines);
    const serialized=JSON.stringify(transcript);
    if(rows.length>200||Buffer.byteLength(serialized)>24*1024)throw new RoomCreationError('This checkpoint exceeds the fork limit of 200 messages or 24 KiB. Choose an earlier checkpoint.');
    const result=createDeskRoom(db,ledger,{id:'fork-'+requestId,name:(source.name.slice(0,65)+' · Fork').slice(0,80),kind:'room',members:source.members,lead:source.leadBotId,requestId});
    db.prepare('INSERT INTO conversation_forks(room_id,source_room_id,through_id,transcript_json) VALUES (?,?,?,?)').run(result.room.id,sourceId,throughId,serialized);
    for(const line of transcript)ledger.append(result.room.id,line.actor,line.type,{text:line.text,...(line.attachments?.length?{attachmentReferences:line.attachments}:{}),forkSource:{roomId:sourceId,eventId:line.eventId}});
    ledger.append('_system','owner','config',{action:'conversation_forked',roomId:result.room.id,sourceRoomId:sourceId,throughId,messages:transcript.length});
    return result;
  });
}

export function forkContext(db:Db,roomId:string):string|undefined {
  const row=db.prepare('SELECT transcript_json FROM conversation_forks WHERE room_id=?').get(roomId) as {transcript_json:string}|undefined;
  return row?getDefaultRedactor().redactString(row.transcript_json):undefined;
}
