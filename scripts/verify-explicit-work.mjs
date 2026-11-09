// Standalone gateway/runner acceptance; synthetic data and controlled runtimes only.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(root+'apps/daemon/package.json');
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals');
const {createRunner}=await load('runtimes/runner'),{createGateway}=await load('gateway'),{createAuth}=await load('auth');
const {createBot,createRoom,addMember,getRoom,getBot}=await load('rooms');
const {createFirstPartyTools}=await load('tools/firstparty'),{createResults}=await load('results');
const {toExecutors}=await load('tools/registry'),{requestInputTool}=await load('tools/input');
const {getDefaultRedactor}=await load('redact');
const {MCP_TOOL_NAMES}=await load('mcpserver');
const dir=mkdtempSync(join(tmpdir(),'openag-explicit-work-'));let db,runner;
const pendingRuns=new Set(),behaviors=new Map(),runtimeFailures=[];
const until=async(read,accept,label)=>{const end=Date.now()+5000;let value;do{value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<end);throw Error(label+': '+JSON.stringify(value));};
const track=p=>{pendingRuns.add(p);void p.finally(()=>pendingRuns.delete(p));return p;};
try{
 db=openDb(dir);const ledger=createLedger(db),approvals=createApprovals(db,ledger);
 for(const id of ['boss','helper'])createBot(db,{id,runtime:'api'});
 for(const id of ['main','other','_hidden']){createRoom(db,{id,leadBotId:'boss'});addMember(db,id,'boss');if(id==='main')addMember(db,id,'helper');}
 const computer={capabilities:{shell:false,hosted:false,view:'none'},peek:()=>({backend:'cua',configured:false,state:'not_observed',observedAt:null,busy:false,inputBlocked:false})};
 const first=createFirstPartyTools({db,computer,pusher:{status:()=>({enabled:false,configured:false})},results:createResults(db,ledger)});
 assert.ok(first.defs.some(t=>t.name==='create_work'));assert.ok(MCP_TOOL_NAMES.includes('create_work'));
 let writes=0;
 const write=async()=>{writes++;return {written:true};};write.confirm=()=>({outcome:'completed',detail:'Controlled write completed.'});
 const tools={...first.executors,...toExecutors([requestInputTool]),fixture_write:write};
 const output=(ctx,text)=>ctx.ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text});
 const runtime={async runTurn(ctx){try{const fn=behaviors.get(ctx.message.id);if(fn)await fn(ctx);else output(ctx,'Controlled continuation finished.');}catch(error){runtimeFailures.push(error);throw error;}}};
 const makeRunner=()=>createRunner({db,ledger,approvals,dataDir:dir,runtimes:{api:runtime},tools});
 runner=makeRunner();
 const auth=createAuth({db,ownerToken:'controlled-owner'}),limited=auth.createDevice('limited').token;
 const gateway=()=>createGateway({db,ledger,approvals,auth,dataDir:dir,work:runner.work,cancelWork:(...args)=>runner.cancelWork(...args),dispatch:args=>track(runner.dispatch(args))});
 let app=gateway();
 const request=(path,method='GET',body,token='controlled-owner')=>app.request(path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const count=()=>db.prepare('SELECT count(*) n FROM work').get().n;
 const post=(text,fn,roomId='main',meta)=>{const message=ledger.append(roomId,'user','message',{text});if(fn)behaviors.set(message.id,fn);return {message,done:track(runner.run(getRoom(db,roomId),getBot(db,'boss'),message,undefined,meta))};};
 const proposal={title:'Investigate a synthetic issue',description:'Check the synthetic records and return evidence.'};
 const decide=(a,decision)=>approvals.resolve(a.id,decision,a.reviewVersion);
 // Plain conversation, plans and approved chat tools retain turns/receipts without Work.
 await post('plain chat',async ctx=>{assert.equal(ctx.workId,undefined);ctx.reportWork({plan:[{title:'A proposed idea',state:'pending'}]});output(ctx,'Only a conversation.');}).done;
 assert.equal(count(),0);
 const chat=post('approved chat write',async ctx=>assert.equal((await ctx.callTool('fixture_write',{})).ok,true));
 const action=await until(()=>approvals.listPending(),v=>v.length===1,'chat approval');assert.equal(count(),0);decide(action[0],{kind:'accept'});await chat.done;
 assert.equal(writes,1);assert.equal(approvals.receipts.get(action[0].id).workId,null);assert.equal(count(),0);
 const delegation=post('delegate in chat',async ctx=>output(ctx,'@helper Read this synthetic note.'));
 await delegation.done;assert.equal(count(),0);assert.ok(db.prepare("SELECT 1 FROM turns WHERE bot_id='helper'").get());
 console.log('ok ordinary chat, plans, delegation and gated tools without Work');
 // Input questions and saved results work through their existing public routes.
 await post('question',async ctx=>{assert.equal((await ctx.callTool('request_input',{prompt:'Which synthetic account?'})).ok,true);}).done;
 const pendingQuestions=await(await request('/rooms/main/requests')).json();assert.equal(pendingQuestions.requests.length,1);
 const question=await (await request('/questions/'+pendingQuestions.requests[0].id)).json();assert.equal(question.question.workId,null);
 const answer=await request('/questions/'+question.question.id+'/answer','POST',{revision:question.question.revision,answer:'Synthetic A'});assert.equal(answer.status,202);await Promise.all([...pendingRuns]);assert.equal(count(),0);
 const save=post('save a chat result',async ctx=>assert.equal((await ctx.callTool('save_result',{name:'evidence.md',kind:'note',content:'Synthetic evidence.'})).ok,true));
 await save.done;assert.equal(approvals.listPending().length,0,'Known daemon result bookkeeping does not fabricate a review');
 const results=await (await request('/results?roomId=main')).json();assert.equal(results.results.length,1);assert.equal(results.results[0].workId,null);assert.equal(count(),0);
 console.log('ok chat questions, continuation and gated saved results');
 // Explicit Work creation requires its own review under Ask; invalid edits remain pending.
 let created;
 const create=post('propose Work',async ctx=>{
  const value=await ctx.callTool('create_work',proposal);assert.equal(value.ok,true);created=value.result.workId;
  const repeat=await ctx.callTool('create_work',proposal);assert.equal(repeat.ok,true);assert.equal(repeat.result.workId,created);assert.equal(repeat.result.title,'Reviewed synthetic issue');assert.equal(repeat.result.alreadyCreated,true);
 });
 const approval=await until(()=>approvals.listPending(),v=>v.length===1,'creation approval');assert.equal(count(),0);
 assert.throws(()=>decide(approval[0],{kind:'edit',payload:{...proposal,assignee:'outsider'}}));assert.equal(approvals.get(approval[0].id).status,'pending');
 decide(approval[0],{kind:'edit',payload:{...proposal,title:'Reviewed synthetic issue'}});
 const retryApproval=await until(()=>approvals.listPending(),v=>v.length===1&&v[0].id!==approval[0].id,'edited proposal retry');decide(retryApproval[0],{kind:'accept'});await create.done;
 assert.equal(count(),1);let item=runner.work.get(created);assert.equal(item.title,'Reviewed synthetic issue');assert.equal(item.originMessageId,create.message.id);assert.equal(item.progress.turns,0);assert.equal(item.nextStep,'Ready to start.');
 runner.shutdown();runner.work.close();runner=makeRunner();runner.recover();app=gateway();item=runner.work.get(created);assert.equal(item.readyToStart,true);assert.equal(item.nextStep,'Ready to start.');
 await runner.withIdleBot('boss',async()=>{});assert.equal(runner.work.get(created).readyToStart,true,'ready Work does not block choosing a model');
 behaviors.set(item.requestId,async ctx=>{assert.equal(ctx.workId,item.id);assert.equal((await ctx.callTool('save_result',{name:'work-evidence.md',kind:'note',content:'Reviewed Work evidence.'})).ok,true);output(ctx,'Explicit Work finished.');});
 const turnsBefore=db.prepare('SELECT count(*) n FROM turns').get().n;
 assert.equal((await request('/work/'+created+'/start','POST',{revision:item.revision},limited)).status,403);
 assert.equal((await request('/work/'+created+'/start','POST',{revision:item.revision})).status,202);await Promise.all([...pendingRuns]);
 assert.equal(runner.work.get(created).status,'completed');
 await request('/work/'+created+'/start','POST',{revision:item.revision});await Promise.all([...pendingRuns]);
 assert.equal(db.prepare('SELECT count(*) n FROM turns').get().n,turnsBefore+1);
 console.log('ok reviewed creation, source provenance and separate idempotent owner start');
 // Repeated proposal and lost response retain the same creation identity.
 let duplicateId;
 behaviors.set(create.message.id,async ctx=>{const value=await ctx.callTool('create_work',proposal);assert.equal(value.ok,true);duplicateId=value.result.workId;});
 await runner.run(getRoom(db,'main'),getBot(db,'boss'),create.message);assert.equal(duplicateId,undefined);assert.equal(count(),1);
 for(const decision of [{kind:'ignore'},{kind:'respond',text:'Keep this as chat.'}]){
  const p=post('declined proposal',async ctx=>assert.equal((await ctx.callTool('create_work',proposal)).ok,false));
  const a=await until(()=>approvals.listPending(),v=>v.length===1,'declined approval');decide(a[0],decision);await p.done;assert.equal(count(),1);
 }
 const expiring=post('expired proposal',async ctx=>assert.equal((await ctx.callTool('create_work',proposal,{maxWaitMs:30})).ok,false));await expiring.done;assert.equal(count(),1);
 const unattended=post('background proposal',async ctx=>assert.equal((await ctx.callTool('create_work',proposal)).status,'denied'),'main',{unattended:true});await unattended.done;assert.equal(approvals.listPending().length,0);assert.equal(count(),1);
 const invalid=post('bad assignee',async ctx=>assert.equal((await ctx.callTool('create_work',{...proposal,assignee:'outsider'})).ok,false));await invalid.done;assert.equal(approvals.listPending().length,0);
 console.log('ok duplicate delivery, non-accept decisions, expiry and background restrictions');
 // Approval survives a stopped runner; its reviewed execution creates one Work after recovery.
 let resumedId;
 const interrupted=post('restart proposal',async ctx=>{const value=await ctx.callTool('create_work',proposal);if(value.ok)resumedId=value.result.workId;});
 const pending=await until(()=>approvals.listPending(),v=>v.length===1,'restart pending');runner.shutdown();await interrupted.done;
 runner.work.close();runner=makeRunner();runner.recover();app=gateway();
 decide(pending[0],{kind:'accept'});await runner.idle();
 assert.ok(resumedId);assert.equal(count(),2);assert.throws(()=>decide(pending[0],{kind:'accept'}));assert.equal(count(),2);
 assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);
 console.log('ok restart approval recovery and preserved SQLite integrity');
 // Ordinary interrupted chat becomes an input/recovery request, never an automatic replay.
 const interruptedChat=post('ordinary interrupted chat',async ctx=>{await new Promise(resolve=>{if(ctx.signal.aborted)resolve();else ctx.signal.addEventListener('abort',resolve,{once:true});});});
 await until(()=>runner.activeTurn('boss','main'),Boolean,'ordinary active turn');
 runner.shutdown();await interruptedChat.done;runner.work.close();runner=makeRunner();runner.recover();app=gateway();
 assert.equal((await(await request('/rooms/main/requests')).json()).requests.length,0,'An interrupted chat does not manufacture a question');
 assert.equal(count(),2);
 // Shutdown while a chat admission waits for configuration: preserve its restrictions and dispatch once.
 runner.cancelWork(resumedId,runner.work.get(resumedId).revision);
 let releaseConfig;const configuring=runner.withIdleBot('boss',()=>new Promise(resolve=>{releaseConfig=resolve;}));
 let queuedCalls=0;
 const queued=post('queued before a turn exists',async ctx=>{queuedCalls++;assert.equal(ctx.state.unattended,true);assert.equal(ctx.state.noIndex,true);output(ctx,'Recovered queued read.');},'main',{unattended:true,noIndex:true});
 assert.equal(db.prepare('SELECT turn_id FROM chat_dispatches WHERE message_id=?').get(queued.message.id).turn_id,null);
 runner.shutdown();releaseConfig();await configuring;await queued.done;runner.work.close();runner=makeRunner();runner.recover();app=gateway();await runner.idle();
 assert.equal(queuedCalls,1);assert.equal(count(),2);
 const atomicMessage=ledger.append('main','user','message',{text:'Controlled admission bind failure'}),beforeAtomic=db.prepare('SELECT count(*) n FROM turns').get().n;
 db.exec("CREATE TEMP TRIGGER fail_chat_binding BEFORE UPDATE OF turn_id ON chat_dispatches BEGIN SELECT RAISE(ABORT,'Injected admission bind failure'); END");
 await assert.rejects(runner.run(getRoom(db,'main'),getBot(db,'boss'),atomicMessage),/Injected admission bind failure/);
 db.exec('DROP TRIGGER fail_chat_binding');
 assert.equal(db.prepare('SELECT count(*) n FROM turns').get().n,beforeAtomic,'turn insertion rolls back with its admission binding');
 console.log('ok ready Work, interrupted chat and pre-turn admission recovery');
 // Two independently approved duplicate calls in one turn settle to the same reviewed Work.
 const beforeDuplicate=count();let duplicateResults;
 const duplicate=post('concurrent repeated proposal',async ctx=>{duplicateResults=await Promise.all([ctx.callTool('create_work',proposal),ctx.callTool('create_work',proposal)]);});
 const repeated=await until(()=>approvals.listPending(),v=>v.length===2,'duplicate proposals');
 decide(repeated[0],{kind:'accept'});
 await until(()=>approvals.receipts.get(repeated[0].id),v=>v.outcome==='completed','first duplicate committed');
 decide(repeated[1],{kind:'accept'});await duplicate.done;
 assert.ok(duplicateResults.every(r=>r.ok));assert.equal(duplicateResults[0].result.workId,duplicateResults[1].result.workId);assert.equal(count(),beforeDuplicate+1);
 // A response lost after local commit is Unknown, never a second create or a grant for another action.
 let lostResult,blockedAfterLost;const beforeLost=count(),confirmCreation=tools.create_work.confirm;
 tools.create_work.confirm=()=>{tools.create_work.confirm=confirmCreation;throw Error('Controlled response lost after SQLite commit.');};
 const lost=post('lost creation response',async ctx=>{lostResult=await ctx.callTool('create_work',proposal);blockedAfterLost=await ctx.callTool('fixture_write',{});});
 const lostApproval=await until(()=>approvals.listPending(),v=>v.length===1,'lost response proposal');decide(lostApproval[0],{kind:'accept'});await lost.done;
 assert.equal(lostResult.status,'unknown');assert.equal(blockedAfterLost.status,'denied','Current scoped-receipt rules still guard opaque effects');assert.equal(count(),beforeLost+1);assert.equal(approvals.receipts.get(lostApproval[0].id).outcome,'unknown');assert.equal(writes,1);
 await runner.run(getRoom(db,'main'),getBot(db,'boss'),lost.message);assert.equal(count(),beforeLost+1);
 console.log('ok concurrent approved duplicates and a lost post-commit response');

 // A durable delegated handoff without a completed return must never recover as Completed.
 const handoffMessage=ledger.append('main','user','message',{text:'Controlled delegated handoff'}),handoff=runner.work.begin({roomId:'main',botId:'boss',messageId:handoffMessage.id});
 const handoffTurn='controlled-handoff-turn';
 db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES(?,'main','boss','finished',?,1,1)").run(handoffTurn,JSON.stringify({messageId:handoffMessage.id,workId:handoff.workId}));
 runner.work.updateRun(handoff.runId,'draining',undefined,handoffTurn);
 ledger.atomic(()=>{
  const delegated=ledger.append('main','boss','message',{text:'Unstarted controlled handoff',delegationId:'controlled-delegation'});
  ledger.append('main','boss','route',{targets:['helper'],delegatedBy:'boss',messageId:delegated.id,delegationId:'controlled-delegation',turnId:handoffTurn});
  runner.work.begin({roomId:'main',botId:'helper',messageId:delegated.id,workId:handoff.workId});
 });
 runner.work.recover();assert.equal(runner.work.get(handoff.workId).status,'interrupted');assert.equal(runner.work.list({parentId:handoff.workId,limit:10}).work.length,0);
 console.log('ok incomplete shared-Work delegation stays interrupted');
 const finishedDelegate=db.prepare("SELECT id FROM turns WHERE bot_id='helper' AND status='finished' AND json_extract(state_json,'$.delegatedBy')='boss' LIMIT 1").get();assert.ok(finishedDelegate);
 db.prepare('UPDATE chat_dispatches SET settled_at=NULL WHERE turn_id=?').run(finishedDelegate.id);
 const deliveredRoot=db.prepare('SELECT turn_id FROM chat_dispatches WHERE message_id=? AND bot_id=?').get(delegation.message.id,'boss').turn_id;
 db.prepare('UPDATE chat_dispatches SET settled_at=NULL WHERE turn_id=?').run(deliveredRoot);
 const lostHandbackMessage=ledger.append('main','boss','message',{text:'Controlled unfinished result handback'}),lostHandbackTurn='controlled-finished-handback';
 db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES(?,'main','helper','finished',?,1,1)").run(lostHandbackTurn,JSON.stringify({messageId:lostHandbackMessage.id,delegatedBy:'boss',delegationId:'lost-handback'}));
 db.prepare("INSERT INTO chat_dispatches(room_id,bot_id,message_id,turn_id) VALUES('main','helper',?,?)").run(lostHandbackMessage.id,lostHandbackTurn);
 const protectedMessage=ledger.append('main','boss','message',{text:'Protected handback'}),protectedChild=ledger.append('main','helper','message',{text:'Child awaiting review'});
 for(const [id,bot,message,status,extra]of [['protected-parent','helper',protectedMessage,'interrupted',{delegatedBy:'boss',delegationId:'protected-handoff'}],['protected-child','boss',protectedChild,'interrupted',{}]]){
  db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES(?,'main',?,?,?,1,1)").run(id,bot,status,JSON.stringify({messageId:message.id,...extra}));
  db.prepare("INSERT INTO chat_dispatches(room_id,bot_id,message_id,turn_id) VALUES('main',?,?,?)").run(bot,message.id,id);
 }
 ledger.append('main','helper','route',{targets:['boss'],messageId:protectedChild.id,turnId:'protected-parent',delegatedBy:'helper',delegationId:'protected-child-call'});
 approvals.request({roomId:'main',botId:'boss',turnId:'protected-child',toolName:'fixture_write',toolClass:'act-external',payload:{}});

 const rootGapMessage=ledger.append('main','user','message',{text:'Finished root before handoff dispatch'});
 db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES('root-handoff-gap','main','boss','finished',?,1,1)").run(JSON.stringify({messageId:rootGapMessage.id}));
 db.prepare("INSERT INTO chat_dispatches(room_id,bot_id,message_id,turn_id) VALUES('main','boss',?,'root-handoff-gap')").run(rootGapMessage.id);
 const turnsBeforeHandoffRecovery=db.prepare('SELECT count(*) n FROM turns').get().n,workBeforeHandoffRecovery=count();
 runner.shutdown();runner.work.close();runner=makeRunner();runner.recover();app=gateway();await runner.idle();
 const handbackQuestion=db.prepare("SELECT * FROM work_questions WHERE source_turn_id=? AND status='open'").get(lostHandbackTurn);
 assert.equal(db.prepare('SELECT count(*) n FROM work_questions WHERE source_turn_id=?').get(finishedDelegate.id).n,0,'delivered handback does not ask again');
 assert.equal(db.prepare('SELECT count(*) n FROM work_questions WHERE source_turn_id=?').get(deliveredRoot).n,0,'root with delivered child results does not ask again');
 assert.equal(db.prepare("SELECT count(*) n FROM work_questions WHERE source_turn_id IN ('protected-parent','protected-child')").get().n,0,'pending child approval keeps the existing recovery path');
 assert.equal(db.prepare("SELECT 1 FROM work_questions WHERE source_turn_id='root-handoff-gap' AND status='open'").get(),undefined,'No synthetic recovery question');
 assert.equal(handbackQuestion,undefined);assert.equal(db.prepare('SELECT count(*) n FROM turns').get().n,turnsBeforeHandoffRecovery);assert.equal(count(),workBeforeHandoffRecovery);
 console.log('ok finished chat handoff retains history without synthetic questions or replay');



 // A pre-existing v23 database retains its Work/questions/results through the additive migration.
 const Database=require('better-sqlite3'),{migrate}=await load('db/migrate');
 const oldDir=join(dir,'old-migrations');mkdirSync(oldDir);
 for(const name of require('node:fs').readdirSync(root+'apps/daemon/dist/db/migrations').filter(n=>Number.parseInt(n,10)<24))copyFileSync(root+'apps/daemon/dist/db/migrations/'+name,join(oldDir,name));
 const old=new Database(':memory:');old.pragma('foreign_keys=ON');migrate(old,oldDir);
 const schemaBefore=old.prepare('SELECT count(*) n FROM schema_version').get().n;assert.equal(schemaBefore,23);
 const tables=['bots','rooms','room_members','events','turns','work','work_runs','approvals','saved_results','action_receipts','work_questions'];
 const snapshots=new Map();
 for(const table of tables){
  const columns=old.pragma('table_info('+table+')').map(v=>v.name);
  for(const row of db.prepare('SELECT * FROM '+table).all()){
   if(['saved_results','work_questions'].includes(table)&&row.work_id===null)continue;
   if(table==='action_receipts'&&row.approval_id===null)continue; // The historical schema represents only genuine human-reviewed receipts.
   old.prepare('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(c=>row[c]));
  }
  if(table==='work_questions'&&!old.prepare('SELECT 1 FROM work_questions LIMIT 1').get())old.prepare("INSERT INTO work_questions(id,work_id,room_id,bot_id,context,source,status,created_at) VALUES('legacy-question',?,'main','boss','Legacy reported need','work-report','open',?)").run(created,Date.now());
  snapshots.set(table,{columns,rows:old.prepare('SELECT '+columns.join(',')+' FROM '+table+' ORDER BY rowid').all()});
 }
 assert.ok(snapshots.get('work').rows.length>0);assert.ok(snapshots.get('saved_results').rows.length>0);assert.ok(snapshots.get('approvals').rows.length>0);assert.ok(snapshots.get('work_questions').rows.length>0);
 migrate(old,root+'apps/daemon/dist/db/migrations');const expectedVersions=require('node:fs').readdirSync(root+'apps/daemon/dist/db/migrations').filter(name=>/^\d+_.+\.sql$/.test(name)).map(name=>Number.parseInt(name,10)).sort((a,b)=>a-b);assert.deepEqual(old.prepare('SELECT version FROM schema_version ORDER BY version').all().map(row=>row.version),expectedVersions);
 for(const [table,{columns,rows}] of snapshots)assert.deepEqual(old.prepare('SELECT '+columns.join(',')+' FROM '+table+' ORDER BY rowid').all(),rows,table+' history preserved');
 assert.deepEqual(old.pragma('foreign_key_check'),[]);old.close();
 assert.deepEqual(runtimeFailures,[],runtimeFailures.map(e=>e.stack).join('\n'));
 console.log('ok v23 to current schema migration preserves representable historical records');
}finally{
 if(runner){runner.shutdown();await Promise.allSettled([...pendingRuns]);await runner.idle();runner.work.close();}
 db?.close();rmSync(dir,{recursive:true,force:true});
}
