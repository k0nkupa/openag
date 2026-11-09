// Standalone temporary-data integration assertions with controlled Google responses. No live account or API calls.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname,'..'), daemon = join(root,'apps/daemon');
const { createGoogleConnectors } = await import(pathToFileURL(join(daemon,'dist/google-connectors.js')));
const { toExecutors } = await import(pathToFileURL(join(daemon,'dist/tools/registry.js')));
const { withoutOwnerSecrets } = await import(pathToFileURL(join(daemon,'dist/runtimes/acp.js')));
const { getDefaultRedactor } = await import(pathToFileURL(join(daemon,'dist/redact.js')));
const dir = mkdtempSync(join(tmpdir(),'openag-google-'));
const env = { OPENAG_GOOGLE_CLIENT_ID:'controlled-client', OPENAG_GOOGLE_CLIENT_SECRET:'controlled-client-secret-482197', OPENAG_GOOGLE_REDIRECT_URI:'https://desk.example/google-connect', OPENAG_CONNECTOR_KEY:randomBytes(32).toString('hex') };
const scope = 'openid email https://www.googleapis.com/auth/gmail.readonly';
let clock=Date.now(), refreshCount=0, refreshError, getCount=0;
let tokens={ access_token:'controlled-access-token-482197',refresh_token:'controlled-refresh-token-482197',expiry_date:clock+3600000,scope };
let driveBody='Controlled Drive document text', mailBody='Controlled message body';
let pendingFetch, driveMime="application/vnd.google-apps.document", driveStatus=200, driveHuge=false;
const readUrls=[];
const audit=[];
const auth = {
  url(scopes,state,challenge){ assert.ok(challenge.length>=40);return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({state,scope:scopes.join(' ')}); },
  async exchange(code,verifier){assert.ok(code);assert.ok(verifier.length>=40);return tokens;},
  async refresh(){refreshCount++;if(refreshError)throw refreshError;return {...tokens,expiry_date:clock+3600000};},
  async revoke(){},
};
const fakeFetch = async (url,opts) => {
  readUrls.push(String(url)); getCount++;assert.equal(opts.redirect,'error');assert.match(opts.headers.Authorization,/^Bearer controlled-/);
  const u=new URL(url);assert.ok(['openidconnect.googleapis.com','gmail.googleapis.com','www.googleapis.com'].includes(u.hostname));
  if(u.pathname==='/v1/userinfo')return Response.json({sub:'person-123',email:'person@example.test',email_verified:true});
  if(pendingFetch)return await pendingFetch(url,opts);
  if(u.pathname.startsWith('/drive/v3/')) {
    if(driveStatus!==200)return new Response('controlled private provider error',{status:driveStatus});
    if(u.pathname==='/drive/v3/files')return Response.json({files:[{id:'known-file',name:'Controlled file',mimeType:driveMime}],nextPageToken:'drive-cursor'});
    if(u.pathname.endsWith('/export')||u.searchParams.get('alt')==='media')return new Response(driveHuge?'x'.repeat(2*1024*1024+1):driveBody);
    return Response.json({id:'known-file',name:'Controlled file',mimeType:driveMime,size:'100',capabilities:{canDownload:true}});
  }
  if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:'person@example.test'});
  if(u.pathname.endsWith('/messages'))return Response.json({messages:[{id:'known-message',threadId:'known-thread'}],nextPageToken:'next-opaque-page'});
  return Response.json({id:'known-message',threadId:'known-thread',payload:{headers:[{name:'Subject',value:'Controlled subject'}],mimeType:'multipart/mixed',parts:[{mimeType:'text/plain',body:{data:Buffer.from(mailBody).toString('base64url')}},{mimeType:'application/pdf',body:{attachmentId:'never-fetch'}}]}});
};
const opts={dataDir:dir,env,auth,fetch:fakeFetch,now:()=>clock,audit:(...args)=>audit.push(args)};
let google=createGoogleConnectors(opts);
async function connect(service='gmail',actor='device-1') { const start=google.start(service,actor);const state=new URL(start.url).searchParams.get('state');await google.complete({state,code:'controlled-auth-code-482197'},actor);return state; }
const executor = name => toExecutors(google.tools)[name];
const ctx={botId:'bot',dataDir:dir};
try {
  assert.equal(google.status().services[0].state,'needs_access');assert.equal(getCount,0);
  await assert.rejects(()=>executor('gmail_read')(ctx,{id:'known'}));
  const start=google.start('gmail','device-1'),state=new URL(start.url).searchParams.get('state');
  await assert.rejects(()=>google.complete({state,code:'wrong-device-code'},'device-2'));
  await google.complete({state,code:'controlled-auth-code-482197'},'device-1');
  await assert.rejects(()=>google.complete({state,code:'controlled-auth-code-482197'},'device-1'));
  assert.equal(google.status().services[0].state,'connected');
  const bytes=readFileSync(join(dir,'connector-google.enc'));assert.ok(!bytes.includes(Buffer.from(tokens.refresh_token)));assert.ok(!bytes.includes(Buffer.from('person@example.test')));assert.equal(statSync(join(dir,'connector-google.enc')).mode&0o777,0o600);
  const result=await executor('gmail_read')(ctx,{id:'known-message'});assert.equal(result.untrusted,true);assert.match(result.text,/Controlled message body/);assert.ok(!result.text.includes('never-fetch'));
  const search=await executor('gmail_search')(ctx,{query:'is:unread',limit:5});assert.match(search.text,/next-opaque-page/);
  for(const args of [{id:'../profile'},{id:'known',action:'delete'},{id:'known',thread:'yes'}])await assert.rejects(()=>executor('gmail_read')(ctx,args));
  await google.verify('gmail');assert.equal(google.status().services[0].verifiedAt,clock);
  google.close();google=createGoogleConnectors(opts);assert.equal(google.status().services[0].state,'connected');assert.equal(google.status().services[0].verifiedAt,null);
  clock+=3600000;await Promise.all([executor('gmail_read')(ctx,{id:'known'}),executor('gmail_read')(ctx,{id:'known'})]);assert.equal(refreshCount,1);
  google.pause('gmail',false);assert.equal(google.status().services[0].state,'paused');await assert.rejects(()=>executor('gmail_read')(ctx,{id:'known'}));google.pause('gmail',true);
  let release;pendingFetch=()=>new Promise(resolve=>{release=resolve;});
  const inFlight=executor('gmail_read')(ctx,{id:'known'});await new Promise(r=>setImmediate(r));google.pause('gmail',false);release(Response.json({id:'known'}));await assert.rejects(()=>inFlight);pendingFetch=undefined;google.pause('gmail',true);
  clock+=3600000;refreshError=Error('temporary network failure');await assert.rejects(()=>executor('gmail_read')(ctx,{id:'known'}));assert.equal(google.status().services[0].state,'connected');
  refreshError={response:{data:{error:'invalid_grant'}}};await assert.rejects(()=>executor('gmail_read')(ctx,{id:'known'}));assert.equal(google.status().services[0].state,'needs_access');refreshError=undefined;
  tokens={...tokens,expiry_date:clock+3600000};await connect();
  const expired=google.start('gmail','device-1');clock+=300001;await assert.rejects(()=>google.complete({state:new URL(expired.url).searchParams.get('state'),code:'expired-code'},'device-1'));
  assert.throws(()=>google.pause('drive',true));
  await assert.rejects(()=>connect('drive')); // Consent without the required scope must preserve Gmail.
  assert.equal(google.status().services.find(s=>s.id==='gmail').state,'connected');
  tokens={...tokens,scope:scope+' https://www.googleapis.com/auth/drive.readonly',expiry_date:clock+3600000};
  await connect('drive');
  assert.equal(google.status().services.find(s=>s.id==='drive').state,'connected');
  const files=await executor('drive_search')(ctx,{query:"budget' or trashed",limit:5,cursor:'opaque'});assert.match(files.text,/drive-cursor/);
  const queryUrl=new URL(readUrls.at(-1));assert.equal(queryUrl.hostname,'www.googleapis.com');assert.equal(queryUrl.searchParams.get('pageToken'),'opaque');assert.ok(queryUrl.searchParams.get('q').includes("budget\\' or trashed"));
  assert.match((await executor('drive_read')(ctx,{id:'known-file'})).text,/Controlled Drive document text/);
  driveMime='application/vnd.google-apps.spreadsheet';assert.match((await executor('drive_read')(ctx,{id:'known-file'})).text,/firstSheetOnly/);
  driveMime='text/plain';assert.match((await executor('drive_read')(ctx,{id:'known-file'})).text,/Controlled Drive document text/);
  driveMime='application/pdf';await assert.rejects(()=>executor('drive_read')(ctx,{id:'known-file'}));
  driveMime='text/plain';driveHuge=true;await assert.rejects(()=>executor('drive_read')(ctx,{id:'known-file'}));driveHuge=false;
  driveStatus=404;await assert.rejects(()=>executor('drive_read')(ctx,{id:'known-file'}));driveStatus=200;
  await assert.rejects(()=>executor('drive_read')(ctx,{id:'https://other.invalid/file'}));
  await google.verify('drive');assert.equal(google.status().services.find(s=>s.id==='drive').verifiedAt,clock);
  google.pause('gmail',false);assert.equal(google.status().services.find(s=>s.id==='drive').state,'connected');await executor('drive_search')(ctx,{});
  google.pause('drive',false);await assert.rejects(()=>executor('drive_read')(ctx,{id:'known-file'}));google.pause('gmail',true);google.pause('drive',true);
  const boundarySecret='boundary-whole-secret-4821976410';getDefaultRedactor().addSecret(boundarySecret);
  for(const offset of [7900,7970,7990,19800,19850,19900,19950,19990,20000,49990]){
    driveBody='x'.repeat(offset)+boundarySecret+'tail';mailBody=driveBody;
    assert.ok(!(await executor('drive_read')(ctx,{id:'known-file'})).text.includes('boundary-whole-secret'));
    assert.ok(!(await executor('gmail_read')(ctx,{id:'known-message'})).text.includes('boundary-whole-secret'));
  }
  assert.equal((await executor('gmail_read')(ctx,{id:'known-message'})).truncated,true);
  driveBody='Controlled Drive document text';mailBody='Controlled message body';
  const official=createGoogleConnectors({...opts,auth:undefined});
  const generated=new URL(official.start('gmail','device-official').url);
  assert.equal(generated.hostname,'accounts.google.com');assert.equal(generated.searchParams.get('code_challenge_method'),'S256');assert.equal(generated.searchParams.get('access_type'),'offline');assert.equal(generated.searchParams.get('redirect_uri'),env.OPENAG_GOOGLE_REDIRECT_URI);official.close();
  const safe=JSON.stringify(getDefaultRedactor().redact({text:`${tokens.refresh_token} ${tokens.access_token} ${env.OPENAG_CONNECTOR_KEY}`}));assert.ok(!safe.includes(tokens.refresh_token));assert.ok(!JSON.stringify(audit).includes('controlled-access'));
  const stripped=withoutOwnerSecrets({...env,PATH:'/usr/bin'});assert.equal(stripped.PATH,'/usr/bin');assert.ok(!('OPENAG_GOOGLE_CLIENT_SECRET' in stripped));assert.ok(!('OPENAG_CONNECTOR_KEY' in stripped));
  await google.disconnect();assert.equal(google.status().account,null);await assert.rejects(()=>executor('gmail_read')(ctx,{id:'known'}));
  const bad=createGoogleConnectors({...opts,env:{...env,OPENAG_CONNECTOR_KEY:'bad'}});assert.equal(bad.status().configured,false);assert.equal(bad.status().services[0].state,'failed');
  // Public gateway owner/full/limited checks use a real temporary SQLite database.
  const {openDb}=await import(pathToFileURL(join(daemon,'dist/db/index.js')));
  const {createAuth}=await import(pathToFileURL(join(daemon,'dist/auth.js')));
  const {createLedger}=await import(pathToFileURL(join(daemon,'dist/ledger.js')));
  const {createApprovals}=await import(pathToFileURL(join(daemon,'dist/approvals.js')));
  const {createGateway}=await import(pathToFileURL(join(daemon,'dist/gateway.js')));
  const db=openDb(join(dir,'gateway')), ownerToken=randomBytes(32).toString('hex');
  const gatewayAuth=createAuth({db,ownerToken}), ledger=createLedger(db), approvals=createApprovals(db,ledger);
  const app=createGateway({db,ledger,approvals,auth:gatewayAuth,dispatch:()=>{},google,dataDir:dir});
  const request=(path,token=ownerToken,body)=>app.request(path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const limited=(await request('/devices',ownerToken,{name:'Limited connector fixture'}).then(r=>r.json())).token;
  const full=(await request('/devices',ownerToken,{name:'Full connector fixture',access:'full'}).then(r=>r.json())).token;
  assert.equal((await request('/connectors','invalid')).status,401);
  assert.equal((await request('/connectors',limited)).status,403);
  assert.equal((await request('/connectors',full)).status,200);
  for(const action of ['start','complete','pause','verify','disconnect'])assert.equal((await request('/connectors/google/'+action,limited,{})).status,403);
  const started=await request('/connectors/google/start',full,{service:'gmail'}).then(r=>r.json());
  const apiState=new URL(started.url).searchParams.get('state');
  assert.equal((await request('/connectors/google/complete',ownerToken,{state:apiState,code:'wrong-owner-callback-code'})).status,400);
  assert.equal((await request('/connectors/google/complete',full,{state:apiState,code:'controlled-code-for-api'})).status,200);
  assert.equal((await request('/connectors/google/start',full,{service:'gmail',redirect:'https://evil.invalid'})).status,400);
  assert.ok(!JSON.stringify(await request('/connectors',full).then(r=>r.json())).includes(tokens.access_token));
  db.close();
  const outside=join(dir,'outside');writeFileSync(outside,'preserve');rmSync(join(dir,'connector-google.enc'));symlinkSync(outside,join(dir,'connector-google.enc'));
  const linked=createGoogleConnectors(opts);assert.equal(linked.status().configured,false);assert.equal(readFileSync(outside,'utf8'),'preserve');
  console.log('Google controlled account/API integration passed: consent, strict tools, encryption, refresh/restart, state/device/expiry/replay, pause/in-flight, revoke, redaction and secret stripping. No live calls.');
} finally {google.close();rmSync(dir,{recursive:true,force:true});}
