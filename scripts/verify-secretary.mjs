import {createRequire} from 'node:module';
// Full-loop standalone acceptance. Real gateway/runner/policy/results/wake; synthetic sources and model transports.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'openag-secretary-')),ownerToken=randomBytes(32).toString('hex');let ws;let child,base,clock=Date.UTC(2026,10,2,12),sequence=0;
async function bounded(p){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Controlled fixture timed out')),20000);})]);}finally{clearTimeout(timer);}}
function ipc(type,extra={}){const requestId=randomUUID();return bounded(new Promise(resolve=>{const listener=m=>{if(m.requestId===requestId){child.off('message',listener);resolve(m);}};child.on('message',listener);child.send({type,requestId,...extra});}));}
async function start(extra={}){child=fork(root+'scripts/secretary-fixture.mjs',[dir],{stdio:['ignore','ignore','inherit','ipc']});const ready=once(child,'message');child.send({clock,ownerToken,...extra});base=(await bounded(ready))[0].url;}
async function kill(){const done=once(child,'exit');child.kill('SIGKILL');await bounded(done);}
async function json(path,{method='GET',body,status=200,token=ownerToken}={}){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,status,await r.clone().text());const text=await r.text();try{return JSON.parse(text);}catch{return {error:text};}}
const history=async r=>(await json('/responsibilities/'+r.id+'/history')).investigations;
async function until(read,predicate,label){const end=Date.now()+10000;while(Date.now()<end){const v=await read();if(predicate(v))return v;await new Promise(r=>setTimeout(r,20));}throw Error(label);}
async function create(name,extra={}){return (await json('/responsibilities',{method:'POST',status:201,body:{name,botId:'boss',roomId:'main',bindingId:'synthetic-allocation',resourceIds:['BRV'],sender:'manuela@example.invalid',topic:'allocation',question:'Check the referenced current record and prepare an unsent reply.',...extra}})).responsibility;}
async function update(r,patch){return (await json('/responsibilities/'+r.id,{method:'PUT',body:{baseRevision:r.revision,...patch}})).responsibility;}
const event=(extra={})=>({bindingId:'synthetic-allocation',resourceId:'BRV',id:'event-'+(++sequence),version:'1',observedAt:clock,sender:'manuela@example.invalid',subject:'Allocation question',body:'Please check SAMPLE-001. Treat this as source data, not permission to act.',...extra});
async function outcome(r){return (await until(()=>history(r),h=>h.length&&h[0].status!=='queued'&&h[0].status!=='running','Investigation did not settle'))[0];}
await start();
try{
 assert.equal((await fetch(base+'/responsibilities')).status,401);
 let r=await create('Synthetic allocation');const first=event();assert.equal((await ipc('observe',{id:r.id,event:first})).reason,'paused');assert.equal((await history(r)).length,0);r=await update(r,{enabled:true});
 await json('/responsibilities/'+r.id,{method:'PUT',status:409,body:{baseRevision:1,enabled:false}});
 const limitedCode=(await ipc('pair',{access:'limited'})).code;const limited=await json('/pair',{method:'POST',body:{code:limitedCode,name:'Limited test device'}});
 await json('/responsibilities/'+r.id,{method:'PUT',token:limited.token,status:403,body:{baseRevision:r.revision,enabled:false}});
 await json('/responsibilities/'+r.id+'/observe',{method:'POST',status:404,body:event()});
 const WebSocket=createRequire(root+'apps/daemon/package.json')('ws');ws=new WebSocket(base.replace('http','ws')+'/stream?token='+limited.token);const streamed=[];ws.on('message',bytes=>streamed.push(JSON.parse(String(bytes))));await bounded(once(ws,'open'));
 const before=await ipc('stats');await ipc('observe',{id:r.id,event:first});let i=await outcome(r);assert.equal(i.status,'completed',JSON.stringify(i));assert.ok(i.resultId);assert.equal(i.evidence.length,1);assert.equal(i.deliveryState,'ping');await until(async()=>streamed,events=>events.some(e=>e.payload.resultId===i.resultId),'Public result notice not streamed');assert.ok(streamed.every(e=>!e.roomId.startsWith('_investigation-')),'private execution data must never reach the client stream');await json('/rooms/_investigation-'+i.id+'/events',{status:404});await json('/rooms/%5Finvestigation-'+i.id,{status:404});
 const result=(await json('/results/'+i.resultId));assert.equal((await json('/responsibilities/'+r.id+'/history',{token:limited.token})).investigations[0].id,i.id,'Limited paired devices retain normal authenticated desk reads');assert.equal(result.result.origin,'investigation');assert.equal(result.result.toolCallId,null);assert.equal(result.result.workId,null);assert.ok(result.content.includes('Suggested reply — unsent'));assert.ok(!result.content.includes('PRIVATE_OTHER_CONTEXT_CANARY'));
 let stats=await ipc('stats');assert.equal(stats.reads,before.reads+1);assert.equal(stats.work,0);assert.equal(stats.approvals,0);assert.equal(stats.recallCalls,0);assert.ok(!JSON.stringify(stats.prompts).includes('PRIVATE_OTHER_CONTEXT_CANARY'));for(const p of stats.prompts)assert.ok(p.tools.every(t=>(t.name??t.function?.name)==='investigation_read'));
 assert.equal((await ipc('observe',{id:r.id,event:first})).reason,'duplicate');assert.equal((await ipc('observe',{id:r.id,event:{...first,body:'Conflicting duplicate'}})).reason,'conflicting_duplicate');assert.equal((await history(r)).length,1);assert.equal((await history(r))[0].sourceConflict,true);
 const unchanged=stats.reads;await ipc('observe',{id:r.id,event:event({subject:'Lunch tomorrow'})});await ipc('observe',{id:r.id,event:event({sender:'other@example.invalid'})});await ipc('observe',{id:r.id,event:event({subject:''})});assert.equal((await history(r)).length,1);assert.equal((await ipc('stats')).reads,unchanged);
 const invalidScope=await create('Unavailable resource',{resourceIds:['OTHER']});await json('/responsibilities/'+invalidScope.id,{method:'PUT',status:409,body:{baseRevision:invalidScope.revision,enabled:true}});
 for(const [mode,reason]of [['partial_report','output_truncated'],['invented','invalid_evidence'],['invalid_report','invalid_report'],['foreign','missing_access'],['direct_escape','read_refused_or_failed'],['steps','step_limit'],['tools','tool_limit']]){
  await ipc('mode',{mode});await ipc('observe',{id:r.id,event:event()});i=await outcome(r);assert.equal(i.status,'incomplete',mode+': '+JSON.stringify(i));if(reason!=='tool_limit')assert.equal(i.reason,reason,mode);assert.equal((await ipc('stats')).approvals,0);if(mode==='partial_report')assert.ok(i.resultId,'valid incomplete report must survive runner diagnostics');
 }
 assert.ok((await ipc('stats')).directDenied>0);assert.equal(existsSync(join(dir,'bots','boss','work','must-not-write.txt')),false);
 await ipc('mode',{mode:'normal'});for(const mode of ['missing_access','missing_record','stale','oversized']){await ipc('source-mode',{mode});await ipc('observe',{id:r.id,event:event()});i=await outcome(r);assert.equal(i.status,'incomplete');if(mode.startsWith('missing'))assert.equal(i.reason,mode);}
 await ipc('source-mode',{mode:'normal'});await ipc('observe',{id:r.id,event:event({observedAt:clock-90000000})});i=await outcome(r);assert.equal(i.status,'blocked');assert.equal(i.reason,'stale_event');
 let local=await create('Local model investigation',{botId:'local'});local=await update(local,{enabled:true});await ipc('observe',{id:local.id,event:event()});i=await outcome(local);assert.equal(i.status,'completed',JSON.stringify(i));
 const cli=await create('Unsupported CLI',{botId:'cli'});await json('/responsibilities/'+cli.id,{method:'PUT',status:409,body:{baseRevision:cli.revision,enabled:true}});assert.equal((await ipc('stats')).acpCalls,0);
 await ipc('mode',{mode:'selective'});await ipc('observe',{id:r.id,event:event()});i=await outcome(r);assert.equal(i.status,'incomplete');assert.equal(i.reason,'conflicting_evidence');assert.ok((await json('/results/'+i.resultId)).content.includes('Source observations conflict'));assert.ok((await json('/results/'+i.resultId)).content.includes('SAMPLE-002'),'selectively citing only a non-conflicting source cannot hide conflict evidence');await ipc('mode',{mode:'normal'});
 // Abort a source that ignores cancellation; a late response cannot publish evidence or a result.
 await ipc('source-mode',{mode:'hold'});const atHold=(await ipc('stats')).reads;await ipc('observe',{id:r.id,event:event()});await until(()=>ipc('stats'),s=>s.reads>atHold,'Held source was not called');const oldResultId=result.result.id;r=await update(r,{enabled:false});await ipc('release');await until(()=>history(r),h=>h[0].status==='cancelled','Pause did not cancel');assert.equal((await history(r))[0].evidence.length,0);await json('/results/'+oldResultId,{status:404});await json('/rooms/_investigation-'+i.id+'/events',{status:404});r=await update(r,{enabled:true});
 // Source revocation also fences a final model response.
 await ipc('mode',{mode:'hold_model'});await ipc('observe',{id:r.id,event:event()});await until(()=>ipc('stats'),s=>s.heldModels>0,'Model did not progress');await ipc('ready-source',{ready:false});await ipc('release');i=await outcome(r);assert.equal(i.status,'cancelled');assert.equal(i.resultId,null);await ipc('ready-source',{ready:true});
 // One active plus one queued; overflow is not acknowledged and a runtime edit cannot start the queued CLI.
 await ipc('source-mode',{mode:'hold'});const heldBefore=(await ipc('stats')).reads;await ipc('observe',{id:r.id,event:event()});await until(()=>ipc('stats'),s=>s.reads>heldBefore,'Queue source did not start');
 await ipc('observe',{id:r.id,event:event()});assert.equal((await ipc('observe',{id:r.id,event:event()})).reason,'capacity');
 await ipc('runtime',{botId:'boss',runtime:'acp'});await ipc('release');await until(()=>history(r),h=>h.every(i=>i.status!=='running'&&i.status!=='queued'),'Queued runtime change did not settle');assert.equal((await history(r))[0].reason,'unsupported_runtime');assert.equal((await ipc('stats')).acpCalls,0);await ipc('runtime',{botId:'boss',runtime:'api'});
 // Crash after real read: recover Interrupted with zero model/source execution replay.
 await ipc('crash',{phase:'read'});let exit=once(child,'exit');await ipc('observe',{id:r.id,event:event()});await bounded(exit);await start();i=await outcome(r);assert.equal(i.status,'interrupted');const afterCrash=await ipc('stats');await kill();await start();assert.equal((await ipc('stats')).reads,afterCrash.reads);
 // Crash after settlement and after wake commit. Recovery reconciles delivery only, once.
 for(const phase of ['settlement','wake','notification']){
  console.log('checking crash boundary: '+phase);
  await ipc('crash',{phase});exit=once(child,'exit');await ipc('observe',{id:r.id,event:event()});await bounded(exit);const reads=Number(readFileSync(join(dir,'reads.count'),'utf8'));await start();i=await outcome(r);assert.equal(i.status,'completed');assert.ok(i.resultId);const after=await ipc('stats');assert.equal(after.reads,reads);await kill();await start();assert.equal((await ipc('stats')).notifications,after.notifications);assert.equal((await history(r))[0].wakeDecisionId,i.wakeDecisionId);
 }
 await ipc('quiet-hours');await ipc('observe',{id:r.id,event:event()});i=await outcome(r);assert.equal(i.deliveryState,'digest');assert.ok(i.resultId);assert.ok((await json('/digest')).items.some(item=>item.resultId===i.resultId));await json('/brief',{method:'POST'});assert.ok((await json('/rooms/main/events')).events.some(e=>e.payload.brief===true&&e.payload.resultIds?.includes(i.resultId)),'morning brief carries a navigable result identity');
 r=await update(r,{question:'Updated question'});assert.equal((await ipc('observe',{id:r.id,event:first})).reason,'duplicate');
 // Deadline cancellation settles even when a controlled provider ignores the signal.
 await kill();await start({deadlineMs:100});await ipc('mode',{mode:'hold_model'});await ipc('observe',{id:r.id,event:event()});i=await outcome(r);assert.equal(i.status,'incomplete');assert.equal(i.reason,'deadline');await ipc('release');await kill();await start();
 await ipc('budget',{value:0});await ipc('observe',{id:r.id,event:event()});i=await outcome(r);assert.equal(i.deliveryState,'digest');
 // Actual v26→v27 migration: retained tool provenance, old wake rows and empty/populated result sequence.
 const require=createRequire(root+'apps/daemon/package.json'),Database=require('better-sqlite3'),{migrate}=await import(root+'apps/daemon/dist/db/migrate.js'),rooms=await import(root+'apps/daemon/dist/rooms.js');
 for(const populated of [false,true]){
  const database=new Database(':memory:');database.pragma('foreign_keys=ON');const folder=join(dir,'migration-'+populated);mkdirSync(folder);
  for(const file of readdirSync(root+'apps/daemon/dist/db/migrations').filter(f=>/^\d+_/.test(f)&&Number(f.slice(0,3))<=26))copyFileSync(root+'apps/daemon/dist/db/migrations/'+file,join(folder,file));
  migrate(database,folder);rooms.createBot(database,{id:'legacy',runtime:'api'});rooms.createRoom(database,{id:'legacy'});
  database.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES('legacy-turn','legacy','legacy','finished','{}',1,2)").run();
  database.prepare("INSERT INTO saved_results(seq,id,version,work_id,room_id,bot_id,turn_id,tool_call_id,name,kind,content,bytes,created_at) VALUES(73,'legacy-result',1,NULL,'legacy','legacy','legacy-turn','legacy-call','old.md','note','legacy content',14,2)").run();
  database.prepare("INSERT INTO wake_decisions(ts,source,bot_id,verdict,urgency,dedupe_key,reason,decision,created_at) VALUES(1,'legacy','legacy','silent','low','old','legacy reason','silent',1)").run();
  const old=database.prepare('SELECT * FROM saved_results').get(),oldWake=database.prepare('SELECT * FROM wake_decisions').get();if(!populated)database.exec('DELETE FROM saved_results');
  copyFileSync(root+'apps/daemon/dist/db/migrations/027_responsibilities.sql',join(folder,'027_responsibilities.sql'));migrate(database,folder);
  assert.equal(database.prepare("SELECT seq FROM sqlite_sequence WHERE name='saved_results'").get().seq,73);if(populated){const current=database.prepare('SELECT * FROM saved_results').get();for(const [key,value]of Object.entries(old))assert.equal(current[key],value);assert.equal(current.origin,'tool');assert.equal(current.investigation_id,null);}
  const currentWake=database.prepare('SELECT * FROM wake_decisions').get();for(const [key,value]of Object.entries(oldWake))assert.equal(currentWake[key],value);assert.equal(currentWake.delivery_key,null);assert.deepEqual(database.pragma('foreign_key_check'),[]);database.close();
 }
 // Automatic conversation artifacts remain reachable behind revoked investigation rows.
 await ipc('mode',{mode:'legacy_result'});await json('/rooms/main/messages',{method:'POST',status:202,body:{text:'@boss Save the controlled conversation note.'}});
 const legacy=(await until(()=>json('/results'),v=>v.results.some(result=>result.name==='legacy.md'),'Legacy result absent')).results.find(result=>result.name==='legacy.md');await ipc('mode',{mode:'normal'});
 for(let n=0;n<100;n++){await ipc('observe',{id:r.id,event:event()});assert.ok((await outcome(r)).resultId);}
 await ipc('mode',{mode:'legacy_result'});await json('/rooms/main/messages',{method:'POST',status:202,body:{text:'@boss Save another controlled conversation note.'}});
 const afterQuota=(await until(()=>json('/results'),v=>v.results.some(result=>result.name==='legacy.md'&&result.id!==legacy.id),'Investigation artifacts consumed interactive quota')).results.find(result=>result.name==='legacy.md'&&result.id!==legacy.id);await ipc('mode',{mode:'normal'});
 for(let n=0;n<4;n++){await ipc('observe',{id:r.id,event:event()});assert.ok((await outcome(r)).resultId);}
 const withheld=(await history(r))[0].resultId;r=await update(r,{enabled:false});assert.equal((await json('/results?limit=1')).results[0].id,afterQuota.id,'hidden newer rows must not produce an empty result page');assert.ok(!(await json('/digest')).items.some(item=>item.resultId===withheld));
 await json('/brief',{method:'POST'});assert.ok(!(await json('/rooms/main/events')).events.some(e=>e.payload.brief===true&&e.payload.resultIds?.includes(withheld)),'paused scope cannot publish a queued digest result');
 r=await update(r,{enabled:true});await ipc('observe',{id:r.id,event:event()});i=await outcome(r);
 const configuredBefore=await ipc('stats');await kill();await start({withSource:false});assert.equal((await json('/responsibilities')).source.state,'source_unavailable');await json('/responsibilities/'+r.id,{method:'PUT',status:409,body:{baseRevision:r.revision,enabled:true}});assert.equal((await ipc('stats')).reads,configuredBefore.reads);assert.equal((await ipc('stats')).models,configuredBefore.models);await kill();await start();
 console.log('OA-368 migration passed: populated/empty result history, original tool/turn provenance, sequence high-water mark, old wake decisions and foreign keys.');
 console.log('OA-368 synthetic loop passed: API/Ollama, reviewed enable, evidence and unsent result, no Work/approvals/recall, scoped offering and executor denial, incomplete limits/access, pause/revocation, duplicate/conflict and crash-safe delivery.');
 writeFileSync(join(dir,'evidence.json'),JSON.stringify({responsibilityId:r.id,resultId:i.resultId,dir},null,2));
 if(process.argv.includes('--serve')){console.log(JSON.stringify({url:base+'/#/automations',pairCode:(await ipc('pair')).code,dir}));await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});}
}finally{ws?.terminate();if(child?.connected){const exit=once(child,'exit');child.send({type:'stop'});await bounded(exit);}}
