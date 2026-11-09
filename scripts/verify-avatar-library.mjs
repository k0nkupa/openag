// Real gateway/runner/approval/restart flow using an owned temporary daemon and controlled generation.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'openag-avatar-')),ownerToken=randomBytes(32).toString('hex');
let child,base;
async function start(){child=fork(root+'scripts/avatar-fixture.mjs',[dir],{stdio:['ignore','ignore','inherit','ipc']});const ready=once(child,'message',{signal:AbortSignal.timeout(15000)});child.send({ownerToken});base=(await ready)[0].url;}
async function stop(){if(child?.exitCode===null){const done=once(child,'exit',{signal:AbortSignal.timeout(10000)});child.send({type:'stop'});await done;}}
async function req(path,{method='GET',body,token=ownerToken}={}){return fetch(base+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
async function json(path,opts){const r=await req(path,opts);assert.ok(r.ok,path+' '+r.status);return r.json();}
async function until(read,test){const end=Date.now()+15000;do{const result=await read();if(test(result))return result;await new Promise(r=>setTimeout(r,30));}while(Date.now()<end);throw Error('Avatar acceptance deadline');}
async function generate(){const posted=await json('/rooms/dm-coder/messages',{method:'POST',body:{text:'GenerateAvatar'}});const pending=await until(()=>json('/approvals?status=pending'),r=>r.approvals.some(a=>a.toolName==='avatar_library_add'));return {message:posted.message,approval:pending.approvals.find(a=>a.toolName==='avatar_library_add')};}
try{
 await start();assert.equal((await req('/avatars')).headers.get('cache-control'),'no-store');assert.equal((await req('/avatars',{token:null})).status,401);assert.deepEqual((await json('/avatars')).avatars,[]);
 // Shared library additions explicitly require review under the Workspace Write/Ask preset.
 const before=(await json('/bots')).bots;
 const invalid=await json('/rooms/dm-coder/messages',{method:'POST',body:{text:'GenerateAvatarInvalid'}});
 await until(()=>json('/rooms/dm-coder/events'),r=>r.events.some(e=>e.type==='tool_result'&&e.payload.tool==='avatar_preview'&&e.payload.ok===false));
 assert.deepEqual((await json('/avatars')).avatars,[]);
 assert.equal((await json('/rooms/dm-coder/events')).events.some(e=>e.type==='avatar_preview'),false,'Invalid markup/geometry never reaches chat');
 await until(()=>json('/rooms/dm-coder/events'),r=>r.events.some(e=>e.type==='turn_finished'));
 const unattended=await json('/rooms/main/messages',{method:'POST',body:{text:'GenerateAvatarUnattended'}});
 await until(()=>json('/rooms/main/events'),r=>r.events.some(e=>e.type==='tool_result'&&e.payload.tool==='avatar_preview'&&e.payload.ok===false));
 assert.equal((await json('/approvals?status=pending')).approvals.length,0,'Even allowApprovals does not allow unattended generation');
 await json('/rooms/dm-coder/messages',{method:'POST',body:{text:'GenerateAvatarPreviewOnly'}});
 await until(()=>json('/rooms/dm-coder/events'),r=>r.events.some(e=>e.type==='avatar_preview'));
 await until(()=>json('/rooms/dm-coder/events'),r=>r.events.filter(e=>e.type==='turn_finished').length>=2);
 const draftId=(await json('/rooms/dm-coder/events')).events.filter(e=>e.type==='avatar_preview').at(-1).payload.previewId;
 async function refusedBeforeApproval(text,tool){
  const cursor=(await json('/rooms/dm-coder/events')).events.at(-1).id;
  await json('/rooms/dm-coder/messages',{method:'POST',body:{text}});
  const settled=await until(()=>json('/rooms/dm-coder/events'),r=>r.events.some(e=>e.id>cursor&&e.type==='turn_finished'));
  assert.ok(settled.events.some(e=>e.id>cursor&&e.type==='tool_result'&&e.payload.tool===tool&&e.payload.ok===false));
  assert.equal((await json('/approvals?status=pending')).approvals.length,0,'Unattended '+tool+' must be refused before creating an approval');
 }
 await refusedBeforeApproval('GenerateAvatarAddUnattended:'+draftId,'avatar_library_add');
 await refusedBeforeApproval('GenerateAvatarUnattended','avatar_preview');
 let {approval}=await generate();
 assert.equal(approval.canEdit,false);assert.equal(approval.review.avatarDefinition.name,'Test Robot');
 let history=(await json('/rooms/dm-coder/events')).events;
 assert.ok(history.some(e=>e.type==='avatar_preview'&&e.payload.previewId===approval.payload.previewId));
 assert.deepEqual((await json('/avatars')).avatars,[],'Draft is absent before approval');
 assert.equal((await req('/bots/coder/settings',{method:'PUT',body:{avatar:{shape:'custom:'+approval.payload.previewId,color:'blue'}}})).status,400,'Unapproved preview cannot be selected');
 await json('/approvals/'+approval.id,{method:'POST',body:{kind:'ignore',reviewVersion:approval.reviewVersion}});
 await until(()=>json('/rooms/dm-coder/events'),r=>r.events.some(e=>e.type==='turn_finished'&&e.payload.turnId===approval.turnId));
 assert.deepEqual((await json('/avatars')).avatars,[],'Declining adds nothing');
 assert.ok((await json('/rooms/dm-coder/events')).events.some(e=>e.type==='avatar_preview'),'Preview remains in chat');
 ({approval}=await generate());
 const pendingId=approval.id;await stop();await start();
 approval=(await json('/approvals?status=pending')).approvals.find(a=>a.id===pendingId);assert.ok(approval,'Pending proposal survives actual restart');
 assert.equal((await req('/approvals/'+approval.id,{method:'POST',body:{kind:'edit',payload:{previewId:'00000000-0000-0000-0000-000000000000'},reviewVersion:approval.reviewVersion}})).status,409,'Immutable preview cannot be swapped by edit');
 await json('/approvals/'+approval.id,{method:'POST',body:{kind:'accept',reviewVersion:approval.reviewVersion}});
 const registered=(await until(()=>json('/avatars'),r=>r.avatars.length===1)).avatars[0];
 assert.equal(registered.id,'custom:'+approval.payload.previewId);assert.equal(registered.definition.name,'Test Robot');
 assert.deepEqual((await json('/bots')).bots,before,'Adding changes no agent appearance');
 await json('/rooms/main/messages',{method:'POST',body:{text:'GenerateAvatarForeign:'+approval.payload.previewId}});
 await until(()=>json('/rooms/main/events'),r=>r.events.some(e=>e.type==='tool_result'&&e.payload.tool==='avatar_library_add'&&e.payload.ok===false));
 assert.equal((await json('/approvals?status=pending')).approvals.length,0,'Another agent/conversation cannot propose this draft');
 const limited=(await json('/devices',{method:'POST',body:{name:'Avatar viewer'}})).token;
 assert.equal((await json('/avatars',{token:limited})).avatars[0].id,registered.id);
 await json('/bots/coder/settings',{method:'PUT',token:limited,body:{avatar:{shape:registered.id,color:'pink',animated:false}}});
 assert.equal((await json('/bots')).bots.find(b=>b.id==='coder').avatar.shape,registered.id);
 const events=(await json('/rooms/dm-coder/events')).events;
 assert.ok(events.some(e=>e.type==='avatar_library_updated'&&e.payload.id===registered.id));
 await stop();await start();
 assert.equal((await json('/avatars')).avatars[0].id,registered.id,'Library survives an actual process restart');
 assert.equal((await json('/bots')).bots.find(b=>b.id==='coder').avatar.shape,registered.id,'Selection survives restart');
 assert.equal((await json('/work')).work.length,0,'Generation creates no implicit Work');
 assert.equal((await req('/avatars',{method:'POST',body:{definition:registered.definition}})).status,404,'No registration write API');
 // Full access uses automatic registration; the global Never policy still refuses explicit review.
 async function select(preset,botId='coder',roomId='dm-coder'){
  const path='/bots/'+botId+'/permissions?roomId='+roomId,current=await json(path);
  return json(path,{method:'PUT',body:{preset,revision:current.revision,acknowledgeFullAccess:preset==='full-access'}});
 }
 async function addTurn(text){
  const cursor=(await json('/rooms/dm-coder/events')).events.at(-1).id;
  await json('/rooms/dm-coder/messages',{method:'POST',body:{text}});
  const settled=await until(()=>json('/rooms/dm-coder/events'),r=>r.events.some(e=>e.id>cursor&&e.type==='turn_finished'));
  const result=settled.events.find(e=>e.id>cursor&&e.type==='tool_result'&&e.payload.tool==='avatar_library_add');
  assert.ok(result,'Registration must return a tool result');
  assert.equal(result.payload.ok,true,JSON.stringify(result.payload));
  assert.equal(result.payload.executionOutcome,'completed');
  assert.equal(result.payload.approvalId,undefined,'Full access creates no human approval');
  assert.equal((await json('/approvals?status=pending')).approvals.length,0);
  return result.payload.result;
 }
 await select('read-only');
 ({approval}=await generate());
 await json('/approvals/'+approval.id,{method:'POST',body:{kind:'ignore',reviewVersion:approval.reviewVersion}});
 await until(()=>json('/rooms/dm-coder/events'),r=>r.events.some(e=>e.type==='turn_finished'&&e.payload.turnId===approval.turnId));
 const full=await select('full-access');assert.equal(full.approvalPolicy,'never');
 const fresh=await addTurn('GenerateAvatar');
 assert.equal(fresh.added,true,'Full access validates and registers a fresh draft');
 const existing=await addTurn('GenerateAvatarAdd:'+draftId);
 assert.equal(existing.previewId,draftId,'Full access can register an existing same-conversation draft');
 assert.deepEqual(await addTurn('GenerateAvatarAdd:'+draftId),existing,'Repeated registration is idempotent');
 assert.equal((await json('/avatars')).avatars.length,3);
 await refusedBeforeApproval('GenerateAvatarAddUnattended:'+draftId,'avatar_library_add');
 await refusedBeforeApproval('GenerateAvatarForeign:00000000-0000-4000-8000-000000000000','avatar_library_add');
 await select('full-access','boss','main');
 const foreignCursor=(await json('/rooms/main/events')).events.at(-1).id;
 await json('/rooms/main/messages',{method:'POST',body:{text:'GenerateAvatarForeign:'+draftId}});
 const foreign=await until(()=>json('/rooms/main/events'),r=>r.events.some(e=>e.id>foreignCursor&&e.type==='turn_finished'));
 assert.ok(foreign.events.some(e=>e.id>foreignCursor&&e.type==='tool_result'&&e.payload.tool==='avatar_library_add'&&e.payload.ok===false&&/unavailable in this conversation/.test(e.payload.message)),'Full access cannot register another agent/conversation draft');
 assert.equal((await json('/approvals?status=pending')).approvals.length,0);

 assert.deepEqual((await json('/bots')).bots.find(b=>b.id==='coder').avatar,{shape:registered.id,color:'pink',animated:false},'Full access registration does not select an avatar');
 await stop();await start();
 assert.equal((await json('/avatars')).avatars.length,3,'Automatic registrations survive restart');
 const redacted=once(child,'message',{signal:AbortSignal.timeout(5000)});child.send({type:'avatar-secret',value:registered.definition.id});await redacted;
 assert.deepEqual((await json('/avatars')).avatars,[],'Later-registered secrets are not exposed by catalogue reads');
 console.log('PASS preview → review under Ask / automatic registration under Full access → shared library → explicit selection → actual restart; no implicit Work or appearance mutation on registration.');
}finally{await stop();rmSync(dir,{recursive:true,force:true});}
