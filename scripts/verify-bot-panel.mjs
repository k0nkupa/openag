// Mounted desk → real disposable gateway acceptance. No unit runner or external provider calls.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startFixture } from './bot-models-fixture.mjs';
const rootPath=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(rootPath+'apps/desk/package.json');
const dir=mkdtempSync(join(tmpdir(),'openag-bot-models-')),token=randomUUID(),f=await startFixture(dir,token);
const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url:f.url+'/#/room/main',pretendToBeVisual:true});
for(const key of ['window','document','HTMLElement','Element','Node','MutationObserver','localStorage','sessionStorage'])globalThis[key]=dom.window[key];
for(const key of ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'])globalThis[key]=dom.window[key].bind(dom.window);
globalThis.matchMedia=dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.ResizeObserver=dom.window.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
globalThis.WebSocket=class{close(){}};
const {createServer}=await import(require.resolve('vite'));
const vite=await createServer({configFile:false,root:rootPath+'apps/desk',resolve:{alias:{'@':rootPath+'apps/desk/src'}},server:{middlewareMode:true,hmr:false},appType:'custom'});
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{fireEvent}=require('@testing-library/react');
const mounted=createRoot(document.getElementById('root'));
const {BotSettings}=await vite.ssrLoadModule('/src/components/BotSettings.tsx'),{StreamProvider}=await vite.ssrLoadModule('/src/stream.tsx'),{createApi}=await vite.ssrLoadModule('/src/api.ts');
const api=createApi(token,()=>{throw Error('Unexpected auth failure');},(path,init)=>fetch(f.url+path,init));
const wait=async check=>{const end=Date.now()+8000;while(!check()){assert.ok(Date.now()<end,'Panel convergence deadline');await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));}};
const visible=el=>!el.closest('[hidden]');
const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text&&visible(el));
const click=async text=>{const el=button(text);assert.ok(el,'Visible button: '+text);await act(async()=>{el.click();await new Promise(resolve=>setTimeout(resolve,20));});};
async function chooseThinking(label){await act(async()=>document.getElementById('model-boss-think').click());await wait(()=>[...document.querySelectorAll('[role="option"]')].some(el=>el.textContent===label));await act(async()=>[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent===label).click());}
try{
 const {WorkInspector}=await vite.ssrLoadModule('/src/components/WorkView.tsx');
 const bot=(await api.listBots()).bots.find(b=>b.id==='boss');
 function Panel({currentApi,bot}) {
  const [tab,onTabChange]=React.useState('settings');
  return React.createElement(WorkInspector,{api:currentApi,bots:[bot],rooms:[],approvals:[],onDecide(){},onChanged(){},tab,onTabChange,empty:React.createElement('p',null,'Agent Work'),extraTabs:[{value:'settings',label:'Settings',content:React.createElement(BotSettings,{api:currentApi,bot,roomId:'main',canManage:currentApi===api})}]});
 }
 const render=async(currentApi=api)=>act(async()=>mounted.render(React.createElement(StreamProvider,{token,onAuthFailure(){}},React.createElement(Panel,{key:currentApi===api?'full':'limited',currentApi,bot}))));
 await render();assert.equal(button('Settings').getAttribute('aria-selected'),'true');await wait(()=>!document.getElementById('bname')?.disabled);
 assert.equal(document.querySelector('[role="dialog"]'),null);
 await act(async()=>fireEvent.change(document.getElementById('bname'),{target:{value:'Panel bot'}}));
 await click('Work');await click('Settings');assert.equal(document.getElementById('bname').value,'Panel bot','Draft survives tab navigation');
 await click('Instructions');
 assert.equal(visible(document.getElementById('bname')),true,'Identity remains visible while a section expands');
 assert.equal(document.querySelector('[aria-label="Back to bot settings"]'),null,'No drill-down Back button');
 assert.equal(button('Full ledger'),undefined,'Ledger is not in Settings');
 assert.equal(visible(document.getElementById('binstr')),true);
 await act(async()=>fireEvent.change(document.getElementById('binstr'),{target:{value:'Panel instructions'}}));
 await click('Instructions');
 assert.equal(document.getElementById('bname').value,'Panel bot','Name draft survives section navigation');
 await click('Instructions');assert.equal(document.getElementById('binstr').value,'Panel instructions');
 await click('Save agent settings');await wait(()=>button('Save agent settings')?.disabled);
 const saved=await api.getBotSettings('boss');assert.equal(saved.name,'Panel bot');assert.equal(saved.instructions,'Panel instructions');
 await click('Instructions');
 for(const section of ['Model and reasoning','Memories','Skills','Permissions']){
  await click(section);assert.equal(document.querySelector('[role="dialog"]'),null,'No stacked drawer for '+section);
  assert.equal(button(section).getAttribute('aria-expanded'),'true');
  await click(section);
  assert.equal(button(section).getAttribute('aria-expanded'),'false');
 }
 const beforeModels=[f.stats.launches.length,f.stats.requests.length];
 await click('Model and reasoning');await wait(()=>document.getElementById('model-choice-boss')?.getAttribute('aria-busy')==='false'&&!button('Save model configuration')?.disabled);
 await act(async()=>document.getElementById('model-choice-boss').click());
 await wait(()=>[...document.querySelectorAll('[role="menuitemradio"]')].some(el=>el.textContent.includes('fixture-b')));
 const localOption=[...document.querySelectorAll('[role="menuitemradio"]')].find(el=>el.textContent.includes('fixture-b'));
 await act(async()=>localOption.click());await wait(()=>!button('Save model configuration')?.disabled);
 await click('Save model configuration');await wait(()=>document.body.textContent.includes('Saved.'));
 assert.equal((await api.getBotModel('boss')).model,'ollama/fixture-b');
 assert.deepEqual([f.stats.launches.length,f.stats.requests.length],beforeModels,'Mounted open/select/save perform no discovery');
 await chooseThinking('high');
 await click('Save model configuration');await wait(()=>document.body.textContent.includes('Saved.'));
 assert.equal((await api.getBotModel('boss')).reasoning.think,'high','Second reasoning-only save uses the confirmed revision');
 await f.botModels.catalogue.refresh();
 await chooseThinking('false');
 await click('Save model configuration');await wait(()=>document.body.textContent.includes('Model catalogue changed.'));
 assert.equal((await api.getBotModel('boss')).reasoning.think,'high','Changed generation requires review before PUT');
 await click('Save model configuration');await wait(()=>document.body.textContent.includes('Saved.'));
 assert.equal((await api.getBotModel('boss')).reasoning.think,false,'Reviewed draft can then be saved');
 await click('Model and reasoning');
 const reopen=performance.now();await click('Model and reasoning');await wait(()=>document.getElementById('model-choice-boss')?.getAttribute('aria-busy')==='false');
 const reopenMs=performance.now()-reopen;assert.ok(reopenMs<300,`Warm reopen took ${reopenMs.toFixed(0)}ms`);
 console.log(`PASS mounted cached model open/select/save; warm reopen ${reopenMs.toFixed(0)}ms; zero metadata requests or adapter launches.`);
 await click('Model and reasoning');
 await act(async()=>fireEvent.change(document.getElementById('bname'),{target:{value:'Discard me'}}));
 await click('Discard');assert.equal(document.getElementById('bname').value,'Panel bot');

 // Real limited device still cannot edit protected identity settings.
 const device=await api.createDevice('Limited panel','limited');
 const limited=createApi(device.token,()=>{},(path,init)=>fetch(f.url+path,init));
 await render(limited);await wait(()=>document.body.textContent.includes('This device has limited access'));
 assert.equal(document.getElementById('bname').disabled,true);
 assert.equal(document.getElementById('bdesc').disabled,true);
 const {NewBotSheet,NewBotTrigger}=await vite.ssrLoadModule('/src/components/NewBotSheet.tsx');
 const created=[];
 await act(async()=>mounted.render(React.createElement(StreamProvider,{token,onAuthFailure(){}},React.createElement(NewBotSheet,{api,identity:{kind:'owner'},onCreated:b=>created.push(b)},React.createElement(NewBotTrigger)))));
 for(let n=1;n<=3;n++){
  await click('New bot');await wait(()=>document.getElementById('new-bot-name')&&!document.getElementById('new-bot-model')?.disabled);
  await act(async()=>fireEvent.change(document.getElementById('new-bot-name'),{target:{value:'Cached creation '+n}}));
  await wait(()=>!button('Create bot')?.disabled);
  if(n===3){await f.botModels.catalogue.refresh();await click('Create bot');await wait(()=>document.body.textContent.includes('Model catalogue changed.'));assert.equal(created.length,2,'Creation requires review after background refresh');}
  await click('Create bot');await wait(()=>created.length===n);
 }
 console.log('PASS mounted repeated bot creation uses current request tokens; refreshed creation requires review.');
 const sectionSource=readFileSync(rootPath+'apps/desk/src/components/SectionViews.tsx','utf8');
 assert.equal(sectionSource.includes('BotsView'),false);
 assert.equal(readFileSync(rootPath+'apps/desk/src/components/SettingsLayout.tsx','utf8').includes('id: "bots"'),false);
 assert.equal(readFileSync(rootPath+'apps/desk/src/components/Shell.tsx','utf8').includes('Manage bots'),false);
 assert.equal(readFileSync(rootPath+'apps/desk/src/components/RoomRail.tsx','utf8').includes('>Bot settings</Button>'),false);
 assert.equal(f.stats.prompts.length,0,'Editing settings runs no inference');
 console.log('PASS mounted bot settings → real gateway: in-panel sections, name/instruction draft retention, save/readback, discard, inline disclosure, limited access, removed page/nav and no inference.');
}finally{await act(async()=>mounted.unmount());await vite.close();dom.window.close();await f.close();rmSync(dir,{recursive:true,force:true});}
