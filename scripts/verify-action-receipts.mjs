// Controlled HTTP/runner acceptance. Synthetic actions only; no model account or unit runner.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'openag-view-')),ownerToken=randomBytes(32).toString('hex');
let child,base;const messages=[];
async function until(read,predicate,label){const end=Date.now()+15000;do{const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,30));}while(Date.now()<end);throw Error('Deadline: '+label);}
async function start(){child=fork(root+'scripts/work-view-fixture.mjs',[dir],{stdio:['ignore','ignore','pipe','ipc']});child.stderr.on('data',d=>process.stderr.write(d));child.on('message',m=>messages.push(m));const ready=once(child,'message');child.send({ownerToken});base=(await ready)[0].url;}
const req=(path,{method='GET',body,token=ownerToken}={})=>fetch(base+path,{method,headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
async function json(path){const r=await req(path);assert.equal(r.status,200,path);return r.json();}
async function propose(to,mode='normal',text='Original reviewed draft',bot='boss'){
 const r=await req('/rooms/main/messages',{method:'POST',body:{text:'@'+bot+' Receipt '+JSON.stringify({to,text,mode})}});assert.equal(r.status,202);const message=(await r.json()).message;
 return(await until(()=>json('/approvals'),p=>p.approvals.some(a=>a.toolName==='receipt_send'&&a.payload.to===to),'pending '+to)).approvals.find(a=>a.toolName==='receipt_send'&&a.payload.to===to);
}
const decide=(a,decision,version=a.reviewVersion)=>req('/approvals/'+a.id,{method:'POST',body:{...decision,reviewVersion:version}});
const result=(a,outcome)=>until(()=>json('/approvals/'+a.id),p=>p.receipt?.outcome===outcome,'receipt '+outcome);
async function inspect(a){const count=markers().length;const response=await req('/approvals/'+a.id+'/inspection',{method:'POST',body:{reviewVersion:a.reviewVersion,note:'Inspected the controlled marker and target state. No automatic replay is authorized.',reference:'synthetic target marker '+a.payload.to}});assert.equal(response.status,200);const r=(await response.json()).receipt;assert.equal(r.outcome,'unknown');assert.ok(r.inspectedAt);assert.equal(markers().length,count,'inspection must not replay');}

const markers=()=>{try{return readFileSync(join(dir,'action-markers.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return[];}};
await start();
try{
 const edited=await propose('edit-target');assert.ok(edited.canEdit);assert.ok(edited.reviewVersion);assert.equal((await decide(edited,{kind:'accept'},'stale-version')).status,409);
 assert.equal((await req('/approvals/'+edited.id,{method:'POST',body:{kind:'accept'}})).status,409);
 assert.equal((await decide(edited,{kind:'edit',payload:{...edited.payload,text:42}})).status,400);assert.equal((await json('/approvals/'+edited.id)).approval.status,'pending');assert.equal(markers().length,0);
 const decision={kind:'edit',payload:{...edited.payload,text:'Exact owner edit'}};const concurrent=await Promise.all([decide(edited,decision),decide(edited,decision)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 const done=await result(edited,'completed');assert.equal(done.receipt.effective.text,'Exact owner edit');assert.equal(done.receipt.proposal.text,'Original reviewed draft');assert.equal(done.receipt.reviewVersion,edited.reviewVersion);assert.ok(done.receipt.workId&&done.receipt.turnId&&done.receipt.toolCallId&&done.receipt.startedAt&&done.receipt.finishedAt);assert.equal(markers().filter(m=>m.to==='edit-target').length,1);
 assert.equal((await decide(edited,{kind:'accept'})).status,409);
 for(const kind of ['ignore','respond']){const a=await propose(kind);assert.equal((await decide(a,kind==='respond'?{kind,text:'Prepare a different proposal'}:{kind})).status,200);const r=await result(a,'not-run');assert.equal(r.receipt.startedAt,null);assert.equal(markers().some(m=>m.to===kind),false);}
 const failed=await propose('refused','reject');await decide(failed,{kind:'accept'});await result(failed,'failed');assert.equal(markers().some(m=>m.to==='refused'),false);
 const staleApproval=await propose('pre-inspection','normal','Old pending proposal must expire','helper');
 const lost=await propose('lost-response','lost');await decide(lost,{kind:'accept'});const unknown=await result(lost,'unknown');assert.equal(markers().filter(m=>m.to==='lost-response').length,1);assert.ok(unknown.receipt.startedAt);
 const limited=(await(await req('/devices',{method:'POST',body:{name:'Limited receipt verifier',access:'limited'}})).json()).token;
 const inspection={reviewVersion:lost.reviewVersion,note:'Inspected the synthetic marker and controlled target; no automatic replay is authorized.',reference:'synthetic lost-response target'};
 const refused=await req('/approvals/'+lost.id+'/inspection',{method:'POST',body:inspection,token:limited});assert.equal(refused.status,403);assert.equal((await refused.json()).error,'owner token required');
 assert.equal((await req('/approvals/'+lost.id+'/inspection',{method:'POST',body:{...inspection,reviewVersion:'stale'}})).status,409);
 const {stripTypeScriptTypes}=await import('node:module');const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');const compile=file=>stripTypeScriptTypes(readFileSync(root+'apps/desk/src/'+file,'utf8'),{mode:'transform'});
 const ownerUrl=moduleUrl(compile('ownerSession.ts')),owner=await import(ownerUrl);const {createApi}=await import(moduleUrl(compile('api.ts').replace(/from ["']\.\/ownerSession["']/,`from "${ownerUrl}"`)));
 owner.setOwnerToken(ownerToken);const desk=createApi(limited,()=>{throw Error('Unexpected authorization failure');},(path,options)=>fetch(new URL(path,base),options));const inspected=await desk.inspectReceipt(lost.id,inspection);owner.clearOwnerToken();assert.equal(inspected.receipt.outcome,'unknown');assert.ok(inspected.receipt.inspectedAt);assert.equal((await json('/approvals/'+staleApproval.id)).approval.status,'ignored');await result(staleApproval,'not-run');assert.equal((await decide(staleApproval,{kind:'accept'})).status,409);assert.equal(markers().some(m=>m.to==='pre-inspection'),false);assert.equal(markers().filter(m=>m.to==='lost-response').length,1);

 const held=await propose('crash-target','hold');const competitor=await propose('concurrent-target','normal','Competing synthetic action','helper');await decide(held,{kind:'accept'});await until(()=>json('/approvals/'+held.id),r=>!!r.receipt?.startedAt,'execution started before crash');
 await decide(competitor,{kind:'accept'});await result(competitor,'not-run');assert.equal(markers().some(m=>m.to==='concurrent-target'),false);
 const exit=once(child,'exit');child.kill('SIGKILL');await exit;await start();await result(held,'unknown');await result(lost,'unknown');await result(edited,'completed');assert.equal(markers().filter(m=>m.to==='crash-target').length,1);
 const count=markers().length;const repeated=await req('/rooms/main/messages',{method:'POST',body:{text:'Receipt '+JSON.stringify({to:'lost-response',text:'Changed draft must not bypass uncertainty',mode:'normal'})}});assert.equal(repeated.status,202);const repeatedId=(await repeated.json()).message.id;
 await until(()=>json('/work?limit=100'),p=>p.work.some(w=>w.requestId===repeatedId&&['completed','failed','interrupted'].includes(w.status)),'blocked repeat settled');assert.equal(markers().length,count);assert.equal((await json('/approvals')).approvals.some(a=>a.payload?.to==='lost-response'),false);
 for(const path of ['/approvals/'+edited.id,'/work/'+done.receipt.workId+'/receipts'])assert.equal((await req(path,{token:'wrong'})).status,401);
 const workReceipts=await json('/work/'+done.receipt.workId+'/receipts');assert.equal(workReceipts.receipts[0].approvalId,edited.id);assert.equal((await req('/work/missing/receipts')).status,404);
 for(const cls of ['act-external','secrets'])assert.equal((await req('/bots/boss/tool-modes/'+cls,{method:'PUT',body:{mode:'auto'}})).status,410);
 await inspect(held);
 // A changed target and silently stripped edit fields must fail before a file write.
 const coderPermissions=await json('/bots/coder/permissions?roomId=main');assert.equal((await req('/bots/coder/permissions?roomId=main',{method:'PUT',body:{preset:'read-only',revision:coderPermissions.revision}})).status,200);
 const workspace=join(dir,'bots','coder','work');mkdirSync(workspace,{recursive:true});writeFileSync(join(workspace,'approval.txt'),'Original on-disk text');
 await req('/rooms/main/messages',{method:'POST',body:{text:'@coder Approval local draft'}});
 const file=(await until(()=>json('/approvals'),p=>p.approvals.some(a=>a.toolName==='write_file'),'file review')).approvals.find(a=>a.toolName==='write_file');
 assert.equal(file.review.before,'Original on-disk text');assert.equal((await decide(file,{kind:'edit',payload:{...file.payload,extra:'must not be silently stripped'}})).status,400);
 writeFileSync(join(workspace,'approval.txt'),'Changed independently after review');await decide(file,{kind:'accept'});await result(file,'not-run');assert.equal(readFileSync(join(workspace,'approval.txt'),'utf8'),'Changed independently after review');
 // An approved edit after restart must not grant a regenerated body with only the same target.
 const restartEdit=await propose('restart-edit-target');let exit2=once(child,'exit');child.send({type:'stop'});await exit2;await start();
 await decide(restartEdit,{kind:'edit',payload:{...restartEdit.payload,text:'Owner edit after restart'}});
 const regenerated=(await until(()=>json('/approvals'),p=>p.approvals.some(a=>a.id!==restartEdit.id&&a.payload?.to==='restart-edit-target'),'exact reapproval')).approvals.find(a=>a.payload?.to==='restart-edit-target');
 assert.equal(markers().some(m=>m.to==='restart-edit-target'),false);await decide(regenerated,{kind:'ignore'});await result(restartEdit,'not-run');
 const crossUnknown=await propose('cross-unknown','lost');await decide(crossUnknown,{kind:'accept'});await result(crossUnknown,'unknown');
 const crossBot=await req('/rooms/main/messages',{method:'POST',body:{text:'@helper Receipt '+JSON.stringify({to:'different-external-target',text:'Different bot must not bypass unresolved external action',mode:'normal'})}});assert.equal(crossBot.status,202);const crossId=(await crossBot.json()).message.id;
 const crossPage=await until(()=>json('/work?limit=100'),p=>p.work.some(w=>w.requestId===crossId&&['completed','failed','interrupted'].includes(w.status)),'cross-bot fence');const crossWork=crossPage.work.find(w=>w.requestId===crossId);assert.ok((await json('/work/'+crossWork.id+'/activity')).events.some(e=>e.type==='tool_result'&&e.payload.status==='denied'));assert.equal(markers().filter(m=>m.to==='lost-response').length,1);
 await inspect(crossUnknown);
 const pending=await propose('browser-pending','normal','Original reviewed draft','helper');
 const browserUnknown=await propose('browser-unknown','lost');await decide(browserUnknown,{kind:'accept'});await result(browserUnknown,'unknown');
 // Historical and chat-only fixtures are explicit controlled states, never migrated live history.
 const casesReady=once(child,'message',{signal:AbortSignal.timeout(15000)});child.send({type:'receipt-cases'});const [cases]=await casesReady;
 const deskRequire=createRequire(root+'apps/desk/package.json'),daemonRequire=createRequire(root+'apps/daemon/package.json'),{JSDOM,VirtualConsole}=deskRequire('jsdom'),{WebSocket}=daemonRequire('ws');
 const assets=root+'apps/desk/dist/assets/',bundle=readFileSync(assets+readdirSync(assets).find(name=>/^index-.*\.js$/.test(name)),'utf8');
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>{if(!error.message.includes('Not implemented'))errors.push(error.message);});
 const dom=new JSDOM('<div id="root"></div>',{url:base+'/#/approvals/'+edited.id,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 const visible=e=>!e.closest('[hidden]'),button=label=>[...w.document.querySelectorAll('button')].find(e=>visible(e)&&e.textContent.trim()===label);
 const fill=(id,value)=>{const e=w.document.getElementById(id),prototype=e.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,value);e.dispatchEvent(new w.Event('input',{bubbles:true}));};
 try {
  let failInspection=false,failedPosts=0;
  const normalFetch=async(path,options)=>{
   if(failInspection&&options?.method==='POST'&&String(path).endsWith('/inspection')){failedPosts++;return Response.json({error:'Controlled inspection outage'},{status:503});}
   const response=await fetch(new URL(path,base),options);
   return response;
  };w.fetch=normalFetch;w.WebSocket=WebSocket;
  w.matchMedia=query=>({matches:query.includes('min-width:1180'),media:query,addEventListener(){},removeEventListener(){}});
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};w.localStorage.setItem('openag-token',ownerToken);w.eval(bundle);
  await until(()=>w.document.querySelector('[aria-label="Execution outcome"]'),e=>e?.textContent.includes('Completed'),'separate completed execution');
  assert.ok(w.document.querySelector('[aria-label="Decision receipt"]').textContent.includes('Accepted with your edit'));
  assert.ok([...w.document.querySelectorAll('pre code')].some(e=>e.textContent.includes('Exact owner edit')));
  assert.equal(button('Receipt details').getAttribute('aria-expanded'),'false');
  w.location.hash='#/approvals/'+cases.invocation;await until(()=>w.document.querySelector('[aria-label="Execution outcome"]'),e=>e?.textContent.includes('External change verification: Not checked'),'independent effect verification');assert.ok(w.document.querySelector('[aria-label="Execution outcome"]').textContent.includes('Succeeded'));assert.ok(w.document.querySelector('[aria-label="Execution outcome"]').textContent.includes('Tool result'));assert.equal((await json('/approvals/'+cases.invocation)).receipt.evidence.effectVerification,'not-checked');
  w.location.hash='#/approvals/'+cases.legacy;await until(()=>w.document.body.textContent,t=>t.includes('No durable execution receipt'),'legacy receipt');assert.ok(w.document.querySelector('[aria-label="Execution outcome"]').textContent.includes('Unconfirmed'));
  w.location.hash='#/approvals/'+cases.legacyEdited;await until(()=>button('Exact edited payload'),Boolean,'legacy edit retained');assert.ok([...w.document.querySelectorAll('pre code')].some(e=>e.textContent.includes('Historical accepted edit')),'Legacy edited payload is never the original proposal');
  w.location.hash='#/approvals/'+cases.pendingExecution;await until(()=>w.document.querySelector('[aria-label="Execution outcome"]'),e=>e?.textContent.includes('Pending execution evidence'),'pending evidence');
  assert.equal((await json('/approvals/'+cases.legacyMissingEdit)).approval.edit,null);w.location.hash='#/approvals/'+cases.legacyMissingEdit;await until(()=>w.document.body.textContent,t=>t.includes('The accepted edit is unavailable'),'missing historical edit is explicit');assert.equal(w.document.querySelector('[aria-label="Action target"]'),null,'An original target is not presented as the accepted edit');
  w.location.hash='#/approvals/'+browserUnknown.id;await until(()=>w.document.getElementById('inspection-note-'+browserUnknown.id),Boolean,'unknown inspection');
  fill('inspection-reference-'+browserUnknown.id,'Synthetic checked target');fill('inspection-note-'+browserUnknown.id,'Inspected the synthetic target. No action was repeated.');await new Promise(resolve=>setTimeout(resolve,20));
  const unload=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true,'Inspection draft is protected');
  failInspection=true;
  button('Record inspection').click();await until(()=>w.document.body.textContent,t=>t.includes('Could not record inspection: Controlled inspection outage'),'inspection failure labelled');assert.equal(failedPosts,1);assert.ok(!w.document.body.textContent.includes('Could not load this receipt'));
  w.location.hash='#/work';await until(()=>w.document.querySelector('[role="alertdialog"]'),Boolean,'guard inspection draft');button('Keep editing').click();await until(()=>w.location.hash,h=>h==='#/approvals/'+browserUnknown.id,'inspection route retained');assert.equal(w.document.getElementById('inspection-reference-'+browserUnknown.id).value,'Synthetic checked target');
  const before=markers().length;failInspection=false;button('Record inspection').click();
  await until(()=>w.document.querySelector('[aria-label="Recorded target inspection"]'),Boolean,'confirmed inspection readback');assert.equal((await json('/approvals/'+browserUnknown.id)).receipt.outcome,'unknown');assert.equal(markers().length,before,'Inspection never replays an action');
  const cleanUnload=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(cleanUnload);assert.equal(cleanUnload.defaultPrevented,false,'Confirmed inspection clears dirty state');
  assert.deepEqual(errors,[]);console.log('PASS shipped receipts: separate decision/outcome, exact edit, legacy/pending/unknown states, failed inspection/draft guard and confirmed no-replay inspection.');
 } finally {w.close();}
 await decide(pending,{kind:'ignore'});await result(pending,'not-run');
 const capturePending=await propose('capture-pending','normal','Exact browser proposal','helper'),captureUnknown=await propose('capture-unknown','lost');await decide(captureUnknown,{kind:'accept'});await result(captureUnknown,'unknown');
 const evidence={url:base,dir,edited:edited.id,lost:captureUnknown.id,crashed:held.id,pending:capturePending.id,failed:failed.id,notRun:file.id,legacy:cases.legacy,legacyEdited:cases.legacyEdited,legacyMissingEdit:cases.legacyMissingEdit,pendingExecution:cases.pendingExecution,workId:done.receipt.workId};writeFileSync(join(dir,'receipt-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 console.log('OA-324 passed: exact edited proposal/version, validation before decision, stale/double decisions, ignore/respond, confirmed failure/completion, lost response and process-crash uncertainty, repeat fence, receipt persistence/auth and retired category writes.');
 if(process.argv.includes('--serve')){const ready=once(child,'message');child.send({type:'pair'});evidence.pairCode=(await ready)[0].code;console.log(JSON.stringify(evidence));process.stdin.setEncoding('utf8');process.stdin.on('data',async text=>{try{const command=JSON.parse(text);if(!['disconnect','connect','stats'].includes(command.type))throw Error('Unsupported verification command');const reply=once(child,'message');child.send(command);console.log(JSON.stringify((await reply)[0]));}catch(error){console.log(JSON.stringify({error:error.message}));}});await new Promise(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);});}
}finally{if(child?.connected){const exit=once(child,'exit');child.send({type:'stop'});await exit;}process.stdin.pause();}
