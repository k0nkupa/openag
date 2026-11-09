// OA-454 journey: a custom MCP server added through the real desk write API reaches a Claude or Codex bot over /mcp.
// Default run uses an in-process fake ACP agent (no provider calls); --real opts into the real Claude and Codex adapters
// (spends subscription turns). Per adapter: server check approval, add, turn 1, then a second turn in the SAME session on a long-named tool.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {startOAuthFixture} from './mcp-oauth-fixture.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const real=process.argv.includes('--real'),stdio=process.argv.includes('--stdio'),oauthMode=process.argv.includes('--oauth'),only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
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
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createMcpManager}=await load('mcp'),{createMcpServerService}=await load('mcp-servers'),{createMcpCommandReview}=await load('mcp-command-review'),{createMcpOAuth}=await load('mcp-oauth'),{createMcpSecrets}=await load('mcp-secrets'),{createMcpServerCheck}=await load('mcp-check'),{acpOfferedTools}=await load('mcp-forwarding');
const {createRunner}=await load('runtimes/runner'),{createAcpRuntime}=await load('runtimes/acp'),{createMcpAccess}=await load('mcpserver'),{createGateway}=await load('gateway');
const {createBot,createRoom,addMember,getBot,getRoom}=await load('rooms'),{createPermissions}=await load('permissions'),{classify}=await load('policy');
const sdkFile=name=>require.resolve('@modelcontextprotocol/sdk/'+name);
const parent=mkdtempSync(join(tmpdir(),'openag-custom-real-'));
const marker=oauthMode?'OAUTH_FIXTURE_RETURNED':'CUSTOM_FIXTURE_RETURNED',calls=[],seenAuth=[],FIXTURE_SECRET='fixture-bearer-secret-DO-NOT-LEAK-31415926';
const SHORT='LOOKUP_ITEM',LONG='LOOKUP_ITEM_WITH_A_DELIBERATELY_LONG_NAME_FOR_ADAPTER_NAMING_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const tools=[SHORT,LONG];
const remote=serve({hostname:'127.0.0.1',port:0,fetch:async req=>{
 if(req.method!=='POST')return new Response('',{status:405});
 seenAuth.push(req.headers.get('authorization'));
 const server=new Server({name:'synthetic-custom',version:'1'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:tools.map(name=>({name,description:'Synthetic acceptance only; no external account.',inputSchema:{type:'object',properties:{},additionalProperties:false}}))}));
 server.setRequestHandler(CallToolRequestSchema,async({params})=>{assert.ok(tools.includes(params.name));calls.push(params.name);return {content:[{type:'text',text:JSON.stringify({successful:true,marker,tool:params.name})}]};});
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 await server.connect(transport);return transport.handleRequest(req);
}});
if(!remote.listening)await new Promise(resolve=>remote.once('listening',resolve));
const remoteUrl=`http://127.0.0.1:${remote.address().port}/mcp`;
const sha=value=>createHash('sha256').update(value).digest('hex');
let stdioLog=null;
/** Original tool names the fixture served, in order: from the child's own log in stdio mode, from the HTTP fixture otherwise. */
let oauthFixture=null;
const callsNow=()=>oauthMode?(oauthFixture?oauthFixture.stats.mcpCalls.map(c=>c.name):[]):stdio?(stdioLog&&existsSync(stdioLog)?readFileSync(stdioLog,'utf8').split('\n').filter(Boolean).map(line=>line.split('\t')[0]):[]):calls;
const tokenHashes=()=>stdioLog&&existsSync(stdioLog)?readFileSync(stdioLog,'utf8').split('\n').filter(Boolean).map(line=>line.split('\t')[1]):[];
const OWNER='synthetic-custom-owner';let groups=0;
try{
 for(const adapter of ['claude','codex'].filter(a=>!only||a===only)){
  const dataDir=join(parent,adapter),db=openDb(dataDir),ledger=createLedger(db),approvals=createApprovals(db,ledger),auth=createAuth({db,ownerToken:OWNER});
  const secrets=createMcpSecrets({dataDir,env:{}}),oauthRef={},mcp=createMcpManager({dataDir,secrets,oauth:{connect:(cfg,entry,signal)=>oauthRef.current.connect(cfg,entry,signal)}});
  const oauth=createMcpOAuth({dataDir,entry:id=>{try{const found=mcp.entries().servers.find(s=>s.id===id);return found&&found.origin==='custom'&&found.transport==='http'&&found.url&&found.oauth?{id,url:found.url,allowPrivateNetwork:found.allowPrivateNetwork===true,oauth:found.oauth}:undefined;}catch{return undefined;}},prepareSignIn:async()=>({kind:'direct',callback:'https://callback.example/composio-connect'}),onChange:id=>mcp.applyServer(id)});oauthRef.current=oauth;
  const service=createMcpServerService({dataDir,mcp,approvals,secrets,oauth}),check=createMcpServerCheck({db,ledger,approvals,mcp});
  let runner,acp,desk,unsubscribe,failure,commandReview;const requested=[];
  const offered=()=>acpOfferedTools({mcp,firstPartyDefs:[],firstPartyAllowed:new Set(),appDefs:[]});
  try{
   await mcp.load();
   commandReview=createMcpCommandReview({db,ledger,approvals,mcp,service});
   const app=createGateway({db,auth,ledger,approvals,dataDir,mcp,mcpServers:service,mcpCheck:check,mcpCommandReview:commandReview,mcpOAuth:oauth,dispatch(){}});
   const api=async(method,path,body)=>{const res=await app.fetch(new Request('http://daemon.test'+path,{method,headers:{authorization:'Bearer '+OWNER,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));return {status:res.status,json:await res.json().catch(()=>({}))};};
   // 1. Owner write path: a reviewed command (stdio) or a server check then add (http).
   const calls0=callsNow().length;let res;
   if(oauthMode){
    oauthFixture=await startOAuthFixture();
    res=await api('POST','/mcp/servers',{id:'custom1',url:oauthFixture.mcpUrl,allowPrivateNetwork:true,oauth:{scope:'items.read'}});assert.equal(res.status,201,JSON.stringify(res.json));
    assert.equal(mcp.status().find(s=>s.id==='custom1').detail,'needs sign-in','nothing is sent before the owner signs in');assert.equal(oauthFixture.stats.mcpCalls.length+oauthFixture.stats.authHeaders.length,0);
    res=await api('POST','/mcp/servers/custom1/oauth/start',{});assert.equal(res.status,200,JSON.stringify(res.json));
    const params=await oauthFixture.authorize(res.json.url);
    const cb=await app.fetch(new Request('http://daemon.test/composio-connect?'+new URLSearchParams(params)));assert.equal(cb.status,200);
    for(let i=0;i<200&&mcp.status().find(s=>s.id==='custom1').state!=='connected';i++)await new Promise(r=>setTimeout(r,25));
    assert.equal(mcp.status().find(s=>s.id==='custom1').state,'connected','signed in; the server connected with the granted bearer');
   }else if(stdio){
    const script=join(parent,adapter+'-server.mjs');
    writeFileSync(script,`import {Server} from ${JSON.stringify(sdkFile('server/index.js'))};import {StdioServerTransport} from ${JSON.stringify(sdkFile('server/stdio.js'))};import {ListToolsRequestSchema,CallToolRequestSchema} from ${JSON.stringify(sdkFile('types.js'))};import {appendFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const tools=${JSON.stringify(tools)};const server=new Server({name:'synthetic-stdio',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:tools.map(name=>({name,description:'Synthetic acceptance only; no external account.',inputSchema:{type:'object',properties:{},additionalProperties:false}}))}));
server.setRequestHandler(CallToolRequestSchema,async({params})=>{appendFileSync('calls.log',params.name+'\\t'+createHash('sha256').update(process.env.FIXTURE_TOKEN??'').digest('hex')+'\\n');return {content:[{type:'text',text:JSON.stringify({successful:true,marker:${JSON.stringify(marker)},tool:params.name})}]};});
await server.connect(new StdioServerTransport());`);
    stdioLog=join(dataDir,'mcp-work','custom1','calls.log');
    res=await api('POST','/mcp/servers/command-review',{id:'custom1',command:process.execPath,args:[script],env:{FIXTURE_TOKEN:'${secret:FIXTURE}'}});assert.equal(res.status,202,JSON.stringify(res.json));
    assert.equal(mcp.status().length,0,'nothing is saved or started before the review is approved');assert.ok(!existsSync(join(dataDir,'mcp-work')),'no working directory before approval');
    approvals.resolve(res.json.approvalId,{kind:'accept'},approvals.get(res.json.approvalId).reviewVersion);
    let state;for(let i=0;i<200;i++){state=(await api('GET','/mcp/servers/command-review/'+res.json.approvalId)).json;if(state.state==='done')break;await new Promise(r=>setTimeout(r,25));}
    assert.equal(state.ok,true,JSON.stringify(state));
    assert.equal(mcp.status().find(s=>s.id==='custom1').state,'skipped','fails closed until the secret is stored');assert.match(mcp.status().find(s=>s.id==='custom1').detail,/missing secret FIXTURE/);
    const binding=(await api('GET','/mcp/servers')).json.entries.servers.find(e=>e.id==='custom1').review.binding;
    res=await api('PUT','/mcp/secrets/custom1/FIXTURE',{value:FIXTURE_SECRET,origin:'stdio:'+binding});assert.equal(res.status,200,JSON.stringify(res.json));
    assert.equal(mcp.status().find(s=>s.id==='custom1').state,'connected','the reviewed command started');
   }else{
   const candidate={url:remoteUrl,allowPrivateNetwork:true};
   res=await api('POST','/mcp/servers/check',candidate);assert.equal(res.status,202);
   assert.equal(callsNow().length,calls0,'nothing contacts the endpoint before the check is approved');
   approvals.resolve(res.json.approvalId,{kind:'accept'},approvals.get(res.json.approvalId).reviewVersion);
   let state;for(let i=0;i<200;i++){state=(await api('GET','/mcp/servers/check/'+res.json.approvalId)).json;if(state.state==='done')break;await new Promise(r=>setTimeout(r,25));}
   assert.equal(state.ok,true,JSON.stringify(state));assert.ok(state.tools.length>=2);assert.equal(mcp.status().length,0,'a check registers nothing');
   res=await api('POST','/mcp/servers',{id:'custom1',url:remoteUrl,allowPrivateNetwork:true,headers:{Authorization:'Bearer ${secret:FIXTURE}'}});assert.equal(res.status,201,JSON.stringify(res.json));
   assert.equal(mcp.status().find(s=>s.id==='custom1').state,'skipped','fails closed until the secret is stored');assert.match(mcp.status().find(s=>s.id==='custom1').detail,/missing secret FIXTURE/);
   res=await api('PUT','/mcp/secrets/custom1/FIXTURE',{value:FIXTURE_SECRET});assert.equal(res.status,200,JSON.stringify(res.json));
   assert.equal(mcp.status().find(s=>s.id==='custom1').state,'connected');assert.equal(seenAuth.at(-1),'Bearer '+FIXTURE_SECRET,'the fixture received the stored secret');
   }
   // The owner declares the long tool read-only in the file (desk entries cannot, by design) to verify that owner declarations survive custom-server forwarding.
   const cfgPath=join(dataDir,'mcp.json'),cfg=JSON.parse(readFileSync(cfgPath,'utf8'));cfg.toolClasses={...cfg.toolClasses,custom1:{[LONG]:'read'}};writeFileSync(cfgPath,JSON.stringify(cfg),{mode:0o600});
   assert.equal((await api('POST','/mcp/reload')).status,200);
   const local=offered().map(d=>d.name);assert.equal(local.length,2,'both tools forwarded because offerToAgents defaults on');
   const LOCAL_LONG=[...local].sort((a,b)=>b.length-a.length)[0],LOCAL_SHORT=local.find(n=>n!==LOCAL_LONG);assert.ok(LONG.startsWith(LOCAL_LONG.slice('mcp.custom1.'.length)));
   assert.ok(LOCAL_LONG.length>70,'the long name stays long: '+LOCAL_LONG.length);
   assert.equal(classify(LOCAL_SHORT),'act-external');assert.equal(classify(LOCAL_LONG),'read');
   groups++;console.log(`PASS ${adapter} owner write path (check, add, forward)`);
   // 2. Real or fake adapter turns through /mcp and the policy gate.
   createBot(db,{id:'bot',runtime:'acp',config:{adapter,instructions:'Local integration acceptance. Use only the requested synthetic daemon MCP tool exactly once. Discovery/loading it is allowed. Do not run commands, access files, use memory, contact external accounts, substitute tools, or retry. Report the returned marker. If the result says effect unconfirmed, include EFFECT_UNCONFIRMED. If refused, report refusal.'}});
   createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
   // An MCP operation cannot enforce a filesystem boundary, so it runs only in Full access (and then without a fabricated approval).
   const permissions=createPermissions(db,ledger,dataDir,approvals),setPermission=mode=>permissions.select('bot','main',mode,'controlled-owner',permissions.ensure('bot','main').revision);
   setPermission('read-only');
   const access=createMcpAccess({runner:{activeTurn:(...args)=>runner.activeTurn(...args)},dataDir,tools:offered});
   const wire=[];
   desk=serve({hostname:'127.0.0.1',port:0,fetch:async req=>{if(new URL(req.url).pathname!=='/mcp')return app.fetch(req);const body=await req.clone().json().catch(()=>({}));const response=await access.handle(req);if(body.method==='tools/call')wire.push((await response.clone().json()).result);return response;}});
   if(!desk.listening)await new Promise(resolve=>desk.once('listening',resolve));
   let sessionsStarted=0,afterFirstTurn=0;
   acp=createAcpRuntime({dataDir,mcp:{access,baseUrl:()=>`http://127.0.0.1:${desk.address().port}`,tools:{has:n=>offered().some(d=>d.name===n),values:()=>offered().map(d=>d.name)}},launcher:real?undefined:({profile})=>{
    let endpoint;
    const fake=agent({name:'custom-fixture'})
     .onRequest(methods.agent.initialize,()=>({protocolVersion:1,agentCapabilities:{sessionCapabilities:{systemPrompt:{}}}}))
     .onRequest(methods.agent.session.new,({params})=>{sessionsStarted++;endpoint=params.mcpServers[0];return {sessionId:'fixture',modes:{currentModeId:profile.safeMode,availableModes:[{id:profile.safeMode,name:'Ask'}]}};})
     .onRequest(methods.agent.session.setMode,()=>({}))
     .onRequest(methods.agent.session.prompt,async({params,client})=>{
      const text=JSON.stringify(params.prompt),name=/mcp\.custom1\.[A-Za-z0-9_]+/.exec(text)[0].slice('mcp.custom1.'.length);
      const full=`mcp.custom1.${name}`,toolCallId='call-'+name.length,title=adapter==='codex'?`mcp.${endpoint.name}.${full}`:`mcp__${endpoint.name}__${full.replace(/[^a-zA-Z0-9_-]/g,'_')}`;
      const notify=update=>client.notify(methods.client.session.update,{sessionId:params.sessionId,update});
      await notify({sessionUpdate:'tool_call',toolCallId,title,kind:'execute',status:'pending',rawInput:{server:endpoint.name,tool:full,arguments:{}}});
      const toolCall=adapter==='codex'?{toolCallId,kind:'execute'}:{toolCallId,title,name:title,kind:'other',_meta:{claudeCode:{toolName:title,mcpServer:{name:endpoint.name,source:'dynamic'}}}};
      const permission=await client.request(methods.client.session.requestPermission,{sessionId:params.sessionId,toolCall,options:[{optionId:'once',name:'Allow once',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]});
      if(permission.outcome.optionId!=='once'){await notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Refused: this operation requires Full access.'}});return {stopReason:'end_turn'};}
      const c=new Client({name:'adapter-fixture',version:'1'});let result;
      try{await c.connect(new StreamableHTTPClientTransport(new URL(endpoint.url),{requestInit:{headers:Object.fromEntries(endpoint.headers.map(h=>[h.name,h.value]))}}));result=await c.callTool({name:full,arguments:{}});}finally{await c.close();}
      await notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(result)}});
      await notify({sessionUpdate:'tool_call_update',toolCallId,status:result.isError?'failed':'completed'});
      return {stopReason:'end_turn'};
     });return {target:fake,close(){}};
   }});
   runner=createRunner({db,ledger,approvals,dataDir,runtimes:{acp},tools:mcp.executors()});
   unsubscribe=ledger.subscribe('main',event=>{if(event.type!=='approval_requested')return;requested.push(event.payload);queueMicrotask(()=>{try{const p=approvals.get(event.payload.approvalId);if(!p.toolName.startsWith('mcp.custom1.')){approvals.resolve(p.id,{kind:'ignore'},p.reviewVersion);throw Error('Unexpected proposal refused: '+p.toolName);}approvals.resolve(p.id,{kind:'accept'},p.reviewVersion);}catch(error){failure=error;runner.shutdown();}});});
   const turn=async name=>{let timeout;try{await Promise.race([runner.run(getRoom(db,'main'),getBot(db,'bot'),ledger.append('main','user','message',{text:`Call ${name} exactly once with {}. Discover it from the supplied openag MCP server if necessary. Return the marker, or report refusal. For unconfirmed effects include EFFECT_UNCONFIRMED. No other actions or retries.`})),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('acceptance deadline')),real?180000:15000);})]);}finally{clearTimeout(timeout);}if(failure)throw failure;};
   {const before=callsNow().length;console.log(`starting ${real?'real':'controlled'} ${adapter}: confined refusal`);await turn(LOCAL_SHORT);
    const denied=ledger.list('main',{limit:2000}).filter(e=>e.type==='tool_result'&&e.payload.tool===LOCAL_SHORT).at(-1)?.payload;
    assert.equal(denied?.status,'denied','a confined mode refuses the custom tool');assert.match(denied.message,/Full access/);assert.ok(!ledger.list('main',{limit:2000}).some(e=>e.type==='error'),'Confinement must not pass because of a runtime error');assert.equal(callsNow().length,before,'and nothing reached the server');groups++;console.log(`PASS ${adapter} confined mode refuses custom MCP tools`);}
   setPermission('full-access');
   for(const [index,[remoteName,name]] of [[SHORT,LOCAL_SHORT],[LONG,LOCAL_LONG]].entries()){
    const before=callsNow().length,approvalsBefore=requested.length;
    console.log(`starting ${real?'real':'controlled'} ${adapter}: turn ${index+1} ${remoteName.length>40?'(long name)':remoteName}`);
    await turn(name);
    const events=ledger.list('main',{limit:2000}),result=events.filter(e=>e.type==='tool_result'&&e.payload.tool===name).at(-1)?.payload;
    assert.ok(result,'canonical daemon result for '+name);assert.ok(!events.some(e=>e.type==='error'),'no runtime error');
    if(callsNow().length===before)console.log(JSON.stringify(events.slice(-8).map(e=>[e.type,e.payload])).slice(0,3500));
    assert.deepEqual(callsNow().slice(before),[remoteName],'exactly one remote execution under the original name');
    const gated=index===0;assert.equal(requested.length-approvalsBefore,0,'Full access creates no fabricated approval');
    assert.equal(result.invocationOutcome,'returned');assert.ok(result.result.untrusted&&result.result.content.includes(marker));assert.equal(result.executionOutcome,'completed','A clean MCP invocation return completes independently of its permission class');
    assert.ok(wire.some(r=>JSON.stringify(r).includes(marker)),'remote evidence reaches the adapter over /mcp');
    assert.ok(result.receiptId);if(gated){assert.equal(approvals.receipts.get(result.receiptId).outcome,'completed');assert.equal(approvals.receipts.get(result.receiptId).evidence.effectVerification,'not-checked');}assert.equal(approvals.listPending().length,0);
    if(index===0)afterFirstTurn=sessionsStarted;groups++;console.log(`PASS ${adapter} turn ${index+1}${index?' (second call, same session, long name, declared read)':''}`);
   }
   if(!real)assert.equal(sessionsStarted,afterFirstTurn,'the second call used the same ACP session as the first');
   if(oauthMode)assert.ok(oauthFixture.stats.authHeaders.length>=2&&oauthFixture.stats.authHeaders.every(h=>/^Bearer at-/.test(h))&&oauthFixture.stats.mcpUnauth===0,'every request, including the adapter-driven calls, carried the granted bearer and none went unauthenticated');
   else if(stdio)assert.ok(tokenHashes().length>=2&&tokenHashes().every(h=>h===sha(FIXTURE_SECRET)),'every call ran in a child holding the stored secret');
   else assert.ok(seenAuth.slice(-6).every(h=>h==='Bearer '+FIXTURE_SECRET),'every request, including the adapter-driven calls, carried the stored secret');
   const hidden=oauthMode?oauthFixture.stats.authHeaders.at(-1).slice('Bearer '.length):FIXTURE_SECRET;
   for(const file of ['mcp.json',oauthMode?'connector-mcp-oauth.enc':'connector-mcp.enc','setup-audit.jsonl','openag.db'])assert.ok(!readFileSync(join(dataDir,file)).includes(hidden),file+' holds no plaintext secret');
   assert.ok(!JSON.stringify(ledger.list('main',{limit:5000})).includes(hidden)&&!JSON.stringify(ledger.list('_system',{limit:5000})).includes(hidden),'the ledger holds no plaintext secret');
   // 3. Switching forwarding off removes the tool for the next session.
   res=await api('PATCH','/mcp/servers/custom1',{offerToAgents:false,digest:(await api('GET','/mcp/servers')).json.entries.digest});assert.equal(res.status,200,JSON.stringify(res.json));
   assert.deepEqual(offered().map(d=>d.name),[],'switch off stops offering it to bots');
   groups++;console.log(`PASS ${adapter} switch off`);
  }finally{unsubscribe?.();check.dispose();commandReview?.dispose();await oauth.close();if(oauthFixture){await oauthFixture.close();oauthFixture=null;}if(runner)await runner.shutdown();if(acp)await acp.close();if(runner)await runner.idle();if(desk){desk.closeAllConnections();await new Promise(resolve=>desk.close(resolve));}await mcp.close();db.close();}
 }
 console.log(`PASS ${groups} ${real?'real-adapter':'controlled'} custom MCP journey groups; no external provider calls.`);
}finally{remote.closeAllConnections();await new Promise(resolve=>remote.close(resolve));rmSync(parent,{recursive:true,force:true});}
