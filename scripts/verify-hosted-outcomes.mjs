// Standalone controlled acceptance through runtimes, gateway and runner. No unit runner or live provider.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,readdirSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=n=>import(root+'apps/daemon/dist/'+n+'.js');
const {MockLanguageModelV3}=await import(require.resolve('ai/test')),{z}=require('zod');
const {openDb}=await load('db/index'),{migrate}=await load('db/migrate'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createBot,createRoom,addMember,getBot,getRoom}=await load('rooms'),{createRunner}=await load('runtimes/runner'),{createGateway}=await load('gateway');
const {createApiRuntime}=await load('runtimes/api'),{createOllamaRuntime}=await load('runtimes/ollama'),{toExecutors}=await load('tools/registry');
const dir=mkdtempSync(join(tmpdir(),'openag-hosted-outcomes-'));
// Seed a genuine v24 graph, including deleted high-water sequence values, before the new migration.
const migrations=join(dir,'v24');mkdirSync(migrations);for(const name of readdirSync(root+'apps/daemon/dist/db/migrations'))if(parseInt(name)<25)cpSync(root+'apps/daemon/dist/db/migrations/'+name,join(migrations,name));
const Database=require('better-sqlite3'),old=new Database(join(dir,'openag.db'));require('sqlite-vec').load(old);old.pragma('foreign_keys=ON');migrate(old,migrations);
createBot(old,{id:'legacy',runtime:'api'});createRoom(old,{id:'legacy',leadBotId:'legacy'});addMember(old,'legacy','legacy');
const oldLedger=createLedger(old),message=oldLedger.append('legacy','user','message',{text:'Historical request'});
old.prepare("INSERT INTO turns VALUES('legacy-turn','legacy','legacy','finished','{}',1,1)").run();
old.prepare("INSERT INTO work(id,room_id,bot_id,request_id,title,request,status,next_step,created_at,updated_at,creation_key,origin_message_id,origin_turn_id) VALUES('legacy-work','legacy','legacy',?,'old','old','completed','old',1,1,'legacy-key',?,'legacy-turn')").run(message.id,message.id);
old.prepare("INSERT INTO work_runs(id,work_id,message_id,turn_id,status,created_at,updated_at) VALUES('legacy-run','legacy-work',?,'legacy-turn','completed',1,1)").run(message.id);
old.prepare("UPDATE sqlite_sequence SET seq=777 WHERE name='work'").run();
old.prepare("INSERT INTO automation_runs(id,automation_id,snapshot_json,trigger,started_at,outcome) VALUES('deleted','old','{}','cron',1,'completed')").run();old.prepare("DELETE FROM automation_runs").run();old.prepare("UPDATE sqlite_sequence SET seq=888 WHERE name='automation_runs'").run();
const before=old.prepare('SELECT * FROM work').all(),beforeRuns=old.prepare('SELECT * FROM work_runs').all();old.close();
const db=openDb(dir);assert.deepEqual(db.prepare('SELECT * FROM work').all(),before);assert.deepEqual(db.prepare('SELECT * FROM work_runs').all(),beforeRuns);assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='work'").get().seq,777);
const {modelToolResult}=await load('runtimes/hosted-execution');const projectionContext={state:{},saveState(p){Object.assign(this.state,p);}};
const bounded=modelToolResult(projectionContext,{ok:true,approvalId:'retained-receipt',executionOutcome:'completed',result:{untrusted:true,server:'fixture',content:'"\\'.repeat(40000)}});const encoded=JSON.stringify(bounded);assert.ok(encoded.length<=20000);assert.equal(JSON.parse(encoded).approvalId,'retained-receipt');assert.equal(bounded.executionOutcome,'completed');assert.equal(bounded.result.untrusted,true);assert.equal(bounded.result.truncated,true);assert.equal(projectionContext.state.hostedStop,'output_truncated');
const failedProjection=modelToolResult(projectionContext,{ok:false,status:'denied',approvalId:'retained-refusal',executionOutcome:'not-run',message:'e'.repeat(30000)});assert.equal(failedProjection.truncated,true);assert.equal(failedProjection.status,'denied');assert.equal(failedProjection.approvalId,'retained-refusal');assert.ok(JSON.stringify(failedProjection).length<=20000);
const unknownProjection=modelToolResult(projectionContext,{ok:false,status:'unknown',approvalId:'retained-uncertainty',executionOutcome:'unknown',invocationOutcome:'returned',message:'Effect unconfirmed',result:{untrusted:true,content:'"\\'.repeat(40000)}});assert.ok(JSON.stringify(unknownProjection).length<=20000);assert.equal(unknownProjection.executionOutcome,'unknown');assert.equal(unknownProjection.invocationOutcome,'returned');assert.equal(unknownProjection.result.untrusted,true);assert.equal(unknownProjection.approvalId,'retained-uncertainty');
const malformed=modelToolResult(projectionContext,{ok:true,result:{server:{large:'a'.repeat(50000)},content:'x'.repeat(50000)}});assert.ok(JSON.stringify(malformed).length<=20000);
assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='automation_runs'").get().seq,888);
console.log('ok v24 migration preserves records, links, sequence high water and foreign keys');
const ledger=createLedger(db),approvals=createApprovals(db,ledger),auth=createAuth({db,ownerToken:'controlled-owner'});
const {createPermissions}=await load('permissions'),permissions=createPermissions(db,ledger,dir,approvals);if(!permissions.active())permissions.adopt('workspace-write',permissions.adoption().reviewVersion,'controlled-owner');
let writes=0,readCalls=0,mode='final',apiRequests=0,localRequests=0,runner,app;const seen=[];
const usage={inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
const definitions=[{name:'read_file',permission:()=>({approval:'allow'}),offlineSafe:true,class:'read',description:'Controlled read',input:z.object({}).strict(),execute:async()=>{readCalls++;return ['huge','race'].includes(mode)?{untrusted:true,server:'fixture',content:'"\\'.repeat(30000)}:{value:'known'};}},{name:'fixture_action',class:'act-external',description:'Controlled action',input:z.object({target:z.string().optional()}).strict(),execute:async()=>{writes++;return {written:true};},confirm:()=>({outcome:mode==='unknown'?'unknown':'completed',detail:mode==='unknown'?'Controlled uncertain result.':'Controlled target read back.'})}];
const response=(calls=[],reason='stop')=>({content:calls.length?calls.map((name,i)=>({type:'tool-call',toolCallId:'call-'+apiRequests+'-'+i,toolName:name,input:mode==='action'&&name==='fixture_action'?'{"target":"recovery"}':'{}'})):[{type:'text',text:'Partial or final finding.'}],finishReason:{unified:reason,raw:reason},usage,warnings:[]});
const model=new MockLanguageModelV3({doGenerate:async opts=>{if(mode==='cancel'){await new Promise((resolve,reject)=>{cancelStarted=true;opts.abortSignal.addEventListener('abort',()=>reject(Error('Controlled cancellation')),{once:true});});}apiRequests++;seen.push(opts.prompt);const hasTools=opts.prompt.some(m=>m.role==='tool');if(mode==='limit'||mode==='toolcap'||(mode==='six'&&!hasTools))return response(Array(mode==='six'?6:mode==='toolcap'?45:1).fill('read_file'),'tool-calls');if(mode==='race'&&!hasTools)return response(['fixture_action','read_file'],'tool-calls');if(['action','denied','unknown'].includes(mode)&&!hasTools)return response(['fixture_action'],'tool-calls');if(mode==='huge'&&!hasTools)return response(['read_file'],'tool-calls');return response([],mode==='length'?'length':'stop');}});
const local=createOllamaRuntime({tools:definitions,env:{OPENAG_OLLAMA_URL:'http://127.0.0.1:1'},fetch:async(_url,opts)=>{localRequests++;const body=JSON.parse(opts.body),hasTools=body.messages.some(m=>m.role==='tool');const calls=mode==='limit'?Array(45).fill('read_file'):mode==='six'&&!hasTools?Array(6).fill('read_file'):mode==='huge'&&!hasTools?['read_file']:[];return Response.json({done:true,done_reason:mode==='length'?'length':'stop',message:{role:'assistant',content:'Partial or final finding.',...(calls.length?{tool_calls:calls.map(name=>({function:{name,arguments:{}}}))}:{})}});}});
let createdWork,cancelStarted=false;const contexts=[];const hosted=createApiRuntime({model,tools:definitions,ollama:local});
const runtime={async runTurn(ctx){contexts.push(ctx);if(mode==='cancel-report')return {outcome:'cancelled'};if(mode==='create'){createdWork=runner.work.create({roomId:ctx.room.id,botId:ctx.bot.id,messageId:ctx.message.id,turnId:ctx.turnId},{title:'Investigate',description:'Controlled explicit objective'},'controlled-work-'+ctx.message.id);}return hosted.runTurn(ctx);}};
const makeRunner=()=>createRunner({db,ledger,approvals,dataDir:dir,tools:toExecutors(definitions),runtimes:{api:runtime}});
const req=(path,method='GET',body,token='controlled-owner')=>app.request(path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const json=async path=>{const r=await req(path);assert.equal(r.status,200);return r.json();};
const run=async(bot,text='Controlled request',extra={})=>{const room=getRoom(db,bot),msg=ledger.append(bot,'user','message',{text});await runner.run(room,getBot(db,bot),msg,undefined,extra);return ledger.list(bot,{limit:1000}).filter(e=>e.type==='turn_finished').at(-1).payload;};
const until=async fn=>{const end=Date.now()+6000;for(;;){const value=fn();if(value)return value;if(Date.now()>end)throw Error('Controlled deadline');await new Promise(r=>setTimeout(r,10));}};
try{
 for(const id of ['api','local']){createBot(db,{id,runtime:'api',model:id==='local'?'ollama/controlled':'openai/gpt-4o-mini',config:{maxSteps:2}});createRoom(db,{id,leadBotId:id});addMember(db,id,id);}
 runner=makeRunner();app=createGateway({db,ledger,approvals,auth,dataDir:dir,work:runner.work,cancelWork:runner.cancelWork});
 const limited=await(await req('/devices','POST',{name:'limited'})).json();assert.equal((await req('/bots/api/settings','PUT',{maxSteps:3},limited.token)).status,403);
 for(const value of [0,101,1.5,'20',null])assert.equal((await req('/bots/api/settings','PUT',{maxSteps:value})).status,400);
 assert.equal((await req('/bots/api/settings','PUT',{maxSteps:1})).status,200);assert.equal((await json('/bots/api/settings')).maxSteps,1);
 mode='final';assert.equal((await run('api')).status,'finished');assert.equal((await run('local')).status,'finished');
 mode='length';for(const bot of ['api','local']){const result=await run(bot);assert.equal(result.status,'incomplete');assert.equal(result.reason,'output_truncated');}
 mode='final';await run('api','Continue from the partial finding.');assert.ok(JSON.stringify(seen.at(-1)).includes('Incomplete: output_truncated'));
 mode='limit';let count=apiRequests;let result=await run('api');assert.equal(result.status,'incomplete');assert.equal(result.reason,'step_limit');assert.equal(apiRequests-count,1);
 const reads=readCalls;result=await run('local');assert.equal(result.status,'incomplete');assert.equal(result.reason,'tool_limit');assert.equal(readCalls-reads,40);
 const capEvents=ledger.list('local',{limit:1000}).filter(e=>e.type==='tool_result'&&e.payload.turnId===result.turnId);assert.equal(capEvents.length,45);assert.equal(capEvents.filter(e=>e.payload.executionOutcome==='not-run').length,5);
 mode='toolcap';const beforeBatch=readCalls;result=await run('api');assert.equal(result.status,'incomplete');assert.equal(result.reason,'tool_limit');assert.equal(readCalls-beforeBatch,40);assert.equal(ledger.list('api',{limit:1000}).filter(e=>e.type==='tool_result'&&e.payload.turnId===result.turnId).length,45);
 assert.equal((await req('/bots/api/settings','PUT',{maxSteps:2})).status,200);
 mode='six';for(const bot of ['api','local']){const beforeRead=readCalls;result=await run(bot);assert.equal(result.status,'finished');assert.equal(readCalls-beforeRead,6,'all six calls execute and get a result');}
 mode='huge';for(const bot of ['api','local']){result=await run(bot);assert.equal(result.status,'incomplete');assert.equal(result.reason,'output_truncated');}
 console.log('ok API/Ollama normal final at cap, length stop, pending calls, tool cap, six-call batch and valid truncation');
 mode='final';count=apiRequests;result=await run('api','x'.repeat(65000));assert.equal(result.status,'incomplete');assert.equal(result.reason,'context_limit');assert.equal(apiRequests,count);
 assert.equal((await json('/work')).work.length,1,'ordinary chat made no Work (only migration fixture exists)');
 // Explicit Work remains incomplete and visible in attention.
 mode='create';await run('api');const work=createdWork;mode='limit';
 await runner.run(getRoom(db,'api'),getBot(db,'api'),ledger.get(work.requestId),undefined,{workId:work.id});
 const item=(await json('/work/'+work.id)).work;assert.equal(item.status,'incomplete');assert.equal((await req('/attention')).status,404);
 console.log('ok context overflow, no implicit Work, explicit Work and attention retain incomplete');
 mode='denied';let executing=run('api');let approval=await until(()=>approvals.listPending()[0]);approvals.resolve(approval.id,{kind:'ignore'},approval.reviewVersion);await executing;assert.equal(writes,0);assert.equal(contexts.at(-1).state.hostedExecutedTools??0,0);assert.ok(JSON.stringify(seen.at(-1).filter(m=>m.role==='tool')).includes('ignored'));
 mode='unknown';executing=run('api');approval=await until(()=>approvals.listPending()[0]);approvals.resolve(approval.id,{kind:'accept'},approval.reviewVersion);await executing;assert.equal(writes,1);const unknownEnvelope=JSON.stringify(seen.at(-1).filter(m=>m.role==='tool'));assert.ok(unknownEnvelope.includes('unknown'));assert.ok(unknownEnvelope.includes(approval.id));assert.ok(unknownEnvelope.includes('executionOutcome'));
 assert.equal(writes,1);assert.equal(approvals.receipts.get(approval.id).outcome,'unknown');
 createRoom(db,{id:'recovery',leadBotId:'api'});addMember(db,'recovery','api');
 mode='create';await run('api');const cancelledWork=createdWork;mode='cancel';executing=runner.run(getRoom(db,'api'),getBot(db,'api'),ledger.get(cancelledWork.requestId),undefined,{workId:cancelledWork.id});await until(()=>cancelStarted);runner.cancelWork(cancelledWork.id);await executing;assert.equal((await json('/work/'+cancelledWork.id)).work.status,'cancelled');
 mode='create';await run('api');const reportedCancel=createdWork;mode='cancel-report';await runner.run(getRoom(db,'api'),getBot(db,'api'),ledger.get(reportedCancel.requestId),undefined,{workId:reportedCancel.id});assert.equal((await json('/work/'+reportedCancel.id)).work.status,'cancelled');
 console.log('ok denied proposals execute nothing, unknown receipt evidence reaches model, cancellation stays distinct');
 mode='race';const beforeRace=writes;executing=run('api');approval=await until(()=>approvals.listPending()[0]);await until(()=>contexts.at(-1).state.hostedStop==='output_truncated');approvals.resolve(approval.id,{kind:'accept'},approval.reviewVersion);await executing;assert.equal(writes,beforeRace);assert.equal(approvals.receipts.get(approval.id).outcome,'not-run');
 console.log('ok forced stop is rechecked after concurrent approval wait');
 // With one request already spent, approval recovery cannot issue another request or leave an unmatched call.
 mode='create';await run('api');const exhausted=createdWork;assert.equal((await req('/bots/api/settings','PUT',{maxSteps:1})).status,200);mode='action';executing=runner.run(getRoom(db,'api'),getBot(db,'api'),ledger.get(exhausted.requestId),undefined,{workId:exhausted.id});approval=await until(()=>approvals.listPending()[0]);runner.shutdown();await executing;runner.work.close();runner=makeRunner();runner.recover();const beforeRecovery=apiRequests;approvals.resolve(approval.id,{kind:'accept'},approval.reviewVersion);await runner.idle();const exhaustedItem=(await json('/work/'+exhausted.id)).work;assert.equal(exhaustedItem.status,'incomplete');assert.equal(exhaustedItem.progress.pendingTools,0);assert.equal(approvals.receipts.get(approval.id).outcome,'not-run');assert.equal(apiRequests,beforeRecovery);assert.equal(writes,beforeRace);assert.equal((await req('/bots/api/settings','PUT',{maxSteps:2})).status,200);
 console.log('ok exhausted approval recovery settles original call without provider request or replay');
 // Approval restart: one started action, no automatic replay, and durable per-turn model count.
 mode='action';const msg=ledger.append('recovery','user','message',{text:'Controlled approval recovery'}),active=runner.run(getRoom(db,'recovery'),getBot(db,'api'),msg);
 const pending=await until(()=>approvals.listPending()[0]);runner.shutdown();await active;runner.work.close();runner=makeRunner();runner.recover();approvals.resolve(pending.id,{kind:'accept'},pending.reviewVersion);await runner.idle();assert.equal(writes,2);
 const last=ledger.list('recovery',{limit:1000}).filter(e=>e.type==='turn_finished').at(-1).payload;assert.equal(last.status,'incomplete');assert.equal(last.reason,'step_limit');assert.equal(approvals.get(pending.id).status,'accepted');
 console.log('ok approval recovery retains allowance and executes approved action once');
}finally{runner?.shutdown();await runner?.idle();runner?.work.close();db.close();rmSync(dir,{recursive:true,force:true});}
