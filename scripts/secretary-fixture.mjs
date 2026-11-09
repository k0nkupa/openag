// Owned temporary daemon, synthetic source and controlled API/Ollama transports only.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
for(const key of Object.keys(process.env))if(!['PATH','HOME','LANG','TMPDIR'].includes(key))delete process.env[key];
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const {serve}=require('@hono/node-server'),{MockLanguageModelV3}=await import(require.resolve('ai/test'));
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createBot,createRoom,addMember,getBot}=await load('rooms'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth'),{createRunner}=await load('runtimes/runner'),{createApiRuntime}=await load('runtimes/api'),{createOllamaRuntime}=await load('runtimes/ollama'),{createResponsibilities,SourceReadFailure}=await load('responsibilities'),{createGateway,attachStream}=await load('gateway'),{createAutomationManager}=await load('automations'),{createScheduler}=await load('scheduler'),{createWakeFilter}=await load('wake'),{toExecutors}=await load('tools/registry'),{defaultTools,defaultToolDefs}=await load('tools/index'),{createResults}=await load('results'),{createResultTool}=await load('tools/results'),{setSetting}=await load('settings');
const dir=process.argv[2];if(!dir||!realpathSync(dir).startsWith(join(realpathSync(tmpdir()),'openag-secretary-')))throw Error('Owned temporary target required');
process.once('message',options=>{
 let clock=options.clock,mode='normal',sourceMode='normal',sourceReady=options.sourceReady??true,crashPhase=null,stopping=false;
 const prompts=[],sourceHolds=[],modelHolds=[];let recallCalls=0,acpCalls=0,directDenied=0;
 const counter=kind=>{const p=join(dir,kind+'.count'),n=existsSync(p)?Number(readFileSync(p,'utf8')):0;writeFileSync(p,String(n+1),{mode:0o600});return n+1;};
 const count=kind=>existsSync(join(dir,kind+'.count'))?Number(readFileSync(join(dir,kind+'.count'),'utf8')):0;
 const db=openDb(dir),ledger=createLedger(db),approvals=createApprovals(db,ledger),auth=createAuth({db,ownerToken:options.ownerToken});
 if(!getBot(db,'boss')){
  for(const [id,runtime,model]of [['boss','api','openai/fixture'],['local','api','ollama/fixture'],['cli','acp',null]]){createBot(db,{id,name:id,runtime,model,config:{instructions:'PRIVATE_OTHER_CONTEXT_CANARY'}});mkdirSync(join(dir,'bots',id),{recursive:true});writeFileSync(join(dir,'bots',id,'MEMORY.md'),'PRIVATE_OTHER_CONTEXT_CANARY');}
  createRoom(db,{id:'main',leadBotId:'boss'});for(const id of ['boss','local','cli'])addMember(db,'main',id);
  setSetting(db,'wake',{dailyPingBudget:50});setSetting(db,'deliveryRoom',{roomId:'main'});setSetting(db,'activeHours',{start:'00:00',end:'23:59',days:[0,1,2,3,4,5,6]});
 }
 const wake=createWakeFilter({db,ledger,tz:'UTC',now:()=>new Date(clock),onPing:()=>{counter('notifications');if(crashPhase==='notification')process.kill(process.pid,'SIGKILL');}});
 const usage={inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
 const evidenceIds=value=>{const found=[];function walk(v){if(typeof v==='string'){try{walk(JSON.parse(v));}catch{}return;}if(!v||typeof v!=='object')return;if(v.untrusted===true&&typeof v.id==='string'&&v.bindingId==='synthetic-allocation')found.push(v.id);for(const item of Object.values(v))walk(item);}walk(value);return [...new Set(found)];};
 async function response(messages,kind,tools){
  counter('model');prompts.push({kind,messages,tools});
  const ids=evidenceIds(messages),done=messages.some(m=>m.role==='tool');
  if(!done||mode==='steps'){
   const reference=mode==='foreign'?'OTHER-ACCOUNT':mode==='bad_reference'?'https://other.invalid/secret':'SAMPLE-001';
   if(mode==='selective')return {calls:[{name:'investigation_read',args:{reference:'SAMPLE-001'}},{name:'investigation_read',args:{reference:'SAMPLE-002'}}]};
   return {calls:Array.from({length:mode==='tools'?25:1},()=>({name:mode==='unknown_tool'?'send_message':'investigation_read',args:{reference}}))};
  }
  if(mode==='hold_model')await new Promise(resolve=>modelHolds.push(resolve));
  if(mode==='invalid_report')return {text:'not a structured report'};
  if(mode==='oversized')return {text:'x'.repeat(32769)};
  return {text:JSON.stringify({answer:'The current source record is pending. No allocation was performed.',evidenceIds:mode==='invented'?[randomUUID()]:mode==='selective'?ids.slice(0,1):ids.length?ids:[randomUUID()],uncertainty:'The owner must decide the next business action.',reply:'Thanks. The record is pending. I will confirm the next step after review.',attention:'ping',urgency:'high',...(mode==='question'?{question:'Which credit reference should be checked?'}:{})})};
 }
 const model=new MockLanguageModelV3({doGenerate:async args=>{const r=await response(args.prompt,'api',args.tools);return {content:r.calls?r.calls.map(call=>({type:'tool-call',toolCallId:randomUUID(),toolName:call.name,input:JSON.stringify(call.args)})):[{type:'text',text:r.text}],finishReason:{unified:r.calls?'tool-calls':mode==='partial_report'?'length':'stop',raw:r.calls?'tool_calls':mode==='partial_report'?'length':'stop'},usage,warnings:[]};}});
 let responsibilities;
 const savedResultTool=createResultTool(createResults(db,ledger));
 const defs=()=>responsibilities?[responsibilities.tool,savedResultTool]:[savedResultTool];
 const ollama=createOllamaRuntime({toolDefs:defs,fetch:async(url,init)=>{if(!String(url).endsWith('/api/chat'))throw Error('Unexpected controlled endpoint');const body=JSON.parse(init.body),r=await response(body.messages,'ollama',body.tools);return Response.json({model:'fixture',message:{role:'assistant',content:r.text??'',...(r.calls?{tool_calls:r.calls.map(c=>({function:{name:c.name,arguments:c.args}}))}:{})},done:true,done_reason:'stop'});}});
 const api=createApiRuntime({model,toolDefs:defs,ollama});
 const runner=createRunner({db,ledger,approvals,dataDir:dir,tools:defaultTools,dynamicTools:()=>toExecutors(defs()),vectors:{indexMemoryFile(){},indexTurn(){},async embedPending(){return 0;},async search(){recallCalls++;return [{source:'private',text:'PRIVATE_OTHER_CONTEXT_CANARY'}];}},runtimes:{api:{async runTurn(ctx){if(mode==='legacy_result'){await ctx.callTool('save_result',{name:'legacy.md',kind:'note',content:'Owner-created conversation artifact.'});ctx.ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Conversation artifact saved.'});return;}if(mode==='direct_escape'){const result=await ctx.callTool('write_file',{path:'must-not-write.txt',content:'blocked'});if(!result.ok&&result.status==='denied')directDenied++;}return api.runTurn(ctx);}},acp:{async runTurn(){acpCalls++;throw Error('ACP must not start');}}}});
 responsibilities=createResponsibilities({db,ledger,runner,wake,now:()=>clock,deadlineMs:options.deadlineMs,source:options.withSource===false?undefined:{bindingId:'synthetic-allocation',resourceIds:['BRV'],ready:()=>sourceReady,async read(input){
  counter('read-attempts');
  if(input.bindingId!=='synthetic-allocation'||input.resourceId!=='BRV'||!['SAMPLE-001','SAMPLE-002'].includes(input.reference))throw new SourceReadFailure('missing_access');
  if(sourceMode==='missing_access')throw new SourceReadFailure('missing_access');if(sourceMode==='missing_record')throw new SourceReadFailure('missing_record');
  counter('reads');
  if(sourceMode==='hold')await new Promise(resolve=>sourceHolds.push(resolve));
  return {conflicted:input.reference==='SAMPLE-002',observedAt:sourceMode==='stale'?clock-90000000:clock,content:sourceMode==='oversized'?'x'.repeat(2049):input.reference==='SAMPLE-002'?'Synthetic credit record SAMPLE-002 conflicts with the allocation record.':'Synthetic BRV record SAMPLE-001: pending; no allocation was made.'};
 }}});
 runner.recover();responsibilities.recover();
 ledger.subscribe('*',event=>{if(crashPhase==='read'&&event.type==='tool_result')process.kill(process.pid,'SIGKILL');if(crashPhase==='wake'&&event.type==='wake')process.kill(process.pid,'SIGKILL');if(crashPhase==='settlement'&&event.type==='config'&&event.payload.action==='responsibility_changed'&&db.prepare("SELECT 1 FROM investigations WHERE delivery_state='pending' LIMIT 1").get())process.kill(process.pid,'SIGKILL');});
 const automations=createAutomationManager({db,ledger,runner,wake,scheduler:createScheduler({now:()=>new Date(clock)}),tz:'UTC',now:()=>clock,fetch:async()=>{throw Error('No external source in fixture');}});
 const app=createGateway({automations,db,ledger,approvals,auth,work:runner.work,cancelWork:runner.cancelWork,dispatch:runner.dispatch,responsibilities,dataDir:dir,deskDir:root+'apps/desk/dist'});
 const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0}),detach=attachStream(server,ledger,auth);
 server.once('listening',()=>process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port}));
 async function stop(){if(stopping)return;stopping=true;automations.shutdown();responsibilities.shutdown();runner.shutdown();for(const release of [...sourceHolds,...modelHolds])release();await responsibilities.idle();detach();server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});}
 process.on('message',async m=>{const reply=value=>process.send({requestId:m.requestId,type:m.type+'-result',...value});try{
  if(m.type==='stop')return await stop();
  if(m.type==='observe')return reply(responsibilities.observe(m.id,m.event));
  if(m.type==='mode'){mode=m.mode;return reply({});}
  if(m.type==='source-mode'){sourceMode=m.mode;return reply({});}
  if(m.type==='ready-source'){sourceReady=m.ready;return reply({});}
  if(m.type==='release'){mode='normal';sourceMode='normal';for(const release of [...sourceHolds.splice(0),...modelHolds.splice(0)])release();return reply({});}
  if(m.type==='clock'){clock=m.at;return reply({});}
  if(m.type==='runtime'){db.prepare('UPDATE bots SET runtime=? WHERE id=?').run(m.runtime,m.botId);return reply({});}
  if(m.type==='crash'){crashPhase=m.phase;return reply({});}
  if(m.type==='budget'){setSetting(db,'wake',{dailyPingBudget:m.value});return reply({});}
  if(m.type==='quiet-hours'){setSetting(db,'activeHours',{start:'01:00',end:'02:00',days:[0,1,2,3,4,5,6]});return reply({});}
  if(m.type==='stats')return reply({reads:count('reads'),attempts:count('read-attempts'),models:count('model'),notifications:count('notifications'),recallCalls,acpCalls,directDenied,heldModels:modelHolds.length,heldSources:sourceHolds.length,prompts,work:(db.prepare('SELECT count(*) n FROM work').get()).n,approvals:(db.prepare('SELECT count(*) n FROM approvals').get()).n});
  if(m.type==='pair')return reply({code:auth.createPairingCode('owner',m.access==='limited'?'limited':'full').code});
 }catch(error){reply({error:error.message});}});
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
});
