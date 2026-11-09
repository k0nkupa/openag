// Standalone public HTTP/CLI/runner acceptance. No unit runner or real model account.
import assert from 'node:assert/strict';
import { fork,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync,writeFileSync,readFileSync,mkdirSync } from 'node:fs';
import { tmpdir,hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'openag-settings-')),ownerToken=randomBytes(32).toString('hex');
let child,base,port=0;
async function start(){child=fork(root+'scripts/settings-fixture.mjs',[dir],{stdio:['ignore','ignore','inherit','ipc']});const ready=once(child,'message',{signal:AbortSignal.timeout(15000)});child.send({ownerToken,port});base=(await ready)[0].url;port=Number(new URL(base).port);}
async function stop(){if(child?.connected){const end=once(child,'exit',{signal:AbortSignal.timeout(15000)});child.send({type:'stop'});await end;}}
async function ipc(type,value={}){
 const reply=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.off('message',receive);reject(Error('Fixture response deadline: '+type));},15000);const receive=message=>{if(message.type===type+'-result'){clearTimeout(timer);child.off('message',receive);resolve(message);}};child.on('message',receive);});
 child.send({type,...value});return reply;
}
const req=(path,{method='GET',body,token=ownerToken}={})=>fetch(base+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
async function json(path,opts){const r=await req(path,opts);assert.ok(r.ok,`${path}: ${r.status} ${await(!r.ok?r.text():Promise.resolve(''))}`);return r.json();}
async function until(read,predicate){const end=Date.now()+15000;do{const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,50));}while(Date.now()<end);throw Error('Acceptance deadline');}
const events=()=>json('/rooms/main/events');
try{
 await start();
 const full=(await json('/devices',{method:'POST',body:{name:'Settings full',access:'full'}})).token,limited=(await json('/devices',{method:'POST',body:{name:'Settings limited'}})).token;
 assert.equal((await req('/settings',{token:null})).status,401);
 const settings=(await json('/settings')).settings;
 for(const[key,value]of Object.entries({heartbeat:{...settings.heartbeat,everyMinutes:0},activeHours:{start:'25:00',end:'09:00',days:[]},wake:{...settings.wake,dailyPingBudget:51},brief:{...settings.brief,time:'bad'},reflection:{...settings.reflection,time:'bad'}}))assert.equal((await req('/settings/'+key,{method:'PUT',body:value})).status,400,key);
 assert.equal((await req('/settings/apps',{method:'PUT',body:settings.apps,token:limited})).status,403);
 assert.equal((await req('/bots/coder/settings',{method:'PUT',body:{instructions:'Disallowed'},token:limited})).status,403);
 assert.equal((await req('/bots/coder/memory',{method:'PUT',body:{text:'Disallowed'},token:limited})).status,403);
 assert.equal((await req('/rooms/main/router',{method:'PUT',body:{strategy:'lead'},token:limited})).status,403);
 // Preserve the existing limited-device permission for non-owner schedule keys and avatar-only patches.
 assert.equal((await req('/settings/heartbeat',{method:'PUT',body:settings.heartbeat,token:limited})).status,200);
 assert.equal((await req('/bots/coder/settings',{method:'PUT',body:{avatar:{shape:'star',color:'green'}},token:limited})).status,200);
 await json('/bots/coder/settings',{method:'PUT',body:{instructions:'Temporary instructions saved'},token:full});
 assert.equal((await json('/bots/coder/settings',{token:full})).instructions,'Temporary instructions saved');
 const heartbeat={...settings.heartbeat,enabled:false,everyMinutes:41};
 await ipc('mode',{value:'lost'});assert.equal((await req('/settings/heartbeat',{method:'PUT',body:heartbeat})).status,503);
 assert.equal((await json('/settings')).settings.heartbeat.everyMinutes,41,'lost response can follow a committed write');
 await ipc('mode',{value:'refuse'});assert.equal((await req('/settings/heartbeat',{method:'PUT',body:{...heartbeat,everyMinutes:42}})).status,503);
 assert.equal((await json('/settings')).settings.heartbeat.everyMinutes,41,'refused request does not write');await ipc('mode',{value:'normal'});
 const models=await json('/models/status');assert.ok(models.providers.every(p=>!p.set));assert.equal(models.ollama.reachable,false);
 assert.ok((await json('/router')).strategies.find(r=>r.strategy==='jev').reason.includes('not set'));
 assert.equal((await req('/rooms/main/router',{method:'PUT',body:{strategy:'jev'}})).status,409);
 await ipc('router-config',{enabled:true});await json('/rooms/main/router',{method:'PUT',body:{strategy:'jev'}});
 const routed=await json('/rooms/main/messages',{method:'POST',body:{text:'Fallback check'}});assert.deepEqual(routed.route.payload.targets,['boss']);assert.match(routed.route.payload.router.reason,/fallback/);
 const before=(await ipc('stats')).routerCalls;const mentioned=await json('/rooms/main/messages',{method:'POST',body:{text:'@coder Mention check'}});assert.deepEqual(mentioned.route.payload.targets,['coder']);assert.equal((await ipc('stats')).routerCalls,before);
 await json('/rooms/main/router',{method:'PUT',body:{strategy:'lead'}});
 await until(()=>json('/work'),r=>r.work.length>=2&&r.work.every(w=>w.status==='completed'));
 // Install the fixed local example with the same digest/machine-bound CLI the desk presents.
 const review=await json('/app-library/setup/hello');
 const installed=spawnSync(process.execPath,[root+'apps/daemon/dist/setup.js','install',review.id,'--data-dir',dir,'--machine',hostname(),'--digest',review.digest],{encoding:'utf8',timeout:15000,env:Object.fromEntries(['PATH','HOME','LANG','TMPDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});assert.equal(installed.status,0,installed.stderr);
 await json('/apps/reload',{method:'POST'});const app=(await json('/apps/hello/review')).app;await json('/apps/hello/enable',{method:'POST',body:{hash:app.hash}});
 assert.equal((await json('/app-library')).entries.find(e=>e.id==='app:hello').state,'ready');
 const post=await json('/rooms/main/messages',{method:'POST',body:{text:'JOINED flow approval and result'}});
 const proposal=(await until(()=>json('/approvals?status=pending'),r=>r.approvals.some(a=>a.toolName==='save_result'))).approvals.find(a=>a.toolName==='save_result');
 await json('/approvals/'+proposal.id,{method:'POST',body:{kind:'accept',reviewVersion:proposal.reviewVersion}});
 const pending=(await until(()=>json('/approvals?status=pending'),r=>r.approvals.some(a=>a.toolName==='write_file'))).approvals.find(a=>a.toolName==='write_file');
 const work=(await until(()=>json('/work'),r=>r.work.some(w=>w.requestId===post.message.id))).work.find(w=>w.requestId===post.message.id);
 assert.ok((await json('/results?workId='+work.id)).results.length);assert.equal((await req('/attention/summary')).status,404);
 await stop();await start();
 assert.equal((await json('/settings')).settings.heartbeat.everyMinutes,41);
 assert.equal((await json('/bots/coder/settings')).instructions,'Temporary instructions saved');
 assert.equal((await json('/app-library')).entries.find(e=>e.id==='app:hello').state,'ready');
 const durable=(await json('/approvals/'+pending.id)).approval;assert.equal(durable.status,'pending');assert.ok((await json('/results?workId='+work.id)).results.length);
 assert.equal((await req('/approvals/'+pending.id,{method:'POST',body:{kind:'accept',reviewVersion:'stale'}})).status,409);
 await json('/approvals/'+pending.id,{method:'POST',body:{kind:'accept',reviewVersion:durable.reviewVersion}});
 await until(()=>json('/work/'+work.id),r=>r.work.status==='completed');
 assert.equal(readFileSync(join(dir,'bots/boss/work/oa330-check.txt'),'utf8'),'Exact reviewed temporary action');
 const receipts=(await json('/work/'+work.id+'/receipts')).receipts;assert.ok(receipts.some(r=>r.toolName==='write_file'&&r.outcome==='completed'));
 assert.equal((await req('/attention/summary')).status,404);
 const automation=(await json('/automations',{method:'POST',body:{name:'Joined local delivery',prompt:'Local delivery check',botId:'boss',roomId:'main',scheduleCron:'0 9 * * *',tz:'UTC',enabled:true,allowApprovals:false}})).automation;
 await json('/automations/'+automation.id+'/run',{method:'POST'});
 const history=await until(()=>json('/automation-runs?automationId='+automation.id),r=>r.runs.some(run=>run.outcome==='completed'));assert.equal(history.runs[0].delivery.kind,'room');
 await ipc('disconnect');await ipc('connect');assert.ok((await events()).events.some(e=>e.type==='approval_decided'));assert.ok((await json('/results?workId='+work.id)).results.length);
 mkdirSync(root+'docs/notes/settings',{recursive:true});writeFileSync(root+'docs/notes/settings/http.json',JSON.stringify({result:'passed',checks:['schema validation and 401/403/409 boundaries','owner/full/limited capabilities retained','lost-save committed state versus refused write','env-only absent provider status and unreachable Ollama','OpenRouter unavailable and controlled failure lead fallback','explicit mention bypasses router','digest-bound CLI local app installation and real example process execution','conversation → Work → saved proposal → pending exact approval → actual process restart → stale review refusal → exact write → completed receipt → empty Needs you','automation local delivery and run history','saved settings, proposals, approvals and installed identity survive restart/reconnect'],manualModel:'separate gate',physicalDevice:'open by owner choice',dir},null,2)+'\n');
 console.log('OA-330 Settings and joined-flow public acceptance passed.');
 if(process.argv.includes('--keep')){writeFileSync('/tmp/oa330-browser-target.json',JSON.stringify({base,token:full,limited,dir,workId:work.id,automationId:automation.id}),{mode:0o600});console.log('Temporary Settings target ready at '+base);process.stdin.setEncoding('utf8');process.stdin.on('data',async text=>{try{console.log(JSON.stringify(await ipc(JSON.parse(text).type,JSON.parse(text))));}catch(e){console.error(e.message);}});await new Promise(r=>{process.once('SIGTERM',r);process.once('SIGINT',r);});}
}finally{await stop();process.stdin.pause();}
