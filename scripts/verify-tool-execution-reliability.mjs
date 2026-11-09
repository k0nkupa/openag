// Actual gateway/runner + API/Ollama + HTTP MCP; only disposable targets and controlled model transports.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,watch} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=n=>import(root+'apps/daemon/dist/'+n+'.js');
const {serve}=require('@hono/node-server'),{z}=require('zod'),{MockLanguageModelV3}=await import(require.resolve('ai/test'));
const {Server}=await import(require.resolve('@modelcontextprotocol/sdk/server/index.js'));
const {WebStandardStreamableHTTPServerTransport}=await import(require.resolve('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'));
const {ListToolsRequestSchema,CallToolRequestSchema}=await import(require.resolve('@modelcontextprotocol/sdk/types.js'));
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createBot,createRoom,addMember}=await load('rooms'),{createRunner}=await load('runtimes/runner'),{createGateway}=await load('gateway');
const {createPermissions}=await load('permissions'),{createApiRuntime}=await load('runtimes/api'),{createOllamaRuntime}=await load('runtimes/ollama');
const {toExecutors}=await load('tools/registry'),{createMcpManager}=await load('mcp'),{getDefaultRedactor}=await load('redact');
const {createAppsManager}=await load('apps');
const directory=mkdtempSync(join(tmpdir(),'openag-tool-lifecycle-')),evidence=[];
console.log('Disposable evidence: '+directory);
const secret='lifecycle-private-'+randomUUID();getDefaultRedactor().addSecret(secret);
const deadline=async promise=>{
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Lifecycle deadline: stop and inspect; do not retry.')),15000);})]);}finally{clearTimeout(timer);}
};
function envelopes(value){
 if(typeof value==='string'){try{return envelopes(JSON.parse(value));}catch{return [];}}
 if(!value||typeof value!=='object')return [];
 if(typeof value.ok==='boolean'&&typeof value.executionOutcome==='string')return [value];
 return Object.values(value).flatMap(envelopes);
}

for(const runtime of ['api','ollama']){
 const dataDir=join(directory,runtime),db=openDb(dataDir),ledger=createLedger(db),approvals=createApprovals(db,ledger),token=randomUUID();
 const permissions=createPermissions(db,ledger,dataDir,approvals),protocolServers=[];
 let scenario,step=0,wire=[],calls=0,work,running,runner,base;
 const appDir=join(dataDir,'apps','lifecycle');mkdirSync(join(appDir,'data'),{recursive:true});
 writeFileSync(join(appDir,'main.cjs'),`const fs=require('node:fs'),target=JSON.parse(fs.readFileSync('data/target','utf8'));process.on('SIGTERM',()=>{});fs.writeFileSync(target,'one effect');fs.writeFileSync(target+'.pid',String(process.pid));setTimeout(()=>{fs.writeFileSync(target+'.after','forbidden');console.log('{}');},6000);`);
 writeFileSync(join(appDir,'manifest.json'),JSON.stringify({id:'lifecycle',name:'Lifecycle fixture',version:'1.0.0',description:'Disposable App process',tools:[{name:'hold',class:'act-local',description:'Fixed App marker',input:{type:'object',properties:{}},exec:{argv:['node','main.cjs'],timeoutSec:10}}]}));
 let enabled={};const apps=createAppsManager({dataDir,getEnabled:()=>enabled,setEnabled:value=>{enabled=value;}});apps.enable('lifecycle',apps.scan()[0].hash);
 const appDefs=apps.toolDefs().map(def=>({...def,execute:async(ctx,args)=>{calls++;return def.execute(ctx,args);}}));
 const remote=serve({hostname:'127.0.0.1',port:0,fetch:async request=>{
  const server=new Server({name:'lifecycle-fixture',version:'1'},{capabilities:{tools:{}}});protocolServers.push(server);
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:['query','external'].map(name=>({name,inputSchema:{type:'object',properties:{},additionalProperties:false}}))}));
  server.setRequestHandler(CallToolRequestSchema,async()=>{calls++;return {isError:true,content:[{type:'text',text:'Provider rejected request: '+secret}],structuredContent:{code:'REJECTED'}};});
  const transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:true});await server.connect(transport);return transport.handleRequest(request);
 }});
 if(!remote.listening)await new Promise(resolve=>remote.once('listening',resolve));
 writeFileSync(join(dataDir,'mcp.json'),JSON.stringify({servers:[{id:'lifecycle',transport:'http',url:'http://127.0.0.1:'+remote.address().port+'/mcp',toolClasses:{query:'read',external:'act-external'}}]}),{mode:0o600});
 const mcp=createMcpManager({dataDir,env:{}});await mcp.load();assert.equal(mcp.status()[0].state,'connected');
 const def={name:'lifecycle_mark',class:'act-local',description:'One fixed disposable marker; no model-controlled target.',input:z.object({}).strict(),
  permission:()=>({approval:scenario.stage==='pending'?'review':'allow'}),
  execute:async ctx=>{
   calls++;writeFileSync(scenario.target,'one effect');scenario.entered();
   if(scenario.stage==='started')await new Promise((_,reject)=>{
    const abort=()=>reject(Error('Controlled response lost after effect '+secret));
    if(ctx.signal.aborted)abort();else ctx.signal.addEventListener('abort',abort,{once:true});
   });
   return {marker:'observed'};
  },confirm:()=>({outcome:'completed',detail:'Disposable marker read back.'})};
 const usage={inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
 const model=new MockLanguageModelV3({doGenerate:async opts=>{
  wire.push(opts.prompt);const call=step++===0;
  return {content:call?[{type:'tool-call',toolCallId:'call-'+randomUUID(),toolName:scenario.tool,input:'{}'}]:[{type:'text',text:'Controlled result consumed.'}],finishReason:{unified:call?'tool-calls':'stop',raw:call?'tool_calls':'stop'},usage,warnings:[]};
 }});
 const ollama=createOllamaRuntime({tools:[def,...appDefs],toolDefs:()=>mcp.toolDefs(),env:{OPENAG_OLLAMA_URL:'http://127.0.0.1:1'},fetch:async(_url,opts)=>{
  const body=JSON.parse(opts.body);wire.push(body.messages);const call=step++===0;
  return Response.json({done:true,done_reason:'stop',message:{role:'assistant',content:call?'':'Controlled result consumed.',...(call?{tool_calls:[{function:{name:scenario.tool,arguments:{}}}]}:{})}});
 }});
 const api=createApiRuntime({model,tools:[def,...appDefs],toolDefs:()=>mcp.toolDefs(),ollama});
 createBot(db,{id:'bot',runtime:'api',model:runtime==='ollama'?'ollama/fixture':'openai/fixture'});
 const hosted={async runTurn(ctx){
  if(scenario.bootstrap){work=runner.work.create({roomId:ctx.room.id,botId:ctx.bot.id,messageId:ctx.message.id,turnId:ctx.turnId},{title:'Controlled explicit Work',description:'One disposable action'},'lifecycle-'+ctx.message.id);return;}
  return api.runTurn(ctx);
 }};
 runner=createRunner({db,ledger,approvals,dataDir,permissions,runtimes:{api:hosted},tools:toExecutors([def,...appDefs]),dynamicTools:()=>mcp.executors()});
 const app=createGateway({db,ledger,approvals,auth:createAuth({db,ownerToken:token}),dataDir,permissions,work:runner.work,cancelWork:runner.cancelWork,dispatch:args=>{
  running=runner.dispatch(args);
  return running;
 }});
 const gateway=serve({hostname:'127.0.0.1',port:0,fetch:req=>app.fetch(req)});if(!gateway.listening)await new Promise(resolve=>gateway.once('listening',resolve));base='http://127.0.0.1:'+gateway.address().port;
 const request=(path,method='GET',body,auth=token)=>fetch(base+path,{method,headers:{authorization:'Bearer '+auth,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=async path=>{const r=await request(path);assert.equal(r.status,200,path);return r.json();};
 const select=async(room,preset)=>{const old=await json('/bots/bot/permissions?roomId='+room);assert.equal((await request('/bots/bot/permissions?roomId='+room,'PUT',{preset,revision:old.revision,acknowledgeFullAccess:preset==='full-access'})).status,200);};
 const post=async room=>{step=0;wire=[];assert.equal((await request('/rooms/'+room+'/messages','POST',{text:'Use the one selected tool once; report its evidence without retrying.'})).status,202);};
 try{
  const cases=[{name:'remote-read-error',tool:'mcp.lifecycle.query',outcome:'failed'},{name:'remote-external-error',tool:'mcp.lifecycle.external',outcome:'failed'},
   ...[false,true].flatMap(work=>['pending','started'].map(stage=>({name:(work?'work':'chat')+'-cancel-'+stage,tool:'lifecycle_mark',work,stage,outcome:stage==='started'?'unknown':'not-run'}))),
   ...[false,true].map(work=>({name:(work?'work':'chat')+'-app-cancel',tool:'app_lifecycle_hold',app:true,work,stage:'started',outcome:'unknown'}))];
  for(const item of cases){
   const room='case-'+randomUUID();scenario={...item,target:join(dataDir,room+'.txt')};createRoom(db,{id:room,leadBotId:'bot'});addMember(db,room,'bot');
   await select(room,item.stage==='pending'?'workspace-write':'full-access');
   let entered;const dispatched=new Promise(resolve=>{entered=resolve;});scenario.entered=entered;
   let appWatch;
   if(item.app){writeFileSync(join(appDir,'data','target'),JSON.stringify(scenario.target));appWatch=watch(dataDir,()=>{if(existsSync(scenario.target+'.pid'))entered();});}
   let approvalId;const pending=new Promise(resolve=>{scenario.pending=resolve;});
   const off=ledger.subscribe(room,event=>{if(event.type==='approval_requested'){approvalId=event.payload.approvalId;scenario.pending();}});
   const before=calls;scenario.bootstrap=!!item.work;await post(room);
   if(item.work){await deadline(running);scenario.bootstrap=false;const current=(await json('/work/'+work.id)).work;assert.equal((await request('/work/'+work.id+'/start','POST',{revision:current.revision})).status,202);}
   try{
    if(item.stage){
     await deadline(item.stage==='pending'?pending:dispatched);
     if(item.work)assert.ok([200,202].includes((await request('/work/'+work.id+'/cancel','POST',{})).status));
     else await select(room,'read-only');
    }
    await deadline(running);await deadline(runner.idle());
    const events=ledger.list(room,{limit:1000}),result=events.filter(e=>e.type==='tool_result'&&e.payload.tool===item.tool).at(-1)?.payload;
    const receiptId=result?.receiptId??approvalId??events.filter(e=>e.type==='receipt_updated').at(-1)?.payload.receiptId;
    const receipt=receiptId?await json('/approvals/'+receiptId):undefined;
    if(item.stage){
     assert.equal(calls-before,item.stage==='started'?1:0,'Cancellation stage must match dispatch count');
     assert.equal(existsSync(scenario.target),item.stage==='started');
     if(item.stage==='started')assert.equal(readFileSync(scenario.target,'utf8'),'one effect');
     assert.equal(approvals.listPending().length,0);
     if(approvalId){const a=approvals.get(approvalId);assert.notEqual(a.status,'pending');assert.equal((await request('/approvals/'+approvalId,'POST',{kind:'accept',reviewVersion:a.reviewVersion})).status,409,'Late decision cannot dispatch cancelled action');}
     if(item.work){const retained=(await json('/work/'+work.id)).work;assert.ok(retained.cancelRequestedAt);assert.equal(retained.status,item.stage==='started'?'interrupted':'cancelled','Cancellation cannot hide an unknown effect');}
    }else{
     assert.equal(calls-before,1);assert.equal(result.ok,false);assert.equal(result.invocationOutcome,'returned');assert.equal(result.executionOutcome,item.outcome);
     assert.ok(wire.length>=2);const returned=JSON.stringify(wire.at(-1));assert.ok(returned.includes('REJECTED'),'Model must receive provider evidence');assert.ok(!returned.includes(secret));
     assert.ok(envelopes(wire.at(-1)).some(e=>e.ok===false&&e.executionOutcome===item.outcome&&e.receiptId===receiptId&&e.invocationOutcome==='returned'),'Model envelope must agree with retained receipt, not just mention an error');
    }
    // Refusals need not create receipts; anything dispatched must retain its actual outcome.
    if(receipt)assert.equal(receipt.receipt.outcome,item.outcome);
    if(item.app){const pid=Number(readFileSync(scenario.target+'.pid','utf8'));let live=false;try{process.kill(pid,0);live=true;}catch{}assert.equal(live,false,'Cancelled App must terminate before settlement');assert.equal(existsSync(scenario.target+'.after'),false,'No second App effect after cancellation');}
    if(item.outcome==='unknown'){
     assert.ok(receipt,'Dispatched uncertainty must be durable');
     if(item.stage)await select(room,'full-access');
     scenario.stage='settled';scenario.work=false;const count=calls;await post(room);await deadline(running);assert.ok(calls>count,'A fresh authorized operation proceeds after Unknown');
     assert.equal((await json('/approvals/'+receiptId)).receipt.outcome,'unknown');
    }
    assert.ok(!JSON.stringify(events).includes(secret),'Retained evidence must redact provider and executor errors');
    const manifests=events.filter(e=>e.type==='request_prepared').map(e=>e.payload.manifestId);assert.ok(manifests.length,'Retain request provenance for the exercised model turn');
    evidence.push({runtime,case:item.name,outcome:item.outcome,receiptId:receiptId??null,manifestIds:manifests,status:'passed'});
    console.log('PASS '+runtime+': '+item.name+' -> '+item.outcome);
   }finally{off();appWatch?.close();}
  }
 }finally{
  runner.shutdown();await deadline(runner.idle());runner.work.close();await mcp.close();for(const server of protocolServers)await server.close();gateway.closeAllConnections();remote.closeAllConnections();await Promise.all([new Promise(resolve=>gateway.close(resolve)),new Promise(resolve=>remote.close(resolve))]);db.close();
 }
}
writeFileSync(join(directory,'acceptance.json'),JSON.stringify(evidence,null,2));
console.log('PASS integrated tool lifecycle. Evidence: '+join(directory,'acceptance.json'));
