// Standalone HTTP MCP acceptance; --real opts into Claude/Codex subscription adapters. No provider calls.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const journey=process.argv.includes('--journey'),adapterFlag=process.argv.indexOf('--adapter');
const adapters=adapterFlag<0?['claude','codex']:[process.argv[adapterFlag+1]];assert.ok(adapters.every(a=>['claude','codex'].includes(a)));
const real=process.argv.includes('--real'),contractAudit=process.argv.includes('--contract-audit'),contractGaps=[],sessions=new Map();
if(real)for(const key of Object.keys(process.env))if(!['PATH','HOME','LANG','TMPDIR'].includes(key))delete process.env[key];
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json');
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {serve}=require('@hono/node-server');
const {Server}=await import(require.resolve('@modelcontextprotocol/sdk/server/index.js'));
const {ListToolsRequestSchema,CallToolRequestSchema}=await import(require.resolve('@modelcontextprotocol/sdk/types.js'));
const {WebStandardStreamableHTTPServerTransport}=await import(require.resolve('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'));
const {Client}=await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const {StreamableHTTPClientTransport}=await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const {agent,methods}=await import(require.resolve('@agentclientprotocol/sdk/unstable'));
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals');
const {createMcpManager}=await load('mcp'),{classify,sessionToolMode}=await load('policy');
const {createRunner}=await load('runtimes/runner'),{createAcpRuntime}=await load('runtimes/acp'),{createMcpAccess}=await load('mcpserver');
const {createBot,createRoom,addMember,getBot,getRoom}=await load('rooms');
const {createPermissions}=await load('permissions');
const {createMcpInteractions}=await load('mcp/interactions'),{createGateway}=await load('gateway'),{createAuth}=await load('auth');
const parent=mkdtempSync(join(tmpdir(),'openag-remote-mcp-'));
const marker='REMOTE_FIXTURE_RETURNED',calls=[];
const tools=['SEARCH_CATALOG','Read.Items','WRITE_ITEM','UNKNOWN_QUERY','ERROR_QUERY','SLOW_QUERY','COMPOSIO_SEARCH_TOOLS','constructor','Read_Items',...contractAudit?['REVIEW_ACTION']:[]];
let duplicate=false;
const remote=serve({hostname:'127.0.0.1',port:0,fetch:async req=>{
 const existing=contractAudit?sessions.get(req.headers.get('mcp-session-id')):undefined;
 if(existing)return existing.transport.handleRequest(req);
 if(req.method!=='POST')return new Response('',{status:405});
 const server=new Server({name:'synthetic-remote',version:'1'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:(duplicate?[...tools,tools[0]]:tools).map(name=>({name,description:'Synthetic acceptance only; no external account or mailbox.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}}))}));
 server.setRequestHandler(CallToolRequestSchema,async({params})=>{
  assert.ok(tools.includes(params.name),'offered remote tool');calls.push(params.name);
  if(params.name==='REVIEW_ACTION'){
   try{const approval=await server.elicitInput({mode:'form',message:'Explicitly approve the synthetic contract query?',requestedSchema:{type:'object',properties:{allow:{type:'boolean'}},required:['allow']}});return {content:[{type:'text',text:JSON.stringify({marker,approval})}]};}
   catch(error){return {isError:true,content:[{type:'text',text:'Server approval requires MCP elicitation: '+error.message}]};}
  }
  if(params.name==='SLOW_QUERY')await new Promise(resolve=>setTimeout(resolve,1800));
  return {...(params.name==='ERROR_QUERY'?{isError:true}:{}),content:[{type:'text',text:JSON.stringify({successful:true,marker,tool:params.name})}]};
 });
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:contractAudit?()=>randomUUID():undefined,enableJsonResponse:true});
 await server.connect(transport);const response=await transport.handleRequest(req);if(contractAudit)sessions.set(transport.sessionId,{server,transport});return response;
}});
if(!remote.listening)await new Promise(resolve=>remote.once('listening',resolve));
const remoteUrl=`http://127.0.0.1:${remote.address().port}/mcp`;
const config=()=>({servers:[{id:'example',transport:'http',url:remoteUrl,allowPrivateNetwork:true,timeoutMs:1000,toolClasses:{'Read.Items':'read',ERROR_QUERY:'read'}}],toolClasses:{example:{SEARCH_CATALOG:'search'}}});
let groups=0;
try{
 // Manager interface verifies the owner-only map, original remote names, managed connections, and policy refresh.
 const dir=join(parent,'catalogue');openDb(dir).close();
 const path=join(dir,'mcp.json');writeFileSync(path,JSON.stringify(config()),{mode:0o600});
 const deskRequire=createRequire(root+'apps/desk/package.json');
 const {createServer}=await import(deskRequire.resolve('vite'));
 const vite=await createServer({root:root+'apps/desk',server:{middlewareMode:true,hmr:false},appType:'custom'});
 try{
  const {summarizeEvent}=await vite.ssrLoadModule('/src/ledger.ts');
  const event={type:'tool_result',payload:{executionOutcome:'unknown',invocationOutcome:'returned'}};
  assert.equal(summarizeEvent(event),'tool result: returned; effect unconfirmed');
  assert.equal(summarizeEvent({...event,payload:{executionOutcome:'unknown'}}),'tool result: outcome unknown');
 }finally{await vite.close();}
 let enabled=true;
 const managed={enabled:()=>enabled,connect:async()=>{const client=new Client({name:'managed-fixture',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(remoteUrl)));return {client,close:()=>client.close()};}};
 const manager=createMcpManager({dataDir:dir,composio:managed});
 try{
  await manager.load();
  assert.equal(classify('mcp.example.SEARCH_CATALOG'),'search','root owner classification applies');
  assert.equal(classify('mcp.example.Read_Items'),'read','entry classification uses original remote name');
  assert.equal(classify('mcp.composio-connect.COMPOSIO_SEARCH_TOOLS'),'search','reviewed managed discovery declaration');
  assert.equal(classify('mcp.example.COMPOSIO_SEARCH_TOOLS'),'act-external','same spelling on another connection grants no class');
  assert.equal(classify('mcp.example.constructor'),'act-external','prototype properties grant no class');
  assert.equal(classify('mcp.example.Read_Items_2'),'act-external','sanitized collision cannot borrow another raw name classification');
  assert.equal(classify('mcp.example.UNKNOWN_QUERY'),'act-external','annotations never classify an unknown query');
  assert.equal(classify('mcp.example.WRITE_ITEM'),'act-external');
  assert.equal(sessionToolMode('never',{approval:'review'}).mode,'deny','Never refuses explicit review');
  const override=config();override.toolClasses['composio-connect']={SEARCH_CATALOG:'search'};
  writeFileSync(path,JSON.stringify(override),{mode:0o600});await manager.reload();
  assert.equal(classify('mcp.composio-connect.SEARCH_CATALOG'),'search','owner classification reaches managed connection');
  enabled=false;await manager.reloadComposio();
  assert.equal(classify('mcp.composio-connect.SEARCH_CATALOG'),'act-external','disconnect clears stale classification');
  enabled=true;await manager.reloadComposio();assert.equal(classify('mcp.composio-connect.SEARCH_CATALOG'),'search','targeted reload publishes classification');
  const invalid=config();invalid.toolClasses.example.SEARCH_CATALOG='not-a-class';
  writeFileSync(path,JSON.stringify(invalid),{mode:0o600});await manager.reload();
  assert.equal(classify('mcp.example.SEARCH_CATALOG'),'act-external','invalid policy cannot retain a permissive class');
  duplicate=true;writeFileSync(path,JSON.stringify(config()),{mode:0o600});await manager.reload();
  assert.equal(manager.toolDefs().length,0,'duplicate raw names refuse offering and classification');
  duplicate=false;
  groups++;console.log('PASS remote catalogue/classification/reload');
 }finally{await manager.close();}
 // A large App-style result exercises the scoped MCP projection boundary, independently of remote result caps.
 const large={ok:false,status:'unknown',approvalId:'fixture-receipt',executionOutcome:'unknown',invocationOutcome:'returned',message:'This tool invocation returned; effect is unconfirmed. Do not repeat; inspect this receipt.',result:{untrusted:true,content:marker+'"\\'.repeat(50000)}};
 const largeAccess=createMcpAccess({runner:{activeTurn:()=>({toolCalls:0,callTool:async()=>large})},dataDir:dir,tools:()=>[{name:'fixture_large',class:'act-external',description:'Synthetic bounded uncertainty',input:require('zod').z.object({}),execute:async()=>{throw Error('not used');}}]});
 const largeBinding=largeAccess.issue('fixture','main');
 const largeReply=await largeAccess.handle(new Request('http://localhost/mcp',{method:'POST',headers:{authorization:'Bearer '+largeBinding.token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'fixture_large',arguments:{}}})}));
 const largeWire=(await largeReply.json()).result;
 assert.equal(largeWire.isError,true);assert.ok(largeWire.content[0].text.length<=50000,'ACP projection is bounded');
 const projected=JSON.parse(largeWire.content[0].text);assert.equal(projected.executionOutcome,'unknown');assert.equal(projected.invocationOutcome,'returned');assert.equal(projected.approvalId,'fixture-receipt');assert.equal(projected.result.untrusted,true);assert.equal(projected.result.truncated,true);assert.match(projected.message,/Do not repeat/);assert.ok(projected.result.excerpt.includes(marker));assert.ok(large.result.content.length>100000,'retained evidence is unchanged');
 largeAccess.revokeAll();groups++;console.log('PASS bounded valid ACP uncertainty envelope');
 const scenarios=[
  {remote:'SEARCH_CATALOG',local:'SEARCH_CATALOG',cls:'search'},
  {remote:'Read.Items',local:'Read_Items',cls:'read'},
  {remote:'WRITE_ITEM',local:'WRITE_ITEM',cls:'act-external',decision:'accept'},
  {remote:'UNKNOWN_QUERY',local:'UNKNOWN_QUERY',cls:'act-external',decision:'accept'},
  {remote:'WRITE_ITEM',local:'WRITE_ITEM',cls:'act-external',confined:true},
  ...contractAudit?[{remote:'REVIEW_ACTION',local:'REVIEW_ACTION',cls:'act-external',decision:'accept',elicitation:true}]:[],
  ...real?[]:[{remote:'ERROR_QUERY',local:'ERROR_QUERY',cls:'read',error:true},{remote:'SLOW_QUERY',local:'SLOW_QUERY',cls:'act-external',decision:'accept',timeout:true}],
 ];
 for(const adapter of adapters)for(const scenario of scenarios.filter(s=>!journey||s.remote==='UNKNOWN_QUERY')){
  const dataDir=join(parent,`${adapter}-${groups}`),db=openDb(dataDir),ledger=createLedger(db),approvals=createApprovals(db,ledger);
  writeFileSync(join(dataDir,'mcp.json'),JSON.stringify(config()),{mode:0o600});
  const interactions=createMcpInteractions(db,ledger);const mcp=createMcpManager({dataDir,interactions});let runner,acp,desk,unsubscribe,failure;
  const reviewed=[],requested=[],wire=[],before=calls.length,name=`mcp.example.${scenario.local}`;
  try{
   await mcp.load();assert.equal(classify(name),scenario.cls);
   createBot(db,{id:'bot',runtime:'acp',config:{adapter,instructions:'Local integration acceptance. Use only the requested synthetic daemon MCP tool exactly once. Discovery/loading it is allowed. Do not run commands, access files, use memory, contact external accounts, substitute tools, or retry. Report the returned marker. If the result says effect unconfirmed, include EFFECT_UNCONFIRMED and do not claim a completed write. If refused, report refusal.'}});
   createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
   const permissions=createPermissions(db,ledger,dataDir,approvals),initial=permissions.ensure('bot','main');permissions.select('bot','main',scenario.confined?'read-only':'full-access','controlled-owner',initial.revision);
   const offered=()=>mcp.toolDefs();
   const access=createMcpAccess({runner:{activeTurn:(...args)=>runner.activeTurn(...args)},dataDir,tools:offered});
   const owner='synthetic-contract-owner',auth=createAuth({db,ownerToken:owner}),app=createGateway({db,ledger,approvals,auth,dispatch:()=>{},mcpInteractions:interactions});
   desk=serve({hostname:'127.0.0.1',port:0,fetch:async req=>{if(new URL(req.url).pathname!=='/mcp')return app.fetch(req);const body=await req.clone().json().catch(()=>({}));const response=await access.handle(req);if(body.method==='tools/call')wire.push((await response.clone().json()).result);return response;}});
   if(!desk.listening)await new Promise(resolve=>desk.once('listening',resolve));
   acp=createAcpRuntime({dataDir,mcp:{access,baseUrl:()=>`http://127.0.0.1:${desk.address().port}`,tools:{has:n=>offered().some(d=>d.name===n),values:()=>offered().map(d=>d.name)}},launcher:real?undefined:({profile})=>{
    let endpoint;
    const fake=agent({name:'remote-fixture'})
     .onRequest(methods.agent.initialize,()=>({protocolVersion:1,agentCapabilities:{sessionCapabilities:{systemPrompt:{}}}}))
     .onRequest(methods.agent.session.new,({params})=>{endpoint=params.mcpServers[0];return {sessionId:'fixture',modes:{currentModeId:profile.safeMode,availableModes:[{id:profile.safeMode,name:'Ask'}]}};})
     .onRequest(methods.agent.session.setMode,()=>({}))
     .onRequest(methods.agent.session.prompt,async({params,client})=>{
      const toolCallId='remote-call',serverName=endpoint.name,title=adapter==='codex'?`mcp.${serverName}.${name}`:`mcp__${serverName}__${name.replace(/[^a-zA-Z0-9_-]/g,'_')}`;
      const notify=update=>client.notify(methods.client.session.update,{sessionId:params.sessionId,update});
      await notify({sessionUpdate:'tool_call',toolCallId,title,kind:'execute',status:'pending',rawInput:{server:serverName,tool:name,arguments:{}}});
      const toolCall=adapter==='codex'?{toolCallId,kind:'execute'}:{toolCallId,title,name:title,kind:'other',_meta:{claudeCode:{toolName:title,mcpServer:{name:serverName,source:'dynamic'}}}};
      const permission=await client.request(methods.client.session.requestPermission,{sessionId:params.sessionId,toolCall,options:[{optionId:'once',name:'Allow once',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]});
      assert.equal(permission.outcome.optionId,'once','forwarding itself does not create another approval');
      const clientMcp=new Client({name:'adapter-fixture',version:'1'});let result;
      try{await clientMcp.connect(new StreamableHTTPClientTransport(new URL(endpoint.url),{requestInit:{headers:Object.fromEntries(endpoint.headers.map(h=>[h.name,h.value]))}}));result=await clientMcp.callTool({name,arguments:{}});}finally{await clientMcp.close();}
      await notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(result)}});
      await notify({sessionUpdate:'tool_call_update',toolCallId,status:result.isError?'failed':'completed'});
      return {stopReason:'end_turn'};
     });return {target:fake,close(){}};
   }});
   runner=createRunner({db,ledger,approvals,dataDir,runtimes:{acp},tools:mcp.executors()});
   unsubscribe=ledger.subscribe('main',event=>{
    if(event.type==='mcp_interaction_updated'&&event.payload.status==='open'){
     queueMicrotask(async()=>{try{
      const base=`http://127.0.0.1:${desk.address().port}`,headers={authorization:'Bearer '+owner,'content-type':'application/json'};
      const response=await fetch(base+'/mcp/interactions/'+event.payload.interactionId,{headers});assert.equal(response.status,200);const {interaction}=await response.json();
      assert.equal(interaction.serverId,'example');assert.equal(interaction.toolName,'REVIEW_ACTION');assert.equal(scenario.elicitation,true,'no unrelated provider interaction is approved');
      const detail=base+'/mcp/interactions/'+interaction.id,path=detail+'/response';
      const limited=auth.createDevice('limited'),full=auth.createDevice('full','owner','full');
      assert.equal((await fetch(detail,{headers:{authorization:'Bearer '+limited.token}})).status,403);
      assert.equal((await fetch(detail,{headers:{authorization:'Bearer '+full.token}})).status,200);
      auth.revokeDevice(full.device.id);
      assert.equal((await fetch(path,{method:'POST',headers:{authorization:'Bearer '+full.token,'content-type':'application/json'},body:JSON.stringify({revision:interaction.revision,action:'accept',content:{allow:true}})})).status,401);
      for(const [payload,status] of [[{revision:randomUUID(),action:'accept',content:{allow:true}},409],[{revision:interaction.revision,action:'accept',content:{}},400]])assert.equal((await fetch(path,{method:'POST',headers,body:JSON.stringify(payload)})).status,status);
      const answer=await fetch(path,{method:'POST',headers,body:JSON.stringify({revision:interaction.revision,action:'accept',content:{allow:true}})});assert.equal(answer.status,200);reviewed.push(interaction.id);assert.equal((await fetch(path,{method:'POST',headers,body:JSON.stringify({revision:interaction.revision,action:'accept',content:{allow:true}})})).status,409);
     }catch(error){failure=error;runner.shutdown();}});return;
    }
    if(event.type!=='approval_requested')return;requested.push(event.payload);queueMicrotask(()=>{try{const p=approvals.get(event.payload.approvalId);if(p.toolName!==name){approvals.resolve(p.id,{kind:'ignore'},p.reviewVersion);throw Error('Unexpected tool proposal refused: '+p.toolName);}approvals.resolve(p.id,{kind:scenario.decision??'accept'},p.reviewVersion);}catch(error){failure=error;runner.shutdown();}});});
   const run=async()=>{let timeout;try{await Promise.race([runner.run(getRoom(db,'main'),getBot(db,'bot'),ledger.append('main','user','message',{text:`Call ${name} exactly once with {}. Discover it from the supplied openag MCP server if necessary. Return the marker, or report refusal. For unconfirmed effects include EFFECT_UNCONFIRMED. No other actions or retries.`})),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('remote acceptance deadline')),real?120000:15000);})]);}finally{clearTimeout(timeout);}};
   console.log(`starting ${real?'real':'controlled'} ${adapter}: ${scenario.remote} ${scenario.confined?'confined refusal':'Full access'}`);
   await run();if(failure)throw failure;
   const events=ledger.list('main',{limit:1000}),result=events.find(e=>e.type==='tool_result'&&e.payload.tool===name)?.payload;
   assert.ok(result,'canonical daemon result');assert.ok(!events.some(e=>e.type==='error'),'no runtime error');
   assert.equal(requested.length,0,'Full access has no fabricated human approval; confined opaque execution is refused');
   if(requested.length)assert.equal(requested[0].toolName,name,'exact approval identity');
   const ran=!scenario.confined;assert.deepEqual(calls.slice(before),ran?[scenario.remote]:[],'exactly one remote execution, original name');
   if(ran&&!scenario.timeout&&!scenario.error){
    assert.equal(result.invocationOutcome,'returned');assert.ok(result.result.untrusted);assert.ok(result.result.content.includes(marker));
    assert.equal(result.executionOutcome,'completed');assert.equal(result.effectVerification,'not-checked');assert.equal(approvals.receipts.get(result.receiptId).evidence.effectVerification,'not-checked');
    const reply=wire.find(r=>JSON.stringify(r).includes(marker));assert.ok(reply,'remote evidence reaches adapter over MCP');
    assert.ok(!reply.isError,'returned MCP success reaches either adapter as success');assert.equal(JSON.parse(reply.content[0].text).effectVerification,'not-checked');assert.match(JSON.parse(reply.content[0].text).notice,/Do not automatically repeat external actions/);
   }
   if(scenario.elicitation){
    assert.equal(reviewed.length,1,'one explicit user response completes server review');
    assert.equal(result.invocationOutcome,'returned');assert.equal(result.executionOutcome,'completed','provider invocation completed');assert.equal(result.effectVerification,'not-checked','consent is not effect verification');
    assert.ok(result.result.content.includes(marker));
   }
   if(scenario.error)assert.equal(result.executionOutcome,'failed','read error is not completed');
   if(scenario.timeout){assert.equal(result.executionOutcome,'unknown');assert.equal(result.invocationOutcome,undefined,'timeout does not claim a return');}
   if(requested.length){const receipt=approvals.receipts.get(requested[0].approvalId);assert.equal(receipt.outcome,!ran?'not-run':scenario.timeout?'unknown':scenario.error?'failed':'completed');}
   if(ran){assert.ok(result.receiptId);assert.equal(approvals.receipts.get(result.receiptId).approvalId,null);}
   assert.equal(approvals.listPending().length,0);
   if(ran&&!scenario.timeout&&!scenario.error&&scenario.cls==='act-external'){
    const session=JSON.parse(db.prepare('SELECT state_json FROM turns ORDER BY created_at DESC LIMIT 1').get().state_json).acpSessionId;
    const count=calls.length;await run();assert.equal(calls.length,count+1,'A new explicit request executes exactly once');
    const next=JSON.parse(db.prepare('SELECT state_json FROM turns ORDER BY created_at DESC LIMIT 1').get().state_json).acpSessionId;assert.equal(next,session,'Second call reuses the ACP session');
    const last=ledger.list('main',{limit:1000}).findLast(e=>e.type==='tool_result'&&e.payload.tool===name).payload;assert.equal(last.executionOutcome,'completed');assert.equal(last.effectVerification,'not-checked');
   }
   groups++;console.log(`PASS ${adapter} ${scenario.remote}`);
  }finally{unsubscribe?.();interactions.close();if(runner)await runner.shutdown();if(acp)await acp.close();if(runner)await runner.idle();if(desk){desk.closeAllConnections();await new Promise(resolve=>desk.close(resolve));}await mcp.close();db.close();}
 }
 const outputIndex=process.argv.indexOf('--report');if(outputIndex>=0)writeFileSync(process.argv[outputIndex+1],JSON.stringify({real,contractAudit,groups,contractGaps,liveProviderCalls:0},null,2),{mode:0o600});
 if(contractGaps.length)process.exitCode=1;
 console.log(`${contractGaps.length?'AUDIT':'PASS'} ${groups} ${real?'real-adapter':'controlled'} remote MCP groups; no Outlook/provider calls.`);
}finally{for(const {server} of sessions.values())await server.close().catch(()=>{});remote.closeAllConnections();await new Promise(resolve=>remote.close(resolve));rmSync(parent,{recursive:true,force:true});}
