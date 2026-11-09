// Real subscription adapters + actual disposable gateway/runner/MCP. No business tools or installed daemon.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
if(!process.argv.includes('--real'))throw Error('Use --real for two bounded consultations per installed adapter.');
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {serve}=require('@hono/node-server');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createBot,getBot}=await load('rooms'),{ensureDirectChat}=await load('roomcreation'),{createRunner}=await load('runtimes/runner'),{createGateway}=await load('gateway');
const {createAcpRuntime}=await load('runtimes/acp'),{createMcpAccess}=await load('mcpserver'),{createAgentTools}=await load('tools/agents'),{toExecutors}=await load('tools/registry'),{createPermissions}=await load('permissions');
const directory=mkdtempSync(join(tmpdir(),'openag-agent-requests-acp-')),evidence=[];
console.log('Evidence: '+directory);
for(const adapter of ['claude','codex']){
 const dataDir=join(directory,adapter),db=openDb(dataDir),ledger=createLedger(db),approvals=createApprovals(db,ledger),token=randomUUID(),auth=createAuth({db,ownerToken:token});
 const bot=createBot(db,{id:'boss',runtime:'acp',config:{adapter,instructions:'For a request to summarize an existing guest reply, use conversation context and no tools. For other owner questions, call the OpenAg agent_consult tool exactly once with agentId researcher and the requested evidence marker verbatim in question. Use no other tools. After admission, finish with a short progress update. When consultation findings return, answer with the exact marker and the word verified only if the specialist returned it. Do not delegate in prose. Never use native tools.'}});
 createBot(db,{id:'researcher',runtime:'acp',config:{adapter,instructions:'Answer only the bounded question. Echo its EVIDENCE marker verbatim and state verified. Do not call any tools, write memory, delegate or claim external actions.'}});
 const room=ensureDirectChat(db,ledger,bot.id),permissions=createPermissions(db,ledger,dataDir,approvals);
 if(!permissions.active())permissions.adopt('read-only',permissions.adoption().reviewVersion,'owner');
 const defs=createAgentTools();let runner,base;
 const access=createMcpAccess({dataDir,runner:{activeTurn:(...args)=>runner.activeTurn(...args)},tools:()=>defs});
 const acp=createAcpRuntime({dataDir,mcp:{access,baseUrl:()=>base,tools:new Set(defs.map(d=>d.name))}});
 runner=createRunner({db,ledger,approvals,dataDir,permissions,runtimes:{acp},tools:toExecutors(defs)});
 const runs=[];
 const app=createGateway({db,ledger,approvals,auth,dataDir,permissions,agentRequests:runner.agentRequests,work:runner.work,dispatch:args=>{const job=runner.dispatch(args);runs.push(job);return job;}});
 const server=serve({hostname:'127.0.0.1',port:0,fetch:req=>new URL(req.url).pathname==='/mcp'?access.handle(req):app.fetch(req)});
 if(!server.listening)await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const choice=await acp.discover(bot,adapter);assert.ok(choice.model);
  for(const id of ['boss','researcher']){const current=getBot(db,id);db.prepare('UPDATE bots SET config_json=? WHERE id=?').run(JSON.stringify({...current.config,modelConfig:{model:choice.model}}),id);}
  const parents=[];
  for(let n=0;n<2;n++){
   const marker='EVIDENCE-'+randomUUID();
   assert.equal((await request(`/rooms/${room.id}/messages`,'POST',{text:`Ask Researcher to check this marker: ${marker}. Use agent_consult with agentId researcher and include this exact marker in its question. Wait for the specialist findings before certifying it.`})).status,202);
   let timer;try{await Promise.race([Promise.all(runs.splice(0)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Real consultation deadline: outcome uncertain; do not retry.')),180000);})]);}finally{clearTimeout(timer);}
   const requests=db.prepare('SELECT * FROM agent_requests ORDER BY created_at').all();assert.equal(requests.length,n+1,'Exactly one admitted specialist run per owner message');const r=requests.at(-1);
   assert.equal(r.status,'completed');assert.equal(r.delivery,'delivered');assert.ok(r.result.includes(marker),'Specialist actually returned requested evidence');
   const parent=db.prepare("SELECT * FROM turns WHERE id=?").get(r.initiator_turn_id);parents.push(parent);
   const synth=db.prepare("SELECT * FROM turns WHERE room_id=? AND json_extract(state_json,'$.agentRequestResult')=1 ORDER BY created_at DESC LIMIT 1").get(room.id);
   assert.equal(synth.status,'finished');assert.ok(ledger.list(room.id,{limit:1000}).some(e=>e.type==='bot_output'&&e.payload.turnId===synth.id&&e.payload.text?.includes(marker)),'Primary returned findings in original chat');
   assert.deepEqual(db.prepare('SELECT bot_id FROM room_members WHERE room_id=?').all(room.id),[{bot_id:'boss'}]);
   assert.equal(approvals.listPending().length,0);assert.equal(db.prepare('SELECT count(*) n FROM work').get().n,0);
   evidence.push({adapter,model:choice.model,requestId:r.id,parentTurnId:parent.id,synthesisTurnId:synth.id,status:r.status,delivery:r.delivery});
   console.log(`PASS ${adapter}: consultation ${n+1}, request ${r.id}`);
  }
  assert.equal(JSON.parse(parents[0].state_json).acpSessionId,JSON.parse(parents[1].state_json).acpSessionId,'Second call reuses the original parent ACP session');
  const guestMarker='EVIDENCE-'+randomUUID();
  for(const text of [`@researcher Echo ${guestMarker} and say verified.`,`Summarize the existing guest reply. Use no tools and do not contact agents. Repeat only its EVIDENCE marker.`]){
   assert.equal((await request(`/rooms/${room.id}/messages`,'POST',{text})).status,202);
   let timer;try{await Promise.race([Promise.all(runs.splice(0)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Guest continuity deadline; do not retry.')),180000);})]);}finally{clearTimeout(timer);}
  }
  const guest=db.prepare("SELECT * FROM agent_requests WHERE kind='mention'").get();assert.equal(guest.status,'completed');assert.ok(guest.result.includes(guestMarker));
  const afterGuest=db.prepare("SELECT * FROM turns WHERE room_id=? AND bot_id='boss' ORDER BY created_at DESC LIMIT 1").get(room.id);assert.equal(afterGuest.status,'finished');
  assert.ok(ledger.list(room.id,{limit:1000}).some(e=>e.type==='bot_output'&&e.payload.turnId===afterGuest.id&&e.payload.text?.includes(guestMarker)),'Previously cached Primary receives the guest exchange');
  assert.notEqual(JSON.parse(afterGuest.state_json).acpSessionId,JSON.parse(parents[1].state_json).acpSessionId,'Guest delivery refreshes only the affected cached conversation');
  evidence.push({adapter,guestRequestId:guest.id,summaryTurnId:afterGuest.id,guestContinuity:'passed'});console.log('PASS '+adapter+': cached Primary receives guest findings');

 }catch(error){
  const report={adapter,stage:'consultation',requests:runner.agentRequests.list(room.id),turns:db.prepare('SELECT id,bot_id,status FROM turns').all(),approvals:approvals.listPending().map(a=>({id:a.id,status:a.status})),toolResults:ledger.list(room.id,{limit:1000}).filter(e=>e.type==='tool_result').map(e=>({id:e.id,tool:e.payload.tool,ok:e.payload.ok,status:e.payload.status,message:e.payload.message}))};
  writeFileSync(join(directory,'failure.json'),JSON.stringify(report,null,2),{mode:0o600});console.error('Stopped on uncertain/failed stage; sanitized invocation report: '+join(directory,'failure.json'));throw error;
 }finally{runner.shutdown();await acp.close();await runner.idle();runner.work.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
}
writeFileSync(join(directory,'acceptance.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log('PASS real Claude and Codex consultation journeys, including reused parent sessions.');
