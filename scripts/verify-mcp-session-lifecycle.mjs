// Real SDK/HTTP integration: no provider, unit runner, credentials or external actions.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json');
const {serve}=require('@hono/node-server');
const {defaultConnector}=await import(root+'apps/daemon/dist/mcp.js');
const {invokeMcp}=await import(root+'apps/daemon/dist/mcp/client.js');
let capabilitiesAvailable=false,initializations=0,calls=0,prompts=0,duplicate=false,changed=false,rejectInitialize=false,stallInitialize=false;
const readTool={name:'READ_PROFILE',inputSchema:{type:'object'}};
const badOutput={name:'BAD_OUTPUT',inputSchema:{type:'object'},outputSchema:{type:'object',properties:{value:{type:'integer'}},required:['value']}};
const pending=new Map(),encoder=new TextEncoder();
const json=(id,result)=>Response.json({jsonrpc:'2.0',id,result});
const http=serve({hostname:'127.0.0.1',port:0,fetch:async req=>{
 if(req.method==='GET')return new Response(null,{status:405});
 const body=await req.json();
 if(body.method==='initialize'){if(stallInitialize)return new Response(new ReadableStream({start(c){c.enqueue(encoder.encode(': waiting\n\n'));}}),{headers:{'content-type':'text/event-stream'}});if(rejectInitialize)return new Response(null,{status:401});initializations++;capabilitiesAvailable=!!body.params.capabilities?.elicitation;return json(body.id,{protocolVersion:body.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'session-lifecycle',version:'1'}});}
 if(body.method==='tools/list')return json(body.id,body.params?.cursor?{tools:[{name:'TAIL',inputSchema:{type:'object'}}]}:{tools:[changed?{...readTool,execution:{taskSupport:'required'}}:readTool,badOutput,...duplicate?[readTool]:[]],nextCursor:'tail'});
 if(body.method==='tools/call'){
  calls++;
  if(body.params.name==='BAD_OUTPUT')return json(body.id,{content:[],structuredContent:{value:'invalid'}});
  if(!capabilitiesAvailable)return json(body.id,{isError:true,content:[{type:'text',text:'Client elicitation support is unavailable'}]});
  const callbackId=1000+calls;
  return new Response(new ReadableStream({start(controller){
   const send=value=>controller.enqueue(encoder.encode('data: '+JSON.stringify(value)+'\n\n'));
   pending.set(callbackId,result=>{send({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:JSON.stringify(result)}]}});controller.close();});
   send({jsonrpc:'2.0',id:callbackId,method:'elicitation/create',params:{mode:'form',message:'Allow this synthetic profile read?',requestedSchema:{type:'object',properties:{decision:{type:'string',enum:['allow_once','deny']}},required:['decision']}}});
  }}),{headers:{'content-type':'text/event-stream'}});
 }
 if(body.result&&pending.has(body.id)){pending.get(body.id)(body.result);pending.delete(body.id);}
 return new Response(null,{status:202});
}});if(!http.listening)await new Promise(r=>http.once('listening',r));
let connection;
try{
 connection=await defaultConnector({id:'fixture',transport:'http',url:`http://127.0.0.1:${http.address().port}`,args:[],env:{},headers:{},allowPrivateNetwork:true,timeoutMs:1000});
 const broker={request:async()=>{prompts++;return {action:'accept',content:{decision:'allow_once'}};}};
 const scope={serverId:'fixture',toolName:'READ_PROFILE',contract:readTool,context:{botId:'fixture',dataDir:'/unused'},valid:()=>true};
 const first=await invokeMcp(connection.client,scope,broker,{},1000);assert.ok(!first.isError);assert.equal(prompts,1);
 // A sessionless server may evict its cached handshake state while the local client remains open.
 capabilitiesAvailable=false;
 const second=await invokeMcp(connection.client,scope,broker,{},1000);assert.ok(!second.isError,'Reused stateless connection lost elicitation capability');assert.equal(prompts,2);assert.equal(calls,2);
 assert.ok(initializations>=2,'Fresh invocation must negotiate its own stateless callback context');
 console.log('PASS reused stateless HTTP connection retains explicit elicitation after handshake-state eviction');
 await assert.rejects(()=>invokeMcp(connection.client,{...scope,toolName:'BAD_OUTPUT',contract:badOutput},broker,{},1000),/schema|structured|validation/i);assert.equal(calls,3);
 console.log('PASS selected paginated tool retains SDK output validation without replay');
 for(const mode of ['duplicate','changed','handshake']){
  duplicate=mode==='duplicate';changed=mode==='changed';rejectInitialize=mode==='handshake';
  await assert.rejects(()=>invokeMcp(connection.client,scope,broker,{},1000),error=>error.outcome==='not-run');assert.equal(calls,3);
 }
 duplicate=false;changed=false;rejectInitialize=false;
 console.log('PASS changed/duplicate catalogue and failed negotiation are Not-run before dispatch');
 const stopped=new AbortController();let opened;const ready=new Promise(r=>opened=r),owners=[];
 const scopedBroker={request:async(current,params,signal)=>{owners.push(current.context.botId);if(current.context.botId==='first'){opened();return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({action:'cancel'}),{once:true}));}return {action:'accept',content:{decision:'allow_once'}};}};
 const interrupted=invokeMcp(connection.client,{...scope,context:{...scope.context,botId:'first',signal:stopped.signal}},scopedBroker,{},1000);const refused=assert.rejects(interrupted);
 await ready;const next=invokeMcp(connection.client,{...scope,context:{...scope.context,botId:'second'}},scopedBroker,{},1000);stopped.abort();await refused;assert.ok(!(await next).isError);assert.deepEqual(owners,['first','second']);assert.equal(calls,5);
 console.log('PASS cancellation followed by a queued bot keeps callback ownership separate');
 stallInitialize=true;const began=Date.now();let deadline;
 try{await assert.rejects(()=>Promise.race([invokeMcp(connection.client,scope,broker,{},1000),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Fresh handshake exceeded connection deadline')),19000);})]),error=>error.outcome==='not-run');assert.ok(Date.now()-began<18500);assert.equal(calls,5);console.log('PASS stalled handshake body stops before dispatch at the connection deadline');}finally{clearTimeout(deadline);}
}finally{await connection?.close();http.closeAllConnections();await new Promise(r=>http.close(r));}
