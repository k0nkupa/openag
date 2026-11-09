// Contract audit against actual SDK transports and daemon managers. Temporary data, synthetic tools only.
// Exit 1 means compatibility gaps remain; all independent probes still run and are recorded.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json');
const load=n=>import(root+'apps/daemon/dist/'+n+'.js');
const {serve}=require('@hono/node-server');
const {Server}=await import(require.resolve('@modelcontextprotocol/sdk/server/index.js'));
const {WebStandardStreamableHTTPServerTransport}=await import(require.resolve('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'));
const {ListToolsRequestSchema,CallToolRequestSchema,McpError,ErrorCode}=await import(require.resolve('@modelcontextprotocol/sdk/types.js'));
const {createMcpManager}=await load('mcp');
const {invokeMcp}=await load('mcp/client');
const {createComposioConnect}=await load('composio-connect');
const {resolveConnectorKey}=await load('connector-key'),{connectorCredentialStore}=await load('connector-credentials');
const dir=mkdtempSync(join(tmpdir(),'openag-contract-')),sessions=new Map(),rows=[];
let state={callPosts:0,mode:'normal',generation:0,calls:0,pages:0,requests:[],cancelled:false,started:null};
const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
const result=(content='CONTRACT_MARKER')=>({content:[{type:'text',text:content}]});
function tool(name='QUERY',inputSchema={type:'object',properties:{},additionalProperties:false}){return {name,inputSchema};}
async function endpoint(req){
 if(req.method==='GET'||req.method==='DELETE'){
  const session=sessions.get(req.headers.get('mcp-session-id'));
  if(!session)return new Response(null,{status:405});
  const response=await session.transport.handleRequest(req);if(req.method==='GET')session.owner.sseReady?.();return response;
 }
 const body=await req.clone().json();state.requests.push(body.method);
 if(body.method==='tools/call'){
  state.callPosts++;
  if(state.mode.startsWith('http-'))return new Response('synthetic transport failure',{status:Number(state.mode.slice(5))});
  if(state.mode==='malformed-json')return new Response('invalid json',{headers:{'content-type':'application/json'}});
 }

 let session=sessions.get(req.headers.get('mcp-session-id'));
 if(!session){
  const server=new Server({name:'stateful-contract',version:'1'},{capabilities:{tools:{listChanged:true}}});
  server.setRequestHandler(ListToolsRequestSchema,async({params})=>{
   state.pages++;
   if(state.mode==='task-only')return {tools:[{...tool('REQUIRED_TASK'),execution:{taskSupport:'required'}}]};
   if(state.mode==='pagination')return {tools:[tool(params?.cursor?'SECOND':'FIRST')],...(!params?.cursor?{nextCursor:'page-two'}:{})};
   if(state.mode==='cursor-cycle')return {tools:[],nextCursor:'same-cursor'};
   return {tools:[tool(state.generation?'UPDATED':'QUERY',{type:'object',properties:{text:{type:'string'}},additionalProperties:false}),tool('VALIDATE',schema),tool('STRUCTURED'),tool('MIXED'),tool('ERROR'),tool('SLOW'),tool('REVIEW'),tool('ROOTS'),tool('SAMPLE'),{...tool('OUTPUT_SCHEMA'),outputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}]};
  });
  server.setRequestHandler(CallToolRequestSchema,async({params},extra)=>{
   state.calls++;state.started?.();
   if(state.mode==='delayed-json')await new Promise(resolve=>setTimeout(resolve,16000));
   if(params.name==='OUTPUT_SCHEMA')return {content:[{type:'text',text:'invalid structure'}],structuredContent:{value:123}};
   if(params.name==='STRUCTURED')return {content:[],structuredContent:{marker:'STRUCTURED_MARKER'}};
   if(params.name==='MIXED')return {content:[{type:'text',text:'text'},{type:'image',data:'AAAA',mimeType:'image/png'},{type:'resource_link',uri:'https://example.invalid/resource',name:'synthetic'}]};
   if(params.name==='ERROR')return {isError:true,content:[{type:'text',text:'PROVIDER_ERROR_BEGIN '+'.'.repeat(300)+' ERROR_DETAILS_TAIL'}],structuredContent:{code:'SYNTHETIC_REJECTION'}};
   if(params.name==='SLOW'){
    extra.signal.addEventListener('abort',()=>{state.cancelled=true;},{once:true});
    await new Promise(r=>setTimeout(r,state.mode==='timeout'?1400:150));return result('late');
   }
   if(params.name==='REVIEW'){
    try{const answer=await server.elicitInput({mode:'form',message:'Approve this synthetic query?',requestedSchema:{type:'object',properties:{allow:{type:'boolean'}},required:['allow']}});return result(JSON.stringify(answer));}
    catch(e){return {isError:true,...result('Elicitation required: '+e.message)};}
   }
   if(params.name==='ROOTS'||params.name==='SAMPLE'){
    try{await server.request(params.name==='ROOTS'?{method:'roots/list',params:{}}:{method:'sampling/createMessage',params:{messages:[],maxTokens:1}},require('zod').z.object({}).passthrough(),{timeout:500});return result('unexpected');}
    catch{return {isError:true,...result('Unsupported callback refused')};}
   }
   if(state.mode==='rpc-error')throw new McpError(ErrorCode.InvalidParams,'Synthetic invalid parameters');
   // Deliberately permissive remote executor: the host must enforce the advertised input schema.
   return result(JSON.stringify(params.arguments??{}));
  });
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),enableJsonResponse:true});
  await server.connect(transport);session={server,transport,owner:state,capabilities:body.params?.capabilities,version:body.params?.protocolVersion};
  let response=await transport.handleRequest(req);sessions.set(transport.sessionId,session);
  if(body.method==='initialize'&&state.mode.startsWith('protocol-')){const value=await response.json();value.result.protocolVersion=state.mode.slice(9);response=new Response(JSON.stringify(value),{status:response.status,headers:response.headers});}
  return response;
 }
 return session.transport.handleRequest(req);
}
const http=serve({hostname:'127.0.0.1',port:0,fetch:endpoint});if(!http.listening)await new Promise(r=>http.once('listening',r));
const url=`http://127.0.0.1:${http.address().port}/mcp`;
const managers=[],catalogueListeners=new WeakMap(),notificationReady=new WeakMap();let index=0;
async function manager(mode='normal',expectConnected=true){
 state={callPosts:0,mode,generation:0,calls:0,pages:0,requests:[],cancelled:false,started:null};
 const ready=new Promise(resolve=>{state.sseReady=resolve;});
 const path=join(dir,String(index++));mkdirSync(path,{mode:0o700});
 writeFileSync(join(path,'mcp.json'),JSON.stringify({servers:[{id:'contract',transport:'http',url,allowPrivateNetwork:true,timeoutMs:mode==='delayed-json'?30000:1000,toolClasses:{QUERY:'read',VALIDATE:'read',STRUCTURED:'read',MIXED:'read',ERROR:'read',SLOW:'read',REVIEW:'read',ROOTS:'read',SAMPLE:'read'}}]}),{mode:0o600});
 const listeners=new Set();const m=createMcpManager({dataDir:path,env:{},onChange:()=>{for(const listener of listeners)listener();}});catalogueListeners.set(m,listeners);notificationReady.set(m,ready);managers.push(m);await m.load();if(expectConnected)assert.equal(m.status()[0].state,'connected');return m;
}
function catalogueChanged(m,predicate){
 return new Promise((resolve,reject)=>{
  const listeners=catalogueListeners.get(m);
  const done=()=>{if(!predicate())return;clearTimeout(timer);listeners.delete(done);resolve();};
  const timer=setTimeout(()=>{listeners.delete(done);reject(Error('catalogue refresh deadline'));},5000);
  listeners.add(done);done();
 });
}
async function check(name,body,{required=true}={}){
 try{const observed=await body();rows.push({name,status:'pass',required,observed});console.log('PASS '+name);}
 catch(e){rows.push({name,status:required?'gap':'unsupported',required,detail:e.message});console.log((required?'GAP ':'UNSUPPORTED ')+name+': '+e.message);}
 finally{while(managers.length)await managers.pop().close();}
}
const execute=(m,name,args={},ctx={})=>m.executors()['mcp.contract.'+name]({botId:'fixture',dataDir:dir,...ctx},args);
try{
 await check('stateful HTTP initialize/version/session/tool invocation',async()=>{
  const m=await manager(),s=[...sessions.values()].at(-1);assert.ok(['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(s.version));
  const r=await execute(m,'QUERY',{text:'marker'});assert.equal(r.untrusted,true);assert.ok(r.content.includes('marker'));return {protocol:s.version,capabilities:s.capabilities};
 });
 for(const version of ['2025-11-25','2025-06-18','2025-03-26','2024-11-05','2024-10-07'])await check('negotiates supported protocol '+version,async()=>{const m=await manager('protocol-'+version);assert.equal((await execute(m,'QUERY')).untrusted,true);});
 await check('unsupported negotiated protocol fails closed',async()=>{const m=await manager('protocol-2099-01-01',false);assert.equal(m.status()[0].state,'down');assert.equal(m.toolDefs().length,0);assert.equal(state.calls,0);});
 await check('paginated catalogue follows nextCursor',async()=>{const m=await manager('pagination');assert.deepEqual(m.toolDefs().map(t=>t.name),['mcp.contract.FIRST','mcp.contract.SECOND']);assert.equal(state.pages,2);});
 await check('cyclic pagination refuses an incomplete catalogue',async()=>{const m=await manager('cursor-cycle',false);assert.notEqual(m.status()[0].state,'connected','repeated empty cursor was silently accepted as a complete connected catalogue');});
 await check('all remote input schemas enforced before execution',async()=>{const m=await manager();await assert.rejects(()=>execute(m,'VALIDATE',{}),/argument|schema|text|required/i);assert.equal(state.calls,0);});
 await check('structured-only output survives projection',async()=>{const m=await manager();const r=await execute(m,'STRUCTURED');assert.ok(JSON.stringify(r).includes('STRUCTURED_MARKER'),'structuredContent was silently discarded');});
 await check('unsupported media is explicitly marked',async()=>{const m=await manager();const r=await execute(m,'MIXED');assert.match(r.content,/image content omitted/);assert.match(r.content,/resource_link content omitted/);return {limit:'remote media/resources are markers, not usable media'};});
 await check('tool errors retain bounded complete rejection evidence',async()=>{const m=await manager();const evidence=await execute(m,'ERROR');assert.equal(evidence.isError,true,'isError must not become success');assert.ok(JSON.stringify(evidence).includes('ERROR_DETAILS_TAIL'),'provider rejection detail must survive within the cap');assert.equal(evidence.structuredContent.code,'SYNTHETIC_REJECTION');});
 await check('JSON-RPC errors fail without automatic replay',async()=>{const m=await manager('rpc-error');await assert.rejects(()=>execute(m,'QUERY'),/Synthetic invalid parameters/);assert.equal(state.calls,1);});
 for(const status of [401,403,404,503])await check('HTTP '+status+' fails without replay or reconnect execution',async()=>{const m=await manager('http-'+status);await assert.rejects(()=>execute(m,'QUERY'));assert.equal(state.callPosts,1);assert.equal(state.calls,0);assert.equal(state.requests.filter(x=>x==='initialize').length,1);});
 await check('malformed JSON response fails without replay',async()=>{const m=await manager('malformed-json');await assert.rejects(()=>execute(m,'QUERY'));assert.equal(state.callPosts,1);});
 await check('advertised output schema rejects invalid structured output',async()=>{const m=await manager();await assert.rejects(()=>execute(m,'OUTPUT_SCHEMA'),/schema|structured|valid/i);assert.equal(state.calls,1);});
 await check('task-only tools are diagnosed before being offered as synchronous calls',async()=>{const m=await manager('task-only');assert.ok(!m.toolDefs().some(t=>t.name==='mcp.contract.REQUIRED_TASK'),'task-required tool is offered without a task execution path');assert.match(m.status()[0].unavailable[0].reason,/asynchronous MCP tasks/);});
 await check('concurrent calls remain independently correlated',async()=>{const m=await manager();const values=await Promise.all(['one','two','three'].map(text=>execute(m,'QUERY',{text})));assert.deepEqual(values.map(v=>JSON.parse(v.content).text),['one','two','three']);assert.equal(state.calls,3);});
 await check('caller cancellation reaches an in-flight remote call',async()=>{
  const m=await manager(),controller=new AbortController();let started;const ready=new Promise(r=>{started=r;});state.started=started;
  const pending=execute(m,'SLOW',{}, {signal:controller.signal});await ready;controller.abort();await pending.catch(()=>{});
  assert.equal(state.cancelled,true,'execution context AbortSignal was not propagated to the MCP request');
 });
 await check('queued caller cancellation settles before the preceding remote invocation',async()=>{
  const m=await manager(),controller=new AbortController();let started;const ready=new Promise(r=>{started=r;});state.started=started;
  const first=execute(m,'SLOW');await ready;
  const queued=execute(m,'QUERY',{}, {signal:controller.signal});const start=Date.now();controller.abort();
  await assert.rejects(()=>queued,/Cancelled before MCP dispatch/);assert.ok(Date.now()-start<100);
  await first;assert.equal(state.calls,1);
 });
 await check('timeout bounds waiting and never replays',async()=>{const m=await manager('timeout');const start=Date.now();await assert.rejects(()=>execute(m,'SLOW'),/timed out/);assert.ok(Date.now()-start<1800);assert.equal(state.calls,1);});
 await check('tools/list_changed refreshes or invalidates the catalogue',async()=>{
  const m=await manager(),s=[...sessions.values()].at(-1);let timer;try{await Promise.race([notificationReady.get(m),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('notification stream setup deadline')),5000);})]);}finally{clearTimeout(timer);}const changed=catalogueChanged(m,()=>m.toolDefs().some(t=>t.name==='mcp.contract.UPDATED'));state.generation=1;await s.server.sendToolListChanged();
  await changed;assert.ok(!m.toolDefs().some(t=>t.name==='mcp.contract.QUERY'),'removed tool remains offered after tools/list_changed');
 });
 await check('catalogue refresh preserves an already dispatched invocation and rejects stale executors',async()=>{
  const m=await manager(),old=m.executors()['mcp.contract.QUERY'],s=[...sessions.values()].at(-1);
  let started;const ready=new Promise(r=>{started=r;});state.started=started;
  const pending=execute(m,'SLOW');await ready;const changed=catalogueChanged(m,()=>m.toolDefs().some(t=>t.name==='mcp.contract.UPDATED'));state.generation=1;await s.server.sendToolListChanged();
  assert.equal((await pending).untrusted,true);
  await changed;
  await assert.rejects(()=>old({botId:'fixture',dataDir:dir},{}),/not enabled/);
  assert.equal(state.calls,1);assert.equal(state.requests.filter(v=>v==='initialize').length,1);
 });
 await check('explicit reload refreshes the catalogue',async()=>{const m=await manager();state.generation=1;await m.reload();assert.ok(m.toolDefs().some(t=>t.name==='mcp.contract.UPDATED'));assert.ok(!m.toolDefs().some(t=>t.name==='mcp.contract.QUERY'));});
 await check('disconnect disables stale executors',async()=>{const m=await manager(),exec=m.executors()['mcp.contract.QUERY'];await m.close();await assert.rejects(()=>exec({botId:'fixture',dataDir:dir},{}),/not enabled/);assert.equal(state.calls,0);});
 await check('generic client supports explicit user elicitation',async()=>{const m=await manager();const s=[...sessions.values()].at(-1);assert.ok(s.capabilities?.elicitation,'generic MCP client does not advertise/implement elicitation');});
 await check('generic delayed JSON reply honors configured invocation timeout',async()=>{
  const m=await manager('delayed-json');const before=Date.now();const reply=await execute(m,'QUERY');assert.equal(reply.untrusted,true);assert.ok(Date.now()-before>=16000);assert.equal(state.callPosts,1);
 });
 await check('managed client supports explicit user elicitation and delayed JSON replies',async()=>{
  state.mode='normal';
  const path=join(dir,'managed');mkdirSync(path,{mode:0o700});const key=resolveConnectorKey(path,'composio');
  connectorCredentialStore(path,key,'composio').write({client:{client_id:'fixture-client'},tokens:{access_token:'synthetic-access-only',token_type:'Bearer',expires_in:3600},expiresAt:Date.now()+3600000,needsAccess:false,redirectUri:'https://desk.example/composio-connect'});
  let advertised;
  const connection=createComposioConnect({dataDir:path,env:{OPENAG_PUBLIC_URL:'https://desk.example'},fetch:async(input,init)=>{
   assert.equal(new URL(input).href,'https://connect.composio.dev/mcp','no OAuth/provider operation is permitted');
   if(init.method==='POST'){const body=JSON.parse(init.body);if(body.method==='initialize')advertised=body.params.capabilities;}
   return endpoint(new Request(url,init));
  }});
  try{assert.equal(connection.enabled(),true);const handle=await connection.connect();try{assert.ok(advertised?.elicitation,'managed Composio client does not advertise/implement elicitation');
    let answers=0;const before=state.calls;
    const reply=await invokeMcp(handle.client,{serverId:'composio-connect',toolName:'REVIEW',context:{botId:'fixture',dataDir:path},valid:()=>true},{request:async(scope,params)=>{assert.equal(scope.serverId,'composio-connect');assert.equal(params.mode,'form');answers++;return {action:'accept',content:{allow:true}};}},{},1000);
    assert.equal(answers,1);assert.equal(state.calls,before+1);assert.match(reply.content[0].text,/accept/);
    state.mode='delayed-json';const delayed=await invokeMcp(handle.client,{serverId:'composio-connect',toolName:'QUERY',context:{botId:'fixture',dataDir:path},valid:()=>true},undefined,{},30000);assert.equal(delayed.isError,undefined);assert.equal(state.calls,before+2);}finally{await handle.close();}}finally{await connection.close();}
 });
 await check('unsupported roots requests fail closed without filesystem disclosure',async()=>{const m=await manager();const reply=await execute(m,'ROOTS');assert.equal(reply.isError,true);assert.match(reply.content,/Unsupported callback refused/);});
 await check('unsupported sampling requests fail closed without model use',async()=>{const m=await manager();const reply=await execute(m,'SAMPLE');assert.equal(reply.isError,true);assert.match(reply.content,/Unsupported callback refused/);});
 const report={source:process.env.OPENAG_AUDIT_REVISION??'working-tree',scope:'installed SDK 1.32.2 / protocol 2025-11-25; stateful loopback HTTP, synthetic tools, temporary state',rows,summary:{pass:rows.filter(r=>r.status==='pass').length,gaps:rows.filter(r=>r.status==='gap').length},liveProviderCalls:0};
 const reportIndex=process.argv.indexOf('--report');if(reportIndex>=0)writeFileSync(process.argv[reportIndex+1],JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify(report.summary));if(report.summary.gaps)process.exitCode=1;
}finally{while(managers.length)await managers.pop().close();for(const {server} of sessions.values())await server.close().catch(()=>{});http.closeAllConnections();await new Promise(r=>http.close(r));rmSync(dir,{recursive:true,force:true});}
