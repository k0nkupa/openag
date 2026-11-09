// Codex ACP, temporary data, two no-tool subscription turns; Claude omitted at owner request. No business/provider writes.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
if(!process.argv.includes('--real-acp'))throw Error('Use --real-acp for bounded subscription handoffs.');
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {serve}=require('@hono/node-server');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createBot,createRoom,addMember}=await load('rooms'),{createRunner}=await load('runtimes/runner'),{createGateway}=await load('gateway');
const {createAcpRuntime}=await load('runtimes/acp'),{createMcpAccess}=await load('mcpserver');
const directory=mkdtempSync(join(tmpdir(),'openag-forks-acp-')),evidence=[];
console.log('Disposable ACP evidence: '+directory);
for(const adapter of ['codex']){
 const dataDir=join(directory,adapter),db=openDb(dataDir),ledger=createLedger(db),approvals=createApprovals(db,ledger),token=randomUUID(),auth=createAuth({db,ownerToken:token});
 const bot=createBot(db,{id:'bot',runtime:'acp',config:{adapter,instructions:'This is a no-tool local conversation continuity check. Do not read or write files, use memory, delegate, run commands or contact integrations. Reply only to the current user message.'}});
 createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
 let runner,base,configuredModel;
 const access=createMcpAccess({dataDir,runner:{activeTurn:(...args)=>runner.activeTurn(...args)},tools:()=>[]});
 const acp=createAcpRuntime({dataDir,mcp:{access,baseUrl:()=>base,tools:new Set()}});
 runner=createRunner({db,ledger,approvals,dataDir,runtimes:{acp},tools:{}});
 const runs=[];let roomId='main';
 const app=createGateway({db,ledger,approvals,auth,dataDir,work:runner.work,dispatch:args=>{const run=runner.dispatch(args);runs.push(run);return run;}});
 const server=serve({hostname:'127.0.0.1',port:0,fetch:req=>new URL(req.url).pathname==='/mcp'?access.handle(req):app.fetch(req)});
 if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
 base='http://127.0.0.1:'+server.address().port;
 const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 async function post(text){
  assert.equal((await request('/rooms/'+roomId+'/messages','POST',{text})).status,202);
  let timer;
  try{await Promise.race([Promise.all(runs.splice(0)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ACP handoff deadline; do not retry an uncertain invocation.')),120000);})]);}finally{clearTimeout(timer);}
  const turn=db.prepare('SELECT * FROM turns ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(turn.status,'finished','ACP turn '+turn.id+' did not settle normally');
  const response=await request('/turns/'+turn.id+'/request-manifests');assert.equal(response.status,200);
  const page=await response.json();assert.equal(page.records.length,1);
  const record=page.records[0];assert.equal(record.manifest.boundary,'acp-handoff');assert.equal(record.manifest.requestedModel,configuredModel);assert.equal(record.manifest.session.adapter,adapter);assert.equal(typeof record.manifest.session.reportedModel,'string');
  assert.deepEqual(record.evidence.map(e=>e.status),['started','returned']);
  assert.equal(record.manifest.session.childRequests,'unavailable');
  assert.equal(record.manifest.toolObservation,'daemon-allowlist-names');
  return {turn,record,output:ledger.list(roomId,{limit:1000}).filter(e=>e.type==='bot_output'&&e.payload.turnId===turn.id).map(e=>e.payload.text??'').join('\n')};
 }
 try{
  const choice=await acp.discover(bot,adapter);configuredModel=choice.model;assert.ok(configuredModel);
  db.prepare('UPDATE bots SET config_json=? WHERE id=?').run(JSON.stringify({...bot.config,modelConfig:{model:configuredModel}}),'bot');
  const marker='TRACE-'+randomUUID();
  ledger.append('main','user','message',{text:'The checkpoint marker is '+marker});
  const checkpoint=ledger.append('main','bot','bot_output',{text:'Recorded checkpoint marker '+marker});
  ledger.append('main','user','message',{text:'AFTER-CHECKPOINT-MUST-NOT-BE-COPIED'});
  const forkResponse=await request('/rooms/main/fork','POST',{requestId:randomUUID(),throughId:checkpoint.id});assert.equal(forkResponse.status,201);
  roomId=(await forkResponse.json()).room.id;
  assert.ok(!ledger.list(roomId).some(event=>JSON.stringify(event.payload).includes('AFTER-CHECKPOINT')));
  assert.equal(db.prepare('SELECT count(*) n FROM turns').get().n,0,'Fork creation starts no turn');
  const first=await post('Reply only with the checkpoint marker from the owner-selected prior transcript. Do not use tools.');
  assert.ok(first.record.manifest.context.sources.some(source=>source.source==='fork'),'Fork context is recorded in request provenance');
  assert.ok(first.output.includes(marker));
  const second=await post('Reply with the earlier marker from this conversation. Do not use tools.');
  assert.ok(second.output.includes(marker),'Actual reused adapter session retains first-call context');
  assert.equal(first.record.manifest.session.context,'fresh');assert.equal(second.record.manifest.session.context,'reused');
  assert.equal(first.record.manifest.session.idFingerprint,second.record.manifest.session.idFingerprint);
  assert.equal(JSON.parse(first.turn.state_json).acpSessionId,JSON.parse(second.turn.state_json).acpSessionId);
  assert.equal(approvals.listPending().length,0);
  assert.deepEqual(ledger.list(roomId,{limit:1000}).filter(e=>e.type==='tool_call'&&!(e.payload.kind==='other'&&e.payload.status==='failed'&&/^mcp__openag-[a-f0-9]+__startup$/.test(e.payload.title))),[],'No native or daemon tools used; own-server startup notifications are transport diagnostics');
  evidence.push({adapter,requestedModel:configuredModel,sessionModel:first.record.manifest.session.reportedModel,first:first.turn.id,second:second.turn.id,sessionFingerprint:first.record.manifest.session.idFingerprint,status:'passed'});
  console.log('PASS '+adapter+': real fork context, fresh/reused handoff, private inspection and no tools');
 }catch(error){
  console.error(JSON.stringify({adapter,turns:db.prepare('SELECT id,status FROM turns').all(),approvals:approvals.listPending().map(a=>({id:a.id,status:a.status}))}));throw error;
 }finally{runner.shutdown();await acp.close();await runner.idle();runner.work.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
}
writeFileSync(join(directory,'acceptance.json'),JSON.stringify(evidence,null,2));
console.log('PASS fork context through Codex ACP; Claude skipped at owner request. Evidence: '+join(directory,'acceptance.json'));
