// Standalone DOM acceptance of real desk components. No browser, real account or unit runner.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const desk = fileURLToPath(new URL('../apps/desk/', import.meta.url));
const require = createRequire(desk + 'package.json');
const { JSDOM } = require('jsdom');
const returned = process.argv[2] === 'Return', callbackProvider = returned ? undefined : process.argv[2], cancelled = process.argv[3] === 'cancel';
const googleService=process.argv[3]==='drive'?'drive':'gmail';
const callbackPath = callbackProvider === 'Google' ? 'google-connect' : 'composio-connect';
const dom = new JSDOM('<div id="root"></div>', { url: returned ? `https://desk.example/?composioResult=${cancelled ? 'cancelled' : 'connected'}#/app-library` : callbackProvider ? `https://desk.example/${callbackPath}?state=controlled-state&${cancelled ? 'error=access_denied' : 'code=controlled-code'}` : 'https://desk.example/#/app-library', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'localStorage', 'getComputedStyle']) globalThis[name] = name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createServer } = await import(require.resolve('vite'));
const vite = await createServer({ configFile: false, root: desk, resolve: { alias: { '@': desk + 'src' } }, server: { middlewareMode: true }, appType: 'custom' });
const { fireEvent } = require('@testing-library/react');
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const root = createRoot(document.getElementById('root'));
if(callbackProvider==='Google'&&googleService==='drive')window.sessionStorage.setItem('openag-google-return-service','drive');
const { createApi } = await vite.ssrLoadModule('/src/api.ts');
let starts = 0, completions = 0, disconnected = 0, role = 'full';
let connected = returned && process.argv[3] === 'success', configured = true, callbackAction, savedAddresses;
let signIn = { callbackOrigin: 'https://callback.example', effectiveCallbackOrigin: 'https://callback.example', deskOrigins: [], callbackLocked: false };
const status = () => ({ signIn, configured, state: !configured ? 'setup' : connected ? 'connected' : 'needs_access', hasAccount: connected, reason: configured ? null : 'Configure sign-in on the daemon' });
globalThis.WebSocket = class { close() {} };
let statusCalls=0, transientStatus=false, stallStatus=false, statusStarted=false, aborts=0, attemptLifetime=300000;
let signInUrl = 'https://evil.invalid/sign-in', popupClosed = false, pendingSignIn = false;
window.open = () => ({ opener:null, location:{replace(url){assert.match(url,/^https:\/\/connect.composio.dev\/oauth\/authorize/);}}, close(){popupClosed=true;} });
const statusApi=createApi('controlled',()=>{},async(_url,init)=>{if(stallStatus){statusStarted=true;return new Promise((_resolve,reject)=>{init.signal?.addEventListener('abort',()=>{aborts++;reject(new DOMException('Cancelled','AbortError'));},{once:true});});}if(transientStatus){transientStatus=false;throw new TypeError('Temporary fixture network error');}if(!pendingSignIn)connected=true;return Response.json({status:pendingSignIn?'pending':'connected'});});
const api = {
 getAppLibrary: async () => ({ entries: [], counts: { installed: 0, ready: 0 } }),
 getComposio: async () => status(),
 putSetting: async (key, value) => { assert.equal(role, 'full'); assert.equal(key, 'connectorSignIn'); savedAddresses = value; signIn = { ...signIn, ...value, effectiveCallbackOrigin: value.callbackOrigin }; return { key, value }; },
 whoami: async () => ({ kind: 'device', access: role }),
 composioConnector: async (action, body, signal) => {
  if (action === 'start') { assert.equal(body.origin, window.location.origin); starts++; return { url: signInUrl, attempt:'x'.repeat(43), expiresAt:Date.now()+attemptLifetime }; }
  if (action === 'status') { statusCalls++;return statusApi.composioConnector('status',body,signal); }
  if (action === 'cancel') return {status:'cancelled'};
  if (action === 'complete') { completions++; callbackAction = { provider: 'Composio', body }; return { connected: true }; }
  disconnected++; connected = false; return { disconnected: true, revoked: false };
 },
 googleConnector: async (action, body) => { completions++; callbackAction = { provider: 'Google', body }; return { connected: true }; },
};
const button = text => [...(document.querySelector('[role=alertdialog]') ?? document).querySelectorAll('button')].find(b => b.textContent.trim() === text);
async function click(text) { assert.ok(button(text), text); assert.equal(button(text).disabled, false); await act(async () => button(text).click()); }
try {
 if (callbackProvider || returned) {
  api.getAppLibrary=async()=>{if(process.argv[3]==='unverified')return new Promise(()=>{});return {entries:[{id:callbackProvider==='Google'?'connector:'+googleService:'connector:composio',installed:!cancelled}]};};
  const {AppLibraryProvider}=await vite.ssrLoadModule('/src/app-library.tsx');const {StreamProvider}=await vite.ssrLoadModule('/src/stream.tsx');
  const { ConnectorConnectReturn } = await vite.ssrLoadModule('/src/components/ConnectorConnectReturn.tsx');
  assert.equal(window.location.search, ''); assert.equal(window.location.pathname, '/');if(callbackProvider)assert.equal(window.location.hash,callbackProvider==='Google'?'#/app-library/connector%3A'+googleService:'#/app-library/connector%3Acomposio');
  await act(async () => root.render(React.createElement(React.StrictMode,null,React.createElement(StreamProvider,{token:'controlled',onAuthFailure(){}},React.createElement(AppLibraryProvider,{api},React.createElement(ConnectorConnectReturn,{api}))))));
  assert.ok(document.body.textContent.includes((callbackProvider ?? 'Composio') + ' connection'));
  if (returned) {
   assert.equal(completions, 0, 'Return hints never exchange credentials');
   assert.ok(document.body.textContent.includes(cancelled ? 'cancelled' : connected ? 'account access is saved' : 'needs attention'));
  } else {
  assert.equal(completions, cancelled ? 0 : 1, 'StrictMode never exchanges the same code twice');
  if (!cancelled) assert.deepEqual(callbackAction, { provider: callbackProvider, body: { state: 'controlled-state', code: 'controlled-code' } });
  else assert.ok(document.body.textContent.includes('cancelled'));
  }
 await click('Return to connection');assert.equal(window.location.hash,`${cancelled||process.argv[3]==='unverified'?'#/app-library':'#/connectors'}/${callbackProvider==='Google'?'connector%3A'+googleService:'connector%3Acomposio'}`);
 } else {
  const { AppLibraryProvider } = await vite.ssrLoadModule('/src/app-library.tsx');
  const { StreamProvider } = await vite.ssrLoadModule('/src/stream.tsx');
  const { ComposioAccess } = await vite.ssrLoadModule('/src/components/ComposioAccess.tsx');
  const mount = async key => act(async () => root.render(React.createElement(StreamProvider, { token: "controlled-token", onAuthFailure() {} }, React.createElement(AppLibraryProvider, { api }, React.createElement(ComposioAccess, { api, key })))));
  await mount('initial'); assert.ok(button('Connect')); assert.ok(!document.body.textContent.includes('Composio connection')); assert.ok(!document.body.textContent.includes('OPENAG_CONNECTOR_KEY'));
  assert.equal(button('Sign-in addresses'), undefined, 'No address configuration in ordinary Connect');
  role = 'limited'; await mount('limited'); assert.equal(button('Sign-in addresses'), undefined); await click('Connect'); assert.equal(starts, 0); assert.ok(document.body.textContent.includes('Full access device'));
  role = 'full'; await click('Connect'); assert.equal(starts, 1); assert.ok(popupClosed); assert.ok(document.body.textContent.includes('sign-in link is invalid')); assert.equal(window.location.origin, 'https://desk.example');
  signInUrl='https://connect.composio.dev/oauth/authorize';popupClosed=false;transientStatus=true;await click('Connect');const deadline=Date.now()+5000;while(!popupClosed){assert.ok(Date.now()<deadline);await act(async()=>{await new Promise(r=>setTimeout(r,100));});}assert.equal(statusCalls,2,'Only status reads retry after a transient failure');assert.ok(popupClosed);assert.ok(document.body.textContent.includes('Composio connected'));
  connected = true; await mount('connected'); assert.ok(button('Reconnect')); assert.ok(!document.body.textContent.includes('Connected')); assert.ok(button('Disconnect').className.includes('border-destructive/40')); await click('Disconnect'); assert.ok(button('Keep connection')); await click('Keep connection'); assert.equal(disconnected, 0);
  await click('Disconnect'); await click('Disconnect'); assert.equal(disconnected, 1); assert.ok(document.body.textContent.includes('Provider revocation was not confirmed')); assert.ok(button('Connect'));
  stallStatus=true;popupClosed=false;statusStarted=false;await mount('cancel-stalled');await click('Connect');
  const waitUntil=async check=>{const deadline=Date.now()+3500;while(!check()){assert.ok(Date.now()<deadline,'Stalled sign-in must stop promptly');await act(async()=>{await new Promise(r=>setTimeout(r,20));});}};
  await waitUntil(()=>statusStarted);await click('Cancel sign-in');await waitUntil(()=>!button('Connect').disabled);assert.ok(popupClosed);assert.ok(aborts>=1,'Cancel reaches real createApi fetch signal');
  popupClosed=false;attemptLifetime=100;statusStarted=false;await mount('deadline-stalled');await click('Connect');await waitUntil(()=>popupClosed&&!button('Connect').disabled);assert.ok(aborts>=2,'Attempt deadline aborts a stalled real API read');assert.ok(document.body.textContent.includes('expired'));stallStatus=false;
  configured = false; await mount('setup');  assert.equal(button('Connect').disabled, true); assert.ok(document.body.textContent.includes('Configure sign-in'));
  configured = true; connected = true;
  const { Dialog } = await vite.ssrLoadModule('/src/components/ui/dialog.tsx');
  const { IntegrationDetails, IntegrationStatus } = await vite.ssrLoadModule('/src/components/IntegrationDetails.tsx');
  const entry={id:'connector:composio-connect',runtimeId:'composio-connect',kind:'connector',name:'Composio',brand:'composio',description:'Connect services for your agents.',category:'Productivity',installed:true,state:'ready',reason:'Composio tools are connected.',source:'Hosted MCP',version:'1.0.0',requirements:[],toolEvidence:'discovered',tools:[{name:'mcp.composio-connect.SEARCH',class:'search',description:'Untrusted controlled tool description'}]};
  await act(async()=>root.render(React.createElement(StreamProvider,{token:'controlled-token',onAuthFailure(){}},React.createElement(AppLibraryProvider,{api},React.createElement(Dialog,{open:true},React.createElement(IntegrationDetails,{api,entry,machine:'Preview Mac',inventoryError:false,managing:true}))))));
  assert.equal([...document.querySelectorAll('[data-slot=badge]')].filter(b=>b.textContent==='Connected').length,1,'One header status');
  assert.ok(!document.body.textContent.includes('Composio connection'));
  assert.ok(button('Reconnect').querySelector('svg[data-icon=inline-start]'));
  assert.ok(button('Disconnect').querySelector('svg[data-icon=inline-start]'));
  assert.ok(!button('Local setup'),'No setup tab without a recipe');
  await click('Disconnect');assert.ok(button('Keep connection'));
  await click('Keep connection');assert.equal(disconnected,1,'Cancelling native dialog never disconnects');
  await click('Tools (1)');assert.ok(button('mcp.composio-connect.SEARCHsearch'));
  assert.ok(!document.body.textContent.includes('Untrusted controlled tool description'),'Descriptions start collapsed');
  await click('mcp.composio-connect.SEARCHsearch');assert.ok(document.body.textContent.includes('Untrusted controlled tool description'));
  await click('Overview');assert.ok(button('Disconnect'),'Management controls remain after tab switches');assert.equal(disconnected,1,'Tab changes never disconnect');
  const {renderToStaticMarkup}=require('react-dom/server');
  for(const [patch,label,colour] of [[{state:'ready'},'Connected','text-[var(--online)]'],[{state:'ready',accessState:'needs_access'},'Needs access','text-[var(--needs-you)]'],[{state:'failed',verifiedAt:1},'Failed','text-destructive'],[{state:'paused'},'Paused','text-[var(--needs-you)]']]){
    const markup=renderToStaticMarkup(React.createElement(IntegrationStatus,{entry:{...entry,...patch}}));assert.ok(markup.includes(label));assert.ok(markup.includes(colour));
  }
  const {ConnectorAccess}=await vite.ssrLoadModule('/src/components/ConnectorAccess.tsx');
  let googleWrites=0,googleAccount={email:'fixture@example.invalid'};
  api.getConnectors=async()=>({apple:null,google:{configured:true,account:googleAccount,services:[{id:'gmail',enabled:true,state:'connected',verifiedAt:null}]}});
  api.googleConnector=async action=>{assert.equal(action,'disconnect');googleWrites++;googleAccount=null;return {revoked:true};};
  await act(async()=>root.render(React.createElement(StreamProvider,{token:'controlled-token',onAuthFailure(){}},React.createElement(AppLibraryProvider,{api},React.createElement(ConnectorAccess,{api,id:'gmail'})))));
  assert.ok(button('Reconnect').querySelector('svg'));assert.ok(button('Disconnect').className.includes('border-destructive/40'));
  await click('Disconnect');assert.equal(googleWrites,0);assert.ok(button('Disconnect both services'));
  await click('Keep connection');assert.equal(googleWrites,0);
  await click('Disconnect');await click('Disconnect both services');assert.equal(googleWrites,1);
  const {ApiError}=await vite.ssrLoadModule('/src/api.ts');api.getConnectors=async()=>{throw new ApiError('owner token required',403);};
  await act(async()=>root.render(React.createElement(StreamProvider,{token:'controlled-token',onAuthFailure(){}},React.createElement(AppLibraryProvider,{api},React.createElement(ConnectorAccess,{api,id:'apple-apps',key:'apple-limited'})))));assert.ok(document.body.textContent.includes('Full access required'));assert.equal(document.querySelector('[aria-label="Loading app permissions"]'),null,'Denied initial read must stop the loading state');


 }
} finally { await act(async () => root.unmount()); await vite.close(); dom.window.close(); }
if (!callbackProvider && !returned) {
 for (const provider of ['Composio', 'Google']) for (const mode of provider==='Google'?['success','cancel','drive']:['success','cancel']) execFileSync(process.execPath, [fileURLToPath(import.meta.url), provider, mode], { stdio: 'inherit', timeout: 20000 });
 for (const mode of ['success', 'cancel', 'unverified']) execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'Return', mode], { stdio: 'inherit', timeout: 20000 });
 console.log('PASS desk access/reconnect/disconnect, limited/setup handling, URL refusal, callback cleanup/cancellation and StrictMode single exchange for both providers. DOM only.');
}
