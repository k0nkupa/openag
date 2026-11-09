import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'openag-connectors-')),ownerToken=randomBytes(32).toString('hex');
const child=fork(join(root,'scripts/connectors-fixture.mjs'),[dir],{stdio:['ignore','ignore','inherit','ipc']});
const ready=once(child,'message',{signal:AbortSignal.timeout(15000)});child.send({ownerToken});const {url:base}=(await ready)[0];
const request=(path,{method='GET',body,token=ownerToken}={})=>fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
async function json(path,opts){const res=await request(path,opts);assert.ok(res.ok,`${path}: ${res.status}`);return res.json();}
async function ipc(type,args={}){const reply=new Promise(resolve=>{const handler=m=>{if(m.type===type+'-result'){child.off('message',handler);resolve(m);}};child.on('message',handler);});child.send({type,...args});return reply;}
async function until(read,predicate){const end=Date.now()+5000;do{const result=await read();if(predicate(result))return result;await new Promise(r=>setTimeout(r,25));}while(Date.now()<end);throw Error('Controlled runner did not finish');}
try{
  const full=(await json('/devices',{method:'POST',body:{name:'Connector browser fixture',access:'full'}})).token;
  const limited=(await json('/devices',{method:'POST',body:{name:'Limited fixture'}})).token;
  assert.equal((await request('/connectors',{token:limited})).status,403);
  for(const action of ['permission','verify'])assert.equal((await request('/connectors/apple/'+action,{method:'POST',token:limited,body:{app:'mail'}})).status,403);
  const callback=await fetch(base+'/google-connect?state=synthetic&code=synthetic');assert.equal(callback.status,200);assert.equal(callback.headers.get('referrer-policy'),'no-referrer');assert.equal(callback.headers.get('cache-control'),'no-store');
  const library=await json('/app-library');for(const name of ['Apple apps','Gmail','Google Drive'])assert.ok(library.entries.some(e=>e.name===name));
  assert.equal((await ipc('counts')).reads,0);assert.equal((await ipc('counts')).permissions,0);
  assert.equal((await request('/connectors/apple/permission',{method:'POST',body:{app:'mail',script:'danger'}})).status,400);
  if(process.platform==='darwin'){
    await json('/connectors/apple/permission',{method:'POST',body:{app:'mail'}});assert.equal((await ipc('counts')).permissions,1);
    const result=await json('/connectors/apple/verify',{method:'POST',body:{app:'mail'}});assert.ok(result.verifiedAt);assert.ok(!JSON.stringify(result).includes('controlled Apple'));
    await json('/mcp/reload',{method:'POST',body:{}});assert.equal((await json('/connectors')).apple.apps.find(a=>a.app==='mail').verifiedAt,null);
  }
  for(const service of ['gmail','drive']){
    const flow=await json('/connectors/google/start',{method:'POST',body:{service},token:full});
    await json('/connectors/google/complete',{method:'POST',body:{state:new URL(flow.url).searchParams.get('state'),code:'fixture-code-9284821'},token:full});
  }
  const post=async text=>{const before=(await json('/rooms/main/events')).events.filter(e=>e.type==='bot_output').length;await json('/rooms/main/messages',{method:'POST',body:{text}});const result=await until(()=>json('/rooms/main/events'),r=>r.events.filter(e=>e.type==='bot_output').length>before);return result.events.filter(e=>e.type==='bot_output').at(-1).payload.text;};
  assert.match(await post('gmail'),/Controlled email content/);assert.match(await post('drive'),/Fixture document/);assert.match(await post('mcp'),/Controlled email content/);if(process.platform==='darwin')assert.match(await post('mcp-apple'),/needle-through-both-hops/);
  const offlineReads=(await ipc('counts')).reads;for(const service of ['gmail','drive-read']){await ipc('offline',{service});assert.match((await json('/rooms/main/events')).events.filter(e=>e.type==='bot_output').at(-1).payload.text,/offline/);}assert.equal((await ipc('counts')).reads,offlineReads);
  const before=(await ipc('counts')).reads;await ipc('policy',{mode:'deny'});assert.match(await post('gmail'),/denied/);assert.equal((await ipc('counts')).reads,before);await ipc('policy',{mode:'auto'});
  await json('/connectors/google/pause',{method:'POST',body:{service:'gmail',enabled:false}});assert.match(await post('gmail'),/not enabled/);
  await json('/connectors/google/pause',{method:'POST',body:{service:'gmail',enabled:true}});
  const status=await json('/connectors');assert.equal(status.google.account.email,'fixture@example.test');assert.ok(!JSON.stringify(await json('/app-library')).includes('fixture-access'));
  console.log('Connector HTTP/runner integration passed: cards, no automatic reads/prompts, owner controls, static callback, controlled verification, shared account and unchanged policy gate.');
  if(process.argv.includes('--serve')){
    writeFileSync('/tmp/openag-connectors-browser.json',JSON.stringify({base,token:full,dir}),{mode:0o600});console.log('Temporary browser fixture: '+base);
    await new Promise(resolve=>process.once('SIGTERM',resolve));
  }
}finally{const stopped=once(child,'exit',{signal:AbortSignal.timeout(10000)});child.send({type:'stop'});await stopped;rmSync(dir,{recursive:true,force:true});}
