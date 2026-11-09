// Built desk -> isolated real gateway/runtimes, controlled model/provider transports. No unit runner.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {startFixture} from './bot-models-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),deskRequire=createRequire(root+'apps/desk/package.json'),daemonRequire=createRequire(root+'apps/daemon/package.json');
const {JSDOM,VirtualConsole}=deskRequire('jsdom'),{WebSocket}=daemonRequire('ws'),sockets=new Set();
class ClientSocket extends WebSocket { constructor(url){super(url);sockets.add(this);this.on('error',()=>{});this.on('close',()=>sockets.delete(this));} }
const {ensureDataRepo,commitMemory}=await import(root+'apps/daemon/dist/datagit.js');
const dir=mkdtempSync(join(tmpdir(),'openag-bot-models-')),owner=randomUUID();await ensureDataRepo(dir);
const fixture=await startFixture(dir,owner),windows=[];
const request=async(path,method='GET',body,token=owner)=>{const r=await fetch(fixture.url+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,path+': '+r.status);return r.json();};
const until=async(read,check,label)=>{const end=Date.now()+15000;do{const v=await read();if(check(v))return v;await pause(25);}while(Date.now()<end);throw Error('Convergence: '+label);};
const assets=root+'apps/desk/dist/assets/',bundle=readFileSync(assets+readdirSync(assets).find(n=>/^index-.*\.js$/.test(n)),'utf8');
let writes=0,failWrite=false,failRead=false,holdWrite,writeStarted=false;
function open(token){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message);});
 const dom=new JSDOM('<div id="root"></div>',{url:fixture.url+'/#/room/main',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;windows.push(w);
 w.fetch=async(path,options={})=>{const url=new URL(path,fixture.url);if(url.pathname.endsWith('/model')){if(options.method==='PUT'){writes++;writeStarted=true;if(holdWrite)await holdWrite;if(failWrite)return Response.json({error:'Controlled stale revision'},{status:409});}else if(failRead)return Response.json({error:'Controlled readback outage'},{status:503});}return fetch(url,options);};
 w.WebSocket=ClientSocket;w.matchMedia=q=>({matches:q.includes('min-width:1180'),media:q,addEventListener(){},removeEventListener(){}});w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
 w.HTMLElement.prototype.scrollTo=function(){};w.HTMLElement.prototype.scrollIntoView=function(){};w.localStorage.setItem('openag-token',token);w.eval(bundle);return{w,errors};
}
const visible=e=>!e.closest('[hidden]');
const bar=(w,id='boss')=>w.document.querySelector(`[aria-label="Model settings for ${id}"]`);
const button=(w,text)=>[...w.document.querySelectorAll('button')].find(e=>visible(e)&&e.textContent.trim()===text);
const fill=(w,text)=>{const e=w.document.getElementById('composer-text');Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(e,text);e.dispatchEvent(new w.Event('input',{bubbles:true}));};
async function chooseModel(w,target,model,id='boss'){
 const trigger=await until(()=>bar(w,id)?.querySelector('[aria-busy]'),el=>el&&!el.disabled,'model trigger');trigger.click();
 const option=await until(()=>[...w.document.querySelectorAll('[role="menuitemradio"]')].find(e=>e.getAttribute('data-model-id')===JSON.stringify([target,model]) && e.getAttribute('aria-disabled')!=='true'),Boolean,'model '+model).catch(error=>{console.error('Model options', [...w.document.querySelectorAll('[role="menuitemradio"]')].map(e=>({value:e.getAttribute('data-value'),text:e.textContent})),bar(w,id)?.textContent);throw error;});
 option.click();await pause(20);
}
async function select(w,trigger,text){trigger.click();const option=await until(()=>[...(w.document.getElementById(trigger.getAttribute('aria-controls'))?.querySelectorAll('[role="option"], [role="menuitemradio"]') ?? [])].find(e=>e.textContent.trim().toLowerCase()===text.toLowerCase()),Boolean,'Select '+text);option.click();await pause(20);}
try{
 const full=await request('/devices','POST',{name:'Composer acceptance',access:'full'});
 failRead=true;const failedComposer=open(full.token).w;
 await until(()=>button(failedComposer,'Reload model settings'),Boolean,'initial model error recovery');
 assert.equal(failedComposer.document.querySelector('form[data-composer-expanded]').getAttribute('data-composer-expanded'),'true','Configuration errors disclose recovery');assert.ok(!button(failedComposer,'Reload model settings').closest('[hidden]'),'Recovery action is visible');
 failRead=false;button(failedComposer,'Reload model settings').click();await until(()=>failedComposer.document.activeElement?.id,id=>id==='composer-text','recovery returns message focus');failedComposer.document.getElementById('composer-text').blur();await until(()=>failedComposer.document.querySelector('form[data-composer-expanded]').getAttribute('data-composer-expanded'),v=>v==='false','clean recovery permits compact idle');failedComposer.close();
 const {w,errors}=open(full.token);
 await until(()=>bar(w)?.querySelector('[aria-busy]'),Boolean,'composer model controls');
 await until(()=>w.document.getElementById('composer-text'),e=>e&&!e.disabled,'composer accepts attachments');
 // Clicking the textarea to move its caret must not dismiss its anchored mention popup.
 fill(w,'@bo');await until(()=>w.document.getElementById('mention-boss'),Boolean,'mention suggestion');
 const mentionArea=w.document.getElementById('composer-text');mentionArea.focus();mentionArea.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,button:0}));mentionArea.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,button:0}));mentionArea.click();await pause(30);
 assert.ok(w.document.getElementById('mention-boss'),'Caret clicks keep the mention query available');mentionArea.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await until(()=>mentionArea.value,v=>v==='@boss ','mention keyboard selection');fill(w,'');
 // Composer attachment presentation keeps explicit failure/removal controls inside the input.
 const uploadFetch=w.fetch;w.fetch=(path,options)=>new URL(path,fixture.url).pathname.endsWith('/uploads')?Promise.resolve(Response.json({error:'Controlled upload outage'},{status:503})):uploadFetch(path,options);
 const picker=w.document.querySelector('input[type="file"]');Object.defineProperty(picker,'files',{configurable:true,value:[new w.File(['Disposable composer attachment'],'composer-check.txt',{type:'text/plain'})]});picker.dispatchEvent(new w.Event('change',{bubbles:true}));
 await until(()=>w.document.querySelector('[data-slot="attachment"][data-state="error"]'),Boolean,'controlled upload unavailable').catch(error=>{console.error('Attachment diagnostics',errors,w.document.querySelector('form')?.textContent);throw error;});
 assert.ok(w.document.querySelector('[data-align="block-start"] [data-slot="attachment-title"]'));
 const removeAttachment=w.document.querySelector('[aria-label="Remove composer-check.txt"]');assert.ok(removeAttachment);assert.ok(w.document.querySelector('[aria-label="Retry composer-check.txt"]'));removeAttachment.click();
 await until(()=>w.document.querySelector('[data-slot="attachment"]'),v=>!v,'attachment removed');w.fetch=uploadFetch;
 const agentLink=[...w.document.querySelectorAll('a.desk-agent')].find(e=>e.textContent.includes('boss'));agentLink.click();
 await until(()=>w.location.hash,h=>h.startsWith('#/room/chat-'),'direct chat');
 await until(()=>button(w,'Model and reasoning'),Boolean,'agent settings');button(w,'Model and reasoning').click();
 await until(()=>w.document.getElementById('model-choice-boss'),e=>e&&!e.disabled,'settings model ready');
 assert.ok(bar(w).querySelector('[aria-label="Effort: Default"]'));assert.equal(bar(w).querySelector('[aria-label="Effort: Default"]').textContent.trim(),'');assert.equal(bar(w).querySelector('[aria-busy]').textContent.trim(),'');
 fill(w,'@eve');await pause(20);
 let release;holdWrite=new Promise(r=>{release=r;});writeStarted=false;
 await chooseModel(w,'openai','openai/gpt-4o-mini');await until(()=>writeStarted,Boolean,'held model save');
 assert.equal(bar(w).querySelector('[aria-busy]').disabled,true,'Model icon locks during save');assert.ok([...bar(w).querySelectorAll('button')].every(control=>control.disabled),'All available model/reasoning icons lock during save');assert.equal(w.document.querySelector('[aria-label="Send"]').disabled,true);assert.equal(w.document.getElementById('composer-text').readOnly,true);assert.equal(w.document.getElementById('mention-list'),null,'Mention insertion is hidden while configuration is pending');
 const messages=fixture.db.prepare("select count(*) n from events where type='message'").get().n;
 w.document.getElementById('composer-text').closest('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await pause(40);
 assert.equal(fixture.db.prepare("select count(*) n from events where type='message'").get().n,messages,'Submit cannot race an in-flight model write');
 release();holdWrite=undefined;
 await until(()=>request('/bots/boss/model'),s=>s.model==='openai/gpt-4o-mini','model persisted');
 await until(()=>w.document.getElementById('composer-text').readOnly,v=>!v,'model save unblocks draft');
 assert.equal(w.document.getElementById('composer-text').value,'@eve');
 await until(()=>w.document.getElementById('model-choice-boss')?.textContent,t=>t?.includes('gpt-4o-mini'),'clean Settings follows composer save');
 const unload=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(unload);assert.equal(unload.defaultPrevented,false,'A clean second editor must not invent an unsaved draft');
 await chooseModel(w,'openai','openai/gpt-5');await until(()=>request('/bots/boss/model'),s=>s.model==='openai/gpt-5','reasoning model');
 await until(()=>bar(w)?.querySelector('[id="chat-boss-effort"]'),Boolean,'effort choices');
 await until(()=>bar(w).querySelector('[aria-busy]').getAttribute('aria-busy'),v=>v==='false','selection settled');
 await select(w,w.document.getElementById('chat-boss-effort'),'high');
 await until(()=>request('/bots/boss/model'),s=>s.reasoning.effort==='high','effort persisted');
 // Finish the partial mention before submission: unknown explicit handles are now refused.
 fill(w,'@boss model check');
 await until(()=>w.document.querySelector('[aria-label="Send"]').disabled,v=>!v,'send enabled');w.document.querySelector('[aria-label="Send"]').click();
 await until(()=>fixture.stats.requests.filter(r=>r.kind==='selected-api'),r=>r.length>0,'actual API turn');
 assert.equal(fixture.stats.requests.find(r=>r.kind==='selected-api').model,'openai/gpt-5');assert.equal(fixture.stats.requests.find(r=>r.kind==='selected-api').options.openai.reasoningEffort,'high');
 await until(()=>fixture.db.prepare("select count(*) n from work_runs r join work w on w.id=r.work_id where w.bot_id='boss' and r.status in ('queued','running','draining')").get().n>0,v=>!v,'API finished');
 await until(()=>fixture.runner.withIdleBot('boss',async()=>true).catch(()=>false),Boolean,'API configuration lock released');
 assert.ok(!bar(w).textContent.includes('Saved.'),'Model changes have no success line');assert.equal(w.document.querySelector('[data-slot=toast]'),null,'Model changes have no toast');
 console.log('PASS built composer: actual DropdownMenu effort, model persistence, retained message, blocked save/send race and real runtime receives selected options');
 // A failed update keeps the draft and cannot send under the displayed unsaved choice.
 fill(w,'Retained through a refused configuration');failWrite=true;const before=writes;
 await chooseModel(w,'openai','openai/gpt-4o-mini');await until(()=>bar(w)?.textContent,t=>t.includes('Save was not confirmed'),'refused model').catch(error=>{console.error('Refused state',bar(w)?.textContent,{writes,before});throw error;});
 assert.equal(writes,before+1);assert.equal(w.document.querySelector('[data-slot=toast]'),null,'Refused save never emits success');assert.equal(w.document.querySelector('[aria-label="Send"]').disabled,true);assert.equal(w.document.getElementById('composer-text').value,'Retained through a refused configuration');
 failWrite=false;button(w,'Reload model settings').click();await until(()=>w.document.getElementById('composer-text').readOnly,v=>!v,'explicit readback');
 assert.equal((await request('/bots/boss/model')).model,'openai/gpt-5');
 // Lost response after the write is confirmed by readback, never replayed.
 fixture.mode('lost');const lostBefore=writes;await chooseModel(w,'openai','openai/gpt-4o-mini');
 await until(()=>w.document.getElementById('composer-text').readOnly,v=>!v,'lost response confirmed by readback');assert.equal((await request('/bots/boss/model')).model,'openai/gpt-4o-mini');assert.ok(!bar(w).textContent.includes('Saved.'),'Confirmed readback adds no success line');assert.equal(w.document.querySelector('[data-slot=toast]'),null,'Confirmed readback adds no toast');assert.equal(writes,lostBefore+1);fixture.mode('normal');
 // Unknown receipt: the stored configuration may have changed, so keep sending blocked until explicit readback.
 fixture.mode('lost');failRead=true;const unknownBefore=writes;await chooseModel(w,'openai','openai/gpt-5');
 await until(()=>bar(w)?.textContent,t=>t.includes('Save is uncertain'),'uncertain readback');assert.equal(writes,unknownBefore+1);assert.equal(w.document.getElementById('composer-text').readOnly,true);
 failRead=false;fixture.mode('normal');button(w,'Reload model settings').click();await until(()=>w.document.getElementById('composer-text').readOnly,v=>!v,'uncertain explicit recovery');assert.equal(writes,unknownBefore+1);
 // A peer update refreshes the passive composer without creating a local draft.
 const peer=await request('/bots/boss/model/discover','POST',{target:'openai',model:'openai/gpt-5'});
 await request('/bots/boss/model','PUT',{revision:peer.revision,snapshotId:peer.snapshotId,model:peer.model,reasoning:{effort:'low'}});
 await until(()=>bar(w)?.querySelector('[aria-busy]')?.getAttribute('aria-label'),t=>t?.includes('OpenAI fixture')||t?.includes('gpt-5'),'peer model refresh');
 await until(()=>w.document.getElementById('composer-text').readOnly,v=>!v,'peer update has no draft');
 console.log('PASS refused update, lost-response readback without replay, explicit recovery and external configuration refresh');
 // Exactly one explicit mention owns controls; everyone/multiple mentions do not invent one model.
 await until(()=>w.document.getElementById('model-boss-effort')?.querySelector('[data-slot="select-value"]')?.textContent,t=>t==='low','second editor follows peer effort');
 const stagedBefore=writes;await select(w,w.document.getElementById('model-boss-effort'),'high');assert.equal(writes,stagedBefore,'Settings stages its own value without a composer write');
 const settingsModelLabel=w.document.getElementById('model-choice-boss').textContent;
 const editedWarning=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(editedWarning);assert.equal(editedWarning.defaultPrevented,true,'Settings has a real staged draft before the composer change');
 await chooseModel(w,'openai','openai/gpt-4o-mini');await until(()=>request('/bots/boss/model'),s=>s.model==='openai/gpt-4o-mini','composer saved over independent draft');
 await until(()=>w.document.getElementById('composer-text').readOnly,v=>!v,'composer clean after save');
 assert.equal(w.document.getElementById('model-choice-boss').textContent,settingsModelLabel,'A genuinely edited settings draft must be retained');
 assert.equal(w.document.getElementById('model-boss-effort').querySelector('[data-slot="select-value"]').textContent,'high');
 w.location.hash='#/room/main';await until(()=>w.document.querySelector('[role="alertdialog"]'),Boolean,'independent draft leave guard');button(w,'Discard changes').click();
 await until(()=>w.location.hash,h=>h==='#/room/main','discarded settings draft');await until(()=>w.document.querySelector('[role=alertdialog]'),dialog=>!dialog,'discard prompt closed');await until(()=>bar(w),Boolean,'room composer');
 fill(w,'@eve');await until(()=>w.document.getElementById('mention-everyone'),Boolean,'broadcast suggestion');
 let releaseMention;holdWrite=new Promise(r=>{releaseMention=r;});writeStarted=false;await chooseModel(w,'openai','openai/gpt-5');await until(()=>writeStarted,Boolean,'held mention configuration');
 assert.equal(w.document.getElementById('mention-list'),null);w.document.getElementById('composer-text').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 assert.equal(w.document.getElementById('composer-text').value,'@eve');assert.ok(bar(w),'Mention input cannot unmount the pending controller');
 releaseMention();holdWrite=undefined;await until(()=>w.document.getElementById('composer-text').readOnly,v=>!v,'mention configuration complete');
 fill(w,'@everyone hello');await until(()=>bar(w),v=>!v,'everyone has no single model');
 fill(w,'@boss @coder hello');await pause(30);assert.equal(bar(w),null);
 fill(w,'@coder Controlled ACP reply');await until(()=>bar(w,'coder'),Boolean,'mentioned agent controls');
 await chooseModel(w,'claude','model-b','coder');await until(()=>request('/bots/coder/model'),s=>s.model==='model-b','ACP config saved');
 await until(()=>w.document.querySelector('[aria-label="Send"]').disabled,v=>!v,'ACP send ready');w.document.querySelector('[aria-label="Send"]').click();
 await until(()=>fixture.stats.prompts,r=>r.some(p=>p.model==='model-b'),'actual ACP session model');await until(()=>fixture.db.prepare("select count(*) n from work_runs r join work w on w.id=r.work_id where w.bot_id='coder' and r.status in ('queued','running','draining')").get().n>0,v=>!v,'ACP finished');
 await until(()=>fixture.runner.withIdleBot('coder',async()=>true).catch(()=>false),Boolean,'ACP configuration lock released');
 // The same model menu in Settings stages a selection until its explicit save.
 fill(w,'');agentLink.click();await until(()=>button(w,'Model and reasoning'),Boolean,'settings reopened');button(w,'Model and reasoning').click();
 const settingsTrigger=await until(()=>w.document.getElementById('model-choice-boss'),e=>e&&!e.disabled,'settings model menu ready');
 const settingsWrites=writes;settingsTrigger.click();
 const settingsPopup=await until(()=>w.document.getElementById(settingsTrigger.getAttribute('aria-controls')),Boolean,'settings popup');
 assert.equal(settingsPopup.querySelector('[cmdk-input]'),null,'Settings uses the same radio menu without legacy search');
 const settingsOption=await until(()=>[...settingsPopup.querySelectorAll('[data-model-id]')].find(e=>e.getAttribute('data-model-id')===JSON.stringify(['openai','openai/gpt-4o-mini'])),e=>e&&e.getAttribute('aria-disabled')!=='true','settings choice');settingsOption.click();
 await until(()=>button(w,'Save model configuration'),e=>e&&!e.disabled,'settings draft ready');assert.equal(writes,settingsWrites,'Settings model selection does not autosave');
 assert.equal((await request('/bots/boss/model')).model,'openai/gpt-5');button(w,'Save model configuration').click();
 await until(()=>request('/bots/boss/model'),s=>s.model==='openai/gpt-4o-mini','settings explicit model save');
 console.log('PASS Settings uses grouped radio selection and preserves explicit save behavior');
 await chooseModel(w,'anthropic','anthropic/claude-opus-5');await until(()=>request('/bots/boss/model'),s=>s.model==='anthropic/claude-opus-5','multiple-control model');
 await until(()=>w.document.getElementById('chat-boss-thinking'),Boolean,'Thinking menu beside Effort');assert.ok(w.document.getElementById('chat-boss-effort'));

 // Dictation renders discovered identities and retains the draft across catalogue refresh.
 const dictationWindow = open(owner).w; dictationWindow.location.hash = '#/settings/models';
 const providerMenu = await until(()=>dictationWindow.document.getElementById('dictation-enabled'),e=>e&&!e.disabled,'dictation provider ready');
 providerMenu.click();
 const providerOption = await until(()=>[...dictationWindow.document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()==='OpenAI'),Boolean,'OpenAI dictation option'); providerOption.click();
 const modelMenu = await until(()=>dictationWindow.document.getElementById('dictation-model'),e=>e&&!e.disabled,'dictation model ready'); modelMenu.click();
 const discovered = await until(()=>[...dictationWindow.document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()==='unfamiliar-file-model'),Boolean,'discovered file model');
 assert.ok(![...dictationWindow.document.querySelectorAll('[role=option]')].some(e=>e.textContent.includes('live-only'))); discovered.click();
 const oldRefresh = fixture.botModels.catalogue.read('openai').snapshotId;
 fixture.block(); button(dictationWindow,'Refresh models').click();
 await until(()=>button(dictationWindow,'Refreshing models…'),Boolean,'refresh entered pending state');
 assert.equal(button(dictationWindow,'Save dictation').disabled,true,'save blocked during discovery'); fixture.release();
 await until(()=>fixture.botModels.catalogue.read('openai').snapshotId,v=>v!==oldRefresh,'catalogue refreshed');
 await until(()=>button(dictationWindow,'Refresh models'),e=>e&&!e.disabled,'refresh completed');
 assert.ok(dictationWindow.document.getElementById('dictation-model').textContent.includes('unfamiliar-file-model'),'refresh preserves unsaved selection');
 await until(()=>button(dictationWindow,'Save dictation'),e=>e&&!e.disabled,'dictation save ready');
 button(dictationWindow,'Save dictation').click();
 try { await until(()=>request('/dictation'),s=>s.enabled&&s.model==='unfamiliar-file-model','discovered dictation identity saved'); } catch(error) { console.error('Controlled dictation UI alerts', [...dictationWindow.document.querySelectorAll('[role=alert]')].map(e=>e.textContent)); throw error; }
 console.log('PASS discovered dictation menu, realtime exclusion, refresh draft retention and explicit save');

 const limited=await request('/devices','POST',{name:'Limited composer',access:'limited'}),low=open(limited.token).w;
 await until(()=>low.document.getElementById('composer-text'),Boolean,'Limited chat');assert.equal(low.document.querySelector('[aria-label^="Model settings for"]'),null);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS mention targeting, controlled ACP selection reaches actual runtime, Limited chat has no configuration write controls; no real providers/adapters');
}catch(error){console.error(error);throw error;}finally{fixture.release();for(const socket of sockets)socket.terminate();for(const w of windows)w.close();await fixture.close();await commitMemory(dir,'acceptance: drain memory writes');rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
