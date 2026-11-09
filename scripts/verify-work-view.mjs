// Public-interface acceptance for Work search/context/activity and computer control. No unit runner or real account.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'openag-view-')),ownerToken=randomBytes(32).toString('hex'),messages=[];
let child,base;
async function wait(f,p,label){for(let i=0;i<400;i++){const value=await f();if(p(value))return value;await new Promise(r=>setTimeout(r,25));}throw Error('Deadline: '+label);}
async function start(){child=fork(root+'scripts/work-view-fixture.mjs',[dir],{stdio:['ignore','ignore','pipe','ipc']});child.stderr.on('data',data=>process.stderr.write(data));child.on('message',m=>messages.push(m));const ready=once(child,'message');child.send({ownerToken});const [message]=await ready;assert.equal(message.type,'ready');base=message.url;}
async function ipc(type,body={},response=type+'-result'){const before=messages.length;child.send({type,...body});return(await wait(()=>messages.slice(before),ms=>ms.some(m=>m.type===response),response)).find(m=>m.type===response);}
const req=(path,{method='GET',body,token=ownerToken}={})=>fetch(base+path,{method,headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
async function json(path){const response=await req(path);assert.equal(response.status,200,path);return response.json();}
async function post(room,text){const response=await req('/rooms/'+room+'/messages',{method:'POST',body:{text}});assert.equal(response.status,202);return(await response.json()).message;}
async function workFor(message){return(await wait(()=>json('/work?limit=100'),page=>page.work.some(w=>w.requestId===message.id),'Work exists')).work.find(w=>w.requestId===message.id);}
async function state(item,status){return(await wait(()=>json('/work/'+item.id),page=>page.work.status===status,'Work '+status)).work;}
async function completed(room,text){return state(await workFor(await post(room,text)),'completed');}
await start();
try{
 const interruptedMessage=await post('dm-boss','Working NEEDLE archived interruption');let interrupted=await workFor(interruptedMessage);await wait(()=>json('/work/'+interrupted.id+'/runs'),page=>page.runs[0]?.turnId,'running before crash');const exited=once(child,'exit');child.kill('SIGKILL');await exited;await start();interrupted=await state(interrupted,'interrupted');
 for(let i=0;i<28;i++)await completed('main','Complete archived item '+i);
 assert.ok(!(await json('/work?limit=25')).work.some(w=>w.id===interrupted.id));assert.equal((await json('/work?q=needle')).work[0].id,interrupted.id,'search spans records beyond page one');
 assert.equal((await json('/work?q=%25')).work.length,0,'literal percent does not become a wildcard');
 for(const query of ['q=','q='+encodeURIComponent('a'.repeat(301)),'after=1'])assert.equal((await req('/work?'+query)).status,400);
 assert.equal((await req('/work/'+interrupted.id+'/activity',{token:'wrong'})).status,401);assert.equal((await req('/work/missing/activity')).status,404);
 const failure=await state(await workFor(await post('dm-boss','Failure local operation')),'failed');
 const cancelCandidate=await workFor(await post('dm-boss','Working cancellation check'));await wait(()=>json('/work/'+cancelCandidate.id+'/runs'),page=>page.runs[0]?.turnId,'cancel running');const cancel=await req('/work/'+cancelCandidate.id+'/cancel',{method:'POST',body:{revision:(await json('/work/'+cancelCandidate.id)).work.revision}});assert.ok([200,202].includes(cancel.status));const cancelled=await state(cancelCandidate,'cancelled');
 const saved=await completed('main','Save comparison draft'),large=await completed('main','Large activity record');
 const selectMode=async preset=>{const old=await json('/bots/boss/permissions?roomId=main');assert.equal((await req('/bots/boss/permissions?roomId=main',{method:'PUT',body:{preset,revision:old.revision,acknowledgeFullAccess:preset==='full-access'}})).status,200);};
 await selectMode('full-access');const computerWork=await completed('main','Computer recorded use');await selectMode('workspace-write');
 const delegated=await completed('main','Delegate analysis');const children=(await json('/work?parentId='+delegated.id)).work;assert.equal(children.length,0,'delegation uses the assigned Work');assert.equal(delegated.progress.turns,3);
 const crossRoom=await completed('other','Complete cross-room result'),direct=await completed('dm-coder','Complete direct Coder request');
 const coderSelection=await json('/bots/coder/permissions?roomId=main');assert.equal((await req('/bots/coder/permissions?roomId=main',{method:'PUT',body:{preset:'read-only',revision:coderSelection.revision}})).status,200);
 const approval=await state(await workFor(await post('main','@coder Approval local draft')),'needs_approval');
 await ipc('extra-approval',{requestId:approval.requestId});await wait(()=>json('/work/'+approval.id+'/approvals'),page=>page.approvals.length===2,'parallel approval links');const sameState=(await json('/work/'+approval.id)).work;assert.equal(sameState.status,approval.status);assert.equal(sameState.progress.turns,approval.progress.turns);
 const input=await state(await workFor(await post('main','@helper Input budget question')),'needs_input');
 await selectMode('full-access');
 const workingMessage=await post('main','Working current operation'),working=await state(await workFor(workingMessage),'working');assert.equal(working.plan[0].state,'completed');assert.equal(working.planIsExecutionEvidence,false);assert.equal(working.progress.finishedTurns,0);
 for(const [name,item]of Object.entries({working,input,approval,saved,failure,interrupted,cancelled})){const filtered=(await json('/work?status='+item.status)).work;assert.ok(filtered.some(w=>w.id===item.id),name+' state filter');assert.ok(filtered.every(w=>w.status===item.status));}
 const code=(await json('/work?botId=coder')).work;assert.ok(code.some(w=>w.id===approval.id)&&code.some(w=>w.id===direct.id));assert.ok(code.every(w=>w.botId==='coder'));assert.ok((await json('/work?q=Coder')).work.every(w=>w.botId==='coder'));
 assert.ok((await json('/work?roomId=main')).work.every(w=>w.roomId==='main'));assert.ok(!(await json('/work?roomId=main')).work.some(w=>w.id===crossRoom.id));
 const hiddenMessage=await post('_internal','Complete private operation');const hidden=await wait(()=>ipc('lookup',{roomId:'_internal',requestId:hiddenMessage.id}),row=>!!row.workId,'hidden Work record');assert.equal((await req('/work/'+hidden.workId)).status,404);assert.equal((await req('/work/'+hidden.workId+'/activity')).status,404);
 for(const query of ['before=1&after=2','after=0','before=-1','limit=101','extra=1'])assert.equal((await req('/work/'+saved.id+'/activity?'+query)).status,400);
 const linkedRuns=(await json('/work/'+saved.id+'/runs')).runs,turns=new Set(linkedRuns.map(r=>r.turnId));const activity=(await json('/work/'+saved.id+'/activity')).events;assert.ok(activity.some(e=>e.type==='result_saved'));assert.ok(activity.every(e=>e.roomId==='main'&&(e.id===saved.requestId||turns.has(e.payload.turnId)||e.payload.workId===saved.id)));
 const paged=[];let before;do{const page=await json('/work/'+saved.id+'/activity?limit=3'+(before?'&before='+before:''));paged.push(...page.events);before=page.nextCursor;}while(before);assert.equal(new Set(paged.map(e=>e.id)).size,paged.length);assert.equal(paged.length,activity.length);
 const bulky=await json('/work/'+large.id+'/activity');assert.ok(bulky.events.some(e=>e.payload.detailsTruncated));assert.ok(Buffer.byteLength(JSON.stringify(bulky))<50000,'activity payload stays bounded');
 const last=(await json('/work/'+working.id+'/activity')).events.at(-1).id;await ipc('burst',{requestId:workingMessage.id,count:60});let after=last;const fresh=[];do{const page=await json('/work/'+working.id+'/activity?after='+after+'&limit=100');fresh.push(...page.events);after=page.nextCursor;}while(after);assert.ok(fresh.length>100);assert.ok(fresh.every(e=>e.id>last));assert.equal(new Set(fresh.map(e=>e.id)).size,fresh.length);assert.equal((await json('/work/'+working.id)).work.progress.completedTools,40);assert.equal(fresh.filter(e=>e.type==='tool_result'&&e.payload.executionOutcome==='not-run').length,20,'The API tool cap refuses the remaining calls; pagination must not report them completed');
 const takeover=await req('/computer/takeover',{method:'POST',body:{}});assert.equal(takeover.status,200);const grant=await takeover.json(),cookie=takeover.headers.get('set-cookie').split(';')[0];assert.ok((await json('/computer/takeover')).active);assert.equal((await ipc('guard-check',{},'guard-result')).paused,true);assert.equal((await fetch(base+grant.viewPath.split('#')[0])).status,401);const view=await fetch(base+grant.viewPath.split('#')[0],{headers:{cookie}});assert.equal(view.status,200);assert.ok((await view.text()).includes('Controlled verification screen'));
 assert.equal((await req('/computer/handback',{method:'POST',body:{}})).status,200);assert.equal((await json('/computer/takeover')).active,false);assert.equal((await ipc('guard-check',{},'guard-result')).paused,false);
 // Exercise the shipped Work presentation against the same real gateway and records.
 const deskRequire=createRequire(root+'apps/desk/package.json'),daemonRequire=createRequire(root+'apps/daemon/package.json');
 const {JSDOM,VirtualConsole}=deskRequire('jsdom'),{WebSocket}=daemonRequire('ws');
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>{if(!error.message.includes('Not implemented'))errors.push(error.message);});
 const dom=new JSDOM('<div id="root"></div>',{url:base+'/#/work',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 try {
  w.fetch=(path,options)=>fetch(new URL(path,base),options);w.WebSocket=WebSocket;
  w.matchMedia=query=>({matches:query.includes('min-width:1180'),media:query,addEventListener(){},removeEventListener(){}});
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};
  w.localStorage.setItem('openag-token',ownerToken);
  const assets=root+'apps/desk/dist/assets/';w.eval(readFileSync(assets+readdirSync(assets).find(name=>/^index-.*\.js$/.test(name)),'utf8'));
  await wait(()=>w.document.querySelectorAll('[data-work-id]'),rows=>rows.length===20,'built Work first page');
  const first=w.document.querySelector('[data-work-id]');assert.ok(first.querySelector('h3').textContent);assert.ok(first.querySelector('time').dateTime);
  assert.ok(!first.textContent.includes('successful tool outcomes'));assert.ok(!first.textContent.includes(first.getAttribute('data-work-id').slice(0,8)),'Summary omits technical IDs');
  for(const label of ['Working','Needs input','Needs approval','Completed','Incomplete','Failed','Interrupted','Cancelled'])assert.ok([...w.document.querySelectorAll('[aria-label="Filter Work state"] button')].some(b=>b.textContent===label));
  const input=w.document.querySelector('[aria-label="Search Work"]');Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,'needle');input.dispatchEvent(new w.Event('input',{bubbles:true}));
  await wait(()=>w.document.querySelectorAll('[data-work-id]'),rows=>rows.length===1&&rows[0].getAttribute('data-work-id')===interrupted.id,'built global search beyond first page');
  w.location.hash='#/room/main/panel/work';await wait(()=>w.document.querySelector('#conversation-context [data-work-id]'),Boolean,'routed room Work collection');const contextCard=w.document.querySelector('#conversation-context [data-work-id]'),contextId=contextCard.getAttribute('data-work-id');[...contextCard.querySelectorAll('button')].find(b=>b.textContent==='View Work').click();await wait(()=>w.location.hash,h=>h==='#/room/main/work/'+contextId+'/panel/work','selected Work keeps panel route');await wait(()=>w.document.querySelector('button[aria-label="Close side panel"]')?.getAttribute('aria-expanded'),value=>value==='true','selected Work panel stays open');await wait(()=>w.document.querySelector('#conversation-context')?.textContent,text=>text?.includes('Next step'),'selected Work evidence visible');
  w.location.hash='#/work/'+saved.id;
  await wait(()=>w.document.querySelector('[role="dialog"]'),el=>el?.textContent.includes('Next step'),'URL-selected Work outside filtered list');
  const detail=w.document.querySelector('[role="dialog"]'),execution=[...detail.querySelectorAll('button')].find(b=>b.textContent==='Execution details');
  assert.ok(execution);assert.equal(execution.getAttribute('aria-expanded'),'false');execution.click();
  await wait(()=>execution.getAttribute('aria-expanded'),value=>value==='true','execution disclosure');assert.ok(detail.textContent.includes(saved.id));assert.ok(detail.textContent.includes('successful tool outcomes'));
  const full=await json('/work/'+saved.id);assert.equal(full.work.status,'completed','Inspecting details does not change Work');
  w.location.hash='#/work/'+approval.id;
  await wait(()=>w.document.querySelector('[role="dialog"] [aria-label="Action target"]'),Boolean,'shared approval target');
  const card=w.document.querySelector('[role="dialog"] [role="article"]'),target=card.querySelector('[aria-label="Action target"]'),code=card.querySelector('pre code');
  assert.ok(card.querySelector('h2').textContent.includes('wants to change a file'));
  assert.ok(target.compareDocumentPosition(code)&w.Node.DOCUMENT_POSITION_FOLLOWING,'Target leads exact proposal');
  assert.equal([...card.querySelectorAll('button')].find(b=>b.textContent==='Exact proposal').getAttribute('aria-expanded'),'true');
  assert.equal([...card.querySelectorAll('button')].find(b=>b.textContent==='Review details').getAttribute('aria-expanded'),'false');
  [...card.querySelectorAll('button')].find(b=>b.textContent==='Edit').click();
  const edit=await wait(()=>card.querySelector('textarea'),Boolean,'edit proposal');
  Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(edit,'{ invalid audit JSON');edit.dispatchEvent(new w.Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,20));[...card.querySelectorAll('button')].find(b=>b.textContent==='Approve edit').click();
  await wait(()=>card.querySelector('[role="alert"]'),el=>el?.textContent.includes('Not valid JSON'),'invalid proposal rejected');
  const approvalId=edit.id.slice('edit-'.length);assert.equal((await json('/approvals/'+approvalId)).approval.status,'pending');
  [...w.document.querySelectorAll('[role="dialog"] [role="tab"]')].find(b=>b.textContent==='Files').click();
  [...w.document.querySelectorAll('[role="dialog"] [role="tab"]')].find(b=>b.textContent==='Work').click();
  assert.equal(w.document.getElementById(edit.id).value,'{ invalid audit JSON','Tab changes retain failed edit');
  console.log('PASS built shared approval: readable action/target before exact payload, optional metadata, invalid edit rejected and retained across tabs.');
  assert.deepEqual(errors,[]);console.log('PASS built Work summaries/search/deep link and retained execution evidence through a real disposable gateway.');
 } finally {w.close();}
 console.log('OA-323 API assertions passed: all states, global search/paging, public room/bot isolation, linked bounded activity/backfill, delegation, saved results and takeover guard/viewer/handback.');
 const evidence={working:working.id,workingRequest:workingMessage.id,input:input.id,approval:approval.id,approvalRequest:approval.requestId,saved:saved.id,failure:failure.id,interrupted:interrupted.id,cancelled:cancelled.id,computerWork:computerWork.id,crossRoom:crossRoom.id,direct:direct.id,delegated:delegated.id};writeFileSync(join(dir,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 if(process.argv.includes('--serve')){
  const pair=await ipc('pair');console.log(JSON.stringify({url:base+'/#/work',pairCode:pair.code,dir,...evidence}));process.stdin.setEncoding('utf8');process.stdin.on('data',async text=>{try{const command=JSON.parse(text);console.log(JSON.stringify(await ipc(command.type,command,command.response??command.type+'-result')));}catch(error){console.log(JSON.stringify({error:error.message}));}});await new Promise(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);});
 }
}finally{if(child?.connected){const exited=once(child,'exit');child.send({type:'stop'});await exited;}process.stdin.pause();}
