// Controlled SDK/gateway acceptance. Temporary state, no provider registration or unit runner.
import assert from 'node:assert/strict';
import { hostedSignInRoute, createSignInRoutes, tailscaleSignInRoute } from '../apps/daemon/dist/signin-routes.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer as createHttpsServer } from 'node:https';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultRedactor } from '../apps/daemon/dist/redact.js';
import { createComposioConnect } from '../apps/daemon/dist/composio-connect.js';
import { openDb } from '../apps/daemon/dist/db/index.js';
import { createAuth } from '../apps/daemon/dist/auth.js';
import { createLedger } from '../apps/daemon/dist/ledger.js';
import { createApprovals } from '../apps/daemon/dist/approvals.js';
import { createGateway } from '../apps/daemon/dist/gateway.js';
import { getSetting, setSetting } from '../apps/daemon/dist/settings.js';
import { createBot, createRoom, addMember } from '../apps/daemon/dist/rooms.js';
import { attachStream } from '../apps/daemon/dist/gateway.js';
const require = createRequire(new URL('../apps/daemon/package.json', import.meta.url));
const { serve } = require('@hono/node-server');
const relayRequire = createRequire(new URL('../apps/signin-relay/package.json', import.meta.url));
const { Miniflare, convertV4MiniflareOptions } = relayRequire('miniflare');
const mf = new Miniflare(convertV4MiniflareOptions({ modules:true, scriptPath:new URL('../apps/signin-relay/dist/index.js',import.meta.url).pathname, compatibilityDate:'2026-11-02', compatibilityFlags:['nodejs_compat'], durableObjects:{SESSIONS:{className:'RelaySession',useSQLite:true}}, ratelimits:{REQUEST_LIMIT:{namespace_id:'1003',simple:{limit:600,period:60}},REQUEST_TOTAL_LIMIT:{namespace_id:'1004',simple:{limit:12000,period:60}},CREATE_LIMIT:{namespace_id:'1001',simple:{limit:10,period:60}},TOTAL_LIMIT:{namespace_id:'1002',simple:{limit:1000,period:60}}} }));
const dir = mkdtempSync(join(tmpdir(), 'oag-oneclick-'));
const db = openDb(dir), owner = 'controlled-owner-remote', apiOrigin = 'http://100.64.0.10:4747';
let clock = Date.now(), registrations = 0, exchanges = 0, rejectToken = false, holdToken, releaseToken;
let connector, http, https, detach, browser;
const codes = new Map(), secret = 'controlled-remote-provider-access';
const ledger = createLedger(db), approvals = createApprovals(db, ledger), auth = createAuth({ db, ownerToken: owner });
const full = auth.createDevice('Original desk', 'owner', 'full'), limited = auth.createDevice('Limited');
const fakeFetch = async (input, init = {}) => {
 const url = new URL(input); assert.equal(init.redirect, 'error');
 if (url.pathname.includes('oauth-protected-resource')) return Response.json({ resource: 'https://connect.composio.dev/mcp', authorization_servers: ['https://connect.composio.dev'] });
 if (url.pathname === '/.well-known/oauth-authorization-server') return Response.json({ issuer: 'https://connect.composio.dev', authorization_endpoint: 'https://connect.composio.dev/oauth/authorize', token_endpoint: 'https://login.composio.dev/oauth2/token', registration_endpoint: 'https://login.composio.dev/oauth2/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
 if (url.pathname === '/oauth2/register') { registrations++; return Response.json({ ...JSON.parse(init.body), client_id: 'controlled-client-' + registrations }, { status: 201 }); }
 if (url.pathname === '/oauth2/token') {
  exchanges++; const params = new URLSearchParams(init.body);
  assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), codes.get(params.get('code')));
  if (holdToken) await holdToken;
  if (rejectToken) return Response.json({ error: 'invalid_grant' }, { status: 400 });
  return Response.json({ access_token: secret, refresh_token: 'controlled-refresh', token_type: 'Bearer', expires_in: 3600 });
 }
 throw Error('Unexpected network access: ' + url.origin + url.pathname);
};
const req = (path, token = full.token, body, method) => app.request(apiOrigin + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
let sequence = 0;
function responseFor(started) {
 const url = new URL(started.url), state = url.searchParams.get('state'), code = 'controlled-code-' + (++sequence);
 codes.set(code, url.searchParams.get('code_challenge'));
 return '/composio-connect?' + new URLSearchParams({ state, code });
}
async function begin(origin = apiOrigin, token = full.token) {
 const response = await req('/connectors/composio/start', token, { origin }); assert.equal(response.status, 200);
 return responseFor(await response.json());
}
async function callback(path) {
 const response = await req(path, null); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
 return response;
}

const relayOrigin = 'https://relay.example';
let relayDown=false,tamperEnvelope=false;
const relayFetch = async (url, init) => { if(relayDown && new URL(url).pathname.startsWith('/sessions/') && !init?.method)return Response.json({error:'temporary'},{status:503}); const response=await mf.dispatchFetch(url.toString(),init);if(init?.method!== 'POST' && new URL(url).pathname.startsWith('/sessions/') && response.ok){const value=await response.clone().json();if(value.status==='received'){assert.ok(value.sealed,'Stored callback must be encrypted');assert.ok(!JSON.stringify(value).includes('controlled-code'));if(tamperEnvelope){value.sealed.ciphertext=(value.sealed.ciphertext[0]==='A'?'B':'A')+value.sealed.ciphertext.slice(1);return Response.json(value);}}}return response; };
let mode = 'hosted', serveConfig = {}, tailscaleCalls = [];
const tailRun = async args => {
 tailscaleCalls.push(args);
 if (args[0] === 'status') return JSON.stringify({BackendState:'Running',Self:{DNSName:'mini.example.ts.net.',TailscaleIPs:['100.64.0.10']}});
 if (args[1] === 'status') return JSON.stringify(serveConfig);
 assert.deepEqual(args, ['serve','--bg','--yes','--https=443','--set-path=/composio-connect','http://127.0.0.1:4747/composio-connect']);
 serveConfig.Web ??= {}; serveConfig.Web['mini.example.ts.net:443'] ??= {Handlers:{}};
 serveConfig.Web['mini.example.ts.net:443'].Handlers['/composio-connect'] = {Proxy:args.at(-1)};
 return '';
};
const hosted = hostedSignInRoute({base:relayOrigin,fetch:relayFetch});
const tail = tailscaleSignInRoute({localOrigin:()=> 'http://127.0.0.1:4747',run:tailRun});
connector = createComposioConnect({ dataDir:dir, env:{}, fetch:fakeFetch, now:()=>clock, prepareSignIn: state => mode === 'hosted' ? hosted(state) : tail() });
const app = createGateway({ db, auth, ledger, approvals, composio:connector, dispatch(){}, dataDir:dir });
async function start(token=full.token) { const r=await req('/connectors/composio/start',token,{origin:apiOrigin});assert.equal(r.status,200);return r.json(); }
async function poll(flow, token=full.token) { return req('/connectors/composio/status',token,{attempt:flow.attempt}); }
async function deliver(flow, error) {
 const path=responseFor(flow); const params=new URLSearchParams(path.split('?')[1]);
 if(error) { params.delete('code');params.set('error',error); }
 return mode === 'hosted' ? relayFetch(relayOrigin+'/composio-connect?'+params) : req('/composio-connect?'+params,null);
}
try {
 assert.equal(connector.status(apiOrigin).configured,true,'No desk/callback addresses required');
 assert.equal((await relayFetch(relayOrigin+'/sessions',{method:'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'198.51.100.99'},body:JSON.stringify({state:'r'.repeat(43),readHash:'a'.repeat(64),publicKey:'A'.repeat(87)})})).status,404,'Malformed curve points are refused before session creation');
 assert.equal((await req('/connectors/composio/start',limited.token,{origin:apiOrigin})).status,403);
 let flow = await start(); assert.equal(flow.route,'hosted'); assert.equal(flow.attempt.length,43);
 assert.equal((await (await poll(flow)).json()).status,'pending');
 assert.equal((await poll(flow,limited.token)).status,403);
 const other=auth.createDevice('Other Full','owner','full'); assert.equal((await poll(flow,other.token)).status,400);
 assert.equal((await relayFetch(relayOrigin+'/sessions/'+flow.attempt)).status,404,'State alone cannot read callback');
 const delivered=await deliver(flow); assert.equal(delivered.status,200); assert.equal(delivered.headers.get('referrer-policy'),'no-referrer');
 const html=await delivered.text(); assert.ok(!html.includes(flow.attempt));assert.ok(!html.includes('controlled-code'));assert.ok(!delivered.headers.get('location'),'Relay never redirects to a supplied desk');
 assert.equal((await deliver(flow)).status,404,'Relay callback is single-use');
 assert.equal((await (await poll(flow)).json()).status,'connected'); assert.equal(exchanges,1);
 assert.equal((await (await poll(flow)).json()).status,'connected'); assert.equal(exchanges,1,'Polling never replays token exchange');
 assert.equal((await req('/connectors/composio/cancel',full.token,{attempt:flow.attempt})).status,200);
 assert.equal((await (await poll(flow)).json()).status,'connected','Cleanup cannot overwrite a completed attempt');
 const saved=readFileSync(join(dir,'connector-composio.enc'));
 const malformed=await start(); const bad=responseFor(malformed);
 assert.equal((await relayFetch(relayOrigin+bad+'&state=duplicate')).status,404);
 assert.equal((await relayFetch(relayOrigin+bad+'&iss=https%3A%2F%2Fevil.invalid')).status,404);
 assert.equal((await relayFetch(relayOrigin+'/sessions/'+malformed.attempt,{headers:{authorization:'Bearer '+'z'.repeat(43)}})).status,404);
 assert.equal((await (await poll(malformed)).json()).status,'pending'); await req('/connectors/composio/cancel',full.token,{attempt:malformed.attempt});

 flow=await start();await deliver(flow,'access_denied');assert.equal((await (await poll(flow)).json()).status,'cancelled');assert.deepEqual(readFileSync(join(dir,'connector-composio.enc')),saved);
 flow=await start();await req('/connectors/composio/cancel',full.token,{attempt:flow.attempt});assert.equal((await (await poll(flow)).json()).status,'cancelled');
 flow=await start();clock+=300001; assert.equal((await (await poll(flow)).json()).status,'cancelled');
 const revoked=auth.createDevice('Revoked','owner','full');flow=await start(revoked.token);await deliver(flow);auth.revokeDevice(revoked.device.id);const before=exchanges;assert.equal((await poll(flow,revoked.token)).status,401);assert.equal(exchanges,before);assert.deepEqual(readFileSync(join(dir,'connector-composio.enc')),saved);
 const downgraded=auth.createDevice('Downgraded','owner','full');flow=await start(downgraded.token);await deliver(flow);
 holdToken=new Promise(resolve=>{releaseToken=resolve});const completing=poll(flow,downgraded.token);
 const exchangeDeadline=Date.now()+5000;while(exchanges===before){assert.ok(Date.now()<exchangeDeadline);await new Promise(r=>setTimeout(r,10));}
 auth.setDeviceAccess(downgraded.device.id,'limited');releaseToken();holdToken=undefined;await completing;
 assert.deepEqual(readFileSync(join(dir,'connector-composio.enc')),saved,'Downgrade during exchange cannot replace existing access');
 flow=await start();await deliver(flow);const beforeRetry=exchanges;relayDown=true;
 assert.equal((await (await poll(flow)).json()).status,'pending','Temporary relay failure preserves an unconsumed attempt');
 assert.equal(exchanges,beforeRetry);relayDown=false;const overlaps=await Promise.all([poll(flow),poll(flow)]);const outcomes=await Promise.all(overlaps.map(r=>r.json()));assert.ok(outcomes.every(v=>['pending','connected'].includes(v.status)),'Overlapping status reads cannot overwrite completion');assert.equal((await (await poll(flow)).json()).status,'connected');assert.equal(exchanges,beforeRetry+1);
 const beforeTamper=readFileSync(join(dir,'connector-composio.enc'));flow=await start();await deliver(flow);tamperEnvelope=true;assert.equal((await (await poll(flow)).json()).status,'failed');tamperEnvelope=false;assert.equal(exchanges,beforeRetry+1,'Bad ciphertext never reaches provider exchange');assert.deepEqual(readFileSync(join(dir,'connector-composio.enc')),beforeTamper);
 const explicit=createSignInRoutes({env:{},callbackOrigin:()=> 'https://saved.example',localOrigin:()=> 'http://127.0.0.1:4747',fetch:async()=>{throw Error('Saved callback must not use relay')}});
 const compatibility=createComposioConnect({dataDir:dir,env:{},fetch:fakeFetch,prepareSignIn:explicit,getSignIn:()=>({callbackOrigin:'https://saved.example',deskOrigins:[]})});
 const legacyAttempt=await compatibility.start(full.device.id,apiOrigin,()=>true);assert.equal(legacyAttempt.route,'direct');assert.equal(new URL(legacyAttempt.url).searchParams.get('redirect_uri'),'https://saved.example/composio-connect');await compatibility.close();
 await connector.close(); connector=createComposioConnect({dataDir:dir,env:{},fetch:fakeFetch,now:()=>clock,prepareSignIn:state=>mode==='hosted'?hosted(state):tail()});
 // Gateway holds its original connector; direct restarted public interface proves saved account reuse.
 assert.equal(connector.status(apiOrigin).state,'connected');
 mode='tailscale';serveConfig={Web:{'mini.example.ts.net:443':{Handlers:{'/other':{Proxy:'http://127.0.0.1:9999'}}}}};
 const privateFlow=await connector.start(full.device.id,apiOrigin,()=>true);assert.equal(privateFlow.route,'tailscale');
 assert.deepEqual(serveConfig.Web['mini.example.ts.net:443'].Handlers['/other'],{Proxy:'http://127.0.0.1:9999'});
 const privateCallback=responseFor(privateFlow);await connector.callback(Object.fromEntries(new URLSearchParams(privateCallback.split('?')[1])),()=>true);
 assert.equal((await connector.attempt(privateFlow.attempt,full.device.id,()=>true)).status,'connected');
 const writes=tailscaleCalls.filter(a=>a.includes('--bg')).length;await tail();assert.equal(tailscaleCalls.filter(a=>a.includes('--bg')).length,writes,'Matching private path reused without configuration write');
 serveConfig.AllowFunnel={'mini.example.ts.net:443':true};await assert.rejects(tail,/conflicts/);delete serveConfig.AllowFunnel;
 serveConfig.Web['mini.example.ts.net:443'].Handlers['/composio-connect']={Proxy:'http://127.0.0.1:9999'};await assert.rejects(tail,/conflicts/);
 serveConfig={};const auto=createSignInRoutes({env:{OPENAG_SIGNIN_RELAY_URL:relayOrigin},localOrigin:()=> 'http://127.0.0.1:4747',fetch:async()=>{throw Error('Unavailable')},run:tailRun});
 assert.equal((await auto('x'.repeat(43))).kind,'tailscale','Hosted outage falls back before consent');
 const forced=createSignInRoutes({env:{OPENAG_SIGNIN_ROUTE:'tailscale'},localOrigin:()=> 'http://127.0.0.1:4747',fetch:async()=>{throw Error('Hosted must not run')},run:tailRun});
 assert.equal((await forced('x'.repeat(43),'https://cloud.example')).kind,'tailscale','Explicit private mode keeps the operator choice');
 let prepared,releasePreparation;const preparing=new Promise(r=>{releasePreparation=r});
 const cancelledDuringSetup=createComposioConnect({dataDir:dir,env:{},fetch:fakeFetch,prepareSignIn:async()=>{await preparing;return{kind:'hosted',callback:relayOrigin+'/composio-connect',close:async()=>{prepared='closed'}}}});
 const starting=cancelledDuringSetup.start('preparing-device',apiOrigin,()=>true);cancelledDuringSetup.revokeDevice('preparing-device');releasePreparation();await assert.rejects(starting);assert.equal(prepared,'closed');await cancelledDuringSetup.close();

 await assert.rejects(()=>auto('x'.repeat(43),'https://cloud.example'),/unavailable/);
 await assert.rejects(createSignInRoutes({env:{OPENAG_SIGNIN_ROUTE:'hosted'},localOrigin:()=>undefined,fetch:async()=>{throw Error('No relay configured')}})('x'.repeat(43)),/not configured/);
 const noRelay=createSignInRoutes({env:{},localOrigin:()=> 'http://127.0.0.1:4747',fetch:async()=>{throw Error('No relay configured')},run:tailRun});assert.equal((await noRelay('x'.repeat(43))).kind,'tailscale','No relay by default');
 await assert.rejects(createSignInRoutes({env:{OPENAG_SIGNIN_ROUTE:'hosted',OPENAG_SIGNIN_RELAY_URL:relayOrigin},localOrigin:()=>undefined,fetch:async()=>{throw Error()}})('x'.repeat(43)),/Hosted/);
 assert.ok(!readFileSync(join(dir,'connector-composio.enc')).includes(Buffer.from(secret)));
 assert.ok(!JSON.stringify(ledger.list('_system')).includes(secret));
 if (process.argv.includes('--browser')) {
  const exec = promisify(execFile), session='oneclick-'+process.pid;
  browser=(...args)=>exec('agent-browser',['--session',session,'--ignore-https-errors','--args','--ignore-certificate-errors',...args],{timeout:15000}).then(r=>r.stdout.trim());
  const evaluate=async code=>JSON.parse(await browser('--json','eval',code)).data.result;
  const bot=createBot(db,{id:'bot',name:'Bot',runtime:'api',config:{}});const room=createRoom(db,{id:'main',leadBotId:bot.id});addMember(db,room.id,bot.id);
  let latest, privateTarget, fixtureCallback, popupHasNoToken=false;
  await connector.close();
  connector=createComposioConnect({dataDir:dir,env:{},fetch:fakeFetch,now:()=>Date.now(),prepareSignIn:async state=>mode==='hosted'?hosted(state):{kind:'tailscale',callback:privateTarget+'/composio-connect'}});
  const browserApp=createGateway({db,auth,ledger,approvals,composio:connector,dispatch(){},dataDir:dir});
  http=serve({fetch:async request=>{const result=await browserApp.fetch(request);if(new URL(request.url).pathname==='/connectors/composio/start'&&result.ok)latest=await result.clone().json();return result;},hostname:'127.0.0.1',port:0});await once(http,'listening');detach=attachStream(http,ledger,auth);
  const desk='http://127.0.0.1:'+http.address().port;
  await exec('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'tls-key'),'-out',join(dir,'tls-cert'),'-days','1','-subj','/CN=127.0.0.1']);
  https=serve({fetch:async request=>{
   const url=new URL(request.url);
   if(url.pathname==='/fixture-health') { popupHasNoToken=(await request.json()).empty;return new Response('ok'); }
   if(url.pathname==='/health')return new Response(`<script>fetch('/fixture-health',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({empty:localStorage.getItem('openag-token')===null})}).then(()=>location.replace(${JSON.stringify(fixtureCallback)}))</script>`,{headers:{'content-type':'text/html'}});
   return mode==='hosted'?mf.dispatchFetch(relayOrigin+url.pathname+url.search,{method:request.method}):browserApp.fetch(request);
  },hostname:'127.0.0.1',port:0,createServer:createHttpsServer,serverOptions:{key:readFileSync(join(dir,'tls-key')),cert:readFileSync(join(dir,'tls-cert'))}});await once(https,'listening');privateTarget='https://127.0.0.1:'+https.address().port;
  await browser('open',desk+'/#/app-library');

  await evaluate(`localStorage.setItem('openag-token',${JSON.stringify(full.token)});location.reload()`);
  const until=async fn=>{const deadline=Date.now()+10000;while(!await fn()){if(Date.now()>=deadline)throw Error('Browser acceptance deadline: '+await evaluate('document.body.textContent')); await new Promise(r=>setTimeout(r,100));}};
  await until(()=>evaluate(`Array.from(document.querySelectorAll('article')).some(a=>a.querySelector('h2')?.textContent==='Composio')`));
  await evaluate(`Array.from(document.querySelectorAll('article')).find(a=>a.querySelector('h2')?.textContent==='Composio').querySelector('button').click()`);
  for (const route of ['hosted','tailscale']) {
   mode=route;latest=undefined;
   assert.equal(await evaluate(`document.body.textContent.includes('Sign-in addresses')`),false);
   await until(()=>evaluate(`!!document.querySelector('[role=dialog] section[aria-label=\"Composio account access\"] button')`));
   await evaluate(`window.fixtureOpen ??= window.open.bind(window);window.open=function(...args){const w=window.fixtureOpen(...args);window.fixturePopup=w;return w&&{set opener(v){w.opener=v;},location:{replace(url){window.fixtureAuthorization=url;w.location.replace('about:blank');}},close(){w.close();}};}`);
   await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
   await evaluate(`document.querySelector('section[aria-label="Composio account access"] button').scrollIntoView({block:'center'})`);
   await browser('click','section[aria-label="Composio account access"] button:first-of-type');
   await until(async()=>!!latest);assert.equal(latest.route,route);
   const path=responseFor(latest);fixtureCallback=path;
   assert.equal(await evaluate('window.fixtureAuthorization'),latest.url);
   popupHasNoToken=false;await evaluate(`window.fixturePopup.location=${JSON.stringify(privateTarget+'/health')}`);await until(async()=>popupHasNoToken);


   await until(()=>evaluate(`document.body.textContent.includes('Composio connected.')`));
   assert.equal(await evaluate('location.origin'),desk);assert.equal(await evaluate(`localStorage.getItem('openag-token')`),full.token);
   const result=await (await browserApp.request('/connectors/composio',{headers:{authorization:'Bearer '+full.token}})).json();assert.equal(result.state,'connected');
   console.log('PASS actual Connect button: '+route+' callback on token-free HTTPS origin, popup completion, original HTTP desk session retained');
  }
 }
 let probe;
 for(let i=0;i<602;i++) { probe=await relayFetch(relayOrigin+'/composio-connect?state='+'q'.repeat(43)+'&code=probe',{headers:{'CF-Connecting-IP':'198.51.100.66'}}); if(i===300)assert.equal(probe.status,404,'Supported polling envelope is below the probe limit'); }
 assert.equal(probe.status,429,'Public callback probes are throttled before storage dispatch');
 console.log('PASS actual Worker + SDK + gateway: one-click hosted, mailbox isolation/replay, cancellation/expiry/restart, Full-device authority, migration, private Tailscale setup/reuse/conflicts and pre-consent fallback');
} finally { if(browser)await browser('close').catch(()=>{});detach?.();for(const server of [http,https])if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await connector?.close();await mf.dispose();db.close();rmSync(dir,{recursive:true,force:true}); }
