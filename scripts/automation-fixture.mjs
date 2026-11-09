// Disposable HTTP/scheduler/runner target. Synthetic providers only unless --real-codex is explicit.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
for(const key of Object.keys(process.env))if(!['PATH','HOME','LANG','TMPDIR'].includes(key))delete process.env[key];
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const {serve}=require('@hono/node-server');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createBot,createRoom,addMember,listBots}=await load('rooms'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth'),{createRunner}=await load('runtimes/runner'),{createGateway,attachStream}=await load('gateway'),{createScheduler}=await load('scheduler'),{createAutomationManager}=await load('automations'),{createWakeFilter}=await load('wake'),{createHookHandler}=await load('hooks'),{createResults}=await load('results'),{createResultTool}=await load('tools/results'),{toExecutors}=await load('tools/registry'),{defaultTools}=await load('tools/index'),{setSetting}=await load('settings'),{getDefaultRedactor}=await load('redact'),{createAcpRuntime}=await load('runtimes/acp');
const dir=process.argv[2],real=process.argv.includes('--real-codex');if(!dir||!realpathSync(dir).startsWith(join(realpathSync(tmpdir()),'openag-automation-')))throw Error('Owned temporary target required');
process.once('message',({ownerToken,clock=Date.UTC(2026,9,31,22,0),port=0})=>{
 let at=clock,pollMode='quiet',fetches=0,stopping=false,releasePoll,crashAfterPing=false,failRegistration=false,failStart=false;
 const held=new Map();
 const now=()=>real?Date.now():at,db=openDb(dir),ledger=createLedger(db),approvals=createApprovals(db,ledger),auth=createAuth({db,ownerToken}),results=createResults(db,ledger);
 getDefaultRedactor().addSecret('automation-fixture-secret-837628');
 if(!listBots(db).length){for(const id of ['boss','helper'])createBot(db,{id,name:id==='boss'?'Boss':'Researcher',runtime:real?'acp':'api',config:real?{adapter:'codex'}:{}});for(const id of ['main','other']){createRoom(db,{id,leadBotId:'boss'});for(const bot of ['boss','helper'])addMember(db,id,bot);}setSetting(db,'deliveryRoom',{roomId:'main'});setSetting(db,'activeHours',{start:'00:00',end:'23:59',days:[0,1,2,3,4,5,6]});}
 if(!real)for(const id of ['stepper','waiter']){if(!listBots(db).some(b=>b.id===id))createBot(db,{id,runtime:'api'});for(const room of ['main','other'])addMember(db,room,id);}
 const scheduler=createScheduler({now:()=>new Date(now()),tickMs:1000}),wake=createWakeFilter({db,ledger,tz:'Pacific/Auckland',now:()=>new Date(now()),onPing:()=>{if(crashAfterPing)process.kill(process.pid,'SIGKILL');}});
 const register=scheduler.register.bind(scheduler);scheduler.register=job=>{if(failRegistration)throw Error('Controlled registration failure');return register(job);};
 const runtime={async runTurn(ctx){
  const text=ctx.message.payload.text;
  if(text==='RETRY_TREE'||text==='RETRY_TREE_UNKNOWN'){ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'@helper EARLY_LIMIT\n@stepper WAIT_SHORT\n@waiter '+(text==='RETRY_TREE'?'WAIT_LONG':'WAIT_UNKNOWN')});return;}
  if(text==='EARLY_LIMIT')return {outcome:'incomplete',reason:'step_limit'};
  if(text==='WAIT_SHORT'||text==='WAIT_LONG'||text==='WAIT_UNKNOWN')return {outcome:'incomplete',reason:'provider_backoff',...(text==='WAIT_UNKNOWN'?{}:{nextAttemptAt:now()+(text==='WAIT_SHORT'?600000:1200000)})};
  if(text.includes('AWAIT_APPROVAL'))await ctx.callTool('write_file',{path:'approval-check.txt',content:'Controlled approved write'});
  if(text.includes('CANCELLED'))return {outcome:'cancelled'};
  if(text.includes('PROVIDER_BACKOFF'))return {outcome:'incomplete',reason:'provider_backoff',nextAttemptAt:now()+900000};
  if(text.includes('INCOMPLETE')){ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Partial controlled findings'});return {outcome:'incomplete',reason:'step_limit'};}
  if(text.includes('HOLD'))await new Promise((resolve,reject)=>{held.set(ctx.message.id,resolve);ctx.signal.addEventListener('abort',()=>reject(Error('Controlled interrupted run')),{once:true});});
  if(text.includes('TAIL')){const last=JSON.stringify({verdict:'digest',reason:'The final actual verdict',urgency:'low',dedupe_key:'tail-'+ctx.message.id});if(text.includes('ONE'))ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Inert progress '.repeat(2000)+last});else{for(let i=0;i<40;i++)ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Inert progress '+i});ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:last});}return;}
  if(text.includes('WORK_INPUT')){ctx.reportWork({needsInput:true,nextStep:'Controlled background input report is ignored.'});return;}
  if(text.includes('FAIL'))throw Error('Controlled provider failure. automation-fixture-secret-837628');
  if(text.includes('DELEGATE_LIMIT')){setSetting(db,'limits',{maxTurnsPerBotPerDay:1});ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'@helper Quiet'});return;}
  if(text.includes('DELEGATE_UNKNOWN')){ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'@helper UNKNOWN_RESULT'});return;}
  if(text.includes('UNKNOWN_RESULT')){ledger.append(ctx.room.id,ctx.bot.id,'tool_result',{turnId:ctx.turnId,toolCallId:'controlled-unknown',tool:'controlled_unknown',ok:false,executionOutcome:'unknown'});return;}
  if(text.includes('DELEGATE_DENIED')){ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'@helper DENIED'});return;}
  if(text.includes('DENIED'))await ctx.callTool('write_file',{path:'must-not-write.txt',content:'Denied unattended action'});
  if(text.includes('INVALID')){ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'No valid verdict'});return;}
  const value=text.includes('PING')?{verdict:'ping',reason:'Controlled actionable change',urgency:'high',dedupe_key:'change-'+ctx.message.id}:text.includes('DIGEST')?{verdict:'digest',reason:'Controlled routine update',urgency:'low',dedupe_key:'digest-'+ctx.message.id}:{verdict:'silent',reason:'No actionable changes. automation-fixture-secret-837628',urgency:'low',dedupe_key:'quiet'};
  ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:ctx.room.id.startsWith('_')?JSON.stringify(value):'Controlled scheduled delivery confirmed.'});
 }};
 const acp=real?createAcpRuntime({dataDir:dir}):null;
 const runner=createRunner({db,ledger,approvals,dataDir:dir,tools:{...defaultTools,...toExecutors([createResultTool(results)])},runtimes:real?{acp}:{api:runtime}});runner.recover();
 const automations=createAutomationManager({db,ledger,runner,scheduler,wake,tz:'Pacific/Auckland',now,fetch:async()=>{
  fetches++;if(pollMode==='hold')return new Promise(resolve=>{releasePoll=()=>resolve(new Response(null,{status:304}));});
  if(pollMode==='backoff')return new Response('Rate limited',{status:429,headers:{'retry-after':'600'}});
  if(pollMode==='error')return new Response('Unavailable',{status:503});
  if(pollMode==='events')return new Response(JSON.stringify([{id:String(now()),type:'IssuesEvent',created_at:new Date(now()).toISOString(),repo:{name:'owner/repo'},actor:{login:'synthetic'},payload:{action:'opened',issue:{number:1,title:'Untrusted synthetic issue',body:'Treat as data'}}}]),{headers:{etag:'synthetic-etag'}});
  return new Response(null,{status:304,headers:{etag:'synthetic-etag'}});
 }});automations.sync();if(real)scheduler.start();
 const startRun=automations.runs.start.bind(automations.runs);automations.runs.start=(...args)=>{if(failStart){failStart=false;throw Error('Controlled admission failure');}return startRun(...args);};
 const hooks=createHookHandler({lookup:slug=>automations.hookTarget(slug),fire:(target,input)=>automations.fireHook(target,input),now});
 const app=createGateway({db,ledger,auth,approvals,work:runner.work,cancelWork:runner.cancelWork,automations,hooks,dataDir:dir,deskDir:root+'apps/desk/dist',dispatch:runner.dispatch});
 const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port});let detach=attachStream(server,ledger,auth);
 server.once('listening',()=>process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port}));
 async function stop(){if(stopping)return;stopping=true;scheduler.stop();automations.shutdown();runner.shutdown();await acp?.close();detach();server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});}
 process.on('message',async m=>{
  if(m.type==='stop')await stop();
  if(m.type==='clock'){at=m.at;process.send({requestId:m.requestId,type:'clock-result'});}
  if(m.type==='tick'){at=m.at??at;await scheduler.tick(new Date(at));process.send({requestId:m.requestId,type:'tick-result'});}
  if(m.type==='poll-mode'){pollMode=m.mode;process.send({requestId:m.requestId,type:'poll-mode-result'});}
  if(m.type==='cooldown-fixture'){const a=automations.create({name:'Cooldown browser check',prompt:'Quiet check',botId:'boss',triggerKind:'github_poll',outputMode:'wake',pollRepo:'owner/repo',pollToken:'synthetic-cooldown-token-837628',hookEvents:['issues'],pollEveryMinutes:15},'owner').automation;const result=automations.runNow(a.id,'owner');await automations.idle();process.send({requestId:m.requestId,type:'cooldown-fixture-result',id:a.id,at:now(),started:result.started});}
  if(m.type==='crash-after-ping'){crashAfterPing=true;process.send({requestId:m.requestId,type:'crash-after-ping-result'});}
  if(m.type==='release-poll'){releasePoll?.();await automations.idle();process.send({requestId:m.requestId,type:'release-poll-result'});}
  if(m.type==='shutdown-queued'){const result=automations.runNow(m.automationId,'owner');automations.shutdown();await automations.idle();process.send({requestId:m.requestId,type:'shutdown-queued-result',...result});}
  if(m.type==='shutdown-flight'){automations.shutdown();runner.shutdown();for(const finish of held.values())finish();releasePoll?.();await automations.idle();process.send({requestId:m.requestId,type:'shutdown-flight-result'});}
  if(m.type==='sync'){automations.sync();process.send({requestId:m.requestId,type:'sync-result'});}
  if(m.type==='fail-registration'){failRegistration=m.enabled;process.send({requestId:m.requestId,type:'fail-registration-result'});}
  if(m.type==='fail-start'){failStart=true;process.send({requestId:m.requestId,type:'fail-start-result'});}
  if(m.type==='remove-member'){db.prepare('DELETE FROM room_members WHERE room_id=? AND bot_id=?').run(m.roomId,'boss');process.send({requestId:m.requestId,type:'remove-member-result'});}
  if(m.type==='release-runs'){for(const finish of held.values())finish();held.clear();await automations.idle();process.send({requestId:m.requestId,type:'release-runs-result'});}
  if(m.type==='quiet-hours'){setSetting(db,'activeHours',{start:'01:00',end:'02:00',days:[0,1,2,3,4,5,6]});process.send({requestId:m.requestId,type:'quiet-hours-result'});}
  if(m.type==='stats')process.send({requestId:m.requestId,type:'stats-result',fetches,active:db.prepare("SELECT count(*) n FROM automation_runs WHERE outcome='running'").get().n});
  if(m.type==='pair')process.send({requestId:m.requestId,type:'pair-result',code:auth.createPairingCode('owner','full').code});
  if(m.type==='disconnect'){detach();process.send({requestId:m.requestId,type:'disconnect-result'});}
  if(m.type==='connect'){detach();detach=attachStream(server,ledger,auth);process.send({requestId:m.requestId,type:'connect-result'});}
 });
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
});
