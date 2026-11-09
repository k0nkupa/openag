// Owned temporary gateway with real runtimes and controlled ACP/model transports.
import { capabilityFixture, capabilityUrl } from './model-capabilities-fixture.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)), require=createRequire(root+'apps/daemon/package.json');
const load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const {serve}=require('@hono/node-server');
const {agent,methods}=await import(require.resolve('@agentclientprotocol/sdk/unstable'));
const {MockLanguageModelV3}=await import(require.resolve('ai/test'));
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createAuth}=await load('auth'),{createApprovals}=await load('approvals'),rooms=await load('rooms'),{createRoomRouter}=await load('router'),{createRunner}=await load('runtimes/runner'),{createGateway,attachStream}=await load('gateway'),{createAcpRuntime}=await load('runtimes/acp'),{createApiRuntime}=await load('runtimes/api'),{createOllamaRuntime}=await load('runtimes/ollama'),{createBotModels,providerOptions}=await load('botmodels'),{defaultTools}=await load('runtimes/tools');
export async function startFixture(dir,ownerToken,port=0,options={}){
 if(!realpathSync(dir).startsWith(join(realpathSync(tmpdir()),'openag-bot-models-')))throw Error('Owned temporary bot-models directory required');
 for(const key of Object.keys(process.env))if(!['PATH','HOME','LANG','TMPDIR'].includes(key))delete process.env[key];
 const db=openDb(dir),ledger=createLedger(db),auth=createAuth({db,ownerToken}),approvals=createApprovals(db,ledger),stats={launches:[],prompts:[],closed:[],requests:[],modes:[]};
 for(const [id,runtime,model]of [['boss','api','openai/gpt-5'],['coder','acp','claude-code'],['other','acp','claude-code'],['local','api','ollama/fixture']])if(!rooms.getBot(db,id))rooms.createBot(db,{id,runtime,model});
 for(const id of ['main','second'])if(!rooms.getRoom(db,id)){rooms.createRoom(db,{id,leadBotId:'boss'});for(const bot of rooms.listBots(db))rooms.addMember(db,id,bot.id);}
 const env={OPENAI_API_KEY:'synthetic-only-openai',ANTHROPIC_API_KEY:'synthetic-only-anthropic',OPENROUTER_API_KEY:'synthetic-only-openrouter',OPENAG_OLLAMA_URL:options.realOllama?'http://127.0.0.1:11434':'http://127.0.0.1:1'};
 let releaseDiscovery;let blockedDiscovery=false;let mode='normal';
 const fakeFetch=async(url,init={})=>{
  stats.requests.push({url:String(url),body:init.body?JSON.parse(init.body):null});
  if(options.realOllama&&String(url).startsWith('http://127.0.0.1:11434/api/'))return fetch(url,init);
  if(blockedDiscovery)await new Promise(r=>{releaseDiscovery=r;});
  if(mode==='unavailable')return new Response(null,{status:503});
  if(String(url)===capabilityUrl)return Response.json(capabilityFixture);
  if(String(url).endsWith('/api/tags')&&mode==='empty-models')return Response.json({models:[]});
  if(String(url).endsWith('/api/tags'))return Response.json({models:[{name:'fixture'},{name:'fixture-b'},{name:'embedding-only'}]});
  if(String(url).endsWith('/api/show')&&JSON.parse(init.body).model==='embedding-only')return Response.json({capabilities:['embedding']});
  if(String(url).endsWith('/api/show')&&mode==='missing-thinking')return Response.json({capabilities:['completion']});
  if(String(url).endsWith('/api/chat')&&mode==='missing-chat')return new Response(null,{status:404});
  if(String(url).endsWith('/api/show'))return Response.json({capabilities:['completion','tools'],thinking:{values:[false,true,'high'],default:true}});
  if(String(url).endsWith('/api/chat')){const b=JSON.parse(init.body),gate=b.messages.at(-1).role==='user'&&b.messages.at(-1).content.replace(/^[\s\S]*?<\/openag_context>\s*/, '').trim()==='gate';return Response.json({model:'fixture-served',message:gate?{role:'assistant',content:'',tool_calls:[{function:{name:'write_file',arguments:{path:'ollama-gate.txt',content:'controlled'}}}]}:{role:'assistant',content:'Controlled Ollama reply'},done:true,done_reason:'stop'});}
  if(String(url).includes('api.openai.com'))return Response.json({data:[{id:'gpt-5',name:mode==='leak'?env.OPENAI_API_KEY:'OpenAI fixture'},{id:'gpt-4o-mini'},{id:'unfamiliar-file-model'},{id:'live-only'}]});
  if(String(url).includes('api.anthropic.com'))return Response.json({data:[{id:'claude-opus-4-6',display_name:'Claude fixture',max_tokens:64000,capabilities:{thinking:{types:{enabled:{supported:true},adaptive:{supported:true}}}}},{id:'claude-opus-5',display_name:'Claude modes fixture',max_tokens:64000,capabilities:{thinking:{types:{adaptive:{supported:true},disabled:{supported:true}}}}}],has_more:false});
  if(String(url).includes('openrouter.ai'))return Response.json({data:[{id:'openai/gpt-5',name:'OpenRouter fixture'}]});
  throw Error('Unexpected network request refused');
 };
 const launcher=({bot,profile,cwd})=>{
  const serial=stats.launches.length;stats.launches.push({bot:bot.id,adapter:profile.id,cwd});let n=0;const state=new Map();
  const options=id=>[{id:'model',name:'Model',type:'select',category:'model',currentValue:state.get(id)?.model??'model-a',options:[{value:'model-a',name:'Fixture A'},{value:'model-b',name:'Fixture B'}]},{id:profile.id==='claude'?'effort':'reasoning_effort',name:'Effort',type:'select',category:'thought_level',currentValue:state.get(id)?.effort??'low',options:(state.get(id)?.model==='model-b'?['high']:['low','high']).map(value=>({value,name:value}))}];
  const fake=agent({name:'controlled-'+profile.id}).onRequest(methods.agent.initialize,()=>({protocolVersion:1,agentCapabilities:{sessionCapabilities:{resume:{},systemPrompt:{}}}}))
   .onRequest(methods.agent.session.new,({params})=>{const sessionId=`fixture-${serial}-${++n}`;state.set(sessionId,{model:'model-a',effort:'low'});return{sessionId,configOptions:mode==='adapter-unavailable'?[]:options(sessionId),modes:{currentModeId:'auto',availableModes:[{id:'auto',name:'Auto'},{id:profile.safeMode,name:'Ask'}]}};})
   .onRequest(methods.agent.session.setMode,({params})=>{stats.modes.push(params.modeId);return{};})
   .onRequest(methods.agent.session.setConfigOption,({params})=>{if(mode==='adapter-fail')throw Error('Controlled failed selection');const s=state.get(params.sessionId);if(!options(params.sessionId).find(o=>o.id===params.configId)?.options.some(v=>v.value===params.value))throw Error('Unsupported fixture config');if(params.configId==='model'){s.model=params.value;s.effort=s.model==='model-b'?'high':'low';}else s.effort=params.value;return{configOptions:options(params.sessionId)};})
   .onRequest(methods.agent.session.resume,()=>{throw Error('No fixture session survives a closed adapter');})
   .onRequest(methods.agent.session.prompt,async({params,client})=>{
    const text=params.prompt.filter(p=>p.type==='text').map(p=>p.text).join('').replace(/^[\s\S]*?<\/openag_context>\s*/, '');stats.prompts.push({bot:bot.id,adapter:profile.id,sessionId:params.sessionId,...state.get(params.sessionId)});
    if(text.trim()==='switch-model'){state.get(params.sessionId).model='model-b';state.get(params.sessionId).effort='high';await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'config_option_update',configOptions:options(params.sessionId)}});}
    if(text.trim()==='gate'){
     const call={toolCallId:'gate-'+stats.prompts.length,title:'Write controlled file',kind:'edit',rawInput:{file_path:'fixture.txt',content:'controlled'},...(profile.id==='claude'?{_meta:{claudeCode:{toolName:'Write'}}}:{content:[{type:'diff',path:'fixture.txt',oldText:null,newText:'controlled'}]})};
     await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'tool_call',status:'pending',...call}});
     const decision=await client.request(methods.client.session.requestPermission,{sessionId:params.sessionId,toolCall:call,options:[{optionId:'allow',name:'Allow once',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]});
     if(decision.outcome.optionId==='allow')writeFileSync(join(dir,'bots',bot.id,'work','fixture.txt'),'controlled');
     await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'tool_call_update',toolCallId:call.toolCallId,status:decision.outcome.optionId==='allow'?'completed':'failed'}});
    }
    if(profile.id==='claude')await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'usage_update',used:2,size:200000,_meta:{'_claude/model':'claude-fixture-served'}}});
    await client.notify(methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Controlled '+profile.id+' reply'}}});return{stopReason:'end_turn'};
   });
  return{target:fake,close(){stats.closed.push(serial);}};
 };
 const acp=createAcpRuntime({dataDir:dir,launcher:options.real?undefined:launcher});
 const usage={inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
 const model=new MockLanguageModelV3({doGenerate:async args=>{
  stats.requests.push({kind:'mastra',providerOptions:args.providerOptions});
  const current=args.prompt.filter(m=>m.role==='user').at(-1);const text=typeof current?.content==='string'?current.content:current?.content?.map(c=>c.text??'').join('')??'';
  const gate=text.replace(/^[\s\S]*?<\/openag_context>\s*/, '').trim()==='gate'&&!args.prompt.some(m=>m.role==='tool');
  return{content:gate?[{type:'tool-call',toolCallId:'gate',toolName:'write_file',input:JSON.stringify({path:'api-gate.txt',content:'controlled'})}]:[{type:'text',text:'Controlled API reply'}],finishReason:{unified:gate?'tool-calls':'stop',raw:gate?'tool_calls':'stop'},usage,warnings:mode==='warning'?[{type:'unsupported-setting',setting:'reasoningEffort'}]:[],response:{id:'fixture-response',timestamp:new Date(),modelId:'hosted-fixture-served'}};
 }});
 const ollama=createOllamaRuntime({env,fetch:fakeFetch});
 const hosted=createApiRuntime({model,ollama});
 const runtime={runTurn(ctx){if(options.runTurn)return options.runTurn(ctx);if(ctx.bot.model?.startsWith('ollama/'))return ollama.runTurn(ctx);stats.requests.push({kind:'selected-api',model:ctx.bot.model,options:providerOptions(ctx.bot)});return hosted.runTurn(ctx);}};
 const runner=createRunner({db,ledger,approvals,dataDir:dir,runtimes:{api:runtime,acp},tools:{...defaultTools,...options.tools}});runner.recover();
 let now=Date.now();
 const botModels=createBotModels({db,ledger,acp,withIdleBot:runner.withIdleBot,env,fetch:fakeFetch,now:()=>now});
 if(options.warm!==false){await botModels.catalogue.refresh();stats.launches.length=0;stats.closed.length=0;stats.requests.length=0;}
 const interactions=options.mcpInteractions?.(db,ledger);
 const gateway=createGateway({db,ledger,auth,approvals,mcpInteractions:interactions,dataDir:dir,agentRequests:runner.agentRequests,dispatch:runner.dispatch,work:runner.work,cancelWork:runner.cancelWork,router:createRoomRouter({db,env,fetch:fakeFetch,chat:async()=>{throw Error('Routing inference is outside this fixture');}}),botModels,modelEnv:env,deskDir:root+'apps/desk/dist'});
 const server=serve({hostname:'127.0.0.1',port,fetch:async request=>{if(mode==='lost-room'&&request.method==='GET'&&new URL(request.url).pathname.startsWith('/rooms/creation/requests/'))return Response.json({error:'Controlled room-status outage'},{status:503});if(mode==='room-error'&&request.method==='POST'&&new URL(request.url).pathname==='/rooms')return Response.json({error:'Controlled room validation failure'},{status:400});if(mode==='lost-create'&&request.method==='GET'&&new URL(request.url).pathname.startsWith('/bots/creation/requests/'))return Response.json({error:'Controlled creation-status outage'},{status:503});const response=await gateway.fetch(request);if(mode==='lost-room'&&request.method==='POST'&&new URL(request.url).pathname==='/rooms')return Response.json({error:'Controlled lost room response'},{status:503});if(mode==='lost-create'&&request.method==='POST'&&new URL(request.url).pathname==='/bots')return Response.json({error:'Controlled lost creation response'},{status:503});if(mode==='lost'&&request.method==='PUT'&&new URL(request.url).pathname.endsWith('/model'))return Response.json({error:'Controlled lost response'},{status:503});return response;}});const detach=attachStream(server,ledger,auth);
 if(!server.listening)await new Promise(r=>server.once('listening',r));
 return{url:`http://127.0.0.1:${server.address().port}`,db,ledger,runner,botModels,stats,env,advance(ms){now+=ms;},mode(value){mode=value;},block(){blockedDiscovery=true;},release(){blockedDiscovery=false;releaseDiscovery?.();},async close(){await botModels.catalogue.close();detach();runner.shutdown();await runner.drain();await runner.idle();await acp.close();await new Promise(r=>server.close(r));db.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 process.once('message',async({ownerToken,port})=>{const fixture=await startFixture(process.argv[2],ownerToken,port);process.send({url:fixture.url});process.on('message',async m=>{if(m.type==='stop'){await fixture.close();process.exit(0);}});});
}
