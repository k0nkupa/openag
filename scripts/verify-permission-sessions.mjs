// Actual public gateway, runner, gate and subprocesses with temporary data. No unit runner or provider network.
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync,readdirSync,copyFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json');
const load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const {serve}=require('@hono/node-server'),{z}=require('zod');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createPermissions}=await load('permissions'),{createGateway}=await load('gateway'),{createRunner}=await load('runtimes/runner');
const {createBot,createRoom,addMember}=await load('rooms'),{commandTool}=await load('tools/execution'),{toExecutors}=await load('tools/registry');
const directory=mkdtempSync(join(tmpdir(),'openag-permission-sessions-')),token=randomUUID();
let db,ledger,approvals,permissions,runner,server,base,current,results=[],pendingRun,releaseDispatch,dispatchEntered;
const quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
async function start(){
 db=openDb(directory);ledger=createLedger(db);approvals=createApprovals(db,ledger);permissions=createPermissions(db,ledger,directory,approvals);
 if(!db.prepare('SELECT 1 FROM bots WHERE id=?').get('bot')){
  createBot(db,{id:'bot',runtime:'api'});createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
  createRoom(db,{id:'other',leadBotId:'bot'});addMember(db,'other','bot');
 }
 const unknown={name:'effect_fixture',class:'act-external',description:'Controlled unknown effect',input:z.object({target:z.string()}).strict(),permission:()=>({approval:'allow'}),execute:async()=>({untrusted:true}),confirm:()=>({outcome:'unknown',detail:'Synthetic lost response; no real business effect.'})};
 const mandatory={...unknown,name:'review_fixture',permission:()=>({approval:'review'}),confirm:()=>({outcome:'completed',detail:'Controlled no-op.'})};
 const runtime={async runTurn(ctx){results.push(await ctx.callTool(current.tool??'run_shell',current.args));}};
 runner=createRunner({db,ledger,approvals,dataDir:directory,permissions,runtimes:{api:runtime},tools:toExecutors([{...commandTool,execute:async(ctx,args)=>{if(current.defer){dispatchEntered();await new Promise(resolve=>{releaseDispatch=resolve;});}return commandTool.execute(ctx,args);}},unknown,mandatory])});
 const app=createGateway({db,ledger,approvals,auth:createAuth({db,ownerToken:token}),dataDir:directory,permissions,work:runner.work,dispatch:args=>{pendingRun=runner.dispatch(args);return pendingRun;}});
 server=serve({hostname:'127.0.0.1',port:0,fetch:req=>app.fetch(req)});if(!server.listening)await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
}
async function stop(){await runner.idle();await new Promise(r=>server.close(r));db.close();}
const request=(path,method='GET',body,credential=token)=>fetch(base+path,{method,headers:{authorization:'Bearer '+credential,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const json=async path=>{const r=await request(path);assert.equal(r.status,200);return r.json();};
async function select(preset,room='main'){const path='/bots/bot/permissions?roomId='+room;const s=await json(path);const r=await request(path,'PUT',{preset,revision:s.revision,acknowledgeFullAccess:preset==='full-access'});assert.equal(r.status,200);return r.json();}
async function begin(args,tool,room='main'){current={args,tool,defer:!!dispatchEntered};const r=await request('/rooms/'+room+'/messages','POST',{text:'One controlled permission operation.'});assert.equal(r.status,202);}
async function run(args,tool,room){await begin(args,tool,room);await pendingRun;return results.at(-1);}
async function checkAutomaticInDesk(id){
 const deskRequire=createRequire(root+'apps/desk/package.json'),{JSDOM}=deskRequire('jsdom');
 const dom=new JSDOM('<div id="root"></div>',{url:base+'/#/approval/'+id,pretendToBeVisual:true});
 for(const key of ['window','document','HTMLElement','Element','Node','MutationObserver','localStorage','sessionStorage'])globalThis[key]=dom.window[key];
 for(const key of ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'])globalThis[key]=dom.window[key].bind(dom.window);
 globalThis.matchMedia=dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let socket;globalThis.WebSocket=class{constructor(){socket=this;}close(){}};
 const {createServer}=await import(deskRequire.resolve('vite')),vite=await createServer({configFile:false,root:root+'apps/desk',resolve:{alias:{'@':root+'apps/desk/src'}},server:{middlewareMode:true,hmr:false},appType:'custom'});
 const React=deskRequire('react'),{act}=React,{createRoot}=deskRequire('react-dom/client'),reactRoot=createRoot(document.getElementById('root'));
 const {ReceiptPage}=await vite.ssrLoadModule('/src/components/ReceiptView.tsx'),{StreamProvider}=await vite.ssrLoadModule('/src/stream.tsx'),{createApi}=await vite.ssrLoadModule('/src/api.ts');
 const api=createApi(token,()=>{throw Error('Unexpected authentication failure');},(path,init)=>fetch(base+path,init));
 const off=ledger.subscribe('*',event=>socket?.onmessage?.({data:JSON.stringify(event)}));
 const until=async check=>{const deadline=Date.now()+5000;while(!check()){assert.ok(Date.now()<deadline,'Automatic receipt UI convergence');await act(async()=>new Promise(r=>setTimeout(r,20)));}};
 try{
  await act(async()=>reactRoot.render(React.createElement(StreamProvider,{token,onAuthFailure(){}},React.createElement(ReceiptPage,{api,approvalId:id,onDecide(){throw Error('An automatic receipt must not fabricate a human decision');}}))));
  await until(()=>document.body.textContent.includes('Outcome unknown'));
  assert.ok(document.body.textContent.includes('Automatically authorized; no human approval'));assert.ok(!document.body.textContent.includes('Your decision:'));
  assert.equal(document.querySelector('[aria-label="Record target inspection"]'),null);assert.equal(document.querySelector('textarea'),null);
  assert.equal(approvals.receipts.get(id).outcome,'unknown');
  console.log('PASS automatic receipt retains Unknown evidence without an inspection form.');

 }finally{off();await act(async()=>reactRoot.unmount());await vite.close();dom.window.close();}
}
async function historicalMigration(){
 const oldDir=mkdtempSync(join(tmpdir(),'openag-permission-history-')),migrationDir=join(oldDir,'migrations');mkdirSync(migrationDir);
 const {migrate}=await load('db/migrate'),{MIGRATIONS_DIR}=await load('db/index');
 for(const file of readdirSync(MIGRATIONS_DIR))if(/^\d+_.+\.sql$/.test(file)&&parseInt(file,10)<33)copyFileSync(join(MIGRATIONS_DIR,file),join(migrationDir,file));
 const historical=new(require('better-sqlite3'))(join(oldDir,'openag.db'));require('sqlite-vec').load(historical);historical.pragma('foreign_keys=ON');migrate(historical,migrationDir);
 try{
  createBot(historical,{id:'bot',runtime:'api'});createRoom(historical,{id:'main',leadBotId:'bot'});addMember(historical,'main','bot');
  historical.prepare(`INSERT INTO approvals(id,room_id,bot_id,tool_name,tool_class,payload_json,status,created_at,decided_at,review_version) VALUES('historical','main','bot','send_message','act-external','{"target":"legacy"}','accepted',1,2,'historical-version')`).run();
  historical.prepare(`INSERT INTO action_receipts(seq,approval_id,review_version,room_id,bot_id,tool_call_id,tool_name,action_key,decision,proposal_json,effective_json,outcome,evidence_json,decided_at,started_at,finished_at) VALUES(41,'historical','historical-version','main','bot','old-call','send_message','old-key','accepted','{"target":"legacy"}','{"target":"legacy"}','unknown','{"detail":"Original retained evidence"}',2,3,4)`).run();
  const original=historical.prepare('SELECT * FROM action_receipts').get(),originalApproval=historical.prepare('SELECT * FROM approvals').get();migrate(historical,MIGRATIONS_DIR);
  const migrated=historical.prepare('SELECT * FROM action_receipts').get();for(const [key,value]of Object.entries(original))assert.deepEqual(migrated[key],value,'Historical receipt '+key);
  assert.deepEqual(historical.prepare('SELECT * FROM approvals').get(),originalApproval);assert.equal(migrated.id,'historical');assert.equal(migrated.permission_json,null);assert.equal(historical.pragma('foreign_key_check').length,0);
  const retainedLedger=createLedger(historical),retainedApprovals=createApprovals(historical,retainedLedger),session=createPermissions(historical,retainedLedger,oldDir,retainedApprovals).ensure('bot','main');
  const id=retainedApprovals.receipts.automatic({roomId:'main',botId:'bot',turnId:'fixture',toolCallId:'fixture',toolName:'run_shell',args:{command:'not dispatched'}},session);
  assert.ok(historical.prepare('SELECT seq FROM action_receipts WHERE id=?').get(id).seq>41);assert.equal(retainedApprovals.receipts.get(id).approvalId,null);assert.equal(historical.prepare('SELECT count(*) n FROM approvals').get().n,1);retainedApprovals.receipts.recover();assert.equal(retainedApprovals.receipts.get(id).outcome,'not-run');assert.equal(retainedApprovals.receipts.get('historical').outcome,'unknown');
  console.log('PASS historical receipt migration: every old field, approval, id, ordering and uncertainty retained; automatic operation has no human row.');
 }finally{historical.close();}
}
await historicalMigration();
await start();
try{
 const initial=await json('/bots/bot/permissions?roomId=main');assert.equal(initial.preset,'workspace-write');
 assert.equal(initial.initialized,false);assert.equal(db.prepare('SELECT count(*) n FROM permission_sessions').get().n,0);assert.equal(existsSync(join(directory,'bots','bot','work')),false,'Inspection must not create a workspace');
 const workspace=join(directory,'bots','bot','work'),inside=join(workspace,'inside.txt'),outside=join(directory,'outside.txt');
 let result=await run({command:'printf workspace > '+quote(inside)});assert.equal(result.ok,true);assert.equal(readFileSync(inside,'utf8'),'workspace');assert.ok(result.receiptId);assert.equal(result.approvalId,undefined);
 const automatic=await json('/approvals/'+result.receiptId);assert.equal(automatic.approval,null);assert.equal(automatic.receipt.decision,'automatic');assert.equal(automatic.receipt.approvalId,null);assert.equal(automatic.receipt.permission.preset,'workspace-write');assert.equal(db.prepare('SELECT count(*) n FROM approvals').get().n,0);
 result=await run({command:'printf blocked > '+quote(outside)});assert.equal(result.ok,false);assert.equal(existsSync(outside),false);
 await select('read-only');result=await run({command:'printf changed > '+quote(inside)});assert.equal(result.ok,false);assert.equal(readFileSync(inside,'utf8'),'workspace');
 await begin({command:'printf reviewed > '+quote(outside),escalation:{reason:'One explicitly reviewed disposable outside write.'}});
 const pending=approvals.listPending()[0];assert.ok(pending);assert.equal(existsSync(outside),false);
 const decision=await request('/approvals/'+pending.id,'POST',{kind:'accept',reviewVersion:pending.reviewVersion});assert.equal(decision.status,200);await pendingRun;assert.equal(results.at(-1).ok,true);assert.equal(readFileSync(outside,'utf8'),'reviewed');assert.equal(results.at(-1).approvalId,pending.id);
 assert.equal((await json('/bots/bot/permissions?roomId=main')).preset,'read-only','Escalation must not widen the session');
 await select('full-access');result=await run({command:'printf full > '+quote(outside)});assert.equal(result.ok,true);assert.equal(readFileSync(outside,'utf8'),'full');
 result=await run({command:'printf forbidden > '+quote(outside),escalation:{reason:'Explicit review must never become automatic consent.'}});assert.equal(result.status,'denied');assert.equal(approvals.listPending().length,0);assert.equal(readFileSync(outside,'utf8'),'full');
 result=await run({target:'mandatory'},'review_fixture');assert.equal(result.status,'denied');
 const full=await json('/bots/bot/permissions?roomId=main');assert.equal((await request('/bots/bot/permissions?roomId=main','PUT',{preset:'read-only',revision:full.revision-1})).status,409);
 const def=await json('/permissions/default');assert.equal((await request('/permissions/default','PUT',{preset:'read-only',revision:def.revision})).status,200);assert.equal((await json('/bots/bot/permissions?roomId=main')).preset,'full-access');assert.equal((await json('/bots/bot/permissions?roomId=other')).preset,'read-only');
 const limited=(await(await request('/devices','POST',{name:'Permission fixture Limited',access:'limited'})).json()).token;assert.equal((await request('/bots/bot/permissions?roomId=main','GET',undefined,limited)).status,200);assert.equal((await request('/bots/bot/permissions?roomId=main','PUT',{preset:'full-access',revision:full.revision,acknowledgeFullAccess:true},limited)).status,403);
 await select('workspace-write');
 let entered;const atDispatch=new Promise(resolve=>{entered=resolve;});dispatchEntered=entered;
 await begin({command:'printf stale > '+quote(join(workspace,'never-dispatched.txt'))});current.defer=true;
 await atDispatch;dispatchEntered=undefined;await select('read-only');releaseDispatch();await pendingRun;assert.equal(results.at(-1).executionOutcome,'not-run');assert.equal(existsSync(join(workspace,'never-dispatched.txt')),false);
 await select('full-access');
 const beforeUnknown=results.length;result=await run({target:'uncertain'},'effect_fixture');assert.equal(result.status,'unknown');const receiptId=result.receiptId;assert.ok(receiptId);assert.equal(results.length,beforeUnknown+1);
 result=await run({command:'printf replay > '+quote(outside)});assert.equal(result.ok,true);assert.equal(readFileSync(outside,'utf8'),'replay');
 const retained=await json('/bots/bot/permissions?roomId=main');await stop();await start();assert.deepEqual(await json('/bots/bot/permissions?roomId=main'),retained);assert.equal((await json('/approvals/'+receiptId)).receipt.outcome,'unknown');
 result=await run({target:'different arguments'},'effect_fixture');assert.equal(result.status,'unknown','A new authorized invocation is not blocked by earlier history');
 assert.equal((await request('/attention?category=recovery')).status,404,'No Recovery queue remains');
 await checkAutomaticInDesk(receiptId);
 await select('workspace-write');await begin({command:'printf stale > '+quote(outside),escalation:{reason:'This pending request will be invalidated by a mode change.'}});assert.equal(approvals.listPending().length,1);await select('full-access');await pendingRun;assert.equal(results.at(-1).ok,false);assert.equal(approvals.listPending().length,0);assert.equal(readFileSync(outside,'utf8'),'replay');
 await select('full-access');await select('full-access','other');
 const partial=join(workspace,'partial-shell.txt'),cross=join(workspace,'cross-room-shell.txt');
 result=await run({command:'printf partial > '+quote(partial)+'; sleep 2',timeoutMs:200});assert.equal(result.status,'unknown');assert.equal(readFileSync(partial,'utf8'),'partial');const shellReceipt=result.receiptId;
 assert.equal(db.prepare('SELECT tool_class FROM action_receipts WHERE id=?').get(shellReceipt).tool_class,'act-external');
 result=await run({command:'printf forbidden > '+quote(cross)},undefined,'other');assert.equal(result.ok,true);assert.equal(existsSync(cross),true);
 result=await run({target:'cross-room opaque operation'},'review_fixture','other');assert.equal(result.status,'denied');assert.equal(approvals.listPending().length,0);
 await stop();await start();result=await run({target:'cross-room after restart'},'effect_fixture','other');assert.equal(result.status,'unknown');
 // Historical shell receipts keep their original class and do not block new operations.
 db.prepare("UPDATE action_receipts SET tool_class='act-local' WHERE id=?").run(shellReceipt);
 result=await run({target:'legacy shell receipt'},'effect_fixture','other');assert.equal(result.status,'unknown');await checkAutomaticInDesk(shellReceipt);
 console.log('PASS Unknown shell history does not block fresh authorized operations across conversations or restart.');
 console.log('PASS gateway permission sessions: three modes, exact escalation, Never refusal, automatic receipts, mode-change expiry, owner authority, defaults, revision conflicts, unknown-effect no-replay and restart.');
}finally{await stop();}
console.log('Disposable evidence: '+directory);
