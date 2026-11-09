// Actual daemon entrypoint, disposable database, controlled Ollama, real process effects and host signals.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,watch} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),load=n=>import(root+'apps/daemon/dist/'+n+'.js');
const {setSetting}=await load('settings');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createBot,createRoom,addMember}=await load('rooms'),{createBotModels}=await load('botmodels');
const dir=mkdtempSync(join(tmpdir(),'openag-daemon-stop-'));console.log('Shutdown evidence: '+dir);
const within=async(p,ms=15000)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Shutdown verification deadline')),ms);})]);}finally{clearTimeout(timer);}};
const fileReady=path=>new Promise((resolve,reject)=>{const done=()=>{if(existsSync(path)){clearTimeout(timer);w.close();resolve();}},w=watch(join(path,'..'),done),timer=setTimeout(()=>{w.close();reject(Error('Child marker deadline'));},15000);done();});
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const evidence=[];
for(const scenario of (process.argv.includes('--reflection-only') ? ['reflection'] : ['active','pending','hosted-release-failed','forced','reflection'])){
 const dataDir=join(dir,scenario);mkdirSync(dataDir);const owner=randomUUID(),pidFile=join(dataDir,'child.pid'),after=join(dataDir,'after'),script=join(dataDir,'child.cjs');
 writeFileSync(script,`const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>fs.writeFileSync(${JSON.stringify(after)},'forbidden'),6000);setTimeout(()=>{},60000);`);
 const quote=s=>"'"+s.replaceAll("'","'\\''")+"'",command='exec '+quote(process.execPath)+' '+quote(script);
 let calls=0,metadataBegan;const metadata=new Promise(resolve=>metadataBegan=resolve);
 const model=createServer(async(req,res)=>{
  let raw='';for await(const b of req)raw+=b;
  if(req.url==='/api/tags'){metadataBegan();res.end(JSON.stringify({models:[]}));return;}
  if(req.url==='/api/chat'){
   calls++;const input=JSON.parse(raw),done=input.messages.some(m=>m.role==='tool');
   if(scenario==='reflection'){res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'fixture',done:true,done_reason:'stop',message:{role:'assistant',content:JSON.stringify({proposals:[{kind:'memory_append',text:'First shutdown note'},{kind:'memory_append',text:'Second shutdown note'},{kind:'skill',slug:'shutdown-review',name:'Shutdown review',description:'Controlled workflow',body:'1. Review the results'}]})}}));return;}
   res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'fixture',done:true,message:done?{role:'assistant',content:'Stopped.'}:{role:'assistant',content:'',tool_calls:[{function:{name:'run_shell',arguments:{command,timeoutMs:60000,...(scenario==='pending'?{escalation:{reason:'Review the exact disposable local command'}}:{})}}}]}}));return;
  }
  res.statusCode=503;res.end('{}');
 });model.listen(0,'127.0.0.1');await once(model,'listening');
 const env={...Object.fromEntries(['PATH','HOME','LANG','TMPDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),OPENAG_DATA:dataDir,OPENAG_PORT:'0',OPENAG_TOKEN:owner,OPENAG_EMBED:'off',OPENAG_OLLAMA_URL:'http://127.0.0.1:'+model.address().port};
 if(scenario==='hosted-release-failed')env.BROWSERBASE_API_KEY='fixture_browserbase_key';
 const db=openDb(dataDir),ledger=createLedger(db);if(scenario==='hosted-release-failed')setSetting(db,'computer',{backend:'browserbase'});createBot(db,{id:'fixture',runtime:'api',model:'ollama/fixture'});createRoom(db,{id:'main',leadBotId:'fixture'});addMember(db,'main','fixture');
 if(scenario==='reflection')setSetting(db,'reflection',{enabled:false,botId:'fixture'});
 db.prepare('UPDATE permission_defaults SET preset=?').run(scenario==='pending'?'read-only':'full-access');
 // Seed fresh metadata using the same source keys, avoiding subscription adapter discovery during this shutdown check.
 const models=createBotModels({db,ledger,env,acp:{discoverAll:async()=>[],stopBot:async()=>{}},withIdleBot:async(_id,fn)=>fn(),fetch:async()=>new Response('{}',{status:503})});
 await models.catalogue.refresh();await models.catalogue.close();if(scenario==='forced')db.prepare("DELETE FROM model_catalogue WHERE target='ollama'").run();db.close();
 let child,output='',base,approvalId;
 const preload=join(dataDir,'hung-transport.mjs');
 if(scenario==='hosted-release-failed')writeFileSync(preload,`import {writeFileSync} from 'node:fs';const original=globalThis.fetch;globalThis.fetch=async(...args)=>{const u=new URL(String(args[0]));if(u.hostname==='api.browserbase.com'){if(u.pathname==='/v1/sessions')return Response.json({id:'fixture_session',connectUrl:'wss://connect.browserbase.com/fixture'});if(args[1]?.method==='POST'){writeFileSync(${JSON.stringify(join(dataDir,'release-attempt'))},'once');return new Response('{}',{status:503});}return Response.json({status:'RUNNING'});}return original(...args);};`);
 if(scenario==='forced')writeFileSync(preload,`const original=globalThis.fetch;globalThis.fetch=async(...args)=>{if(new URL(String(args[0])).pathname==='/api/tags'){await original(...args);return new Promise(()=>{});}return original(...args);};`);
 if(scenario==='reflection')writeFileSync(preload,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {writeFileSync,existsSync,watch} from 'node:fs';const original=cp.execFile;let held=false;cp.execFile=function(file,args,...rest){const callback=rest.pop();if(!held&&file==='git'&&args.some(arg=>String(arg).startsWith('memory: reflection save'))){held=true;return original.call(this,file,args,...rest,(...result)=>{writeFileSync(${JSON.stringify(join(dataDir,'reflection-saving'))},'waiting');const gate=${JSON.stringify(join(dataDir,'release-save'))};let watcher;const release=()=>{if(existsSync(gate)){watcher?.close();callback(...result);}};watcher=watch(${JSON.stringify(dataDir)},release);release();});}return original.call(this,file,args,...rest,callback);};syncBuiltinESMExports();`);
 const start=async()=>{
  output='';child=spawn(process.execPath,[...(['forced','hosted-release-failed','reflection'].includes(scenario)?['--import',preload]:[]),root+'apps/daemon/dist/main.js'],{env,stdio:['ignore','pipe','pipe']});
  const ready=new Promise((resolve,reject)=>{const read=b=>{output+=b;const m=output.match(/openagd listening on http:\/\/0.0.0.0:(\d+)/);if(m){base='http://127.0.0.1:'+m[1];resolve();}};child.stdout.on('data',read);child.stderr.on('data',b=>output+=b);child.once('exit',code=>reject(Error('Daemon exited before ready: '+code+' '+output)));});
  await within(ready); // Owner socket setup finishes immediately after the TCP listener.
 };
 const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{authorization:'Bearer '+owner,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  await start();if(scenario==='forced')await within(metadata);
  if(scenario==='reflection'){const saving=fileReady(join(dataDir,'reflection-saving'));assert.equal((await request('/reflection/run','POST')).status,202);await saving;}
  else if(scenario==='hosted-release-failed'){assert.equal((await request('/computer/start','POST',{})).status,202);await within((async()=>{while((await(await request('/computer')).json()).state!=='running')await new Promise(resolve=>setTimeout(resolve,25));})());}
  else{
   const ready=['active','forced'].includes(scenario)?fileReady(pidFile):undefined;
   assert.equal((await request('/rooms/main/messages','POST',{text:'Run the fixed disposable command once.'})).status,202);
   if(ready){await ready;if(scenario==='active')assert.equal((await request('/rooms/main/messages','POST',{text:'Queued disposable command.'})).status,202);}
   else{await within((async()=>{while(!approvalId){const a=await(await request('/approvals')).json();approvalId=a.approvals?.[0]?.id;if(!approvalId)await new Promise(resolve=>setTimeout(resolve,25));}})());}
  }
  const exited=once(child,'exit'),stopped=performance.now();child.kill('SIGTERM');child.kill('SIGINT');
  if(scenario==='reflection'){
   const exitedBeforeRelease=await Promise.race([exited.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),150))]);
   assert.equal(exitedBeforeRelease,false,'Shutdown must wait for the in-flight reflection save');
   writeFileSync(join(dataDir,'release-save'),'continue');
  }
  const [code]=await within(exited,25000);const elapsedMs=Math.round(performance.now()-stopped);
  writeFileSync(join(dataDir,'shutdown.log'),output);
  assert.equal(code,['forced','hosted-release-failed'].includes(scenario)?1:0,output);assert.ok(elapsedMs<23000);assert.ok(output.includes(scenario==='forced'?'shutdown incomplete after 20 seconds':scenario==='hosted-release-failed'?'incomplete stop':'execution drained'),output);assert.ok(!/database.*closed|SQLITE_MISUSE/i.test(output),output);
  if(scenario==='hosted-release-failed'){assert.ok(existsSync(join(dataDir,'release-attempt')));assert.ok(!output.includes('execution drained'));}
  const retained=openDb(dataDir);try{
   if(['active','forced'].includes(scenario)){assert.equal(alive(Number(readFileSync(pidFile,'utf8'))),false,'Owned child must be dead when daemon exits');assert.equal(existsSync(after),false);assert.ok(retained.prepare("SELECT 1 FROM turns WHERE status='interrupted'").get());assert.equal(calls,1,'Queued admission must not execute during drain');assert.equal(retained.prepare('SELECT count(*) AS n FROM chat_dispatches').get().n,scenario==='active'?2:1);assert.ok(retained.prepare("SELECT 1 FROM action_receipts WHERE outcome='unknown'").get());}
   if(scenario==='reflection'){
    const memory=readFileSync(join(dataDir,'bots/fixture/MEMORY.md'),'utf8');assert.match(memory,/First shutdown note/);assert.match(memory,/Second shutdown note/);
    assert.equal(retained.prepare('SELECT status FROM reflection_runs ORDER BY id DESC LIMIT 1').get().status,'finished');
    assert.equal(retained.prepare("SELECT count(*) AS n FROM approvals WHERE tool_name='reflection_memory'").get().n,0);
    assert.equal(retained.prepare("SELECT status FROM approvals WHERE tool_name='reflection_skill'").get().status,'pending');
   }
   if(scenario==='pending'){assert.equal(retained.prepare('SELECT status FROM approvals WHERE id=?').get(approvalId).status,'pending');assert.equal(existsSync(pidFile),false);}
  }finally{retained.close();}
  if(scenario==='pending'){
   const previousCalls=calls;await start();assert.equal((await(await request('/approvals')).json()).approvals.some(a=>a.id===approvalId),true);assert.equal(calls,previousCalls);assert.equal(existsSync(pidFile),false,'Restart must not replay pending review');const exitedAgain=once(child,'exit');child.kill('SIGTERM');assert.equal((await within(exitedAgain))[0],0);
  }
  evidence.push({scenario,exitCode:code,elapsedMs,childStopped:['active','forced'].includes(scenario)?true:undefined,pendingReviewRetained:scenario==='pending'?true:undefined});console.log('PASS actual daemon '+scenario+' '+elapsedMs+'ms');
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}
}
writeFileSync(join(dir,'acceptance.json'),JSON.stringify(evidence,null,2));console.log('PASS actual daemon shutdown: '+join(dir,'acceptance.json'));
