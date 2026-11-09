// Standalone acceptance for OA-457: OAuth sign-in for custom remote MCP servers, against a controlled fake authorization server.
// Temporary data, loopback only, synthetic devices; real provider consent is manual and not covered here.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startOAuthFixture} from './mcp-oauth-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {openDb}=await load('db/index'),{createAuth}=await load('auth'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals');
const {createGateway}=await load('gateway'),{createMcpManager}=await load('mcp'),{createMcpServerService}=await load('mcp-servers'),{createMcpSecrets}=await load('mcp-secrets'),{createMcpOAuth}=await load('mcp-oauth');
const dir=mkdtempSync(join(tmpdir(),'openag-mcp-oauth-')),db=openDb(dir),ledger=createLedger(db),approvals=createApprovals(db,ledger);
const OWNER='owner-token-oauth-synthetic-80808',PRESET_SECRET='preset-client-secret-DO-NOT-LEAK-27182818';
const auth=createAuth({db,ownerToken:OWNER});
const fixture=await startOAuthFixture();
let clock=Date.now();
const CALLBACK='https://callback.example/composio-connect';
const prepared=[];let routeReceive=null,prepareWait=null;
const secrets=createMcpSecrets({dataDir:dir,env:{}});
const oauthRef={};
const manager=createMcpManager({dataDir:dir,env:{},secrets,oauth:{connect:(cfg,entry,signal)=>oauthRef.current.connect(cfg,entry,signal)}});
const entryOf=id=>{try{const found=manager.entries().servers.find(s=>s.id===id);return found&&found.origin==='custom'&&found.transport==='http'&&found.url&&found.oauth?{id,url:found.url,allowPrivateNetwork:found.allowPrivateNetwork===true,oauth:found.oauth}:undefined;}catch{return undefined;}};
const audit=[];
const oauth=createMcpOAuth({dataDir:dir,now:()=>clock,entry:entryOf,
 prepareSignIn:async(state,origin)=>{await prepareWait?.();prepared.push({state,origin});return {kind:routeReceive?'hosted':'direct',callback:CALLBACK,...(routeReceive?{receive:routeReceive}:{})};},
 onChange:id=>manager.applyServer(id),audit:(action,id)=>audit.push([action,id])});
oauthRef.current=oauth;
const service=createMcpServerService({dataDir:dir,mcp:manager,approvals,secrets,oauth});
const app=createGateway({db,auth,ledger,approvals,dataDir:dir,mcp:manager,mcpServers:service,mcpOAuth:oauth,dispatch(){}});
const limited=auth.createDevice('Phone','owner','limited').token;
const req=async(method,path,{token=OWNER,body,headers={}}={})=>{const res=await app.request(path,{method,headers:{authorization:`Bearer ${token}`,...headers,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await res.text();let json;try{json=text?JSON.parse(text):undefined;}catch{}return {status:res.status,json,text};};
const callback=async params=>{const res=await app.request('/composio-connect?'+new URLSearchParams(params),{headers:{}});return {status:res.status,text:await res.text()};};
const listing=async()=>(await req('GET','/mcp/servers')).json;
const digest=async()=>(await listing()).entries.digest;
const statusOf=async id=>(await listing()).servers.find(s=>s.id===id);
let groups=0;const group=name=>{groups++;console.log('PASS '+name);};
const until=async(read,predicate,what='deadline')=>{const end=Date.now()+10000;do{const value=await read();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);throw Error(what);};
const addServer=async(id,extra={})=>{const res=await req('POST','/mcp/servers',{body:{id,url:fixture.mcpUrl,allowPrivateNetwork:true,oauth:{scope:'items.read'},...extra,digest:await digest()}});assert.equal(res.status,201,res.text);return res;};
const start=async id=>{const res=await req('POST',`/mcp/servers/${id}/oauth/start`,{body:{}});return res;};
const signIn=async(id,{iss}={})=>{const started=await start(id);assert.equal(started.status,200,started.text);const params=await fixture.authorize(started.json.url);const result=await callback({...params,...(iss!==undefined?{iss}:{})});return {started:started.json,params,result};};
const callTool=async id=>{const out=await manager.executors()[`mcp.${id}.LOOKUP_ITEM`]({botId:'bot',dataDir:dir},{});return out;};
const sinkFiles=()=>[join(dir,'mcp.json'),join(dir,'connector-mcp-oauth.enc'),join(dir,'setup-audit.jsonl'),join(dir,'openag.db'),join(dir,'openag.db-wal')].filter(existsSync);
const leaks=value=>[...sinkFiles().map(f=>[f,readFileSync(f)]),['ledger',Buffer.from(JSON.stringify(ledger.list('_system',{limit:5000})))],['approvals',Buffer.from(JSON.stringify(approvals.listPending()))],['status',Buffer.from(JSON.stringify(manager.status()))],['entries',Buffer.from(JSON.stringify(manager.entries()))],['env',Buffer.from(JSON.stringify(process.env))]].filter(([,bytes])=>bytes.includes(value)).map(([name])=>name);
const latestToken=()=>fixture.stats.mcpCalls.at(-1)?.token;
const oauthFixtureLatest=()=>fixture.stats.authHeaders.filter(h=>/^Bearer at-/.test(h)).at(-1).slice('Bearer '.length);
let res;
try{
 await manager.load();
 // 1. Authority and preconditions.
 await addServer('alpha');await addServer('plain',{oauth:undefined});
 for(const [method,path,body] of [['GET','/mcp/servers/alpha/oauth'],['POST','/mcp/servers/alpha/oauth/start',{}],['POST','/mcp/servers/alpha/oauth/disconnect',{}],['PUT','/mcp/servers/alpha/oauth/client',{clientId:'x'}],['DELETE','/mcp/servers/alpha/oauth/client']])assert.equal((await req(method,path,{token:limited,body})).status,403,`limited ${method} ${path}`);
 assert.equal((await start('plain')).status,409,'a server without OAuth cannot sign in');assert.equal((await start('missing')).status,409);
 const first=await statusOf('alpha');assert.equal(first.state,'skipped');assert.equal(first.detail,'needs sign-in','before sign-in the server needs sign-in');assert.equal(fixture.stats.mcpCalls.length,0);
 assert.equal((await req('GET','/mcp/servers/alpha/oauth')).json.state,'needs_sign_in');
 group('authority and preconditions; unsigned server needs sign-in');

 // 2. What the wrapper refuses before anything is started.
 const refusedStart=async(knob,value,pattern)=>{fixture.knobs[knob]=value;const res=await start('alpha');fixture.knobs[knob]=knob==='advertiseIss'?true:false;assert.equal(res.status,400,knob+': '+res.text);assert.match(res.json.error,pattern,knob);};
 await refusedStart('missingS256',true,/PKCE/);
 await refusedStart('plainOnly',true,/PKCE/);
 await refusedStart('issuerMismatch',true,/issuer/);
 await refusedStart('noRegistration',true,/pre-registered client/);
 await refusedStart('resourceElsewhere',true,/different origin/);
 await refusedStart('linkLocalEndpoint',true,/authorization endpoint is not acceptable/);
 assert.equal(fixture.stats.registers.length,0,'nothing was registered with a server that was refused');assert.equal(prepared.length,0,'and no sign-in route was prepared');
 // The entry has not opted into private addresses: the guard refuses every OAuth request to a loopback server.
 await addServer('public',{allowPrivateNetwork:false,url:'https://public.example/mcp'});
 const blocked=await start('public');assert.equal(blocked.status,400);assert.match(blocked.json.error,/authorization server|discovered/);assert.equal(fixture.stats.registers.length,0);
 group('discovery refusals: no PKCE, issuer mismatch, no client, foreign resource, guarded fetch');

 // 3. Full flow with dynamic registration; nothing is stored in the clear.
 const flow=await signIn('alpha');
 assert.equal(flow.result.status,200,flow.result.text);
 assert.equal(fixture.stats.registers.length,1);const registered=fixture.stats.registers[0];assert.equal(registered.application_type,'web');assert.deepEqual(registered.redirect_uris,[CALLBACK]);assert.equal(registered.token_endpoint_auth_method,'none');
 assert.equal(fixture.stats.exchanges,1);
 await until(()=>statusOf('alpha'),s=>s.state==='connected','signed in and connected');
 const out=await callTool('alpha');assert.ok(out.untrusted&&out.content.includes('OAUTH_FIXTURE_RETURNED'));assert.match(fixture.stats.mcpCalls.at(-1).token,/^at-/);
 assert.match(fixture.stats.authHeaders.at(-1),/^Bearer at-/);
 const tokens=[latestToken(),flow.params.code,flow.started.attempt];
 for(const secret of tokens)assert.deepEqual(leaks(secret),[],'no copy of a token, code or state: '+secret.slice(0,8));
 assert.ok(!readFileSync(join(dir,'mcp.json'),'utf8').includes('client-'),'the registered client is not in mcp.json');
 assert.ok(readFileSync(join(dir,'connector-mcp-oauth.enc')).length>29);
 assert.equal((await req('GET','/mcp/servers/alpha/oauth')).json.state,'signed_in');assert.equal((await req('GET','/mcp/servers/alpha/oauth')).json.registration,'dcr');
 assert.ok(audit.some(([action,id])=>action==='mcp_oauth_signed_in'&&id==='alpha'));
 group('full flow with dynamic registration; no token, code or state stored in the clear');

 // 4. State rules: single use, unknown, expired, cancelled, another device, no caller-chosen address.
 assert.equal((await callback({...flow.params})).status,400,'a used state cannot be replayed');
 assert.equal((await callback({state:'x'.repeat(43),code:'c'})).status,400,'an unknown state');
 let started=(await start('alpha')).json;let params=await fixture.authorize(started.url);
 clock+=6*60_000;assert.equal((await callback(params)).status,400,'an expired state is refused');assert.equal((await req('POST','/mcp/servers/alpha/oauth/status',{body:{attempt:started.attempt}})).json.status,'cancelled');
 clock+=1;started=(await start('alpha')).json;params=await fixture.authorize(started.url);
 assert.equal((await req('POST','/mcp/servers/alpha/oauth/cancel',{body:{attempt:started.attempt}})).status,200);assert.equal((await callback(params)).status,400,'a cancelled attempt cannot be completed');
 const exchangesBefore=fixture.stats.exchanges;
 assert.equal((await req('POST','/mcp/servers/alpha/oauth/status',{token:limited,body:{attempt:started.attempt}})).status,403);
 assert.equal(fixture.stats.exchanges,exchangesBefore,'nothing was exchanged by any of these');
 const full2=auth.createDevice('Desk 2','owner','full').token;
 assert.equal((await req('POST','/mcp/servers/alpha/oauth/status',{token:full2,body:{attempt:started.attempt}})).status,404,'another Full device cannot read or finish this attempt');
 assert.equal((await req('POST','/mcp/servers/alpha/oauth/cancel',{token:full2,body:{attempt:started.attempt}})).status,404);
 group('state is single use, expiring and cancellable');

 // 5. RFC 9207: the issuer is checked before a code is spent.
 for(const [label,iss] of [['wrong issuer','https://evil.example'],['look-alike issuer',fixture.base+'.evil.example']]){
  const s=(await start('alpha')).json,p=await fixture.authorize(s.url),before=fixture.stats.exchanges;
  assert.equal((await callback({...p,iss})).status,400,label);assert.equal(fixture.stats.exchanges,before,label+': the code was not exchanged');
 }
 {const s=(await start('alpha')).json,p=await fixture.authorize(s.url),before=fixture.stats.exchanges;const {iss:_omitted,...noIss}=p;
  assert.equal((await callback(noIss)).status,400,'a missing iss is refused when the server advertises it');assert.equal(fixture.stats.exchanges,before);}
 fixture.knobs.advertiseIss=false;
 {const s=(await start('alpha')).json,p=await fixture.authorize(s.url);const {iss:_omitted,...noIss}=p;assert.equal((await callback(noIss)).status,200,'without the advertisement a missing iss is accepted');}
 fixture.knobs.advertiseIss=true;
 {const s=(await start('alpha')).json,p=await fixture.authorize(s.url),before=fixture.stats.exchanges;fixture.knobs.advertiseIss=false;assert.equal((await callback({...p,iss:'https://evil.example'})).status,400,'a present iss must still match');assert.equal(fixture.stats.exchanges,before);fixture.knobs.advertiseIss=true;}
 group('RFC 9207 issuer check happens before the code is exchanged');

 // 6. Nothing a request says can choose where the callback goes.
 const before6=fixture.stats.registers.length;
 {const res=await req('POST','/mcp/servers/alpha/oauth/start',{body:{origin:'https://evil.example'},headers:{host:'evil.example','x-forwarded-host':'evil.example','x-forwarded-proto':'https',origin:'https://evil.example'}});
  assert.equal(res.status,200,res.text);const authorizeUrl=new URL(res.json.url);assert.equal(authorizeUrl.searchParams.get('redirect_uri'),CALLBACK,'the callback is the managed route, whatever the headers say');
  assert.equal(prepared.at(-1).origin,'https://evil.example','the origin is passed to the route chooser only as a hint it validates itself');
  const back=await fixture.authorize(res.json.url);
  const cb=await app.request('/composio-connect?'+new URLSearchParams(back),{headers:{host:'evil.example','x-forwarded-host':'evil.example'}});assert.equal(cb.status,200);}
 assert.equal(fixture.stats.registers.length,before6,'the registered client was reused, never re-registered for another address');
 group('callback address is not influenced by Host, forwarded or Origin headers');

 // 7. Refresh: expiry causes exactly one rotation however many calls race.
 fixture.knobs.delayRefresh=150;clock+=3600_000;
 const refreshesBefore=fixture.stats.refreshes,reuseBefore=fixture.stats.refreshReuse;
 const results=await Promise.all(Array.from({length:6},()=>callTool('alpha')));
 for(const r of results)assert.ok(r.content.includes('OAUTH_FIXTURE_RETURNED'));
 assert.equal(fixture.stats.refreshes-refreshesBefore,1,'six racing calls caused one refresh');assert.equal(fixture.stats.refreshReuse,reuseBefore,'and no refresh token was spent twice');
 const rotated=latestToken();assert.deepEqual(leaks(rotated),[],'the rotated token is not in any sink');
 const again=await callTool('alpha');assert.ok(again.content.includes('OAUTH_FIXTURE_RETURNED'));assert.equal(fixture.stats.refreshes-refreshesBefore,1,'the next call reuses the new token');
 // Calls through the manager are serialised per server, so the race is also driven directly: two connections, one expired grant, every request at once.
 {const c1=await oauth.connect({headers:{}},entryOf('alpha')),c2=await oauth.connect({headers:{}},entryOf('alpha'));
  clock+=3600_000;const r0=fixture.stats.refreshes,u0=fixture.stats.refreshReuse;
  const lists=await Promise.all([c1.client.listTools(),c2.client.listTools(),c1.client.listTools(),c2.client.listTools(),c1.client.listTools()]);
  for(const l of lists)assert.equal(l.tools[0].name,'LOOKUP_ITEM');
  assert.equal(fixture.stats.refreshes-r0,1,'five concurrent requests on two clients caused one refresh');assert.equal(fixture.stats.refreshReuse,u0,'and no refresh token was spent twice');
  await c1.close();await c2.close();}
 fixture.knobs.delayRefresh=0;
 group('refresh is single-flight and rotates once');

 // 8. When sign-in is lost the server says so; the call that found out is not retried, nothing is replayed.
 clock+=3600_000;fixture.knobs.failRefresh='server_error';
 const callsBefore=fixture.stats.mcpCalls.length;
 await assert.rejects(()=>callTool('alpha'));
 assert.equal((await req('GET','/mcp/servers/alpha/oauth')).json.state,'signed_in','a server outage alone does not sign the owner out');assert.equal(fixture.stats.mcpCalls.length,callsBefore,'and the call never reached the server');
 fixture.knobs.failRefresh='invalid_grant';
 await assert.rejects(()=>callTool('alpha'));
 await until(()=>statusOf('alpha'),s=>s.state==='skipped'&&s.detail==='needs sign-in','needs sign-in after a rejected refresh');
 assert.equal(fixture.stats.mcpCalls.length,callsBefore,'no tool call was sent without a valid grant');assert.equal((await req('GET','/mcp/servers/alpha/oauth')).json.state,'needs_sign_in');
 fixture.knobs.failRefresh=null;
 const again8=await signIn('alpha');assert.equal(again8.result.status,200);await until(()=>statusOf('alpha'),s=>s.state==='connected');
 // A 401 in the middle of a session, and a 403 asking for more scope, are both "needs sign-in" and neither is retried.
 fixture.revokeAll();const c401=fixture.stats.mcpUnauth;
 await assert.rejects(()=>callTool('alpha'));assert.equal(fixture.stats.mcpUnauth-c401,1,'one unauthenticated request, never retried');
 await until(()=>statusOf('alpha'),s=>s.detail==='needs sign-in','401 needs sign-in');
 const again8b=await signIn('alpha');assert.equal(again8b.result.status,200);await until(()=>statusOf('alpha'),s=>s.state==='connected');
 fixture.knobs.forbidScope='items.write';const calls403=fixture.stats.mcpCalls.length;
 await assert.rejects(()=>callTool('alpha'));
 const status403=await req('GET','/mcp/servers/alpha/oauth');assert.equal(status403.json.state,'needs_sign_in');assert.equal(status403.json.needsScope,'items.write');assert.equal(fixture.stats.mcpCalls.length,calls403);
 fixture.knobs.forbidScope=null;
 const again8c=await signIn('alpha');assert.equal(again8c.result.status,200);await until(()=>statusOf('alpha'),s=>s.state==='connected');
 assert.equal((await statusOf('plain')).state,'down','a server without OAuth is untouched by anyone else signing in or out (it cannot connect without a bearer)');
 group('lost sign-in becomes needs sign-in; nothing is retried or replayed');

 // 9. Disconnect, moving the server and removing it leave nothing behind.
 const grant=latestToken();
 res=await req('POST','/mcp/servers/alpha/oauth/disconnect',{body:{}});assert.equal(res.status,200);assert.deepEqual(res.json,{disconnected:true,revoked:false},'revocation at the provider is never claimed');
 await until(()=>statusOf('alpha'),s=>s.detail==='needs sign-in');assert.equal((await req('GET','/mcp/servers/alpha/oauth')).json.issuer,null,'tokens and client info are gone');
 await signIn('alpha');await until(()=>statusOf('alpha'),s=>s.state==='connected');
 const otherFixture=await startOAuthFixture();
 res=await req('PATCH','/mcp/servers/alpha',{body:{url:otherFixture.mcpUrl,digest:await digest()}});assert.equal(res.status,200,res.text);
 assert.equal((await req('GET','/mcp/servers/alpha/oauth')).json.issuer,null,'moving the server to another origin drops its sign-in');assert.equal(otherFixture.stats.authHeaders.length,0,'the new host never received a token');
 res=await req('PATCH','/mcp/servers/alpha',{body:{url:fixture.mcpUrl,digest:await digest()}});assert.equal(res.status,200);
 await signIn('alpha');await until(()=>statusOf('alpha'),s=>s.state==='connected');
 // Repointing the file by hand cannot carry the grant to another host either: it is bound to the origin it was granted for.
 {const raw=JSON.parse(readFileSync(join(dir,'mcp.json'),'utf8'));raw.servers.find(e=>e.id==='alpha').url=otherFixture.mcpUrl;writeFileSync(join(dir,'mcp.json'),JSON.stringify(raw),{mode:0o600});await manager.reload();
  assert.equal((await statusOf('alpha')).detail,'needs sign-in');assert.equal(otherFixture.stats.authHeaders.length,0,'the grant was not sent to the hand-edited address');
  raw.servers.find(e=>e.id==='alpha').url=fixture.mcpUrl;writeFileSync(join(dir,'mcp.json'),JSON.stringify(raw),{mode:0o600});await manager.reload();await until(()=>statusOf('alpha'),s=>s.state==='connected','restoring the address restores the grant');}
 res=await req('DELETE',`/mcp/servers/alpha?digest=${await digest()}`);assert.equal(res.status,200,res.text);
 await addServer('alpha');assert.equal((await statusOf('alpha')).detail,'needs sign-in','a reused id inherits nothing');
 await otherFixture.close();
 assert.deepEqual(leaks(grant),[],'no copy of the disconnected grant');
 group('disconnect, repointing and removal drop the sign-in');

 // 10. Registration order: an owner-entered client first, a metadata document when advertised, otherwise dynamic registration.
 const dcrBefore=fixture.stats.registers.length;
 res=await req('PUT','/mcp/servers/alpha/oauth/client',{body:{clientId:'preset-client-1',clientSecret:PRESET_SECRET}});assert.equal(res.status,200,res.text);assert.ok(!res.text.includes(PRESET_SECRET));
 assert.deepEqual(leaks(PRESET_SECRET),[],'the owner-entered secret is stored only encrypted');assert.equal((await req('GET','/mcp/servers/alpha/oauth')).json.hasOwnerClient,true);
 res=await req('PUT','/mcp/servers/alpha/oauth/client',{body:{clientId:'preset-client-1'}});assert.equal(res.status,200);fixture.knobs.expectedClientSecret=PRESET_SECRET;
 {const s=(await start('alpha')).json;assert.equal(new URL(s.url).searchParams.get('client_id'),'preset-client-1');const p=await fixture.authorize(s.url);assert.equal((await callback(p)).status,200);}
 assert.equal(fixture.stats.registers.length,dcrBefore,'a pre-registered client means no dynamic registration');assert.equal((await req('GET','/mcp/servers/alpha/oauth')).json.registration,'preregistered');
 res=await req('PUT','/mcp/servers/alpha/oauth/client',{body:{clientId:'preset-client-2'}});assert.equal(res.status,200);fixture.knobs.expectedClientSecret=null;
 {const s=(await start('alpha')).json,p=await fixture.authorize(s.url);assert.equal((await callback(p)).status,200,'changing client does not carry the previous secret');}
 delete fixture.knobs.expectedClientSecret;
 res=await req('DELETE','/mcp/servers/alpha/oauth/client');assert.equal(res.status,200);
 assert.equal((await req('GET','/mcp/servers/alpha/oauth')).json.issuer,null,'a grant that used the removed client is gone with it');
 res=await req('PATCH','/mcp/servers/alpha',{body:{oauth:{scope:'items.read',clientMetadataUrl:'https://client.example/metadata.json'},digest:await digest()}});assert.equal(res.status,200,res.text);
 {const s=(await start('alpha')).json;assert.notEqual(new URL(s.url).searchParams.get('client_id'),'https://client.example/metadata.json','a metadata document is used only when the server advertises support');}
 fixture.knobs.cimd=true;
 {const s=(await start('alpha')).json;assert.equal(new URL(s.url).searchParams.get('client_id'),'https://client.example/metadata.json');}
 fixture.knobs.cimd=false;
 res=await req('PATCH','/mcp/servers/alpha',{body:{oauth:{clientMetadataUrl:'http://client.example/metadata.json'},digest:await digest()}});assert.equal(res.status,400,'a metadata document must be https');
 res=await req('PATCH','/mcp/servers/alpha',{body:{oauth:null,digest:await digest()}});assert.equal(res.status,200);assert.equal((await start('alpha')).status,409,'turning OAuth off removes it');
 group('registration order: owner client, metadata document, dynamic registration');
 // 11. A hosted route: the desk polls and the daemon reads the callback from the mailbox, so no browser request ever reaches the daemon.
 {await addServer('hosted');let delivered=null;routeReceive=async()=>delivered;
  const s=(await start('hosted')).json;assert.equal(s.route,'hosted');const p=await fixture.authorize(s.url);
  assert.equal((await req('POST','/mcp/servers/hosted/oauth/status',{body:{attempt:s.attempt}})).json.status,'pending','nothing arrived yet');
  delivered={...p,iss:'https://evil.example'};assert.equal((await req('POST','/mcp/servers/hosted/oauth/status',{body:{attempt:s.attempt}})).json.status,'failed','a mailbox callback gets the same issuer check');
  const s2=(await start('hosted')).json,p2=await fixture.authorize(s2.url);delivered=p2;
  assert.equal((await req('POST','/mcp/servers/hosted/oauth/status',{body:{attempt:s2.attempt}})).json.status,'connected');routeReceive=null;
  await until(()=>statusOf('hosted'),x=>x.state==='connected');}
 group('a hosted route completes through the mailbox with the same checks');
 // 12. Failure behaviour: limits that belong to MCP traffic, a rejected refresh during a connect, a stale failure after a new sign-in, odd grants.
 await addServer('big');await signIn('big');await until(()=>statusOf('big'),s=>s.state==='connected');
 fixture.knobs.bigDescription=true;await manager.applyServer('big');await until(()=>statusOf('big'),s=>s.state==='connected','a 100 KB tool list still connects: MCP traffic is not held to the OAuth response limit');
 assert.ok(manager.status().find(s=>s.id==='big').toolCount>=1);fixture.knobs.bigDescription=false;await manager.applyServer('big');
 {clock+=3600_000;fixture.knobs.failRefresh='invalid_grant';const t=Date.now();await manager.applyServer('big');assert.ok(Date.now()-t<5000,'a rejected refresh during a connect does not stall the manager ('+(Date.now()-t)+' ms)');
  assert.equal((await statusOf('big')).detail,'needs sign-in');fixture.knobs.failRefresh=null;await signIn('big');await until(()=>statusOf('big'),s=>s.state==='connected');}
 {const old=oauthFixtureLatest();const c1=await oauth.connect({headers:{}},entryOf('big'));
  fixture.knobs.rejectTokens.add(old);fixture.knobs.mcpDelay=300;const inFlight=c1.client.listTools().catch(error=>error);await new Promise(resolve=>setTimeout(resolve,60));
  await signIn('big');await inFlight;fixture.knobs.mcpDelay=0;fixture.knobs.rejectTokens.clear();
  await until(()=>statusOf('big'),s=>s.state==='connected','the newer grant survived a late 401 for the older token');assert.equal((await req('GET','/mcp/servers/big/oauth')).json.state,'signed_in');
  const out=await manager.executors()['mcp.big.LOOKUP_ITEM']({botId:'bot',dataDir:dir},{});assert.ok(out.content.includes('OAUTH_FIXTURE_RETURNED'));await c1.close();}
 // Without advertised resource metadata no resource indicator is invented; a grant with no expiry and no refresh token keeps working.
 fixture.knobs.noPrm=true;await addServer('noprm');await signIn('noprm');await until(()=>statusOf('noprm'),s=>s.state==='connected','sign-in works when the server advertises no resource');fixture.knobs.noPrm=false;
 fixture.knobs.nonExpiring=true;await signIn('noprm');await until(()=>statusOf('noprm'),s=>s.state==='connected');fixture.knobs.nonExpiring=false;
 {clock+=10*365*24*3600_000;const r0=fixture.stats.refreshes;const out=await manager.executors()['mcp.noprm.LOOKUP_ITEM']({botId:'bot',dataDir:dir},{});assert.ok(out.content.includes('OAUTH_FIXTURE_RETURNED'));assert.equal(fixture.stats.refreshes,r0,'a non-expiring grant is never refreshed or dropped');}
 group('failure behaviour: MCP limits, rejected refresh during connect, stale failure, odd grants');
 let finishPreparing;prepareWait=()=>new Promise(resolve=>{finishPreparing=resolve;});const startingSignIn=start('noprm');await until(()=>finishPreparing,Boolean,'route preparation');await req('POST','/mcp/servers/noprm/oauth/disconnect',{body:{}});prepareWait=null;finishPreparing();const cancelledStart=await startingSignIn;assert.equal(cancelledStart.status,409);assert.equal(oauth.hasPendingState(prepared.at(-1).state),false,'Disconnect cancels a start before its flow exists');assert.equal((await req('GET','/mcp/servers/noprm/oauth')).json.state,'needs_sign_in');await signIn('noprm');group('disconnect cancels pending OAuth preparation');
 // Manager cancellation and shutdown stop an in-flight OAuth handshake, not just established connections.
 const entry=manager.entries().servers.find(server=>server.id==='noprm');fixture.knobs.mcpDelay=1500;const controller=new AbortController();const handshake=oauth.connect({headers:{}},entry,controller.signal);const cancelled=assert.rejects(handshake);await new Promise(resolve=>setTimeout(resolve,30));let stopped=Date.now();controller.abort();await cancelled;assert.ok(Date.now()-stopped<1000,'An aborted handshake must not wait for the remote response');
 const closingHandshake=oauth.connect({headers:{}},entry);const closedHandshake=assert.rejects(closingHandshake);await new Promise(resolve=>setTimeout(resolve,30));stopped=Date.now();await oauth.close();await closedHandshake;assert.ok(Date.now()-stopped<1000,'OAuth close drains and aborts pending handshakes');fixture.knobs.mcpDelay=0;group('pending OAuth handshake cancellation and shutdown ownership');
 console.log(`PASS ${groups} MCP OAuth groups; controlled fake authorization server only, real provider consent is manual.`);
}finally{await oauth.close();await manager.close();await fixture.close();db.close();rmSync(dir,{recursive:true,force:true});}
