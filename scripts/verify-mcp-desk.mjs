// Standalone desk acceptance for managing custom MCP servers: real React components in jsdom against a real in-process gateway,
// manager, write service and check module. Temporary data, a fake connector and synthetic devices only; no browser, no unit runner.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {startOAuthFixture} from './mcp-oauth-fixture.mjs';
const base=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(base+'apps/desk/package.json');
const load=name=>import(base+'apps/daemon/dist/'+name+'.js');
const {openDb}=await load('db/index'),{createAuth}=await load('auth'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals');
const {createGateway}=await load('gateway'),{createMcpManager}=await load('mcp'),{createMcpServerService}=await load('mcp-servers'),{createMcpServerCheck}=await load('mcp-check'),{createMcpSecrets}=await load('mcp-secrets'),{createMcpCommandReview}=await load('mcp-command-review'),{createMcpOAuth}=await load('mcp-oauth');
const dir=mkdtempSync(join(tmpdir(),'openag-mcp-desk-')),db=openDb(dir),ledger=createLedger(db),approvals=createApprovals(db,ledger);
const OWNER='owner-token-desk-synthetic-4417',SECRET='linear-secret-value-DO-NOT-LEAK-7781',DESCRIPTION='<img src=x onerror=alert(1)> Search issues';
const auth=createAuth({db,ownerToken:OWNER}),limited=auth.createDevice('Phone','owner','limited').token;
const configPath=join(dir,'mcp.json'),resolvedHeaders=[];
const initial={servers:[
 {id:'apple-apps',transport:'stdio',command:'node',openagPackage:{id:'apple-apps',version:'1.0.0',digest:'a'.repeat(64)}},
 {id:'hand',transport:'http',url:'https://hand.example/mcp',headers:{Authorization:'Bearer ${GITHUB_TOKEN}'}},
 {id:'localtool',transport:'stdio',command:'node',args:['server.js']},
 {id:'plainhttp',transport:'http',url:'http://plain.example/mcp'},
]};
writeFileSync(configPath,JSON.stringify(initial,null,2)+'\n',{mode:0o600});
const secrets=createMcpSecrets({dataDir:dir,env:{}}),DESK_SECRET='desk-typed-secret-DO-NOT-LEAK-90210';
const oauthFixture=await startOAuthFixture(),oauthRef={},opened=[];
const manager=createMcpManager({dataDir:dir,env:{OPENAG_MCP_LINEAR:SECRET,GITHUB_TOKEN:'github-value-7781'},secrets,oauth:{connect:(cfg,entry)=>oauthRef.current.connect(cfg,entry)},onChange(){ledger.append('_system','daemon','config',{action:'mcp_status_changed'});},
 connector:async cfg=>{resolvedHeaders.push(cfg.headers);return {client:{getServerVersion:()=>({name:'S',version:'1'}),listTools:async()=>({tools:[{name:'SEARCH',description:DESCRIPTION,inputSchema:{type:'object',properties:{}}}]}),callTool:async()=>({content:[{type:'text',text:'ok'}]})},close:async()=>{}};}});
await manager.load();
const oauth=createMcpOAuth({dataDir:dir,entry:id=>{try{const found=manager.entries().servers.find(s=>s.id===id);return found&&found.origin==='custom'&&found.transport==='http'&&found.url&&found.oauth?{id,url:found.url,allowPrivateNetwork:found.allowPrivateNetwork===true,oauth:found.oauth}:undefined;}catch{return undefined;}},prepareSignIn:async()=>({kind:'direct',callback:'https://callback.example/composio-connect'}),onChange:id=>manager.applyServer(id)});oauthRef.current=oauth;
const service=createMcpServerService({dataDir:dir,mcp:manager,approvals,secrets,oauth}),check=createMcpServerCheck({db,ledger,approvals,mcp:manager}),commandReview=createMcpCommandReview({db,ledger,approvals,mcp:manager,service});
const app=createGateway({db,auth,ledger,approvals,dataDir:dir,mcp:manager,mcpServers:service,mcpCheck:check,mcpCommandReview:commandReview,mcpOAuth:oauth,dispatch(){}});

const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:'https://desk.example/#/settings/connectors',pretendToBeVisual:true});
dom.window.open=()=>({location:{replace:url=>opened.push(String(url))},close(){},opener:null});
for(const key of ['window','document','HTMLElement','Element','Node','DocumentFragment','MutationObserver','localStorage','sessionStorage'])globalThis[key]=dom.window[key];
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let socket;globalThis.WebSocket=class{constructor(){socket=this;}close(){}};
const off=ledger.subscribe('_system',event=>socket?.onmessage?.({data:JSON.stringify(event)}));
const {createServer}=await import(require.resolve('vite'));
const vite=await createServer({configFile:false,root:base+'apps/desk',resolve:{alias:{'@':base+'apps/desk/src'}},server:{middlewareMode:true,hmr:false},appType:'custom'});
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{fireEvent}=require('@testing-library/react');
const root=createRoot(document.getElementById('root'));
const {StreamProvider}=await vite.ssrLoadModule('/src/stream.tsx'),{AppLibraryProvider}=await vite.ssrLoadModule('/src/app-library.tsx'),{createApi}=await vite.ssrLoadModule('/src/api.ts');
const {InstalledConnections}=await vite.ssrLoadModule('/src/components/AppLibraryPage.tsx'),{hrefFor}=await vite.ssrLoadModule('/src/route.ts');
const gateway=(path,init)=>app.request(String(path),init);
const ownerApi=createApi(OWNER,()=>{},gateway),phoneApi=createApi(limited,()=>{},gateway);
const mount=async(api,token,integrationId)=>act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(StreamProvider,{token,onAuthFailure(){}},React.createElement(AppLibraryProvider,{api},React.createElement(InstalledConnections,{api,integrationId,key:`${token}-${integrationId??'list'}`}))))));
const wait=async(check,what='DOM/API convergence')=>{const end=Date.now()+8000;while(!check()){assert.ok(Date.now()<end,what);await act(async()=>new Promise(resolve=>setTimeout(resolve,25)));}};
const text=()=>document.body.textContent;
const button=label=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);
const click=async label=>{await wait(()=>button(label),`button "${label}"`);await act(async()=>{button(label).click();await new Promise(resolve=>setImmediate(resolve));});};
const fill=async(id,value)=>{await wait(()=>document.getElementById(id),`field #${id}`);await act(async()=>fireEvent.change(document.getElementById(id),{target:{value}}));};
const toggle=async id=>{await wait(()=>document.getElementById(id),`switch #${id}`);await act(async()=>{document.getElementById(id).click();await new Promise(resolve=>setImmediate(resolve));});};
const dialogs=()=>document.querySelectorAll('[role="dialog"]').length;
const leafText=value=>[...document.querySelectorAll('*')].some(el=>el.children.length===0&&el.textContent.trim()===value);
// Never assert on a DOM node directly: a failure would try to print the whole jsdom tree.
const none=(value,message)=>assert.ok(value==null,message);
let groups=0;const group=name=>{groups++;console.log('PASS '+name);};
const statusOf=id=>manager.status().find(server=>server.id===id);

try{
 // 1. A limited device sees no controls; the owner sees "Add MCP server". Origins are explained, nothing is editable that should not be.
 await mount(phoneApi,limited);await wait(()=>text().includes('added integrations'));
 none(button('Add MCP server'),'a limited device has no Add button');none(button('Add local command'),'and no local command button');
 await mount(phoneApi,limited,'mcp:hand');await wait(()=>text().includes('Server settings'));assert.match(text(),/Only the owner can change custom servers/);none(document.getElementById('mcp-offer-hand'),'and no switches');
 await mount(ownerApi,OWNER);await wait(()=>button('Add MCP server'));
 await mount(ownerApi,OWNER,'mcp:apple-apps');await wait(()=>text().includes('Server settings'));assert.match(text(),/Built in to OpenAg and managed by OpenAg/);none(document.getElementById('mcp-offer-apple-apps'),'a built-in server has no switches');
 await mount(ownerApi,OWNER,'mcp:localtool');await wait(()=>text().includes('Server settings'));assert.match(text(),/stays managed in mcp.json/);none(button('Edit'),'a command server cannot be edited from the desk');assert.equal(button('Remove'),undefined);
 await mount(ownerApi,OWNER,'mcp:plainhttp');await wait(()=>text().includes('Server settings'));await wait(()=>/Plain http is only allowed/.test(text()),'status hint');
 group('limited device, origins and status hint');

 // 2. Add: a refused reference keeps the draft and says why; a valid one is saved and appears.
 await mount(ownerApi,OWNER);await click('Add MCP server');
 await fill('mcp-server-id','linear');await fill('mcp-server-url','https://linear.example/mcp');
 await click('Add header');await wait(()=>document.querySelector('input[id^="mcp-header-name-"]'));
 const nameInput=document.querySelector('input[id^="mcp-header-name-"]'),valueInput=document.querySelector('input[id^="mcp-header-value-"]');
 await act(async()=>fireEvent.change(nameInput,{target:{value:'Authorization'}}));await act(async()=>fireEvent.change(valueInput,{target:{value:'Bearer ${GITHUB_TOKEN}'}}));
 await click('Add header');await wait(()=>document.querySelectorAll('input[id^="mcp-header-value-"]').length===2);
 await act(async()=>fireEvent.change(document.querySelectorAll('input[id^="mcp-header-value-"]')[1],{target:{value:'Bearer ${OPENAG_MCP_LINEAR}'}}));
 await click('Add server');await wait(()=>/Each header needs a name/.test(text()),'a header without a name is refused');assert.equal(statusOf('linear'),undefined,'nothing was saved');
 await click('Remove header row');await wait(()=>document.querySelectorAll('input[id^="mcp-header-value-"]').length===1);
 await click('Add server');await wait(()=>/can reference only OPENAG_MCP_ variables/.test(text()),'inline refusal');
 assert.match(text(),/instead of GITHUB_TOKEN/,'the refusal comes with a one-line hint');
 assert.ok(dialogs()>=1,'the dialog stays open');assert.ok(document.getElementById('mcp-server-id')?.value==='linear','the draft is kept');assert.equal(document.querySelector('input[id^="mcp-header-value-"]').value,'Bearer ${GITHUB_TOKEN}');
 assert.equal(statusOf('linear'),undefined,'nothing was saved');
 await act(async()=>fireEvent.change(document.querySelector('input[id^="mcp-header-value-"]'),{target:{value:'Bearer ${OPENAG_MCP_LINEAR}'}}));
 await click('Add server');await wait(()=>statusOf('linear')?.state==='connected','server added');
 await wait(()=>dialogs()===0,'dialog closes');await wait(()=>/linear added\./.test(text()),'success notice');
 assert.equal(statusOf('linear').offerToAgents,true,'offered to agents by default');
 assert.ok(JSON.parse(readFileSync(configPath,'utf8')).servers.some(entry=>entry.id==='linear'&&entry.headers.Authorization==='Bearer ${OPENAG_MCP_LINEAR}'),'saved as a reference, not a value');
 await mount(ownerApi,OWNER);await wait(()=>leafText('Custom MCP server'),'the card says it is a custom server');
 group('add keeps the draft on refusal and saves a reference');

 // 3. Server check: nothing is contacted until the approval is accepted; results are plain text.
 const contactsBefore=resolvedHeaders.length;
 await click('Add MCP server');await fill('mcp-server-id','cand');await fill('mcp-server-url','https://cand.example/mcp');
 await click('Add header');await wait(()=>document.querySelector('input[id^="mcp-header-name-"]'));
 await act(async()=>fireEvent.change(document.querySelector('input[id^="mcp-header-name-"]'),{target:{value:'Authorization'}}));await act(async()=>fireEvent.change(document.querySelector('input[id^="mcp-header-value-"]'),{target:{value:'Bearer ${OPENAG_MCP_LINEAR}'}}));
 await click('Check server');await wait(()=>/You asked OpenAg to check an MCP server/.test(text()),'approval shown inline');
 assert.match(text(),/https:\/\/cand\.example\/mcp/);assert.match(text(),/Authorization/);assert.ok(!text().includes(SECRET),'the proposal never shows a value');assert.equal(resolvedHeaders.length,contactsBefore,'nothing is contacted before the approval is accepted');
 none(button('Respond'),'a server check has no Respond');none(button('Edit'),'and no Edit');
 await click('Cancel check');await wait(()=>/was cancelled/.test(text()),'declined result');assert.equal(resolvedHeaders.length,contactsBefore,'ignoring contacts nothing');
 await click('Check again');await wait(()=>/You asked OpenAg to check an MCP server/.test(text()));
 // Editing the form drops the proposal: a result can never describe an address that is no longer in the form.
 await fill('mcp-server-url','https://cand.example/other');await wait(()=>!/You asked OpenAg to check an MCP server/.test(text()),'the old proposal is dropped');assert.ok(button('Check server'),'and the check can be requested again');
 await fill('mcp-server-url','https://cand.example/mcp');await click('Check server');await wait(()=>/You asked OpenAg to check an MCP server/.test(text()));
 await click('Check server');await wait(()=>/Server reachable: 1 tool/.test(text()),'check result');
 assert.ok(text().includes(DESCRIPTION),'the tool description is shown as text');none(document.querySelector('img[src="x"]'),'and never as markup');assert.ok(!text().includes(SECRET),'no resolved value in the result');
 assert.equal(resolvedHeaders.length,contactsBefore+1,'accepting contacted the server exactly once');assert.ok(resolvedHeaders.some(headers=>JSON.stringify(headers).includes(SECRET)),'and the reference really was resolved server-side');
 assert.equal(statusOf('cand'),undefined,'a check saves nothing');
 await click('Cancel');await wait(()=>dialogs()===0);
 group('server check is approval-gated, plain text, and saves nothing');

 // 4. Switches save immediately and read back; a stale digest refreshes and says so.
 await mount(ownerApi,OWNER,'mcp:linear');await wait(()=>document.getElementById('mcp-offer-linear'));
 await toggle('mcp-offer-linear');await wait(()=>statusOf('linear').offerToAgents===false,'offer switched off');await wait(()=>/No longer offered to agents/.test(text()));
 await toggle('mcp-enabled-linear');await wait(()=>statusOf('linear').enabled===false,'disconnected');await wait(()=>leafText('Disabled'),'the Disabled badge');assert.equal(statusOf('linear').state,'skipped');
 await toggle('mcp-enabled-linear');await wait(()=>statusOf('linear').state==='connected','reconnected');
 // Another writer changes the file after the panel loaded its digest.
 const sneaky=JSON.parse(readFileSync(configPath,'utf8'));sneaky.note='changed elsewhere';writeFileSync(configPath,JSON.stringify(sneaky,null,2)+'\n',{mode:0o600});
 await toggle('mcp-offer-linear');await wait(()=>/changed since you loaded it/.test(text()),'stale digest message');assert.equal(statusOf('linear').offerToAgents,false,'the stale change was not applied');
 await wait(()=>!document.getElementById('mcp-offer-linear').disabled,'controls usable again after the refresh');
 await toggle('mcp-offer-linear');await wait(()=>statusOf('linear').offerToAgents===true,'works with the latest digest');
 group('switches save and read back; a stale digest refreshes');

 // 5. Edit keeps a draft on refusal and saves; the id is fixed.
 await click('Edit');await wait(()=>document.getElementById('mcp-server-url'));none(document.getElementById('mcp-server-id'),'the id cannot be changed');
 assert.equal(document.getElementById('mcp-server-url').value,'https://linear.example/mcp');
 await act(async()=>fireEvent.change(document.querySelector('input[id^="mcp-header-value-"]'),{target:{value:'[REDACTED:key]'}}));await click('Save changes');await wait(()=>/hidden when it was loaded/.test(text()),'a hidden value is never resubmitted');
 await act(async()=>fireEvent.change(document.querySelector('input[id^="mcp-header-value-"]'),{target:{value:'Bearer ${OPENAG_MCP_LINEAR}'}}));
 await fill('mcp-server-url','http://linear.example/mcp');await click('Save changes');await wait(()=>/Plain http is only allowed|http requires allowPrivateNetwork/.test(text()),'refusal');assert.equal(document.getElementById('mcp-server-url').value,'http://linear.example/mcp','the draft is kept');
 await fill('mcp-server-url','https://linear.example/v2/mcp');await click('Save changes');await wait(()=>dialogs()===0||!document.getElementById('mcp-server-url'),'saved');
 await wait(()=>JSON.parse(readFileSync(configPath,'utf8')).servers.find(entry=>entry.id==='linear').url==='https://linear.example/v2/mcp','url saved');await wait(()=>/Saved\. The server was reconnected\./.test(text()));
 group('edit keeps the draft on refusal and saves');

 // 5b. A stale save keeps what you edited and takes the latest for what you did not touch (so another writer's change is not lost).
 await click('Edit');await wait(()=>document.getElementById('mcp-server-url'));
 await toggle('mcp-server-private');await wait(()=>document.getElementById('mcp-server-private').checked===true);
 const elsewhere=JSON.parse(readFileSync(configPath,'utf8'));elsewhere.servers.find(entry=>entry.id==='linear').url='https://other.example/mcp';elsewhere.servers.find(entry=>entry.id==='linear').oauth={scope:'latest.read'};writeFileSync(configPath,JSON.stringify(elsewhere,null,2)+'\n',{mode:0o600});
 await click('Save changes');await wait(()=>/Another change was saved first/.test(text()),'stale message');
 await wait(()=>document.getElementById('mcp-server-url').value==='https://other.example/mcp','the untouched address follows the latest version');
 assert.ok(document.getElementById('mcp-server-private').checked===true,'the edited field keeps the draft');
 assert.equal(document.getElementById('mcp-server-oauth').checked,true,'untouched OAuth follows the latest version');assert.equal(document.getElementById('mcp-server-scope').value,'latest.read');
 await click('Save changes');await wait(()=>JSON.parse(readFileSync(configPath,'utf8')).servers.find(entry=>entry.id==='linear').allowPrivateNetwork===true,'saved');
 assert.equal(JSON.parse(readFileSync(configPath,'utf8')).servers.find(entry=>entry.id==='linear').url,'https://other.example/mcp',"the other writer's address was not replaced by an old copy");
 assert.equal(JSON.parse(readFileSync(configPath,'utf8')).servers.find(entry=>entry.id==='linear').oauth.scope,'latest.read',"the other writer's OAuth setting survives");
 await wait(()=>dialogs()===0||!document.getElementById('mcp-server-url'));
 group('a stale save never overwrites another writer');

 // 6. Remove needs confirmation; keeping it changes nothing.
 await click('Remove');await wait(()=>document.querySelector('[role="alertdialog"]'));
 await click('Keep server');await wait(()=>!document.querySelector('[role="alertdialog"]'));assert.ok(statusOf('linear'),'keeping leaves the server');
 await click('Remove');await wait(()=>document.querySelector('[role="alertdialog"]'));await click('Remove server');
 await wait(()=>statusOf('linear')===undefined,'removed');assert.ok(!JSON.parse(readFileSync(configPath,'utf8')).servers.some(entry=>entry.id==='linear'));
 assert.ok(hrefFor({kind:'connectors'}).endsWith(window.location.hash)&&window.location.hash.length>1,'the page returns to Connectors after removal');
 group('remove asks first');

 // 6b. A check that expires on the daemon is shown as expired here (the desk timer follows the daemon's window).
 const shortApi={...ownerApi,checkMcpServer:async input=>({...await ownerApi.checkMcpServer(input),expiresInMs:300})};
 await mount(shortApi,OWNER);await click('Add MCP server');await fill('mcp-server-url','https://short.example/mcp');await click('Check server');await wait(()=>/You asked OpenAg to check an MCP server/.test(text()));
 await wait(()=>/Check expired/.test(text()),'expired result');none(button('Cancel check'),'the stale card is gone');await click('Cancel');await wait(()=>dialogs()===0);
 group('an expired check is shown as expired');

 // 6d. Direct secrets: typed once, saved after the server, never shown again; delete fails the server closed; a failed secret keeps the dialog.
 const addHeader=async(name,template)=>{await click('Add header');await wait(()=>document.querySelector('input[id^="mcp-header-name-"]'));await act(async()=>fireEvent.change(document.querySelector('input[id^="mcp-header-name-"]'),{target:{value:name}}));await act(async()=>fireEvent.change(document.querySelector('input[id^="mcp-header-value-"]'),{target:{value:template}}));};
 await mount(ownerApi,OWNER);await click('Add MCP server');await fill('mcp-server-id','vault');await fill('mcp-server-url','https://vault.example/mcp');
 none(document.getElementById('mcp-secret-VAULT'),'no secret field before a header refers to one');
 await addHeader('Authorization','Bearer ${secret:VAULT}');await wait(()=>document.getElementById('mcp-secret-VAULT'),'a secret field appears for the reference');
 assert.equal(document.getElementById('mcp-secret-VAULT').type,'password','the value is masked');assert.equal(document.getElementById('mcp-secret-VAULT').placeholder,'Not set');
 await fill('mcp-secret-VAULT',DESK_SECRET);await click('Add server');await wait(()=>statusOf('vault')?.state==='connected','saved, then the secret was stored');
 assert.ok(resolvedHeaders.some(headers=>headers.Authorization===`Bearer ${DESK_SECRET}`),'the daemon connected with the typed value');
 await wait(()=>dialogs()===0,'dialog closes');assert.ok(!document.body.innerHTML.includes(DESK_SECRET),'the typed value is gone from the page after saving');
 assert.ok(!readFileSync(configPath,'utf8').includes(DESK_SECRET),'and it is not in mcp.json');
 await mount(ownerApi,OWNER,'mcp:vault');await click('Edit');await wait(()=>document.getElementById('mcp-secret-VAULT'));
 await wait(()=>/^Set, ending /.test(document.getElementById('mcp-secret-VAULT').placeholder),'the saved secret shows its last four');
 assert.equal(document.getElementById('mcp-secret-VAULT').value,'','the field never holds the saved value');assert.ok(!document.body.innerHTML.includes(DESK_SECRET));
 await click('Delete VAULT');await wait(()=>statusOf('vault')?.state==='skipped','deleting fails the server closed');await wait(()=>/Not set/.test(document.getElementById('mcp-secret-VAULT').placeholder));
 await wait(()=>button('Cancel')&&!button('Cancel').disabled,'the dialog is idle again');await click('Cancel');await wait(()=>!document.getElementById('mcp-secret-VAULT'),'the edit dialog closes');
 await mount(ownerApi,OWNER,'mcp:vault');await wait(()=>/missing secret VAULT/.test(text()),'the reason is shown');await wait(()=>/Enter the value for secret VAULT/.test(text()),'with a one-line hint');
 await click('Edit');await wait(()=>document.getElementById('mcp-secret-VAULT'));await fill('mcp-secret-VAULT',DESK_SECRET+'-2');await click('Save changes');
 await wait(()=>statusOf('vault')?.state==='connected','re-entering the value reconnects');await wait(()=>dialogs()===0||!document.getElementById('mcp-secret-VAULT'));
 // A secret the daemon refuses leaves the dialog open, and a retry does not add the server twice.
 await mount(ownerApi,OWNER);await click('Add MCP server');await fill('mcp-server-id','vault2');await fill('mcp-server-url','https://vault2.example/mcp');await addHeader('Authorization','Bearer ${secret:VAULT2}');
 await wait(()=>document.getElementById('mcp-secret-VAULT2'));await fill('mcp-secret-VAULT2','x'.repeat(2000));await click('Add server');
 await wait(()=>/The server was saved, but secret VAULT2 was not/.test(text()),'a refused secret is reported');assert.ok(statusOf('vault2'),'the server itself was saved');assert.ok(dialogs()>=1,'the dialog stays open');
 assert.ok(document.getElementById('mcp-server-id').disabled,'the name is fixed once the server exists');
 await fill('mcp-server-url','https://vault2.example/v2/mcp');await fill('mcp-secret-VAULT2',DESK_SECRET+'-3');await click('Add server');await wait(()=>statusOf('vault2')?.state==='connected','the retry saved the edit and sent the secret');
 await wait(()=>JSON.parse(readFileSync(configPath,'utf8')).servers.find(entry=>entry.id==='vault2').url==='https://vault2.example/v2/mcp','an edit made after the failure was saved, not dropped');
 await wait(()=>dialogs()===0);assert.equal(JSON.parse(readFileSync(configPath,'utf8')).servers.filter(entry=>entry.id==='vault2').length,1,'the server was not added twice');
 assert.ok(!readFileSync(configPath,'utf8').includes('desk-typed-secret'));
 group('direct secrets are write-only, deletable and fail closed');

 // 6e. Local commands: reviewed before anything is saved or started; an edit is a new review; operator commands stay in the file.
 const scriptPath=join(dir,'cmd-server.mjs');writeFileSync(scriptPath,'// reviewed script\n');
 await mount(ownerApi,OWNER);await click('Add local command');
 await fill('mcp-command-id','cmd');await fill('mcp-command-program',process.execPath);await fill('mcp-command-args',scriptPath);
 await click('Add variable');await wait(()=>document.querySelector('input[id^="mcp-env-name-"]'));
 await act(async()=>fireEvent.change(document.querySelector('input[id^="mcp-env-name-"]'),{target:{value:'FLAG'}}));await act(async()=>fireEvent.change(document.querySelector('input[id^="mcp-env-value-"]'),{target:{value:'${secret:CMDSECRET}'}}));
 await wait(()=>document.getElementById('mcp-secret-CMDSECRET'),'a secret field appears');assert.equal(document.getElementById('mcp-secret-CMDSECRET').type,'password');await fill('mcp-secret-CMDSECRET',DESK_SECRET+'-cmd');
 const configBefore=readFileSync(configPath,'utf8'),contactsBeforeCmd=resolvedHeaders.length;
 await click('Review command');await wait(()=>/You asked OpenAg to review a command/.test(text()),'the review card');
 assert.match(text(),/not sandboxed/);assert.ok(text().includes(scriptPath),'the full argument list is shown');assert.match(text(),/Environment names: FLAG/);assert.match(text(),/\$OPENAG_DATA\/mcp-work\/cmd/);assert.match(text(),/Review code: [a-f0-9]{64}/);assert.ok(!text().includes(DESK_SECRET),'no value is shown');
 none(button('Respond'),'a command review has no Respond');none(button('Edit',),'and no Edit inside the card');
 assert.equal(readFileSync(configPath,'utf8'),configBefore,'nothing is saved before the approval');assert.equal(statusOf('cmd'),undefined);assert.equal(resolvedHeaders.length,contactsBeforeCmd,'nothing is started before the approval');
 // Editing the form drops the proposal.
 await fill('mcp-command-args',scriptPath+'\n--flag');await wait(()=>!/You asked OpenAg to review a command/.test(text()),'the old proposal is dropped');await wait(()=>button('Review command'));
 await fill('mcp-command-args',scriptPath);await click('Review command');await wait(()=>/You asked OpenAg to review a command/.test(text()));
 await click('Cancel review');await wait(()=>/was cancelled, so nothing was saved or started/.test(text()),'cancelled');assert.equal(readFileSync(configPath,'utf8'),configBefore,'cancel writes nothing');
 await click('Review again');await wait(()=>/You asked OpenAg to review a command/.test(text()));await click('Approve command');
 await wait(()=>statusOf('cmd')?.state==='connected','approved, saved and started');await wait(()=>dialogs()===0,'the dialog closes');
 assert.ok(!document.body.innerHTML.includes(DESK_SECRET),'the typed secret is gone from the page');assert.ok(!readFileSync(configPath,'utf8').includes('desk-typed-secret'),'and not in mcp.json');
 assert.equal(JSON.parse(readFileSync(configPath,'utf8')).servers.find(entry=>entry.id==='cmd').managedBy,'desk');
 await mount(ownerApi,OWNER,'mcp:cmd');await wait(()=>document.getElementById('mcp-offer-cmd'),'a reviewed command has switches');await wait(()=>button('Edit'));
 await click('Edit');await wait(()=>document.getElementById('mcp-command-program'));assert.equal(document.getElementById('mcp-command-program').value,process.execPath);assert.equal(document.getElementById('mcp-command-args').value,scriptPath);
 await wait(()=>/^Set, ending /.test(document.getElementById('mcp-secret-CMDSECRET').placeholder),'the saved secret shows its last four');
 const hashBefore=JSON.parse(readFileSync(configPath,'utf8')).servers.find(entry=>entry.id==='cmd').review.hash;
 await fill('mcp-command-args',scriptPath+'\n--changed');await click('Review command');await wait(()=>/You asked OpenAg to review a command/.test(text()));
 assert.equal(JSON.parse(readFileSync(configPath,'utf8')).servers.find(entry=>entry.id==='cmd').review.hash,hashBefore,'an edit changes nothing until it is approved');
 await click('Cancel review');await wait(()=>/was cancelled/.test(text()));await click('Cancel');await wait(()=>!document.getElementById('mcp-command-program'));
 await mount(ownerApi,OWNER,'mcp:localtool');await wait(()=>text().includes('Server settings'));assert.match(text(),/stays managed in mcp.json/);none(button('Edit'),'an operator command cannot be edited from the desk');
 group('local commands are reviewed before they are saved or started');

 // 6f. OAuth sign-in: set up in the dialog, signed in from the server's settings, never showing a token.
 await mount(ownerApi,OWNER);await click('Add MCP server');await fill('mcp-server-id','oa');await fill('mcp-server-url',oauthFixture.mcpUrl);await toggle('mcp-server-private');
 none(document.getElementById('mcp-server-scope'),'no scope field until OAuth is switched on');await toggle('mcp-server-oauth');await fill('mcp-server-scope','items.read');
 await click('Add server');await wait(()=>statusOf('oa')?.detail==='needs sign-in','added; it needs sign-in');await wait(()=>dialogs()===0);
 assert.deepEqual(JSON.parse(readFileSync(configPath,'utf8')).servers.find(e=>e.id==='oa').oauth,{scope:'items.read'},'only the scope is in mcp.json');
 await mount(ownerApi,OWNER,'mcp:oa');await wait(()=>leafText('Needs sign-in'),'the badge');await wait(()=>/Sign in from this server/.test(text()),'and the hint');await wait(()=>button('Sign in'));
 await click('Sign in');await wait(()=>opened.some(u=>u.includes('/authorize')),'the browser was pointed at the provider');
 {const authorizeUrl=opened.find(u=>u.includes('/authorize')),params=await oauthFixture.authorize(authorizeUrl);const cb=await app.request('/composio-connect?'+new URLSearchParams(params));assert.equal(cb.status,200);}
 await wait(()=>statusOf('oa')?.state==='connected','signed in and connected');await wait(()=>leafText('Signed in'),'the badge says signed in');await wait(()=>/Signed in\./.test(text()),'and the notice');
 const issuedToken=oauthFixture.stats.authHeaders.at(-1).slice('Bearer '.length);assert.ok(issuedToken.startsWith('at-'));assert.ok(!document.body.innerHTML.includes(issuedToken),'no token in the page');
 await fill('mcp-oauth-client-oa','preset-desk-client');await fill('mcp-oauth-secret-oa','desk-client-secret-DO-NOT-LEAK-55667788');assert.equal(document.getElementById('mcp-oauth-secret-oa').type,'password');
 await click('Save client');await wait(()=>/Client saved/.test(text()),'client saved');assert.ok(!document.body.innerHTML.includes('desk-client-secret'),'the client secret is write-only');assert.equal(document.getElementById('mcp-oauth-secret-oa').value,'');
 await wait(()=>statusOf('oa')?.detail==='needs sign-in','a new client needs a new sign-in');await click('Remove client');await wait(()=>/Client removed/.test(text()));
 await click('Sign in');await wait(()=>opened.filter(u=>u.includes('/authorize')).length>=2);
 {const authorizeUrl=opened.filter(u=>u.includes('/authorize')).at(-1),params=await oauthFixture.authorize(authorizeUrl);assert.equal((await app.request('/composio-connect?'+new URLSearchParams(params))).status,200);}
 await wait(()=>statusOf('oa')?.state==='connected');await click('Disconnect');await wait(()=>/Disconnected/.test(text()),'disconnected');await wait(()=>statusOf('oa')?.detail==='needs sign-in');
 await click('Edit');await wait(()=>document.getElementById('mcp-server-oauth'));assert.equal(document.getElementById('mcp-server-oauth').checked,true);await toggle('mcp-server-oauth');await click('Save changes');
 await wait(()=>!JSON.parse(readFileSync(configPath,'utf8')).servers.find(e=>e.id==='oa').oauth,'OAuth switched off');await wait(()=>!document.querySelector('[aria-label="OAuth sign-in"]'),'the sign-in panel is gone');
 group('OAuth sign-in from the desk shows no token or client secret');

 // 6c. An unreadable mcp.json is reported, never half-shown.
 chmodSync(configPath,0o664);await mount({...ownerApi},OWNER);await wait(()=>/cannot be read safely/.test(text()),'entries error shown');none(button('Add MCP server'),'no Add button while the file cannot be read safely');chmodSync(configPath,0o600);
 group('an unreadable file is reported');

 // 7. Nothing sensitive ever reached the page.
 assert.ok(!document.body.innerHTML.includes(SECRET)&&!document.body.innerHTML.includes('github-value-7781')&&!document.body.innerHTML.includes('desk-typed-secret'),'no resolved environment value anywhere in the DOM');
 group('no resolved value in the DOM');
}finally{
 off();check.dispose();commandReview.dispose();await oauth.close();await oauthFixture.close();await act(async()=>root.unmount());await vite.close();dom.window.close();await manager.close();db.close();rmSync(dir,{recursive:true,force:true});
}
console.log(`MCP desk verification passed (${groups} groups).`);
