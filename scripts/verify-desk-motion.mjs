// Shipped desk -> real disposable gateway. DOM checks cover behaviour; CUA covers actual motion.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFileSync,readdirSync} from 'node:fs';
import {setTimeout as pause} from 'node:timers/promises';
import {startUsabilityFixture} from './desk-usability-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/desk/package.json'),daemonRequire=createRequire(root+'apps/daemon/package.json');
const {JSDOM,VirtualConsole}=require('jsdom'),{WebSocket}=daemonRequire('ws');
const fixture=await startUsabilityFixture(),windows=[],errors=[],uploaded=[];
let failUploads=false,uploadRequests=0,sendBarrier;
const assets=root+'apps/desk/dist/assets/',bundle=readFileSync(assets+readdirSync(assets).find(name=>/^index-.*\.js$/.test(name)),'utf8');
async function until(read,check,label){const deadline=Date.now()+10000;do{const value=await read();if(check(value))return value;await pause(20);}while(Date.now()<deadline);throw Error('Deadline: '+label);}
function open(preferences){
 const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message);});
 const w=new JSDOM('<div id="root"></div>',{url:fixture.url+'/#/room/main',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}).window;windows.push(w);
 w.fetch=async(path,options={})=>{
  const url=new URL(path,fixture.url),upload=options.method==='POST'&&url.pathname.endsWith('/uploads');
  if(upload){uploadRequests++;if(failUploads)return Response.json({error:'Controlled upload outage'},{status:503});}
  if(options.method==='POST'&&url.pathname.endsWith('/messages')&&sendBarrier)await sendBarrier;
  const response=await fetch(url,options);if(upload&&response.ok)uploaded.push((await response.clone().json()).attachment);return response;
 };w.motionSockets=[];w.WebSocket=class extends WebSocket{constructor(...args){super(...args);w.motionSockets.push(this);}};
 w.matchMedia=query=>({matches:query.includes('min-width:1180')||query.includes('pointer: fine'),media:query,addEventListener(){},removeEventListener(){}});
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
 for(const name of ['scrollTo','scrollIntoView','setPointerCapture'])w.HTMLElement.prototype[name]=function(){};
 w.localStorage.setItem('openag-token',fixture.full.token);if(preferences)w.localStorage.setItem('openag.sidebar.agents',preferences);w.eval(bundle);return w;
}
const row=(w,id)=>w.document.querySelector(`[data-nav-kind="agents"][data-nav-id="${id}"]`);
const order=w=>[...w.document.querySelectorAll('[data-nav-kind="agents"]')].map(e=>e.dataset.navId);
const button=(w,name)=>[...w.document.querySelectorAll('button')].find(e=>!e.closest('[hidden]')&&(e.getAttribute('aria-label')===name||e.textContent.trim()===name));
async function drag(w,from,to,cancel=false){
 const grip=row(w,from).querySelector('button');
 const fire=type=>{const event=new w.MouseEvent(type,{bubbles:true,button:0,clientX:10,clientY:10});Object.defineProperty(event,'pointerId',{value:1});grip.dispatchEvent(event);};
 w.document.elementFromPoint=()=>row(w,to);fire('pointerdown');await pause(20);fire('pointermove');await pause(20);fire(cancel?'pointercancel':'pointerup');await pause(20);
}
try{
 const w=open(JSON.stringify({order:['boss','model','other'],pins:[]}));await until(()=>order(w),ids=>ids.length===3,'sidebar inventory');const initial=order(w);
 await drag(w,'boss','other');assert.deepEqual(order(w),['model','other','boss'],'Pointer drop commits one reorder');
 const stored=w.localStorage.getItem('openag.sidebar.agents');const restored=open(stored);await until(()=>order(restored),ids=>ids.length===3,'restored sidebar');assert.deepEqual(order(restored),['model','other','boss'],'Order survives a fresh desk load');restored.close();
 await drag(w,'boss','model',true);assert.deepEqual(order(w),['model','other','boss'],'Cancelled drag preserves order');
 await drag(w,'boss','model');assert.deepEqual(order(w),initial);
 button(w,'Options for Desk agent').click();await until(()=>button(w,'Pin to top'),Boolean,'pin control');button(w,'Pin to top').click();await pause(20);button(w,'Options for Desk agent').click();
 const pinnedOrder=order(w);await drag(w,'other','boss');assert.deepEqual(order(w),pinnedOrder,'Cannot reorder across pin groups');
 button(w,'Options for Other agent').click();await until(()=>button(w,'Move up'),Boolean,'keyboard alternative');button(w,'Move up').click();await pause(20);assert.deepEqual(order(w),['boss','other','model'],'Keyboard-style menu activation changes order immediately');
 button(w,'Options for Other agent').click();
 await until(()=>w.document.getElementById('composer-text'),e=>e&&!e.disabled,'attachment composer');
 const compactArea=w.document.getElementById('composer-text'),composerForm=compactArea.closest('form');
 const expanded=()=>composerForm.getAttribute('data-composer-expanded')==='true';
 await until(expanded,v=>!v,'idle composer is compact');assert.equal(compactArea.rows,1);assert.ok(w.document.querySelector('[aria-label^="Model settings for"]').closest('[hidden]'),'Model controls stay mounted but hidden');
 const visibleActions=[...composerForm.querySelector('[data-slot="input-group"]').querySelectorAll('button')].filter(e=>!e.closest('[hidden]')).map(e=>e.getAttribute('aria-label'));assert.deepEqual(visibleActions,['Attach files','Dictate message','Send']);
 compactArea.focus();await until(expanded,Boolean,'keyboard focus expands composer');assert.equal(compactArea.rows,2);compactArea.blur();await until(expanded,v=>!v,'empty blur collapses composer');
 Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(compactArea,'Compact draft');compactArea.dispatchEvent(new w.Event('input',{bubbles:true}));await until(expanded,Boolean,'draft remains expanded without focus');Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(compactArea,'');compactArea.dispatchEvent(new w.Event('input',{bubbles:true}));await until(expanded,v=>!v,'cleared draft can collapse');
 console.log('PASS shipped compact composer: one-line three-action idle, mounted hidden settings, focus/blur and retained draft.');

 const compactAdd=button(w,'Attach files');compactAdd.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,button:0}));compactAdd.focus();await pause(20);assert.ok(!expanded(),'Pointer focus keeps compact action stationary until click');compactAdd.dispatchEvent(new w.MouseEvent('pointerup',{bubbles:true,button:0}));
 const file=(name,text='Disposable attachment')=>new File([text],name,{type:'text/plain'});
 function pick(files,detail=0){button(w,'Attach files').dispatchEvent(new w.MouseEvent('click',{bubbles:true,detail}));const input=w.document.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:files});input.dispatchEvent(new w.Event('change',{bubbles:true}));}
 const ready=name=>until(()=>[...w.document.querySelectorAll('[data-slot=attachment]')].find(e=>e.textContent.includes(name)),e=>e?.textContent.includes('Ready'),'ready '+name);
 async function removeFile(name){button(w,'Remove '+name).click();await until(()=>button(w,'Remove '+name),e=>!e,'removed '+name);}
 pick([file('pointer-motion.txt')],1);await ready('pointer-motion.txt');assert.ok(expanded(),'Attachments keep composer expanded');const pointerFile=uploaded.find(f=>f.name==='pointer-motion.txt');assert.ok(pointerFile);assert.equal(await (await fixture.request('/rooms/main/uploads/'+pointerFile.id)).text(),'Disposable attachment');
 await removeFile('pointer-motion.txt');assert.equal((await fixture.request('/rooms/main/uploads/'+pointerFile.id)).status,404,'Removal reaches the real upload store');
 pick([file('keyboard-motion.txt')]);await ready('keyboard-motion.txt');await removeFile('keyboard-motion.txt');
 const paste=new w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{files:[file('paste-motion.txt')]}});w.document.getElementById('composer-text').dispatchEvent(paste);await ready('paste-motion.txt');assert.ok(paste.defaultPrevented);await removeFile('paste-motion.txt');
 failUploads=true;const failedBefore=uploadRequests;pick([file('retry-motion.txt')],1);await until(()=>w.document.body.textContent,t=>t.includes('Controlled upload outage'),'failed upload retains chip');assert.equal(uploadRequests,failedBefore+1);failUploads=false;button(w,'Retry retry-motion.txt').click();await ready('retry-motion.txt');assert.equal(uploadRequests,failedBefore+2,'Retry sends exactly one new upload');
 const uploadsBeforeRender=uploadRequests,area=w.document.getElementById('composer-text');Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(area,'Retained draft');area.dispatchEvent(new w.Event('input',{bubbles:true}));await pause(30);assert.equal(uploadRequests,uploadsBeforeRender,'Rerender does not upload again');await removeFile('retry-motion.txt');assert.equal(area.value,'Retained draft');
 const six=Array.from({length:6},(_,i)=>file('limit-'+i+'.txt'));pick(six,1);for(const item of six)await ready(item.name);const beforeLimit=uploadRequests;pick([file('seventh.txt')],1);await until(()=>w.document.body.textContent,t=>t.includes('Use up to six files'),'file count limit');assert.equal(uploadRequests,beforeLimit);for(const item of six)await removeFile(item.name);
 pick([new File([new Uint8Array(10*1024*1024+1)],'oversized.txt',{type:'text/plain'})],1);assert.equal(uploadRequests,beforeLimit,'Total byte limit rejects before upload');assert.equal(w.document.querySelector('[data-slot=attachment]'),null);
 const cue=()=>w.document.querySelector('[data-file-drop-active]'),target=()=>cue().parentElement;
 function dragFile(type,files=[],types=['Files'],element=target()) {const event=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{types,files}});element.dispatchEvent(event);return event;}
 const active=()=>cue()?.getAttribute('data-file-drop-active')==='true';
 dragFile('dragenter',[],['text/plain']);await pause(20);assert.ok(!active(),'Text drag is not a file target');
 dragFile('dragenter');await until(active,Boolean,'available file target');dragFile('dragenter',[],['Files'],area);dragFile('dragleave',[],['Files'],area);await pause(20);assert.ok(active(),'Nested leave preserves outer cue');dragFile('dragleave');await until(active,v=>!v,'outer leave clears');
 for(const cancel of ['dragend','blur','drop','hashchange']){dragFile('dragenter');await until(active,Boolean,'cue before '+cancel);w.dispatchEvent(new w.Event(cancel));await until(active,v=>!v,cancel+' clears cue');}
 dragFile('dragenter');await until(active,Boolean,'cue before Escape');w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));await until(active,v=>!v,'Escape clears cue');
 dragFile('dragenter');const dropEvent=dragFile('drop',[file('native-drop.txt')]);assert.ok(dropEvent.defaultPrevented);await ready('native-drop.txt');assert.ok(!active());await removeFile('native-drop.txt');
 let releaseSend;sendBarrier=new Promise(resolve=>{releaseSend=resolve;});dragFile('dragenter');await until(active,Boolean,'cue before pending send');button(w,'Send').click();await until(()=>button(w,'Attach files').disabled,Boolean,'pending send locks attachments');await until(active,v=>!v,'pending send clears cue');const beforeBusy=uploadRequests;dragFile('dragenter');dragFile('drop',[file('blocked-send.txt')]);await pause(30);assert.ok(!active());assert.equal(uploadRequests,beforeBusy,'Pending send refuses file drop');releaseSend();sendBarrier=undefined;await until(()=>button(w,'Attach files').disabled,v=>!v,'send finishes');
 dragFile('dragenter');await until(active,Boolean,'cue before disconnect');for(const socket of w.motionSockets)socket.close();await until(()=>button(w,'Attach files').disabled,Boolean,'disconnected composer');await until(active,v=>!v,'disconnect clears cue');const beforeOffline=uploadRequests;dragFile('dragenter');dragFile('drop',[file('blocked-offline.txt')]);await pause(30);assert.ok(!active());assert.equal(uploadRequests,beforeOffline,'Offline drop remains refused');
 console.log('PASS shipped file target: nested/text drags, leave/drop/Escape/end/blur/route cleanup, real dropped upload, pending-send and offline guards.');
 console.log('PASS shipped attachments: real upload/read/remove, keyboard/pointer/paste, failed retry, retained draft, no replay and six-file/byte limits.');
 assert.deepEqual(errors,[]);console.log('PASS shipped sidebar: pointer reorder, browser persistence, cancellation, pin boundaries and keyboard alternative. Motion timing requires real-browser inspection.');
 for(const window of windows)window.close();
 if(process.argv.includes('--serve')){console.log(JSON.stringify({url:fixture.url,pairingCode:fixture.pairCode(),dir:fixture.dir}));await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});}
}finally{for(const w of windows)w.close();await fixture.close();}
