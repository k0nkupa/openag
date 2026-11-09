import { assignedWorkDispatch } from './assigned-work-fixture.mjs';
// Disposable gateway/runner process for verify-work.mjs. No real model or account is used.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { realpathSync, writeFileSync, mkdirSync,readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
for (const key of Object.keys(process.env)) if (!['PATH','HOME','LANG','TMPDIR'].includes(key)) delete process.env[key];
process.env.OPENAG_OLLAMA_URL='http://127.0.0.1:1';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(root+'apps/daemon/package.json');
const { serve }=require('@hono/node-server');
const { agent, methods }=require('@agentclientprotocol/sdk/unstable');
const { MockLanguageModelV3 }=await import(require.resolve('ai/test'));
const load=path=>import(root+'apps/daemon/dist/'+path+'.js');
const {openDb}=await load('db/index');const {createBot,createRoom,addMember,getBot,getRoom}=await load('rooms');
const {createAuth}=await load('auth');const {createLedger}=await load('ledger');const {createApprovals}=await load('approvals');
const {createRunner}=await load('runtimes/runner');const {createGateway,attachStream}=await load('gateway');
const {createAcpRuntime}=await load('runtimes/acp');const {createApiRuntime}=await load('runtimes/api');const {createOllamaRuntime}=await load('runtimes/ollama');
const {getDefaultRedactor}=await load('redact');
const {createPermissions}=await load('permissions');
const {requestInputTool}=await load('tools/input'),{toExecutors}=await load('tools/registry'),{createMcpAccess}=await load('mcpserver');
const dir=process.argv[2];
if(!dir || !realpathSync(dir).startsWith(join(realpathSync(tmpdir()),'openag-work-'))) throw new Error('Temporary fixture directory required');
process.once('message',({ownerToken,port,fastWatchdog})=>{
 const db=openDb(dir);const auth=createAuth({db,ownerToken});const ledger=createLedger(db);const approvals=createApprovals(db,ledger);
 const permissions=createPermissions(db,ledger,dir,approvals);
 if(!permissions.active())permissions.adopt('workspace-write',permissions.adoption().reviewVersion,'controlled fixture owner');
 getDefaultRedactor().addSecret('work-fixture-secret-837628');
 for(const id of ['boss','helper','acp','model','local']) if(!getBot(db,id)) createBot(db,{id,runtime:id==='acp'?'acp':'api',...(id==='local'?{model:'ollama/work-check'}:{}),config:id==='acp'?{adapter:'codex'}:{}});
 for(const [id,bots] of [['main',['boss','helper']],['other',['boss']],['_internal',['boss']],['acp-room',['acp']],['acp-other',['acp']],['model-room',['model']],['local-room',['local']]]){
  if(!getRoom(db,id)) createRoom(db,{id,leadBotId:bots[0]});for(const bot of bots)addMember(db,id,bot);
 }
 const held=new Map();
 const hold=(key,signal)=>new Promise((resolve,reject)=>{ const done=()=>{held.delete(key);signal?.removeEventListener('abort',abort);resolve();};const abort=()=>{held.delete(key);reject(new Error('controlled cancellation'));};held.set(key,done);if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true}); });
 let runner,baseUrl;
 const mcpAccess=createMcpAccess({runner:{activeTurn:(bot,room)=>runner?.activeTurn(bot,room)},dataDir:dir,tools:()=>[requestInputTool]});
 const tools={...toExecutors([requestInputTool]),fixture_write:async(_ctx,args)=>{
  if(typeof args?.requestId!=='number'||typeof args?.text!=='string')throw new Error('Invalid fixture write');
  if(args.text==='slow_tool'){process.send({type:'tool-started',key:args.requestId});await hold(args.requestId);}
  mkdirSync(join(dir,'results'),{recursive:true});writeFileSync(join(dir,'results',args.requestId+'.txt'),args.text,{flag:'wx',mode:0o600});return {written:true};
 }};
 tools.fixture_write.validate=args=>{if(typeof args?.requestId!=='number'||typeof args?.text!=='string')throw Error('Invalid fixture write');return args;};
 tools.fixture_write.permission=()=>({approval:'review',effects:'act-local'});
 tools.fixture_write.confirm=()=>({outcome:"completed",detail:"Controlled executor wrote the exact temporary result file."});
 const sessions=new Map(),mcpConfigs=new Map();let sessionCount=0;
 const controlledAcp=agent({name:'work-cancellation-fixture'})
 .onRequest(methods.agent.initialize,async()=>({protocolVersion:1,agentCapabilities:{sessionCapabilities:{systemPrompt:{}}}}))
 .onRequest(methods.agent.session.new,async({params})=>{const id='session-'+(++sessionCount);mcpConfigs.set(id,params.mcpServers?.[0]);return {sessionId:id,modes:{currentModeId:'read-only',availableModes:[{id:'read-only',name:'Read only'}]}};})
 .onRequest(methods.agent.session.setMode,async()=>({}))
 .onNotification(methods.agent.session.cancel,async({params})=>{process.send({type:'acp-cancel',sessionId:params.sessionId});sessions.get(params.sessionId)?.();})
 .onRequest(methods.agent.session.prompt,async({params,client})=>{
  await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'plan',entries:[{content:'Proposed step only',priority:'medium',status:'completed'}]}});
  const text=params.prompt.map(p=>p.text??'').join('').split('</openag_context>\n\n').at(-1);
  if(text.includes('input_runtime')&&!text.includes('Answer:')){
   const config=mcpConfigs.get(params.sessionId),toolCallId=randomUUID();if(!config)throw Error('Scoped MCP missing');
   await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'tool_call',toolCallId,title:'mcp.'+config.name+'.request_input',rawInput:{server:config.name},kind:'other',status:'pending'}});
   const permit=await client.request(methods.client.session.requestPermission,{sessionId:params.sessionId,toolCall:{toolCallId},options:[{optionId:'allow',name:'Allow',kind:'allow_once'}]});
   if(permit.outcome?.optionId!=='allow')throw Error('Internal MCP permission refused');
   const response=await fetch(config.url,{method:'POST',headers:{...Object.fromEntries(config.headers.map(h=>[h.name,h.value])),'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'request_input',arguments:{prompt:'Which controlled option should ACP use?'}}})});
   await response.text();
   await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'tool_call_update',toolCallId,status:'failed'}});
   return {stopReason:'cancelled'};
  }
  if(text.includes('acp_file')) {
   const label=/acp_file ([a-z-]+)/.exec(text)?.[1]??'match',path=join(dir,'bots','acp','work','native-'+label+'.txt'),toolCallId=randomUUID();
   const before=existsSync(path)?readFileSync(path,'utf8'):'',after='Native reviewed change '+label;
   const content=[{type:'diff',path,oldText:existsSync(path)?before:null,newText:after,_meta:{kind:existsSync(path)?'update':'add'}}];
   await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'tool_call',toolCallId,title:'Controlled native file change',kind:'edit',status:'pending',content}});
   const answer=await client.request(methods.client.session.requestPermission,{sessionId:params.sessionId,toolCall:{toolCallId,title:'Controlled native file change',kind:'edit'},options:[{optionId:'allow',name:'Allow',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]});
   const allowed=answer.outcome?.optionId==='allow';if(allowed){mkdirSync(join(dir,'bots','acp','work'),{recursive:true});writeFileSync(path,label==='mismatch'?'Unreviewed adapter bytes':after);}
   await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'tool_call_update',toolCallId,status:allowed?'completed':'failed'}});
   return {stopReason:'end_turn'};
  }
  if(text.includes('acp_ask')) {
   const label=/acp_ask ([a-z-]+)/.exec(text)?.[1] ?? 'native';const toolCallId=randomUUID();const input={command:'write '+label,cwd:join(dir,'native')};
   await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'tool_call',toolCallId,title:'Controlled local write',kind:'execute',status:'pending',rawInput:input}});
   const answer=await client.request(methods.client.session.requestPermission,{sessionId:params.sessionId,toolCall:{toolCallId,title:'Controlled local write',kind:'execute',rawInput:input},options:[{optionId:'allow',name:'Allow',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]});
   const allowed=answer.outcome?.optionId==='allow';if(allowed){mkdirSync(join(dir,'native'),{recursive:true});writeFileSync(join(dir,'native',label+'.txt'),'native confirmed',{flag:'wx',mode:0o600});}
   await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'tool_call_update',toolCallId,status:allowed?'completed':'failed'}});
   return {stopReason:'end_turn'};
  }
  if(text.includes('acp_terminal')) await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'tool_call',toolCallId:'terminal-initial',title:'Already completed read',kind:'read',status:text.includes('acp_terminal_fail')?'failed':'completed'}});
  if(text.includes('acp_wait')) await new Promise(resolve=>{sessions.set(params.sessionId,resolve);process.send({type:'acp-started',sessionId:params.sessionId});});
  else await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Controlled ACP response'}}});
  sessions.delete(params.sessionId);return {stopReason:text.includes('acp_wait')?'cancelled':'end_turn'};
 });
 const acp=createAcpRuntime({dataDir:dir,mcp:{access:mcpAccess,baseUrl:()=>baseUrl,tools:new Set(["request_input"])},launcher:()=>({target:controlledAcp,close:()=>{for(const resolve of sessions.values())resolve();sessions.clear();}})});
 const usage={inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
 const model=new MockLanguageModelV3({doGenerate:async opts=>{
  const current=opts.prompt.filter(m=>m.role==='user').at(-1);
  const prompt=typeof current?.content==='string'?current.content:current?.content?.map(c=>c.text??'').join('')??'';
  if(prompt.includes('input_runtime')&&!prompt.includes('Answer:')&&!opts.prompt.some(m=>m.role==='tool'))return {content:[{type:'tool-call',toolCallId:'input-'+randomUUID(),toolName:'request_input',input:JSON.stringify({prompt:'Which controlled option should API use?'})}],finishReason:{unified:'tool-calls',raw:'tool_calls'},usage,warnings:[]};
  if(prompt.includes('api_wait')){process.send({type:'api-started'});await new Promise((resolve,reject)=>{opts.abortSignal.addEventListener('abort',()=>{process.send({type:'api-aborted'});reject(new DOMException('Aborted','AbortError'));},{once:true});});}
  return {content:[{type:'text',text:'Controlled API response'}],finishReason:{unified:'stop',raw:'stop'},usage,warnings:[]};
 }});
 const api=createApiRuntime({model,tools:[requestInputTool]});
 const local=createOllamaRuntime({tools:[requestInputTool],env:{OPENAG_OLLAMA_URL:'http://127.0.0.1:1'},fetch:async(_url,opts)=>{
  const messages=JSON.parse(opts.body).messages,current=messages.filter(m=>m.role==='user').at(-1)?.content??'';
  if(current.includes('input_runtime')&&!current.includes('Answer:')&&!messages.some(m=>m.role==='tool'))return new Response(JSON.stringify({done:true,done_reason:'stop',message:{role:'assistant',content:'',tool_calls:[{function:{name:'request_input',arguments:{prompt:'Which controlled option should Ollama use?'}}}]}}));
  if(current.includes('ollama_wait')){process.send({type:'ollama-started'});await new Promise((resolve,reject)=>{opts.signal.addEventListener('abort',()=>{process.send({type:'ollama-aborted'});reject(new DOMException('Aborted','AbortError'));},{once:true});});}
  return new Response(JSON.stringify({done:true,done_reason:'stop',message:{role:'assistant',content:'Controlled local response'}}));
 }});
 const runtime={async runTurn(ctx){
  const text=ctx.message.payload.text;
  if(ctx.bot.id==='model')return api.runTurn(ctx);
  if(ctx.bot.id==='local')return local.runTurn(ctx);
  if(ctx.message.payload.replyTo){ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Delegation result handled.'});return;}
  if(ctx.resumed && ctx.prompt.includes('Answer without tools')) {ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Answered without executing the rejected tool.'});return;}
  if(text==='fail')throw new Error('Controlled execution failed');
  if(text==='report-secret'){ctx.reportWork({needsInput:true,nextStep:'work-fixture-secret-837628',plan:[{title:'work-fixture-secret-837628',state:'completed'}]});return;}
  if(text==='input'){ctx.reportWork({needsInput:true,nextStep:'What is the budget?',plan:[{title:'Confirm budget',state:'pending'}]});return;}
  if(text==='bad-report'){try{ctx.reportWork({status:'completed'});}catch{}await hold(ctx.message.id,ctx.signal);return;}
  if(text==='fake-done'){ctx.reportWork({plan:[{title:'Model claims done',state:'completed'}]});await hold(ctx.message.id,ctx.signal);return;}
  if(text==='wait'){await hold(ctx.message.id,ctx.signal);return;}
  if(text==='uncooperative'){await hold(ctx.message.id);return;}
  if(text==='unknown'){ledger.append(ctx.room.id,ctx.bot.id,'tool_call',{turnId:ctx.turnId,toolCallId:'unknown-call',tool:'external_action'});return;}
  if(text==='delegate'||text==='delegate_fail'||text==='delegate_wait'){ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'@helper '+({delegate:'ask',delegate_fail:'fail',delegate_wait:'wait'}[text])});return;}
  if(text==='ask'||text==='slow_tool'){const outcome=await ctx.callTool('fixture_write',{requestId:ctx.message.id,text});ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:outcome.ok?'Tool confirmed.':'Tool did not run.'});return;}
  ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Controlled completion.'});
 }};
 runner=createRunner({db,ledger,approvals,dataDir:dir,permissions,runtimes:{api:runtime,acp},tools,...(fastWatchdog?{watchdog:{idleMs:100,tickMs:10}}:{})});runner.recover();
 const app=createGateway({db,ledger,approvals,auth,permissions,dispatch:args=>args.message.payload.text==='input_runtime_chat'?runner.dispatch(args):assignedWorkDispatch(runner,db)(args),work:runner.work,cancelWork:runner.cancelWork,dataDir:dir,mcpAccess,deskDir:root+'apps/desk/dist'});
 const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port});const detach=attachStream(server,ledger,auth);
 server.once('listening',()=>{baseUrl='http://127.0.0.1:'+server.address().port;process.send({type:'ready',url:baseUrl});});
 let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;runner.shutdown();for(const finish of held.values())finish();await Promise.all([acp.close(),runner.drain()]);detach();server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});};
 process.on('message',async message=>{
  if(message.type==='stop')return stop();
  if(message.type==='release'){held.get(message.key)?.();return;}
  if(message.type==='invalid'){
   try{runner.work.begin(message.input);process.send({type:'invalid-result',ok:true});}catch(error){process.send({type:'invalid-result',ok:false,status:error.status});}
  }
  if(message.type==='shutdown-race'){
   const request=ledger.append('main','user','message',{text:'delegate_wait'});let turnId;
   const off=ledger.subscribe('main',event=>{
    if(event.type==='turn_started' && event.payload.messageId===request.id)turnId=event.payload.turnId;
    if(event.type==='turn_finished' && event.payload.turnId===turnId)queueMicrotask(()=>runner.shutdown());
   });
   await assignedWorkDispatch(runner,db)({room:getRoom(db,'main'),botIds:['boss'],message:request});off();
   const work=runner.work.list({roomId:'main',limit:100}).work.find(w=>w.requestId===request.id);
   process.send({type:'shutdown-race-result',work,children:runner.work.list({parentId:work.id,limit:100}).work.length});return;
  }
  if(message.type==='atomic'){
   try{ledger.atomic(()=>{ledger.append('main','daemon','error',{message:'rolled-back-marker'});throw new Error('rollback');});}catch{}
   process.send({type:'atomic-result',exists:ledger.list('main',{limit:1000}).some(e=>e.payload.message==='rolled-back-marker')});
  }
 });process.on('disconnect',stop);process.once('SIGINT',stop);process.once('SIGTERM',stop);
});
