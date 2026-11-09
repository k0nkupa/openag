// Disposable gateway + real App processes. --real-acp opts into bounded subscription adapter calls.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,watch} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
if(!process.argv.includes('--real-acp'))throw Error('Use --real-acp for the disposable real-adapter ownership checkpoint.');
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=n=>import(root+'apps/daemon/dist/'+n+'.js');
const {serve}=require('@hono/node-server');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createBot,createRoom,addMember}=await load('rooms'),{createRunner}=await load('runtimes/runner'),{createGateway}=await load('gateway');
const {createAcpRuntime}=await load('runtimes/acp'),{createMcpAccess}=await load('mcpserver'),{createAppsManager}=await load('apps'),{createPermissions}=await load('permissions');
const directory=mkdtempSync(join(tmpdir(),'openag-execution-ownership-')),evidence=[];
console.log('Disposable ownership evidence: '+directory);
function deadline(promise,ms=120000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Ownership checkpoint deadline; inspect evidence, do not replay.')),ms);})]).finally(()=>clearTimeout(timer));}
function fileReady(path){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{listener.close();reject(Error('App dispatch marker deadline'));},120000);const done=()=>{if(existsSync(path)){clearTimeout(timer);listener.close();resolve();}};const listener=watch(join(path,'..'),done);done();});}
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
for(const adapter of ['claude','codex']){
 const dataDir=join(directory,adapter),db=openDb(dataDir),ledger=createLedger(db),approvals=createApprovals(db,ledger);
 // Temporary owner authority never leaves this process except the fixture gateway header.
 const owner=randomUUID(),gatewayAuth=createAuth({db,ownerToken:owner});
 const bot=createBot(db,{id:'bot',runtime:'acp',config:{adapter}});createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
 const appDir=join(dataDir,'apps','ownership'),results=join(appDir,'data');mkdirSync(results,{recursive:true});
 writeFileSync(join(appDir,'main.cjs'),`const fs=require('node:fs');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const a=JSON.parse(input);if(!a.hold){fs.writeFileSync('data/first','one');console.log(JSON.stringify({status:'returned'}));return;}process.on('SIGTERM',()=>{});fs.writeFileSync('data/started',String(process.pid));setTimeout(()=>{fs.writeFileSync('data/after','must not happen after cancellation');console.log(JSON.stringify({status:'returned late'}));},6000);});`);
 writeFileSync(join(appDir,'manifest.json'),JSON.stringify({id:'ownership',name:'Ownership checkpoint',version:'1.0.0',description:'Fixed disposable local target only',tools:[{name:'probe',class:'act-local',description:'Write a fixed disposable marker. hold false returns immediately; hold true announces its PID then waits. Invoke only as instructed, never retry.',input:{type:'object',properties:{hold:{type:'boolean'}},required:['hold']},exec:{argv:['node','main.cjs'],timeoutSec:15}}]}));
 let enabled={};const apps=createAppsManager({dataDir,getEnabled:()=>enabled,setEnabled:value=>{enabled=value;}});apps.enable('ownership',apps.scan()[0].hash);
 const permissions=createPermissions(db,ledger,dataDir,approvals);let runner,base,running;
 const access=createMcpAccess({dataDir,runner:{activeTurn:(...args)=>runner.activeTurn(...args)},tools:()=>apps.toolDefs()});
 const acp=createAcpRuntime({dataDir,mcp:{access,baseUrl:()=>base,tools:new Set(['app_ownership_probe'])}});
 runner=createRunner({db,ledger,approvals,dataDir,permissions,runtimes:{acp},tools:{},dynamicTools:()=>apps.executors()});
 const app=createGateway({db,ledger,approvals,auth:gatewayAuth,dataDir,permissions,work:runner.work,cancelWork:runner.cancelWork,dispatch:args=>{running=runner.dispatch(args);return running;}});
 const server=serve({hostname:'127.0.0.1',port:0,fetch:req=>new URL(req.url).pathname==='/mcp'?access.handle(req):app.fetch(req)});if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
 const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{authorization:'Bearer '+owner,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const select=async preset=>{const old=await(await request('/bots/bot/permissions?roomId=main')).json();assert.equal((await request('/bots/bot/permissions?roomId=main','PUT',{preset,revision:old.revision,acknowledgeFullAccess:preset==='full-access'})).status,200);};
 const post=async hold=>{assert.equal((await request('/rooms/main/messages','POST',{text:`Call only app_ownership_probe exactly once with ${JSON.stringify({hold})}. Do not use native tools or any other tool, do not retry and do not write elsewhere. Stop after its result or cancellation.`})).status,202);};
 try{
  const choice=await acp.discover(bot,adapter);db.prepare('UPDATE bots SET config_json=? WHERE id=?').run(JSON.stringify({...bot.config,modelConfig:{model:choice.model}}),'bot');await select('full-access');
  await post(false);await deadline(running);assert.equal(readFileSync(join(results,'first'),'utf8'),'one');
  const first=db.prepare('SELECT id,state_json FROM turns ORDER BY rowid DESC LIMIT 1').get();
  const ready=fileReady(join(results,'started'));await post(true);await ready;const pid=Number(readFileSync(join(results,'started'),'utf8'));assert.ok(alive(pid));
  const stopped=performance.now();await select('read-only');await deadline(running,15000);
  const second=db.prepare('SELECT id,state_json FROM turns ORDER BY rowid DESC LIMIT 1').get();assert.equal(JSON.parse(first.state_json).acpSessionId,JSON.parse(second.state_json).acpSessionId,'Second call must reuse the unchanged session before cancellation');
  const receipt=db.prepare('SELECT id,outcome FROM action_receipts WHERE turn_id=? ORDER BY seq DESC LIMIT 1').get(second.id);
  const row={adapter,model:choice.model,firstTurn:first.id,cancelledTurn:second.id,receiptId:receipt?.id,outcome:receipt?.outcome,elapsedMs:Math.round(performance.now()-stopped),childStopped:!alive(pid),postCancelEffect:existsSync(join(results,'after'))};evidence.push(row);
  console.log(JSON.stringify(row));
 }finally{runner.shutdown();await Promise.allSettled([...(running?[running]:[]),acp.close()]);await runner.idle();runner.work.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
}
writeFileSync(join(directory,'real-acp.json'),JSON.stringify(evidence,null,2));
assert.ok(evidence.every(row=>row.childStopped&&!row.postCancelEffect&&row.outcome==='unknown'&&row.elapsedMs<3000),'App cancellation must stop execution promptly, preserve Unknown and prevent the next effect');
console.log('PASS real ACP App cancellation and second-call reuse: '+join(directory,'real-acp.json'));
