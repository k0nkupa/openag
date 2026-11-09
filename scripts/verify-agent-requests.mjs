// Standalone public gateway/runner/SDK acceptance, temporary data only; no unit runner or live provider.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {MockLanguageModelV3}=await import(require.resolve('ai/test'));
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createBot,createRoom,addMember,getRoom,getBot}=await load('rooms'),{ensureDirectChat}=await load('roomcreation'),{createRunner}=await load('runtimes/runner'),{createGateway,attachStream}=await load('gateway');
const {createMcpInteractions}=await load('mcp/interactions');
const {createResults}=await load('results'),{createResultTool}=await load('tools/results');
const {requestInputTool}=await load('tools/input');const {z}=require('zod');
const {createAgentTools}=await load('tools/agents'),{toExecutors}=await load('tools/registry'),{createPermissions,permissionReference}=await load('permissions'),{createApiRuntime}=await load('runtimes/api'),{createOllamaRuntime}=await load('runtimes/ollama');
const {createUploads}=await load('uploads');
const {createFirstPartyTools}=await load('tools/firstparty'),{MCP_TOOL_NAMES}=await load('mcpserver');
const usage={inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
const report=[],directory=mkdtempSync(join(tmpdir(),'openag-agent-requests-'));
console.log('Evidence: '+directory);
async function fixture(name,fn,transport='controlled'){
 const dataDir=join(directory,name),db=openDb(dataDir),ledger=createLedger(db),approvals=createApprovals(db,ledger),auth=createAuth({db,ownerToken:'fixture-owner'}),permissions=createPermissions(db,ledger,dataDir,approvals);
 const boss=createBot(db,{id:'boss',name:'Primary',runtime:'api',model:transport==='ollama'?'ollama/controlled':'controlled/model'});
 createBot(db,{id:'researcher',name:'Same name',runtime:'api',model:boss.model});createBot(db,{id:'writer',name:'Same name',runtime:'api',model:boss.model});
 const room=ensureDirectChat(db,ledger,'boss');if(!permissions.active())permissions.adopt('read-only',permissions.adoption().reviewVersion,'owner');
 const broker=createMcpInteractions(db,ledger);let effects=0;
 const defs=[createResultTool(createResults(db,ledger)),{name:'fixture_effect',class:'act-local',input:z.object({}).strict(),permission:()=>({approval:'allow',effects:'act-local'}),execute:async()=>{effects++;return {observed:true};}}, {name:'fixture_input',class:'read',input:z.object({}).strict(),permission:()=>({approval:'allow',effects:'read'}),execute:ctx=>broker.request({serverId:'fixture',toolName:'fixture_input',context:ctx,valid:()=>!ctx.signal.aborted,dispatchValid:()=>{try{ctx.assertPermission?.();return true;}catch{return false;}}},{mode:'form',message:'Choose a report folder',requestedSchema:{type:'object',properties:{folder:{type:'string'}},required:['folder']}},ctx.signal)},...createAgentTools(),requestInputTool,{name:'fixture_review',class:'act-local',input:z.object({}).strict(),permission:()=>({approval:'review',effects:'act-local'}),execute:async()=>{effects++;return {observed:true};},confirm:()=>({outcome:'completed',detail:'Controlled review invocation observed; no external effect.'})}],runs=[],allRuns=[],seen=[],toolResults=[];let runner,app,mode='answer',entered,release;
 const enteredPromise=new Promise(r=>entered=r),held=new Promise(r=>release=r);
 const output=(ctx,text)=>ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text});
 const runtime={async runTurn(ctx){
  seen.push(ctx);
  if(transport!=='controlled'){
   let step=0;
   const answer=ctx.state.agentRequestResult?'SYNTHESIZED FINDING':ctx.bot.id==='boss'?'Consultation requested.':'FINDING';
   const toolCall=()=>ctx.bot.id==='boss'&&!ctx.state.agentRequestResult&&step++===0;
   const local=createOllamaRuntime({tools:defs,env:{OPENAG_OLLAMA_URL:'http://127.0.0.1:1'},fetch:async(url,opts)=>{
    if(String(url).endsWith('/api/tags'))return Response.json({models:[{name:'controlled'}]});
    const body=JSON.parse(opts.body);assert.ok(body.messages.length);return Response.json({done:true,done_reason:'stop',model:'controlled',message:toolCall()?{role:'assistant',content:'',tool_calls:[{function:{name:'agent_consult',arguments:{agentId:'researcher',question:'FINDING'}}}]}:{role:'assistant',content:answer}});
   }});
   const model=new MockLanguageModelV3({doGenerate:async opts=>{assert.ok(opts.prompt.length);return toolCall()?{content:[{type:'tool-call',toolCallId:'sdk-consult',toolName:'agent_consult',input:JSON.stringify({agentId:'researcher',question:'FINDING'})}],finishReason:{unified:'tool-calls',raw:'tool_calls'},usage,warnings:[]}:{content:[{type:'text',text:answer}],finishReason:{unified:'stop',raw:'stop'},usage,warnings:[]};}});
   return createApiRuntime({model,tools:defs,ollama:local}).runTurn(ctx);
  }
  if(ctx.state.agentRequestId){
   assert.ok(!ctx.prompt.includes('PRIVATE_DM_SENTINEL'));assert.ok(!JSON.stringify(ctx.hostedInput).includes('PRIVATE_MEMORY_SENTINEL'));
   assert.equal(ctx.state.noIndex,true);
   if(mode==='held'){entered();await Promise.race([held,new Promise(r=>ctx.signal.addEventListener('abort',r,{once:true}))]);}
   if(mode==='read-receipt'){const result=await ctx.callTool('agent_list',{});assert.equal(result.ok,true);}
   if(mode==='effect'||mode==='blocked-effect'){const result=await ctx.callTool('fixture_effect',{});toolResults.push(result);assert.equal(result.ok,mode==='effect');}
   if(mode==='provider-input'){const result=await ctx.callTool('fixture_input',{});toolResults.push(result);assert.equal(result.ok,true);assert.equal(result.result.action,'accept');assert.equal(result.result.content.folder,'reports');}
   if(mode==='review'||mode==='review-unknown'){entered();const result=await ctx.callTool('fixture_review',{});toolResults.push(result);assert.equal(result.ok,true);}
   if(mode==='restrictions'){
    for(const tool of ['agent_consult','agent_request_cancel','create_work','memory_append','request_input','save_result']){const r=await ctx.callTool(tool,tool==='agent_consult'?{agentId:'boss',question:'cycle'}:{});assert.equal(r.ok,false,tool);}
   }
   if(mode==='unknown'){
    const own=permissions.ensure(ctx.bot.id,ctx.room.id),r=approvals.receipts.automatic({roomId:ctx.room.id,botId:ctx.bot.id,turnId:ctx.turnId,toolCallId:'unknown-effect',toolName:'fixture_effect',toolClass:'act-local',args:{}},own,{mode:'read-only',workspace:own.workspace},{approvalPolicy:'ask',parents:[]});
    approvals.receipts.start(r,ctx.turnId,'unknown-effect');approvals.receipts.finish(r,{outcome:'unknown',detail:'Controlled uncertain effect; no actual external operation.'});
   }
   if(mode==='many-chunks')for(let n=0;n<300;n++)output(ctx,'CHUNK-'+n);
   output(ctx,mode==='large'?'F'.repeat(18000):'FINDING');if(mode==='incomplete')return {outcome:'incomplete',reason:'step_limit'};return;
  }
  if(ctx.state.agentRequestResult){if(mode==='artifact'){const saved=await ctx.callTool('save_result',{name:'findings.md',kind:'note',content:'FINDING'});assert.equal(saved.ok,true);}
  if(mode==='synthesis-review'){const result=await ctx.callTool('fixture_review',{});toolResults.push(result);return;}
  if(mode==='synthesis-held'){entered();await new Promise(r=>ctx.signal.addEventListener('abort',r,{once:true}));return;}if(mode==='synthesis-failure')throw Error('Controlled synthesis failure');output(ctx,'SYNTHESIZED FINDING');return;}
  const text=ctx.message.payload.text;
  if(text==='CANCEL'){const r=await ctx.callTool('agent_request_cancel',{});toolResults.push(r);output(ctx,'Cancelled.');return;}
  if(!text.includes('CONSULT')){output(ctx,'ORDINARY');return;}
  const args={agentId:text.includes('SELF')?'boss':text.includes('MISSING')?'missing':'researcher',question:'FINDING',context:'Explicit shared excerpt'};
  const r=await ctx.callTool('agent_consult',args,{toolCallId:'fixture-consult'});toolResults.push(r);if(mode==='pause'&&r.ok)await ctx.callTool('request_input',{prompt:'Which source should I use?'});output(ctx,r.ok?'Requested.':'Refused: '+r.message);
  if(mode==='past-deadline'&&r.ok)db.prepare('UPDATE agent_requests SET deadline_at=1 WHERE id=?').run(r.result.id);
 }};
 runner=createRunner({db,ledger,approvals,dataDir,permissions,runtimes:{api:runtime},tools:toExecutors(defs)});
 app=createGateway({db,ledger,approvals,auth,dataDir,permissions,mcpInteractions:broker,agentRequests:runner.agentRequests,work:runner.work,cancelWork:runner.cancelWork,dispatch:args=>{const job=runner.dispatch(args);runs.push(job);allRuns.push(job);return job;}});
 const request=(path,method='GET',body)=>app.request(path,{method,headers:{authorization:'Bearer fixture-owner','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const post=async(text,attachments)=>{const response=await request(`/rooms/${room.id}/messages`,'POST',{text,...(attachments?{attachments}:{})});if(response.status===202)await Promise.all(runs.splice(0));return response;};
 let deadline;
 try{await Promise.race([fn({db,ledger,approvals,permissions,runner,app,auth,dataDir,room,request,post,runs,seen,toolResults,getEffects:()=>effects,entered:enteredPromise,release,runtime,defs,setMode:v=>mode=v}),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Controlled gateway deadline: '+name)),25000);})]);report.push({name,status:'passed'});console.log('PASS '+name);}
 finally{clearTimeout(deadline);release();runner.shutdown();broker.recover();await Promise.allSettled(allRuns);await runner.idle();runner.work.close();db.close();}
}
await fixture('api-sdk-consultation',async f=>{assert.equal((await f.post('CONSULT')).status,202);const [r]=f.runner.agentRequests.list(f.room.id);assert.equal(r.status,'completed');assert.equal(r.delivery,'delivered');assert.ok(f.ledger.list(f.room.id).some(e=>e.type==='bot_output'&&e.payload.text==='SYNTHESIZED FINDING'));},'sdk');
await fixture('ollama-http-consultation',async f=>{await f.post('CONSULT');const [r]=f.runner.agentRequests.list(f.room.id);assert.equal(r.status,'completed');assert.equal(r.delivery,'delivered');},'ollama');
await fixture('guest-mention-context-and-attachments',async f=>{
 const privateRoom=ensureDirectChat(f.db,f.ledger,'researcher');f.ledger.append(privateRoom.id,'user','message',{text:'PRIVATE_DM_SENTINEL'});
 mkdirSync(join(f.dataDir,'bots','researcher'),{recursive:true});writeFileSync(join(f.dataDir,'bots','researcher','MEMORY.md'),'PRIVATE_MEMORY_SENTINEL');
 const uploads=createUploads(f.db,f.dataDir),file=uploads.save(f.room.id,'question.txt','text/plain',Buffer.from('SELECTED_ATTACHMENT'));
 await f.post('@researcher check this',[file.id]);
 const request=f.runner.agentRequests.list(f.room.id)[0];assert.equal(request.status,'completed');assert.equal(request.delivery,'delivered');
 assert.deepEqual(getRoom(f.db,f.room.id).members,['boss']);assert.equal(f.db.prepare('SELECT count(*) n FROM work').get().n,0);
 const guest=f.seen.find(c=>c.bot.id==='researcher');assert.equal(guest.attachments[0].text,'SELECTED_ATTACHMENT');assert.equal(f.seen.filter(c=>c.bot.id==='boss').length,0);
 assert.ok(f.ledger.list(f.room.id).some(e=>e.actor==='researcher'&&e.type==='message'&&e.payload.guestReply&&e.payload.text==='FINDING'));
 await f.post('What were the findings?');const primary=f.seen.at(-1);assert.ok(JSON.stringify(primary.hostedInput).includes('FINDING'),'Primary can see explicitly shared guest findings');
 const exec=f.db.prepare('SELECT execution_room_id FROM agent_requests').get().execution_room_id;
 for(const path of [`/rooms/${exec}/events`,`/rooms/${exec}/uploads/nope`,`/rooms/${exec}/agent-requests`])assert.equal((await f.request(path)).status,404);
 const turn=f.db.prepare('SELECT id FROM turns WHERE room_id=?').get(exec);assert.equal((await f.request(`/turns/${turn.id}/request-manifests`)).status,404);
});
await fixture('guest-mention-quoted-reply',async f=>{
 const source=f.ledger.append(f.room.id,'boss','bot_output',{text:'SELECTED_QUOTE_ONLY'});
 f.ledger.append(f.room.id,'user','message',{text:'UNSELECTED_ORIGIN_HISTORY'});
 const response=await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'@researcher explain this',replyToMessageId:source.id});
 assert.equal(response.status,202);await Promise.all(f.runs.splice(0));await f.runner.idle();
 const guest=f.seen.find(c=>c.bot.id==='researcher');
 assert.ok(guest.prompt.includes('SELECTED_QUOTE_ONLY'));assert.ok(JSON.stringify(guest.hostedInput).includes('SELECTED_QUOTE_ONLY'));
 assert.ok(!guest.prompt.includes('UNSELECTED_ORIGIN_HISTORY'));assert.equal(guest.attachments?.length??0,0);
 assert.equal(f.runner.agentRequests.list(f.room.id)[0].status,'completed');
 const message=(await response.json()).message;assert.equal(message.payload.reply.messageId,source.id);
 assert.deepEqual(getRoom(f.db,f.room.id).members,['boss']);assert.equal(f.db.prepare('SELECT count(*) n FROM work').get().n,0);
});
await fixture('addressing-and-discovery',async f=>{
 assert.equal((await f.post('@missing answer')).status,400);assert.equal(f.ledger.list(f.room.id).filter(e=>e.type==='message').length,0);
 const email=await(await f.post('email a@researcher.com')).json();assert.deepEqual(email.route.payload.targets,['boss']);
 const multiple=await(await f.post('@researcher @researcher @writer check')).json();assert.deepEqual(multiple.route.payload.targets,['researcher','writer']);
 const broadcast=await(await f.post('@everyone check')).json();assert.deepEqual(broadcast.route.payload.targets,['boss']);
 const named=createRoom(f.db,{id:'named',leadBotId:'boss'});addMember(f.db,named.id,'boss');addMember(f.db,named.id,'researcher');const legacy=await(await f.request('/rooms/named/messages','POST',{text:'@writer check'})).json();await Promise.all(f.runs.splice(0));assert.deepEqual(legacy.route.payload.targets,['boss']);
 const beforeSelf=f.runner.agentRequests.list(f.room.id).length;await f.post('@boss hello');assert.equal(f.runner.agentRequests.list(f.room.id).length,beforeSelf);
 const before=f.db.prepare('SELECT count(*) n FROM events').get().n;assert.equal(f.runner.agentRequests.agents().filter(a=>a.name==='Same name').length,2);assert.equal(f.db.prepare('SELECT count(*) n FROM events').get().n,before);
 const definitions=createFirstPartyTools({db:f.db,computer:{},pusher:{}}).defs;for(const name of ['agent_list','agent_consult']){assert.ok(definitions.some(d=>d.name===name));assert.ok(MCP_TOOL_NAMES.includes(name));}
});
await fixture('consultation-deduplication-and-no-native-context',async f=>{
 await f.post('CONSULT');const ctx=f.seen[0],own=f.permissions.ensure('boss',f.room.id),key=`consult:${ctx.turnId}:fixture-consult`,origin={room:f.room,message:ctx.message,botId:'boss',turnId:ctx.turnId,key,parents:[permissionReference(own)]};
 const before=f.seen.length;assert.equal(f.runner.agentRequests.admit({agentId:'researcher',question:'FINDING',context:'Explicit shared excerpt'},origin,'consultation').status,'completed');assert.equal(f.seen.length,before);
 assert.throws(()=>f.runner.agentRequests.admit({agentId:'researcher',question:'changed',context:''},origin,'consultation'),/different content/);
 assert.equal(f.seen.find(c=>c.state.agentRequestId).attachments.length,0);
});
for(const [mode,expected] of [['restrictions','completed'],['incomplete','incomplete'],['past-deadline','completed'],['large','completed'],['many-chunks','completed'],['synthesis-failure','completed']])await fixture(mode,async f=>{
 f.setMode(mode);await f.post('CONSULT');const [r]=f.runner.agentRequests.list(f.room.id);assert.equal(r.status,expected);
 if(mode==='many-chunks')assert.ok(r.result.includes('CHUNK-299'),'All retained output chunks participate in bounded findings');
 if(mode==='large')assert.ok(r.result.length<=16000&&r.result.includes('Findings shortened'));
 if(mode==='synthesis-failure')assert.equal(r.delivery,'failed');
 if(mode==='past-deadline')assert.equal(f.seen.filter(c=>c.state.agentRequestId).length,1);
});
await fixture('self-and-missing-refusal-are-known',async f=>{
 await f.post('CONSULT SELF');await f.post('CONSULT MISSING');assert.equal(f.runner.agentRequests.list(f.room.id).length,0);
 for(const result of f.toolResults){assert.equal(result.ok,false);assert.equal(result.executionOutcome,'not-run');}
});
await fixture('cancel-and-busy-no-duplicate-final',async f=>{
 f.setMode('held');const response=await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'@researcher check'});assert.equal(response.status,202);await f.entered;
 assert.equal((await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'@researcher another'})).status,409);
 const [r]=f.runner.agentRequests.list(f.room.id);assert.equal((await f.request(`/rooms/${f.room.id}/agent-requests/${r.id}/cancel`,'POST',{})).status,200);
 await Promise.all(f.runs);f.release();assert.equal(f.runner.agentRequests.list(f.room.id)[0].status,'cancelled');
 assert.equal(f.ledger.list(f.room.id).filter(e=>e.type==='message'&&e.payload.guestReply).length,0);
 assert.equal((await f.request(`/rooms/${f.room.id}/agent-requests/${r.id}/cancel`,'POST',{})).status,200);
 assert.equal(f.ledger.list(f.room.id).filter(e=>e.type==='message'&&e.payload.guestReply).length,0);
});
await fixture('coordinator-cancellation-tool',async f=>{
 f.setMode('held');await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'CONSULT'});await f.entered;
 assert.equal((await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'CANCEL'})).status,202);
 await Promise.all(f.runs);f.release();assert.equal(f.toolResults.at(-1).ok,true);assert.equal(f.runner.agentRequests.list(f.room.id)[0].status,'cancelled');assert.equal(f.seen.filter(c=>c.state.agentRequestResult).length,0);
});
await fixture('parent-revision-cancels-descendant',async f=>{
 f.setMode('held');assert.equal((await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'CONSULT'})).status,202);await f.entered;
 const own=f.permissions.get('boss',f.room.id);f.permissions.select('boss',f.room.id,'workspace-write','owner',own.revision);
 await Promise.all(f.runs);f.release();const [r]=f.runner.agentRequests.list(f.room.id);assert.equal(r.status,'cancelled');assert.equal(r.delivery,'failed');
 assert.equal(f.seen.filter(c=>c.state.agentRequestResult).length,0);
});
await fixture('unknown-receipt-does-not-fence-origin',async f=>{
 f.setMode('unknown');await f.post('@researcher inspect');
 const [request]=f.runner.agentRequests.list(f.room.id);assert.equal(f.approvals.receipts.get(request.receiptIds[0]).outcome,'unknown');
 assert.equal((await f.request('/attention?category=recovery')).status,404);
 f.setMode('normal');await f.post('CONSULT');assert.equal(f.toolResults.at(-1).ok,true);
});
await fixture('restart-does-not-dispatch-admitted-request',async f=>{
 const msg=f.ledger.append(f.room.id,'user','message',{text:'Ask Researcher'}),own=f.permissions.ensure('boss',f.room.id);
 const admitted=f.runner.agentRequests.admit({agentId:'researcher',question:'FINDING',context:''},{room:f.room,message:msg,botId:'boss',turnId:'stopped-parent',key:'recovery-admission',parents:[permissionReference(own)]},'consultation');
 f.runner.recover();const [r]=f.runner.agentRequests.list(f.room.id);assert.equal(r.id,admitted.id);assert.equal(r.status,'interrupted');assert.equal(r.delivery,'failed');assert.equal(f.seen.length,0);
 f.runner.recover();assert.equal(f.seen.length,0);
});
await fixture('unattended-and-offline-cannot-consult',async f=>{
 for(const meta of [{unattended:true},{isolated:true},{noNetwork:true}]){const msg=f.ledger.append(f.room.id,'user','message',{text:'CONSULT'});await f.runner.run(f.room,getBot(f.db,'boss'),msg,undefined,meta);assert.equal(f.toolResults.at(-1).ok,false);}
 assert.equal(f.runner.agentRequests.list(f.room.id).length,0);
});
await fixture('specialist-review-is-actionable',async f=>{
 f.setMode('review');let ready;const approvalReady=new Promise(r=>ready=r);const off=f.ledger.subscribe(f.room.id,e=>{if(e.type==='approval_requested'&&e.payload.agentRequestId)ready(e.payload.approvalId);});
 try{
  await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'CONSULT'});const id=await approvalReady;
  const pending=await (await f.request('/approvals')).json();assert.equal(pending.approvals.find(a=>a.id===id).roomId,f.room.id);
  assert.ok(pending.approvals.some(a=>a.id===id&&a.roomId===f.room.id));
  const a=pending.approvals.find(a=>a.id===id);assert.equal((await f.request(`/approvals/${id}`,'POST',{kind:'accept',reviewVersion:a.reviewVersion})).status,200);
  await Promise.all(f.runs);assert.equal(f.runner.agentRequests.list(f.room.id)[0].status,'completed');assert.equal(f.runner.agentRequests.list(f.room.id)[0].delivery,'delivered');assert.equal(f.toolResults.at(-1).ok,true);
 }finally{off();}
});
await fixture('work-cancellation-reaches-specialist',async f=>{
 f.setMode('held');const msg=f.ledger.append(f.room.id,'user','message',{text:'CONSULT'}),task=f.runner.work.begin({roomId:f.room.id,botId:'boss',messageId:msg.id});
 const job=f.runner.run(f.room,getBot(f.db,'boss'),msg,undefined,{workId:task.workId});await f.entered;
 assert.equal(f.seen.find(c=>c.state.agentRequestId).state.sourceWorkId,task.workId);
 f.runner.cancelWork(task.workId);await job;f.release();const [r]=f.runner.agentRequests.list(f.room.id);assert.equal(r.status,'cancelled');assert.equal(f.seen.filter(c=>c.state.agentRequestResult).length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM work').get().n,1);
});
for(const abrupt of [false,true])await fixture(`work-consultation-${abrupt?'restart':'shutdown'}-stays-interrupted`,async f=>{
 f.setMode('held');const msg=f.ledger.append(f.room.id,'user','message',{text:'CONSULT'}),task=f.runner.work.begin({roomId:f.room.id,botId:'boss',messageId:msg.id});
 const job=f.runner.run(f.room,getBot(f.db,'boss'),msg,undefined,{workId:task.workId});await f.entered;
 assert.equal(f.db.prepare('SELECT status FROM work_runs WHERE work_id=?').get(task.workId).status,'draining');
 if(abrupt)f.runner.recover();else f.runner.shutdown();
 assert.equal(f.db.prepare('SELECT status FROM work WHERE id=?').get(task.workId).status,'interrupted');
 assert.equal(f.runner.agentRequests.list(f.room.id)[0].status,'interrupted');f.release();await job;
 assert.equal(f.runner.agentRequests.list(f.room.id)[0].delivery,'failed');
});
await fixture('cancellation-during-synthesis',async f=>{
 f.setMode('synthesis-held');await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'CONSULT'});await f.entered;const [r]=f.runner.agentRequests.list(f.room.id);assert.equal(r.status,'completed');assert.equal(r.delivery,'pending');
 await f.request(`/rooms/${f.room.id}/agent-requests/${r.id}/cancel`,'POST',{});await Promise.all(f.runs);const [after]=f.runner.agentRequests.list(f.room.id);assert.equal(after.status,'completed');assert.equal(after.delivery,'failed');
});
await fixture('restart-cannot-resume-synthesis-approval',async f=>{
 f.setMode('synthesis-review');let ready;const requested=new Promise(r=>ready=r),off=f.ledger.subscribe(f.room.id,e=>{if(e.type==='approval_requested')ready(e.payload.approvalId);});
 let restarted;
 try{
  await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'CONSULT'});const id=await requested;
  f.runner.shutdown();await Promise.all(f.runs);
  assert.equal(f.approvals.get(id).status,'pending');
  restarted=createRunner({db:f.db,ledger:f.ledger,approvals:f.approvals,permissions:f.permissions,dataDir:f.dataDir,runtimes:{api:f.runtime},tools:toExecutors(f.defs)});
  restarted.recover();assert.equal(f.approvals.get(id).status,'ignored');assert.equal(f.approvals.get(id).responseText,'expired');
  assert.throws(()=>f.approvals.resolve(id,{kind:'accept'},f.approvals.get(id).reviewVersion));
  await restarted.idle();assert.equal(f.seen.filter(c=>c.state.agentRequestResult).length,1);assert.equal(f.getEffects(),0);assert.equal(restarted.agentRequests.list(f.room.id)[0].delivery,'failed');
 }finally{off();restarted?.shutdown();restarted?.work.close();}
});
await fixture('queued-synthesis-cancellation-releases-dispatch',async f=>{
 f.setMode('held');const original=f.post('CONSULT');await f.entered;
 let entered,release;const active=new Promise(r=>entered=r),held=new Promise(r=>release=r),run=f.runtime.runTurn;
 f.runtime.runTurn=async ctx=>{if(ctx.message.payload.text==='Hold coordinator'){entered();await held;return;}return run(ctx);};
 const followup=f.runner.run(f.room,getBot(f.db,'boss'),f.ledger.append(f.room.id,'user','message',{text:'Hold coordinator'}));
 try{
  await active;let queued;const pending=new Promise(r=>queued=r),off=f.ledger.subscribe(f.room.id,e=>{if(e.type==='message'&&e.payload.internalConsultation)queued();});
  try{f.release();await pending;await new Promise(r=>setImmediate(r));const [request]=f.runner.agentRequests.list(f.room.id);await f.request(`/rooms/${f.room.id}/agent-requests/${request.id}/cancel`,'POST',{});await original;assert.equal(f.runner.agentRequests.list(f.room.id)[0].delivery,'failed');assert.equal(f.seen.filter(c=>c.state.agentRequestResult).length,0);}finally{off();}
 }finally{release();await followup;f.runtime.runTurn=run;}
});
await fixture('input-pause-settles-admission',async f=>{
 f.setMode('pause');await f.post('CONSULT');const [r]=f.runner.agentRequests.list(f.room.id);assert.equal(r.status,'cancelled');assert.equal(r.delivery,'failed');assert.equal(f.runner.agentRequests.agents().find(a=>a.id==='researcher').busy,false);
});
await fixture('provider-input-is-actionable-and-full-only',async f=>{
 f.setMode('provider-input');let ready;const opened=new Promise(r=>ready=r);const off=f.ledger.subscribe(f.room.id,e=>{if(e.type==='mcp_interaction_updated'&&e.payload.status==='open')ready(e.payload.interactionId);});
 try{
  await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'CONSULT'});const id=await opened;
  const requests=await(await f.request(`/rooms/${f.room.id}/requests`)).json();assert.ok(requests.requests.some(item=>item.id===id&&item.kind==='provider'));
  const {interaction}=await(await f.request(`/mcp/interactions/${id}`)).json();assert.equal(interaction.roomId,f.room.id);assert.equal(f.runner.agentRequests.list(f.room.id)[0].pendingInteractionIds[0],id);
  const limited=await(await f.request('/devices','POST',{name:'Limited input fixture'})).json();assert.equal((await f.app.request(`/mcp/interactions/${id}`,{headers:{authorization:'Bearer '+limited.token}})).status,403);
  assert.equal((await f.request(`/mcp/interactions/${id}/response`,'POST',{revision:interaction.revision,action:'accept',content:{folder:'reports'}})).status,200);
  await Promise.all(f.runs);assert.equal(f.runner.agentRequests.list(f.room.id)[0].status,'completed');assert.equal(f.runner.agentRequests.list(f.room.id)[0].delivery,'delivered');assert.equal(f.toolResults.at(-1).ok,true);
 }finally{off();}
});
await fixture('request-has-no-overall-deadline',async f=>{
 f.setMode('held');await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'CONSULT'});await f.entered;
 const [r]=f.runner.agentRequests.list(f.room.id);assert.equal(r.status,'running');assert.equal(r.deadlineAt,null);
 f.release();await Promise.all(f.runs);const [done]=f.runner.agentRequests.list(f.room.id);assert.equal(done.status,'completed');assert.equal(done.delivery,'delivered');
});
await fixture('delegated-work-synthesis-keeps-provenance',async f=>{
 f.setMode('artifact');
 const team=createRoom(f.db,{id:'team',leadBotId:'boss'});addMember(f.db,team.id,'boss');addMember(f.db,team.id,'writer');const room=getRoom(f.db,team.id);
 f.db.prepare('UPDATE bots SET config_json=? WHERE id=?').run(JSON.stringify({canDelegate:true}),'writer');
 const original=f.ledger.append(room.id,'user','message',{text:'Existing explicit Work'}),task=f.runner.work.begin({roomId:room.id,botId:'boss',messageId:original.id});await f.runner.run(room,getBot(f.db,'boss'),original,undefined,{workId:task.workId});
 const parent=f.db.prepare("SELECT turn_id FROM work_runs WHERE work_id=? AND turn_id IS NOT NULL ORDER BY seq LIMIT 1").get(task.workId);
 const delegated=f.ledger.append(room.id,'boss','message',{text:'CONSULT'});f.ledger.append(room.id,'boss','route',{targets:['writer'],messageId:delegated.id,turnId:parent.turn_id});
 await f.runner.run(room,getBot(f.db,'writer'),delegated,undefined,{workId:task.workId,delegatedBy:'boss',delegationId:'controlled-chain',parentWorkId:task.workId,hop:1});const [r]=f.runner.agentRequests.list(room.id);assert.equal(r.status,'completed');assert.equal(r.delivery,'delivered');assert.equal(f.db.prepare('SELECT count(*) n FROM work').get().n,1);
 assert.ok(f.seen.some(c=>c.bot.id==='writer'&&c.state.agentRequestResult&&c.workId===task.workId));
 assert.ok(f.seen.some(c=>c.bot.id==='boss'&&c.message.payload.replyTo==='boss'&&c.message.payload.text.includes('SYNTHESIZED FINDING')),'Original delegator receives synthesized findings, not admission progress');
 assert.deepEqual(f.db.prepare('SELECT room_id,work_id,bot_id FROM saved_results').all(),[{room_id:room.id,work_id:task.workId,bot_id:'writer'}]);
});
await fixture('older-outstanding-requests-remain-inspectable',async f=>{
 f.setMode('held');await f.request(`/rooms/${f.room.id}/messages`,'POST',{text:'@researcher check'});await f.entered;const heldJob=f.runs.shift();const original=f.runner.agentRequests.list(f.room.id)[0];f.setMode('answer');
 for(let n=0;n<4;n++){createBot(f.db,{id:'extra'+n,runtime:'api',model:'controlled/model'});await f.post('@extra'+n+' check');}
 const requests=(await(await f.request(`/rooms/${f.room.id}/agent-requests`)).json()).requests;assert.ok(requests.some(r=>r.id===original.id&&r.status==='running'));
 await f.request(`/rooms/${f.room.id}/agent-requests/${original.id}/cancel`,'POST',{});f.release();await heldJob;
});
await fixture('outstanding-admission-is-bounded',async f=>{
 const own=f.permissions.ensure('boss',f.room.id);
 for(let n=0;n<51;n++){
  const id='capacity'+n;createBot(f.db,{id,runtime:'api',model:'controlled/model'});const message=f.ledger.append(f.room.id,'user','message',{text:'Request '+n});
  const admit=()=>f.runner.agentRequests.admit({agentId:id,question:'Question',context:''},{room:f.room,message,botId:'boss',key:'capacity:'+n,parents:[permissionReference(own)]},'consultation');
  if(n<50)admit();else assert.throws(admit,/50 outstanding/);
 }
 assert.equal(f.runner.agentRequests.list(f.room.id).length,50);
});
await fixture('unknown-source-work-blocks-overlapping-specialist-effects',async f=>{
 f.setMode('held');const message=f.ledger.append(f.room.id,'user','message',{text:'CONSULT'}),task=f.runner.work.begin({roomId:f.room.id,botId:'boss',messageId:message.id});const job=f.runner.run(f.room,getBot(f.db,'boss'),message,undefined,{workId:task.workId});await f.entered;
 const parent=f.seen.find(c=>c.bot.id==='boss'),own=f.permissions.get('boss',f.room.id),id=f.approvals.receipts.automatic({roomId:f.room.id,botId:'boss',turnId:parent.turnId,toolCallId:'unknown-source',toolName:'fixture_effect',toolClass:'act-local',args:{},workId:task.workId},own,{mode:'read-only',workspace:own.workspace},{approvalPolicy:'ask',parents:[]});
 f.approvals.receipts.start(id,parent.turnId,'unknown-source');f.approvals.receipts.finish(id,{outcome:'unknown',detail:'Controlled source uncertainty; no real effect.'});f.setMode('blocked-effect');f.release();await job;assert.equal(f.getEffects(),0);assert.equal(f.toolResults.at(-1).ok,false);assert.equal(f.runner.agentRequests.list(f.room.id)[0].status,'completed');
});
await fixture('unknown-source-work-rechecks-conflicting-reviewed-dispatch',async f=>{
 f.setMode('review-unknown');let ready;const opened=new Promise(r=>ready=r),off=f.ledger.subscribe(f.room.id,e=>{if(e.type==='approval_requested'&&e.payload.agentRequestId)ready(e.payload.approvalId);});
 try{
  const message=f.ledger.append(f.room.id,'user','message',{text:'CONSULT'}),task=f.runner.work.begin({roomId:f.room.id,botId:'boss',messageId:message.id}),job=f.runner.run(f.room,getBot(f.db,'boss'),message,undefined,{workId:task.workId});const approvalId=await opened;
  const parent=f.seen.find(c=>c.bot.id==='boss'),own=f.permissions.get('boss',f.room.id),id=f.approvals.receipts.automatic({roomId:f.room.id,botId:'boss',turnId:parent.turnId,toolCallId:'unknown-during-review',toolName:'fixture_effect',toolClass:'act-local',args:{},workId:task.workId},own,{mode:'read-only',workspace:own.workspace},{approvalPolicy:'ask',parents:[]});f.approvals.receipts.start(id,parent.turnId,'unknown-during-review');f.approvals.receipts.finish(id,{outcome:'unknown',detail:'Controlled uncertainty during review.'});
  const a=f.approvals.get(approvalId);assert.equal((await f.request(`/approvals/${approvalId}`,'POST',{kind:'accept',reviewVersion:a.reviewVersion})).status,200);await job;
  assert.equal(f.getEffects(),0);assert.equal(f.toolResults.at(-1).ok,false);assert.equal(f.approvals.receipts.get(approvalId).outcome,'not-run');assert.equal(f.runner.agentRequests.list(f.room.id)[0].status,'failed');
 }finally{off();}
});
await fixture('artifact-is-saved-in-origin-without-work',async f=>{
 f.setMode('artifact');await f.post('CONSULT');assert.deepEqual(f.db.prepare('SELECT room_id,work_id,bot_id FROM saved_results').all(),[{room_id:f.room.id,work_id:null,bot_id:'boss'}]);assert.equal(f.db.prepare('SELECT count(*) n FROM work').get().n,0);assert.equal(f.runner.agentRequests.list(f.room.id)[0].delivery,'delivered');
});
await fixture('guest-input-preflight-preserves-unsent-message',async f=>{
 const before=f.ledger.list(f.room.id).length,body='@researcher '+ 'x'.repeat(8001);const response=await f.post(body);assert.equal(response.status,400);assert.match((await response.json()).error,/8,000/);assert.equal(f.ledger.list(f.room.id).length,before);assert.equal(f.runner.agentRequests.list(f.room.id).length,0);assert.equal(f.seen.length,0);
});
await fixture('automatic-receipt-navigation-retains-execution-scope',async f=>{
 f.setMode('read-receipt');await f.post('@researcher check');const [r]=f.runner.agentRequests.list(f.room.id);assert.equal(r.status,'completed');const id=r.receiptIds[0];assert.ok(id);
 const {approval,receipt}=await(await f.request(`/approvals/${id}`)).json();assert.equal(approval,null);assert.equal(receipt.originRoomId,f.room.id);assert.ok(receipt.roomId.startsWith('_agent-request-'));assert.equal(f.approvals.receipts.get(id).roomId,receipt.roomId);
});
await fixture('private-stream-and-scoped-inspection',async f=>{
 await f.post('@researcher check');const [r]=f.runner.agentRequests.list(f.room.id),exec=f.db.prepare('SELECT execution_room_id FROM agent_requests WHERE id=?').get(r.id).execution_room_id;
 const scoped=await f.request(`/rooms/${f.room.id}/agent-requests/${r.id}/request-manifests`);assert.equal(scoped.status,200);assert.equal(scoped.headers.get('cache-control'),'no-store');
 const device=await(await f.request('/devices','POST',{name:'Limited fixture'})).json();assert.equal((await f.app.request(`/rooms/${f.room.id}/agent-requests/${r.id}/request-manifests`,{headers:{authorization:'Bearer '+device.token}})).status,403);
 const other=ensureDirectChat(f.db,f.ledger,'writer');assert.equal((await f.request(`/rooms/${other.id}/agent-requests/${r.id}/request-manifests`)).status,404);
 const {serve}=require('@hono/node-server'),WebSocket=require('ws');
 const server=serve({hostname:'127.0.0.1',port:0,fetch:req=>f.app.fetch(req)});if(!server.listening)await new Promise(r=>server.once('listening',r));const stop=attachStream(server,f.ledger,f.auth),events=[];
 const socket=new WebSocket(`ws://127.0.0.1:${server.address().port}/stream?token=fixture-owner`);
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 let timer;try{
  const delivered=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Stream delivery deadline')),3000);socket.on('message',bytes=>{const event=JSON.parse(String(bytes));events.push(event);if(event.payload?.marker==='VISIBLE_FENCE')resolve();});});
  f.ledger.append(exec,'researcher','message',{text:'PRIVATE_EXEC_SENTINEL'});f.ledger.append(f.room.id,'daemon','config',{marker:'VISIBLE_FENCE'});await delivered;
  assert.ok(!JSON.stringify(events).includes('PRIVATE_EXEC_SENTINEL'));assert.ok(events.every(e=>!e.roomId?.startsWith('_agent-request-')));
 }finally{clearTimeout(timer);socket.terminate();stop();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
writeFileSync(join(directory,'acceptance.json'),JSON.stringify(report,null,2));console.log('PASS '+report.length+' standalone gateway/SDK/Ollama cases.');
