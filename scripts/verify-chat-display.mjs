// Built-desk DOM integration against an owned temporary gateway; no unit runner or live data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const deskRequire = createRequire(root + '/apps/desk/package.json');
const daemonRequire = createRequire(root + '/apps/daemon/package.json');
const { JSDOM, VirtualConsole } = deskRequire('jsdom');
const { WebSocket } = daemonRequire('ws');
const dir = mkdtempSync(join(tmpdir(), 'openag-flow-'));
const env = Object.fromEntries(['PATH','HOME','LANG','TMPDIR'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const child = fork(root + '/scripts/desk-flow-fixture.mjs', [dir], { env, stdio: ['ignore','ignore','inherit','ipc'] });
const ready = once(child,'message', {signal:AbortSignal.timeout(15000)});
const ownerToken = 'controlled-chat-display-owner-credential';
child.send({ownerToken,port:0});
const [{url:base}] = await ready;
const request = (path,body) => fetch(base+path,{method:body?'POST':'GET', headers:{authorization:'Bearer '+ownerToken,'content-type':'application/json'}, ...(body?{body:JSON.stringify(body)}:{})});
const {token} = await (await request('/devices',{name:'DOM check',access:'full'})).json();
await request('/rooms/main/messages',{text:'/say Conversation marker'});
const until = async (read, check, label) => { const end=Date.now()+8000; do { const value=await read(); if(check(value))return value; await pause(25); }while(Date.now()<end);throw Error(label); };
await until(()=>request('/rooms/main/events').then(r=>r.json()),v=>v.events.some(e=>e.type==='bot_output'),'bot response');
await request('/rooms/main/messages',{text:'Pending marker'});
await until(()=>request('/approvals?status=pending').then(r=>r.json()),v=>v.approvals.length,'pending approval');
const assets=root+'/apps/desk/dist/assets/';
const bundle=readFileSync(assets+readdirSync(assets).find(n=>/^index-.*\.js$/.test(n)),'utf8');
const windows=[];
function open(hash, hidden, blocked=false){
 const errors=[];
 const vc=new VirtualConsole(); vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message);});
 const dom=new JSDOM('<div id="root"></div>',{url:base+hash,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window; windows.push(w);
 w.fetch=(url,options)=>fetch(new URL(url,base),options);
 w.WebSocket=WebSocket;
 w.matchMedia=query=>({matches:false,media:query,addEventListener(){},removeEventListener(){}});
 w.ResizeObserver=class {observe(){} unobserve(){} disconnect(){}};
 w.IntersectionObserver=class {observe(){} unobserve(){} disconnect(){}};
 w.HTMLElement.prototype.scrollTo=function(){};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.localStorage.setItem('openag-token',token);
 if(hidden!==undefined)w.localStorage.setItem('openag-hide-technical-activity',String(hidden));
 if(blocked)w.Storage.prototype.setItem=function(){throw Error('storage blocked');};
 w.eval(bundle);
 return {w,errors};
}
const element=(w,selector)=>until(()=>w.document.querySelector(selector),Boolean,selector);
async function displayToggle(w) {
 const appearance=await until(()=>[...w.document.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent==='Appearance'),Boolean,'Appearance tab');
 appearance.click();
 return element(w,'[role="switch"][aria-describedby="hide-technical-activity-help"]');
}
const log=w=>w.document.querySelector('[role="log"]');
try {
 const {w,errors}=open('#/room/main');
 await until(()=>log(w)?.textContent,t=>t?.includes('Conversation marker')&&log(w)?.querySelector('[aria-label="Agent activity"]'),'visible feed');
 assert.ok(log(w).querySelector('[aria-label="Agent activity"]'));
 w.location.hash='#/settings';
 const toggle=await displayToggle(w);
 assert.equal(toggle.getAttribute('aria-checked'),'false');
 toggle.click();
 await until(()=>toggle.getAttribute('aria-checked'),v=>v==='true','toggle enabled');
 assert.equal(w.localStorage.getItem('openag-hide-technical-activity'),'true');
 w.location.hash='#/room/main';
 await until(()=>log(w)?.textContent,t=>t?.includes('Conversation marker')&&t.includes('Pending marker'),'hidden feed');
 assert.equal(log(w).querySelector('[aria-label="Agent activity"]'),null);
 assert.ok(log(w).querySelector('[data-slot="approval-card"]')||log(w).textContent.includes('fixture_write'),'pending approval preserved');
 assert.ok(log(w).textContent.includes('is working')===false,'waiting bot is not shown as thinking');
 // A new document receives the saved preference, as on reload.
 const second=open('#/room/main',true);
 await until(()=>log(second.w)?.textContent,t=>t?.includes('Conversation marker'),'reload');
 assert.equal(log(second.w).querySelector('[aria-label="Agent activity"]'),null);
 // Simulate the native cross-tab storage notification (JSDOM does not share storage across windows).
 second.w.localStorage.setItem('openag-hide-technical-activity','false');
 second.w.dispatchEvent(new second.w.StorageEvent('storage',{key:'openag-hide-technical-activity',newValue:'false'}));
 await until(()=>log(second.w)?.querySelector('[aria-label="Agent activity"]'),Boolean,'cross-tab reveal');
 const blocked=open('#/settings',false,true);
 const blockedToggle=await displayToggle(blocked.w);blockedToggle.click();
 await until(()=>blockedToggle.getAttribute('aria-checked'),v=>v==='true','blocked storage toggle');
 blocked.w.location.hash='#/room/main';
 await until(()=>log(blocked.w)?.textContent,t=>t?.includes('Conversation marker'),'blocked storage feed');
 assert.equal(log(blocked.w).querySelector('[aria-label="Agent activity"]'),null);
 assert.deepEqual(errors,[]);assert.deepEqual(second.errors,[]);assert.deepEqual(blocked.errors,[]);
 console.log('PASS built desk + real temporary gateway DOM integration: default/show/hide, human/bot messages, pending approvals, reload, cross-tab reveal, blocked storage. No unit runner or visual browser used.');
}finally{
 for(const w of windows)w.close();
 const exited=once(child,'exit');child.send({type:'stop'});await exited;rmSync(dir,{recursive:true,force:true});
}
