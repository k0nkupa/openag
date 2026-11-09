// Standalone public-interface verification. No unit runner, model account, live data or persistent preview server.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,cpSync,readdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(root+'apps/daemon/package.json');const Database=require('better-sqlite3');const {WebSocket}=require('ws');
const dir=mkdtempSync(join(tmpdir(),'openag-work-'));const oldMigrations=join(dir,'old-migrations');mkdirSync(oldMigrations);
const migrations=root+'apps/daemon/dist/db/migrations';for(const name of readdirSync(migrations))if(parseInt(name,10)<14)cpSync(join(migrations,name),join(oldMigrations,name));
const {migrate}=await import(root+'apps/daemon/dist/db/migrate.js');
const old=new Database(join(dir,'openag.db'));require('sqlite-vec').load(old);migrate(old,oldMigrations);
old.prepare("INSERT INTO bots(id,name,runtime,config_json,created_at) VALUES('legacy','legacy','api','{}',1)").run();
old.prepare("INSERT INTO rooms(id,name,lead_bot_id,created_at) VALUES('legacy','legacy','legacy',1)").run();
old.prepare("INSERT INTO room_members VALUES('legacy','legacy')").run();
old.prepare("INSERT INTO events(room_id,ts,actor,type,payload_json) VALUES('legacy',1,'user','message','{\"text\":\"Historical message\"}')").run();old.close();
let child,base,port=0,fastWatchdog=false;const messages=[];const ownerToken=randomBytes(32).toString('hex');let deviceToken=ownerToken;let ws;
async function start(){child=fork(fileURLToPath(new URL('./work-fixture.mjs',import.meta.url)),[dir],{env:Object.fromEntries(['PATH','HOME','LANG','TMPDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),stdio:['ignore','inherit','inherit','ipc']});child.on('message',m=>messages.push(m));const ready=once(child,'message',{signal:AbortSignal.timeout(20000)});child.send({ownerToken,port,fastWatchdog});const [m]=await ready;assert.equal(m.type,'ready');base=m.url;port=Number(new URL(base).port);}
async function stop(){if(!child||child.exitCode!==null)return;const exited=once(child,'exit',{signal:AbortSignal.timeout(15000)});child.send({type:'stop'});try{await exited;}catch(error){child.kill('SIGKILL');throw error;}}
async function until(read,predicate,label){const end=Date.now()+12000;let value;do{value=await read();if(predicate(value))return value;await pause(30);}while(Date.now()<end);throw new Error('Timed out: '+label+'; latest='+JSON.stringify(value));}
const req=async(path,{method='GET',body,token=deviceToken}={})=>{
 if(method==='POST'&&path.startsWith('/approvals/')&&body&&body.reviewVersion===undefined){const reviewed=await fetch(base+path,{headers:{authorization:'Bearer '+token}}).then(r=>r.json());body={...body,reviewVersion:reviewed.approval?.reviewVersion};}
 return fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
};
async function json(path){const r=await req(path);assert.equal(r.status,200,path);return r.json();}
async function post(room,text){const r=await req('/rooms/'+room+'/messages',{method:'POST',body:{text}});assert.equal(r.status,202);return (await r.json()).message;}
const get=async id=>(await json('/work/'+id)).work;
const cancel=(w,token=deviceToken)=>req('/work/'+w.id+'/cancel',{method:'POST',body:{revision:w.revision},token});
async function forMessage(message,bot){const r=await until(()=>json('/work?roomId='+message.roomId),r=>r.work.some(w=>w.requestId===message.id&&(!bot||w.botId===bot)),'work created');return r.work.find(w=>w.requestId===message.id&&(!bot||w.botId===bot));}
async function status(w,value){return until(()=>get(w.id),r=>r.status===value,'work '+value);}
async function approval(w){return (await until(()=>json('/work/'+w.id+'/approvals'),r=>r.approvals.some(a=>a.status==='pending'),'linked approval')).approvals.find(a=>a.status==='pending');}
async function ipc(type,body={},response=type+'-result'){const before=messages.length;child.send({type,...body});return until(()=>messages.slice(before),ms=>ms.some(m=>m.type===response),response).then(ms=>ms.find(m=>m.type===response));}
await start();
try{
 const full=await (await req('/devices',{method:'POST',body:{name:'Work verifier',access:'full'}})).json();deviceToken=full.token;
 const limited=await (await req('/devices',{method:'POST',body:{name:'Limited verifier',access:'limited'}})).json();
 assert.equal((await req('/work',{token:'invalid'})).status,401);
 assert.equal((await req('/work',{token:limited.token})).status,200);
 for(const query of ['limit=0','limit=101','before=-1','status=bogus','unexpected=true','parentId=bad'])assert.equal((await req('/work?'+query)).status,400);
 assert.equal((await req('/work/no-such-id')).status,404);
 assert.equal((await req('/work/no-such-id/runs')).status,404);
 assert.equal((await req('/work/no-such-id/cancel',{method:'POST',body:{}})).status,404);
 assert.equal((await json('/rooms/legacy/events')).events[0].payload.text,'Historical message');
 assert.equal((await json('/work')).work.length,0,'no manufactured historical Work');
 const streamed=[];ws=new WebSocket(base.replace('http','ws')+'/stream?token='+deviceToken);ws.on('message',data=>streamed.push(JSON.parse(data)));await once(ws,'open');
 const a=await post('main','finish');const completed=await status(await forMessage(a),'completed');
 assert.equal(completed.botId,'boss');assert.equal(completed.progress.finishedTurns,1);
 assert.equal((await json('/work/'+completed.id+'/runs')).runs.length,1);
 assert.equal((await cancel(completed)).status,409);
 const wait=await post('main','wait');let waiting=await forMessage(wait);await until(()=>json('/work/'+waiting.id+'/runs'),r=>r.runs[0]?.status==='running','running before cancel');
 assert.equal((await cancel(waiting,limited.token)).status,403);
 assert.equal((await req('/work/'+waiting.id+'/cancel',{method:'POST',body:{revision:waiting.revision+100}})).status,409);
 const queuedMessage=await post('main','finish');const queued=await forMessage(queuedMessage);
 assert.equal((await json('/work/'+queued.id+'/runs')).runs[0].turnId,null);
 assert.ok([200,202].includes((await cancel(queued)).status));await status(queued,'cancelled');
 assert.ok([200,202].includes((await cancel(await get(waiting.id))).status));const stopped=await status(waiting,'cancelled');
 assert.equal((await cancel(stopped)).status,200,'repeat cancel is idempotent');
 assert.equal((await json('/work/'+queued.id+'/runs')).runs[0].turnId,null,'queued cancelled Work never executes');
 const independent=await post('other','finish');await status(await forMessage(independent),'completed');
 for(const decision of ['accept','edit','respond','ignore']){
  const m=await post('main','ask');const w=await status(await forMessage(m),'needs_approval');const ap=await approval(w);
  assert.equal(existsSync(join(dir,'results',m.id+'.txt')),false);
  const body=decision==='edit'?{kind:decision,payload:{requestId:m.id,text:'edited'}}:decision==='respond'?{kind:decision,text:'Do something else'}:{kind:decision};
  const answers=await Promise.all([req('/approvals/'+ap.id,{method:'POST',body}),req('/approvals/'+ap.id,{method:'POST',body})]);
  assert.deepEqual(answers.map(r=>r.status).sort(),[200,409]);
  const result=await status(w,['accept','edit'].includes(decision)?'completed':'failed');
  assert.equal(existsSync(join(dir,'results',m.id+'.txt')),['accept','edit'].includes(decision));
  if(decision==='edit')assert.equal(readFileSync(join(dir,'results',m.id+'.txt'),'utf8'),'edited');
  assert.equal(result.progress.pendingTools,0);
 }
 for(let i=0;i<3;i++){
  const message=await post('main','ask');const work=await status(await forMessage(message),'needs_approval');const ap=await approval(work);
  const answers=await Promise.all([cancel(await get(work.id)),req('/approvals/'+ap.id,{method:'POST',body:{kind:'accept'}})]);
  assert.ok([200,202,409].includes(answers[0].status));assert.ok([200,409].includes(answers[1].status));
  const result=await until(()=>get(work.id),w=>['cancelled','completed','interrupted'].includes(w.status),'cancel/decision race');assert.equal(result.progress.pendingTools,0);
 }
 const input=await status(await forMessage(await post('main','input')),'needs_input');assert.equal(input.nextStep,'What is the budget?');assert.equal(input.planIsExecutionEvidence,false);
 const fake=await forMessage(await post('main','fake-done'));await until(()=>get(fake.id),w=>w.plan.length===1,'reported plan');assert.equal((await get(fake.id)).status,'working');assert.equal((await get(fake.id)).progress.finishedTurns,0);await cancel(await get(fake.id));await status(fake,'cancelled');
 const bad=await forMessage(await post('main','bad-report'));assert.equal((await get(bad.id)).status,'working');await cancel(await get(bad.id));await status(bad,'cancelled');
 const failed=await status(await forMessage(await post('main','fail')),'failed');assert.match(failed.nextStep,/failed/i);
 const unknown=await status(await forMessage(await post('main','unknown')),'interrupted');assert.equal(unknown.progress.pendingTools,1);
 const uncooperativeMessage=await post('main','uncooperative');const uncooperative=await forMessage(uncooperativeMessage);await until(()=>json('/work/'+uncooperative.id+'/runs'),r=>r.runs[0].status==='running','uncooperative started');await cancel(await get(uncooperative.id));
 let unconfirmed=await get(uncooperative.id);assert.equal(unconfirmed.status,'working');assert.ok(unconfirmed.cancelRequestedAt);child.send({type:'release',key:uncooperativeMessage.id});await status(uncooperative,'cancelled');
 const slowMessage=await post('main','slow_tool');const slow=await status(await forMessage(slowMessage),'needs_approval');const slowApproval=await approval(slow);await req('/approvals/'+slowApproval.id,{method:'POST',body:{kind:'accept'}});
 await until(()=>messages,ms=>ms.some(m=>m.type==='tool-started'&&m.key===slowMessage.id),'tool executing');await cancel(await get(slow.id));assert.equal((await get(slow.id)).status,'working');
 child.send({type:'release',key:slowMessage.id});await status(slow,'cancelled');assert.equal(readFileSync(join(dir,'results',slowMessage.id+'.txt'),'utf8'),'slow_tool','cancellation does not undo completed side effects');
 const rootWork=await forMessage(await post('main','delegate'));
 const childApproval=(await until(()=>json('/approvals'),r=>r.approvals.some(a=>a.botId==='helper'),'delegated approval')).approvals.find(a=>a.botId==='helper');
 await status(rootWork,'needs_approval');assert.equal((await json('/work?parentId='+rootWork.id)).work.length,0,'delegation does not create another Work');
 await req('/approvals/'+childApproval.id,{method:'POST',body:{kind:'accept'}});const parentDone=await status(rootWork,'completed');assert.equal(parentDone.progress.turns,3,'delegate and return turns belong to the approved Work');
 const failureRoot=await forMessage(await post('main','delegate_fail'));await status(failureRoot,'failed');
 const cancelRoot=await forMessage(await post('main','delegate_wait'));await until(()=>json('/work/'+cancelRoot.id+'/runs'),r=>r.runs.some(x=>x.status==='running'),'delegate running');await cancel(await get(cancelRoot.id));await status(cancelRoot,'cancelled');assert.equal((await json('/work?parentId='+cancelRoot.id)).work.length,0);
 const hidden=await post('_internal','finish');await until(()=>json('/rooms/_internal/events'),r=>r.events.some(e=>e.type==='work_updated'),'internal Work');const hiddenId=(await json('/rooms/_internal/events')).events.find(e=>e.type==='work_updated').payload.workId;assert.equal((await req('/work/'+hiddenId)).status,404);assert.equal((await json('/work?roomId=_internal')).work.length,0);
 const secret=await status(await forMessage(await post('main','report-secret')),'needs_input');assert.ok(!JSON.stringify(secret).includes('work-fixture-secret-837628'));assert.ok(JSON.stringify(secret).includes('REDACTED'));
 const invalid=await ipc('invalid',{input:{roomId:'other',botId:'helper',messageId:a.id}});assert.equal(invalid.ok,false);assert.equal(invalid.status,400);
 const mismatch=await ipc('invalid',{input:{roomId:'other',botId:'boss',messageId:independent.id,workId:rootWork.id}});assert.equal(mismatch.ok,false);
 assert.equal((await ipc('atomic')).exists,false);assert.ok(!streamed.some(e=>e.payload?.message==='rolled-back-marker'));
 const beforePage=await json('/work?limit=2');await post('other','finish');const nextPage=await json('/work?limit=2&before='+beforePage.nextCursor);assert.ok(nextPage.work.every(w=>w.seq<beforePage.nextCursor));assert.ok(!nextPage.work.some(w=>beforePage.work.some(p=>p.id===w.id)));
 const acpMessage=await post('acp-room','acp_wait');const acpWork=await forMessage(acpMessage);await until(()=>messages,ms=>ms.some(m=>m.type==='acp-started'),'ACP prompt active');const otherAcp=await post('acp-other','acp_wait');const otherWork=await forMessage(otherAcp);await until(()=>messages,ms=>ms.filter(m=>m.type==='acp-started').length===2,'second ACP prompt');
 await cancel(await get(acpWork.id));await status(acpWork,'cancelled');assert.equal((await get(otherWork.id)).status,'working');assert.equal(messages.filter(m=>m.type==='acp-cancel').length,1,'only one session cancelled');await cancel(await get(otherWork.id));await status(otherWork,'cancelled');
 for(const [room,text,started,aborted] of [['model-room','api_wait','api-started','api-aborted'],['local-room','ollama_wait','ollama-started','ollama-aborted']]){
  const m=await post(room,text);const w=await forMessage(m);await until(()=>messages,ms=>ms.some(m=>m.type===started),started);await cancel(await get(w.id));await status(w,'cancelled');assert.ok(messages.some(m=>m.type===aborted),aborted);
 }
 const restartMessage=await post('main','ask');const restartWork=await status(await forMessage(restartMessage),'needs_approval');const restartApproval=await approval(restartWork);const sameId=restartWork.id;
 ws.close();await stop();await start();assert.equal((await get(sameId)).status,'needs_approval');assert.equal((await approval(restartWork)).id,restartApproval.id);
 await req('/approvals/'+restartApproval.id,{method:'POST',body:{kind:'accept'}});await status(restartWork,'completed');assert.equal(readFileSync(join(dir,'results',restartMessage.id+'.txt'),'utf8'),'ask');assert.equal((await json('/work/'+sameId+'/runs')).runs.length,1,'same run and Work survive restart');
 for(const decision of ['ignore','respond']){
  const message=await post('main','ask');const work=await status(await forMessage(message),'needs_approval');const ap=await approval(work);await stop();await start();
  await req('/approvals/'+ap.id,{method:'POST',body:decision==='ignore'?{kind:decision}:{kind:decision,text:'Answer without tools'}});
  const result=await status(work,'failed');assert.equal(result.progress.pendingTools,0,'restarted rejected action is known not-run');assert.equal(existsSync(join(dir,'results',message.id+'.txt')),false);
 }
 const drainingRoot=await forMessage(await post('main','delegate'));
 const drainingApproval=(await until(()=>json('/approvals'),r=>r.approvals.some(a=>a.botId==='helper'),'restart delegated approval')).approvals.find(a=>a.botId==='helper');await stop();await start();
 await req('/approvals/'+drainingApproval.id,{method:'POST',body:{kind:'accept'}});await status(drainingRoot,'interrupted');assert.equal((await json('/work?parentId='+drainingRoot.id)).work.length,0,'restart never fabricates child Work');
 for(const [text,expected] of [['acp_terminal','completed'],['acp_terminal_fail','failed']]) {const message=await post('acp-room',text);const result=await status(await forMessage(message),expected);assert.equal(result.progress.pendingTools,0);}
 console.log('OA-321 runtime, approval and delegation recovery checks passed.');
 const nativeMessage=await post('acp-room','acp_ask native-refused');const nativeWork=await status(await forMessage(nativeMessage),'failed');
 assert.equal(nativeWork.progress.tools,1);assert.equal(nativeWork.progress.pendingTools,0);assert.equal(existsSync(join(dir,'native','native-refused.txt')),false);
 assert.equal((await json('/work/'+nativeWork.id+'/approvals')).approvals.length,0,'Native execution must not create an actionable review');
 const crashMessage=await post('main','wait');const crashWork=await forMessage(crashMessage);await until(()=>json('/work/'+crashWork.id+'/runs'),r=>r.runs[0].status==='running','crash scenario active');
 const dead=once(child,'exit',{signal:AbortSignal.timeout(10000)});child.kill('SIGKILL');await dead;await start();await status(crashWork,'interrupted');assert.equal((await json('/work/'+crashWork.id+'/runs')).runs.length,1,'startup does not replay');await cancel(await get(crashWork.id));await status(crashWork,'cancelled');
 const shutdownMessage=await post('main','wait');const shutdownWork=await forMessage(shutdownMessage);await until(()=>json('/work/'+shutdownWork.id+'/runs'),r=>r.runs[0].status==='running','shutdown running');await stop();const stoppedDb=new Database(join(dir,'openag.db'),{readonly:true});assert.equal(stoppedDb.prepare('SELECT status FROM work WHERE id=?').get(shutdownWork.id).status,'interrupted');stoppedDb.close();await start();
 for(const [label,preset] of [['read-only','read-only'],['workspace','workspace-write'],['full','full-access']]){
  const old=await json('/bots/acp/permissions?roomId=acp-room');assert.equal((await req('/bots/acp/permissions?roomId=acp-room',{method:'PUT',body:{preset,revision:old.revision,acknowledgeFullAccess:preset==='full-access'}})).status,200);
  const path=join(dir,'bots','acp','work','native-'+label+'.txt');mkdirSync(join(dir,'bots','acp','work'),{recursive:true});writeFileSync(path,'Controlled base file');
  const message=await post('acp-room','acp_file '+label),w=await status(await forMessage(message),'failed');
  assert.equal(w.progress.pendingTools,0);assert.equal(readFileSync(path,'utf8'),'Controlled base file','Native file effects remain disabled in every mode');
  assert.equal((await json('/work/'+w.id+'/approvals')).approvals.length,0);assert.equal((await json('/work/'+w.id+'/receipts')).receipts.length,0,'Refused native calls must not fabricate executed receipts');
 }
 const pendingCancel=await status(await forMessage(await post('main','ask')),'needs_approval');const cancelledApproval=await approval(pendingCancel);await stop();await start();await cancel(await get(pendingCancel.id));await status(pendingCancel,'cancelled');assert.equal((await req('/approvals/'+cancelledApproval.id,{method:'POST',body:{kind:'accept'}})).status,409);
 const lastForCompleted=streamed.filter(e=>e.type==='work_updated'&&e.payload.workId===completed.id).at(-1);assert.ok(lastForCompleted);assert.ok((await get(completed.id)).revision>=lastForCompleted.payload.revision);
 const race=await ipc('shutdown-race');assert.equal(race.work.status,'interrupted');assert.equal(race.children,0,'shutdown between finishing and delegation must not create children or mark completion');
 await stop();fastWatchdog=true;await start();
 const watchdogMessage=await post('main','uncooperative');const watchdogWork=await forMessage(watchdogMessage);await until(()=>json('/work/'+watchdogWork.id+'/runs'),r=>r.runs[0].status==='running','watchdog runtime active');await cancel(await get(watchdogWork.id));const uncertain=await status(watchdogWork,'interrupted');assert.ok(uncertain.cancelRequestedAt);assert.match(uncertain.nextStep,/could not confirm/);child.send({type:'release',key:watchdogMessage.id});
 const raw=new Database(join(dir,'openag.db'),{readonly:true});assert.ok(!JSON.stringify(raw.prepare('SELECT * FROM work').all()).includes('work-fixture-secret-837628'));raw.close();
 console.log('OA-321 passed: migration/history, authenticated paged reads, all lifecycle states, approvals/decisions, delegation/return links, redaction, commit-only stream events, scoped ACP/API/Ollama cancellation, queued/unconfirmed/in-flight cancellation, process restart and crash recovery without replay.');
}finally{ws?.close();await stop();}
