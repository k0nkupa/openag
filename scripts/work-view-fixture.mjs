import { assignedWorkDispatch } from './assigned-work-fixture.mjs';
// Disposable daemon for the Work UI acceptance script. No model account or external computer.
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {realpathSync,mkdirSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
for(const key of Object.keys(process.env))if(!['PATH','HOME','LANG','TMPDIR'].includes(key))delete process.env[key];
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const {serve}=require('@hono/node-server');
const {openDb}=await load('db/index'),{createBot,createRoom,addMember,listBots}=await load('rooms'),{createLedger}=await load('ledger'),{createAuth}=await load('auth'),{createApprovals}=await load('approvals'),{createRunner}=await load('runtimes/runner'),{createGateway,attachStream}=await load('gateway'),{createFirstPartyTools}=await load('tools/firstparty'),{createResults}=await load('results'),{createDriverComputer}=await load('computer/driver'),{createTakeover}=await load('takeover'),{createViewProxy}=await load('computerview'),{toExecutors}=await load('tools/registry'),{ActionFailure}=await load('action-receipts'),{defaultTools}=await load('tools/index');
const {z}=require('zod');
const dir=process.argv[2];if(!dir||!realpathSync(dir).startsWith(join(realpathSync(tmpdir()),'openag-view-')))throw Error('Owned temporary directory required');
process.once('message',({ownerToken,port=0})=>{
 const db=openDb(dir),ledger=createLedger(db),auth=createAuth({db,ownerToken}),approvals=createApprovals(db,ledger),results=createResults(db,ledger);
 if(!listBots(db).length){
  for(const [id,name,color]of[['boss','Boss','blue'],['coder','Coder','red'],['helper','Researcher','teal']])createBot(db,{id,name,runtime:'api',config:{avatar:{shape:'blob',color},description:'Controlled verification agent'}});
  for(const[id,members]of[['main',['boss','coder','helper']],['other',['boss','helper']],['dm-boss',['boss']],['dm-coder',['coder']],['_internal',['boss']]]){createRoom(db,{id,leadBotId:members[0]});for(const bot of members)addMember(db,id,bot);}
 }
 const counts={};let suspendDispatch=false,actions=0,viewerOrigin='http://127.0.0.1:1',wsActive=0;
 const ticket=randomBytes(32).toString('hex'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAbUlEQVR4nA3JQQEAMAgDMaRUClIqpVIQcQKQgpQt31QVKrpwkWKKLa6oEhItLCJGrDj9aNR04ybNNNtc/zAybWxixqw5/wgKHRwSJmy4/Bg09OAhwww73PxYtPTiJcssu9z+OHT04SPHHHvc8QDNxmUBg7F8NQAAAABJRU5ErkJggg==','base64');
 const driver={kind:'docker',name:'Controlled verification computer',capabilities:{shell:false,view:'proxy'},inspect:async()=>({state:'running',status:'Controlled verification session',image:'synthetic',kind:'controlled',runtime:'controlled'}),create:async()=>{},start:async()=>{},stop:async()=>{},destroy:async()=>{},screenshot:async()=>png,act:async()=>{actions++;return{message:'Controlled input recorded'};},shell:async()=>{throw Error('No shell in this fixture');},viewLink:async()=>({origin:viewerOrigin,fragment:'ticket='+ticket,expiresAt:Date.now()+3600000})};
 const computer=createDriverComputer(driver,{dataDir:dir,ledger}),takeover=createTakeover({computer,ledger}),viewProxy=createViewProxy({takeover});
 const firstParty=createFirstPartyTools({computer,pusher:{status:()=>({configured:false,enabled:false})},results});
 const actionTools=toExecutors([{name:'receipt_send',class:'act-external',description:'Synthetic receipt acceptance check',input:z.object({to:z.string().min(1).max(80),text:z.string().min(1).max(200),mode:z.enum(['normal','reject','lost','hold'])}).strict(),
  execute:async(_ctx,args)=>{if(args.mode==='reject')throw new ActionFailure('Controlled provider refused the action before any side effect.');appendFileSync(join(dir,'action-markers.jsonl'),JSON.stringify(args)+'\n');if(args.mode==='lost')throw Error('Controlled response lost after the side effect.');if(args.mode==='hold')await new Promise(()=>{});return {accepted:true,reference:'synthetic-acceptance-'+args.to};},
  confirm:result=>({outcome:result.accepted?'completed':'unknown',detail:'Controlled provider accepted this action; delivery is not confirmed.',reference:result.reference})}]);
 const held=new Map();
 function hold(ctx){if(ctx.signal.aborted)return Promise.reject(new Error('Controlled wait already ended'));held.set(ctx.message.id,ctx);return new Promise((_,reject)=>{ctx.signal.addEventListener('abort',()=>{held.delete(ctx.message.id);reject(new Error('Controlled wait cancelled'));},{once:true});});}
 const runtime={async runTurn(ctx){
  const text=(ctx.message.payload.text??'').replace(/^@(?:boss|helper|coder)\s+/,'');
  if(ctx.message.payload.questionId){
   if(text.includes('REQUIRE_ACTION'))await ctx.callTool('receipt_send',{to:'question-target',text:'Fresh gated proposal',mode:'normal'});
   else await ctx.callTool('save_result',{name:'answer.md',kind:'note',content:'Answer delivered to '+ctx.bot.id+' in '+ctx.room.id+' for Work '+ctx.workId});
   return;
  }
  if(ctx.message.payload.continuedFrom){if(text.includes('Restricted')){await ctx.callTool('brave_search',{query:'synthetic network refusal'});return;}await ctx.callTool('save_result',{name:'recovery.md',kind:'note',content:'Fresh attempt; earlier failure remains.'});return;}
  if(text.includes('Ask')){await ctx.callTool('request_input',{prompt:'What is the budget? An answer does not approve a purchase.'});return;}
  if(text.includes('DelegateQuestion')){ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'@helper Ask delegated question'});return;}
  if(ctx.message.payload.replyTo){ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Delegated result received.'});return;}
  if(text.startsWith('Receipt ')){await ctx.callTool('receipt_send',JSON.parse(text.slice(8)));return;}
  if(text.includes('Failure'))throw Error('Controlled runtime failure. No action ran.');
  if(text.includes('Working')){ctx.reportWork({nextStep:'Waiting for the controlled operation.',plan:[{title:'Agent reports this planned step complete',state:'completed'}]});await hold(ctx);return;}
  if(text.includes('Input')){ctx.reportWork({needsInput:true,nextStep:'What is the budget?',plan:[{title:'Confirm the budget',state:'in_progress'}]});await hold(ctx);return;}
  if(text.includes('Approval')){held.set(ctx.message.id,ctx);await ctx.callTool('write_file',{path:'approval.txt',content:'Controlled local draft'});}
  else if(text.includes('Save')){await ctx.callTool('save_result',{name:'comparison.md',kind:'comparison',content:'Proposed comparison\n\nOption A: review delivery.\nOption B: review lead time.'});}
  else if(text.includes('Large')){await ctx.callTool('save_result',{name:'long-note.txt',kind:'note',content:'Inert text '.repeat(3000)});ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Long output '.repeat(1000)});}
  else if(text.includes('Computer')){await ctx.callTool('computer_click',{x:10,y:10});}
  else if(text.includes('Delegate')){ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'@helper Complete delegated part'});return;}
  ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Controlled operation finished. Its ledger records the actual outcome.'});
 }};
 const runner=createRunner({db,ledger,approvals,dataDir:dir,tools:{...defaultTools,...firstParty.executors,...actionTools},runtimes:{api:runtime}});runner.recover();
 const app=createGateway({db,ledger,auth,approvals,dataDir:dir,deskDir:root+'apps/desk/dist',computer,takeover,viewProxy,work:runner.work,cancelWork:runner.cancelWork,dispatch:args=>suspendDispatch?undefined:assignedWorkDispatch(runner,db)(args)});
 const server=serve({hostname:'127.0.0.1',port,fetch:req=>{
  const path=new URL(req.url).pathname;counts[req.method+' '+path]=(counts[req.method+' '+path]??0)+1;
  if(path.startsWith('/viewer/'))return new Response('<!doctype html><title>Controlled viewer</title><h1>Controlled verification screen</h1><p>No external computer is connected.</p>',{headers:{'content-type':'text/html'}});
  return app.fetch(req);
 }});
 let streamAttached=true;let detach=attachStream(server,ledger,auth);server.on('upgrade',(req,socket)=>{if(new URL(req.url,'http://local').pathname==='/stream'){if(!streamAttached){socket.destroy();return;}wsActive++;socket.once('close',()=>wsActive--);}});
 server.once('listening',()=>{viewerOrigin='http://127.0.0.1:'+server.address().port;process.send({type:'ready',url:viewerOrigin});});
 let stopping=false;async function stop(){if(stopping)return;stopping=true;runner.shutdown();detach();takeover.dispose();viewProxy.close?.();server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});}
 process.on('message',async message=>{
  if(message.type==='suspend-dispatch'){suspendDispatch=true;process.send({type:'suspend-dispatch-result'});}
  if(message.type==='quiet-question'){const room=(await load('rooms')).getRoom(db,'main'),bot=(await load('rooms')).getBot(db,'boss');const event=ledger.append('main','daemon','message',{text:'Ask quiet check'});await runner.run(room,bot,event,undefined,{unattended:true});process.send({type:'quiet-question-result'});}
  if(message.type==='legacy-history'){
   const rootMessage=ledger.append('main','user','message',{text:'Imported report-only history'}),parent=runner.work.begin({roomId:'main',botId:'boss',messageId:rootMessage.id});runner.work.updateRun(parent.runId,'completed');
   const event=ledger.append('main','boss','message',{text:'Imported delegated input report'}),child=runner.work.begin({roomId:'main',botId:'helper',messageId:event.id,parentId:parent.workId}),turnId='legacy-'+randomBytes(10).toString('hex');
   db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES(?,'main','helper','finished',?,?,?)").run(turnId,JSON.stringify({workId:child.workId,parentWorkId:parent.workId,delegatedBy:'boss',delegationId:'legacy-assignment',noNetwork:true}),Date.now(),Date.now());
   runner.work.updateRun(child.runId,'completed',undefined,turnId);runner.work.report(child.workId,{needsInput:true,nextStep:'Original imported context; no exact question was stored.'});
   const pendingMessage=ledger.append('main','user','message',{text:'Imported report with an action already waiting'}),pending=runner.work.begin({roomId:'main',botId:'coder',messageId:pendingMessage.id}),pendingTurn='legacy-'+randomBytes(10).toString('hex');
   db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES(?,'main','coder','finished',?,?,?)").run(pendingTurn,JSON.stringify({workId:pending.workId}),Date.now(),Date.now());runner.work.updateRun(pending.runId,'completed',undefined,pendingTurn);runner.work.report(pending.workId,{needsInput:true,nextStep:'A legacy report with a separate pending approval.'});
   const a=approvals.request({roomId:'main',botId:'coder',turnId:pendingTurn,toolName:'write_file',toolClass:'act-local',payload:{path:'legacy-pending.txt',content:'Imported proposal only'}});
   process.send({type:'legacy-history-result',parent:parent.workId,child:child.workId,pending:pending.workId,approvalId:a.approvalId});
  }
  if(message.type==='internal-approval'){const a=approvals.request({roomId:'_internal',botId:'boss',toolName:'write_file',toolClass:'act-local',payload:{path:'hidden.txt',content:'Hidden controlled proposal'}});process.send({type:'internal-approval-result',id:a.approvalId});}
  if(message.type==='restricted-failure'){const room=(await load('rooms')).getRoom(db,'main'),bot=(await load('rooms')).getBot(db,'boss'),event=ledger.append('main','user','message',{text:'Failure Restricted snapshot'});const task=runner.work.begin({roomId:room.id,botId:bot.id,messageId:event.id});await runner.run(room,bot,event,undefined,{workId:task.workId,noNetwork:true,noIndex:true});process.send({type:'restricted-failure-result',messageId:event.id});}
  if(message.type==='receipt-cases'){
   const make=(toolName,effectScope={kind:'opaque'})=>{const pending=approvals.request({roomId:'main',botId:'boss',toolName,toolClass:'act-external',review:{effectScope},payload:{destination:'Controlled historical target'}});const a=approvals.get(pending.approvalId);approvals.resolve(a.id,{kind:'accept'},a.reviewVersion);return a;};
   const legacy=make('legacy_action');db.prepare('DELETE FROM action_receipts WHERE approval_id=?').run(legacy.id);
   const makeEdit=()=>{const request=approvals.request({roomId:'main',botId:'boss',toolName:'receipt_send',toolClass:'act-external',payload:{to:'historical-target',text:'Original historical proposal',mode:'normal'}}),a=approvals.get(request.approvalId);approvals.resolve(a.id,{kind:'edit',payload:{...a.payload,text:'Historical accepted edit'}},a.reviewVersion);db.prepare('DELETE FROM action_receipts WHERE approval_id=?').run(a.id);return a;};
   const edited=makeEdit(),missingEdit=makeEdit();db.prepare('UPDATE approvals SET edit_json=NULL WHERE id=?').run(missingEdit.id);
   const pending=make('pending_evidence_fixture');
   // Data-only presentation fixture: no provider operation is dispatched.
   const invocation=make('mcp.future.NEW_TOOL',{kind:'read'});approvals.receipts.start(invocation.id,null,'fixture-invocation');approvals.receipts.finish(invocation.id,{outcome:'completed',effectVerification:'not-checked',detail:'The connector reported success.'});
   process.send({type:'receipt-cases-result',legacy:legacy.id,legacyEdited:edited.id,legacyMissingEdit:missingEdit.id,pendingExecution:pending.id,invocation:invocation.id});
  }
  if(message.type==='stop')await stop();
  if(message.type==='pair')process.send({type:'pair-result',code:auth.createPairingCode('owner','full').code});
  if(message.type==='lookup')process.send({type:'lookup-result',workId:db.prepare('SELECT id FROM work WHERE room_id=? AND request_id=?').get(message.roomId,message.requestId)?.id});
  if(message.type==='stats')process.send({type:'stats-result',counts,wsActive,actions,takeover:takeover.state()});
  if(message.type==='extra-approval'){
   const ctx=held.get(message.requestId);if(!ctx){process.send({type:'extra-approval-result',error:'No held turn'});return;}
   for(let i=0;i<Math.min(message.count??1,60);i++)void ctx.callTool('write_file',{path:'second-approval.txt',content:'Second controlled local draft'}).catch(()=>{});
   process.send({type:'extra-approval-result',queued:true});
  }
  if(message.type==='disconnect'){streamAttached=false;detach();process.send({type:'disconnected'});}
  if(message.type==='connect'){detach();streamAttached=true;detach=attachStream(server,ledger,auth);process.send({type:'connected'});}
  if(message.type==='burst'){
   const ctx=held.get(message.requestId);if(!ctx){process.send({type:'burst-result',error:'No held Work'});return;}
   for(let i=0;i<(message.count??60);i++)await ctx.callTool('computer_click',{x:i,y:i});process.send({type:'burst-result',count:message.count??60});
  }
  if(message.type==='guard-check'){
   let paused=false;try{await computer.act(['click','1','1']);}catch(error){paused=error.message==='human has control';}process.send({type:'guard-result',paused,actions});
  }
 });
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
});
