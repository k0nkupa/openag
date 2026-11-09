// Real disposable gateway; all model/computer execution is controlled and never contacts a provider.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json');
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {serve}=require('@hono/node-server');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createAuth}=await load('auth'),{createApprovals}=await load('approvals');
const {createBot,createRoom,addMember}=await load('rooms'),{getSetting,setSetting}=await load('settings');
const {createComputer}=await load('computer'),{createComputerRouter}=await load('computer/router'),{createTakeover}=await load('takeover');
const {createGateway,attachStream}=await load('gateway'),{createRunner}=await load('runtimes/runner');
const {ensureDataRepo,commitMemory}=await load('datagit');
const {createBotModels}=await load('botmodels');
const {createWork}=await load('work');
export async function startUsabilityFixture({includeWork=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'openag-usability-')),db=openDb(dir),ledger=createLedger(db),ownerToken=randomUUID();
 await ensureDataRepo(dir);
 const auth=createAuth({db,ownerToken}),approvals=createApprovals(db,ledger);
 createBot(db,{id:'boss',name:'Desk agent',runtime:'api',model:'openai/controlled'});
 createBot(db,{id:'other',name:'Other agent',runtime:'api',model:'openai/controlled'});
 createBot(db,{id:'model',name:'Default model agent',runtime:'acp',model:'claude-code'});
 createRoom(db,{id:'main',name:'Main',leadBotId:'boss'});addMember(db,'main','boss');
 setSetting(db,'defaultBot',{botId:'boss'});
 const full=auth.createDevice('Acceptance browser','owner','full'),limited=auth.createDevice('Limited browser','owner','limited');
 const controls={info:{state:'missing',status:'missing',runtime:'controlled'},absent:false,malformed:false,busy:false,held:false,memory:'normal',lastError:null,unavailable:{},operations:[],releases:0,writes:0};
 const run=async(_bin,args)=>{
  controls.operations.push(args.slice(0,2).join(' '));
  if(args[1]==='info')return {code:controls.absent?3:0,stdout:controls.malformed?'not json':JSON.stringify(controls.info),stderr:'',timedOut:false};
  throw Error('Unexpected lifecycle command in read-only acceptance');
 };
 const make=backend=>{
  const computer=createComputer({dataDir:dir,name:'acceptance',run});
  return {...computer,busy:()=>controls.busy||computer.busy(),status:async()=>({...await computer.status(),backend,busy:controls.busy,...(controls.lastError?{lastError:controls.lastError}:{})}),capabilities:()=>({shell:false,view:'none',hosted:backend==='browserbase'}),stop:async()=>{controls.releases++;return {...await computer.status(),backend};}};
 };
 let takeover;
 const computer=createComputerRouter({create:Object.fromEntries(['cua','browserbase','docker','ssh'].map(kind=>[kind,()=>make(kind)])),unavailable:Object.fromEntries(['cua','browserbase','docker','ssh'].map(kind=>[kind,()=>controls.unavailable[kind]??null])),wanted:()=>getSetting(db,'computer').backend,switchBlocked:()=>controls.held||takeover?.state().active===true,ledger});
 takeover=createTakeover({computer,ledger});
 const actualTakeoverState=takeover.state;
 takeover.state=()=>controls.held?{active:true,by:{kind:"owner"},since:Date.now(),idleExpiresAt:Date.now()+60000}:actualTakeoverState();
 const runner=createRunner({db,ledger,approvals,dataDir:dir,tools:{},runtimes:{api:{async runTurn(ctx){if(controls.turnBarrier)await controls.turnBarrier;ctx.ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'**Streamed response**\n\n- Complete\n- No provider used'});}}}});
 const botModels={...createBotModels({db,ledger,env:{},fetch:async()=>{throw Error('No provider in acceptance');},withIdleBot:async(_id,fn)=>fn(),acp:{stopBot:async()=>{},discover:async(_bot,target,model)=>({target,model:model||'controlled-default',models:[{id:'controlled-default',name:'Controlled default'},{id:'controlled-other',name:'Other controlled model'}],controls:[{id:'effort',name:'Effort',values:[{value:'low',name:'Low'},{value:'high',name:'High'}]}],reason:null,source:'controlled'})}}),creationTargets:()=>[{id:'claude',name:'Controlled adapter',configured:true}]};
 await botModels.catalogue.refresh();
 const work=includeWork?createWork(db,ledger):undefined;
 const app=createGateway({work,db,ledger,approvals,auth,dataDir:dir,computer,takeover,botModels,modelEnv:{},deskDir:root+'apps/desk/dist',dispatch:args=>runner.dispatch(args)});
 const server=serve({hostname:'127.0.0.1',port:0,fetch:async request=>{
  if(request.method==='GET'&&new URL(request.url).pathname==='/rooms'&&controls.roomsBarrier){controls.roomsStarted=true;await controls.roomsBarrier;}
  if(new URL(request.url).pathname==='/computer/backend/apply'&&controls.applyBarrier){controls.applyStarted=true;await controls.applyBarrier;}
  if(request.method==='PUT'&&new URL(request.url).pathname.endsWith('/memory')){
   controls.writes++;
   if(controls.memoryBarrier){controls.memoryStarted=true;await controls.memoryBarrier;}
   if(controls.memory==='refuse')return Response.json({error:'Controlled refused save'},{status:503});
   if(controls.memory==='lost'){await app.fetch(request);return Response.json({error:'Controlled response lost after save'},{status:503});}
  }
  return app.fetch(request);
 }});
 const detach=attachStream(server,ledger,auth);
 await new Promise(resolve=>server.once('listening',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const request=async(path,{method='GET',body,token=full.token}={})=>fetch(url+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=async(path,options)=>{const response=await request(path,options);if(!response.ok)throw Error(path+': '+response.status+' '+await response.text());return response.json();};
 const markdown='# Readable reply\n\n**Ready** and *clear*. [Source](https://example.com) [Unsafe](javascript:alert(1))\n\n- First\n- Second\n\n```js\nconst example = "'+('long-content-'.repeat(32))+'";\n```\n\n| Item | State |\n| --- | --- |\n| Read | Ready |\n\n<img src="https://example.com/tracker" onerror="alert(1)"><script>alert(1)</script>\n\n![Remote image](https://example.com/tracker.png)';
 ledger.append('main','user','message',{text:'**Keep user text literal**\n  Preserve  two spaces'});ledger.append('main','boss','bot_output',{text:markdown});
 let closed=false;
 return {url,dir,controls,request,json,ledger,full,limited,pairCode:()=>auth.createPairingCode('owner','full').code,async close(){if(closed)return;closed=true;await botModels.catalogue.close();takeover.dispose();runner.shutdown();work?.close();detach();await new Promise(resolve=>server.close(resolve));await commitMemory(dir,'acceptance: drain memory writes');db.close();rmSync(dir,{recursive:true,force:true});}};
}
if(process.argv.includes('--serve')&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const fixture=await startUsabilityFixture();
 console.log(JSON.stringify({url:fixture.url,pairingCode:fixture.pairCode(),note:'Disposable acceptance only; no live computer or provider'}));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void fixture.close().then(()=>process.exit()));
}
