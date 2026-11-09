// Real Feed/Composer/avatar DOM integration with deterministic work counters, not browser frame-rate evidence.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/desk/package.json');
const {JSDOM}=require('jsdom'),React=require('react'),{act}=React;
const dom=new JSDOM('<div id="root"></div>',{url:'http://render.fixture/',pretendToBeVisual:true});
const saved=new Map(),frames=new Map(),intersections=new Set(),resizes=new Set(),mediaListeners=new Set();
let frame=0,clock=performance.now(),reduced=false,formReads=0;
const metrics={projections:0,markdown:0,evidence:0};
class IntersectionObserver {
  targets=new Set();
  constructor(callback){this.callback=callback;intersections.add(this);}
  observe(target){this.targets.add(target);}
  unobserve(target){this.targets.delete(target);}
  disconnect(){this.targets.clear();intersections.delete(this);}
}
class ResizeObserver {
  targets=new Set();
  constructor(callback){this.callback=callback;resizes.add(this);}
  observe(target){this.targets.add(target);}
  unobserve(target){this.targets.delete(target);}
  disconnect(){this.targets.clear();resizes.delete(this);}
}
const media={get matches(){return reduced;},addEventListener:(_,fn)=>mediaListeners.add(fn),removeEventListener:(_,fn)=>mediaListeners.delete(fn)};
const globals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
  HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,Node:dom.window.Node,MutationObserver:dom.window.MutationObserver,
  Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,localStorage:dom.window.localStorage,
  getComputedStyle:dom.window.getComputedStyle.bind(dom.window),matchMedia:()=>media,IntersectionObserver,ResizeObserver,
  requestAnimationFrame:fn=>{frames.set(++frame,fn);return frame;},cancelAnimationFrame:id=>frames.delete(id),
  IS_REACT_ACT_ENVIRONMENT:true,__openagRenderMetrics:metrics};
for(const [key,value] of Object.entries(globals)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});}
for(const key of ['matchMedia','IntersectionObserver','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'])dom.window[key]=globals[key];
for(const key of ['scrollTo','scrollIntoView'])dom.window.HTMLElement.prototype[key]=()=>{};
const originalRect=dom.window.HTMLElement.prototype.getBoundingClientRect;
dom.window.HTMLElement.prototype.getBoundingClientRect=function(){if(this.tagName==='FORM'){formReads++;return new dom.window.DOMRect(0,0,800,this.dataset.composerExpanded==='true'?160:56);}return originalRect.call(this);};
const settle=fn=>act(async()=>{fn?.();await new Promise(resolve=>setImmediate(resolve));});
const flush=()=>{clock+=17;const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn(clock));};
const visible=(target,value)=>{for(const observer of intersections)if(observer.targets.has(target))observer.callback([{target,isIntersecting:value}]);};
const resize=(target,height)=>{for(const observer of resizes)if(observer.targets.has(target))observer.callback([{target,borderBoxSize:[{blockSize:height}],contentRect:{height}}]);};
let vite,reactRoot,previewHistory;
try{
  const {createServer}=await import(require.resolve('vite'));
  vite=await createServer({configFile:false,root:root+'apps/desk',resolve:{alias:{'@':root+'apps/desk/src'}},server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{
    name:'render-work-counters',enforce:'pre',transform(code,id){
      if(id.endsWith('/src/activity.ts'))return code.replace('export function activityItems(events: readonly LedgerEvent[]): ActivityItem[] {','$&\n globalThis.__openagRenderMetrics.projections++;');
      if(id.endsWith('/src/components/MessageText.tsx'))return code.replace(/(function MessageText\(\{ text \}: \{ text: string \}\) \{)/,'$1\n globalThis.__openagRenderMetrics.markdown++;');
      if(id.endsWith('/src/components/ActivityTrace.tsx'))return code.replace('JSON.stringify(history.length > 1 ? history : event.payload, null, 2)','(globalThis.__openagRenderMetrics.evidence++, JSON.stringify(history.length > 1 ? history : event.payload, null, 2))');
    }
  }]});
  const {Feed}=await vite.ssrLoadModule('/src/components/Feed.tsx');
  const {Composer}=await vite.ssrLoadModule('/src/components/Composer.tsx');
  const {BotAvatar}=await vite.ssrLoadModule('/src/components/BotAvatar.tsx');
  const {StreamProvider}=await vite.ssrLoadModule('/src/stream.tsx');
  const {setHideTechnicalActivity}=await vite.ssrLoadModule('/src/chat-display.ts');
  const {createRoot}=require('react-dom/client');reactRoot=createRoot(document.getElementById('root'));
  const transport={onClose:()=>()=>{},subscribe:async()=>()=>{}};
  const wrap=child=>React.createElement(StreamProvider,{token:'fixture',rtcTransport:transport,onAuthFailure:()=>{}},child);
  const render=child=>settle(()=>reactRoot.render(wrap(child)));
  const bot={id:'coder',name:'Coder',runtime:'api',avatar:{shape:'mug',color:'blue'}};
  let nextId=0;
  const event=(type,payload,actor='coder')=>({id:++nextId,ts:1700000000000+nextId,roomId:'main',actor,type,payload});
  const makeHistory=(count,offset=0)=>Array.from({length:count},(_,index)=>{const i=index+offset;return [
    event('message',{text:'Question '+i},'user'),event('turn_started',{turnId:'turn-'+i}),
    event('tool_call',{turnId:'turn-'+i,toolCallId:'call-'+i,tool:'read',args:{path:'fixture-'+i}}),
    event('bot_output',{text:'**Findings** '+i+'\n\n- One\n- Two'}),
    event('tool_result',{turnId:'turn-'+i,toolCallId:'call-'+i,tool:'read',ok:true,result:{text:'Synthetic evidence '.repeat(80)}}),
    event('turn_finished',{status:'finished'})
  ];}).flat();
  const history=makeHistory(130);
  previewHistory=history;
  const props={events:history,bots:[bot]},feed=extra=>React.createElement(Feed,{...props,...extra});
  let started=performance.now();await render(feed());
  console.log(JSON.stringify({check:'long-feed-initial',events:history.length,activityProjections:metrics.projections,markdownRenders:metrics.markdown,collapsedEvidenceFormats:metrics.evidence,domMs:Math.round(performance.now()-started)}));
  assert.equal(metrics.projections,1,'Feed must prepare the full history once, shared across all activity sections');
  assert.equal(metrics.markdown,130,'Counters must exercise actual bot Markdown rendering');
  assert.equal(metrics.evidence,0,'Collapsed activity must not serialize stored evidence');
  const messages=metrics.markdown,projects=metrics.projections;
  await render(feed({loading:true}));
  assert.equal(metrics.projections,projects,'Unchanged history must reuse its projection');
  assert.equal(metrics.markdown,messages,'Unchanged message text must not reparse Markdown');
  const summary=[...document.querySelectorAll('[data-slot="trace-collapsible-trigger"]')].find(button=>button.textContent.includes('Activity'));
  await settle(()=>summary.click());
  assert.equal(metrics.evidence,0,'Opening a task summary must not serialize closed operation evidence');
  const first=[...document.querySelectorAll('[data-slot="trace-collapsible-trigger"]')].find(button=>button.textContent.includes('read: ok'));
  await settle(()=>first.click());
  assert.ok(metrics.evidence>0,'Opening native Trace must format and display evidence');
  assert.ok([...document.querySelectorAll('[data-slot="trace-collapsible-content"] pre')].some(pre=>/"toolCallId": "call-\d+"/.test(pre.textContent)),'Expanded operation retains its invocation identity');
  const beforeUpdate=metrics.projections;
  const next=[...history,event('message',{text:'One new message'},'user')];
  await render(feed({events:next}));
  assert.equal(metrics.projections,beforeUpdate+1,'One new history snapshot causes one projection');
  assert.equal(metrics.markdown,messages,'A new user message must not reparse existing bot messages');
  assert.ok(document.body.textContent.includes('One new message'));
  await settle(()=>setHideTechnicalActivity(true));
  assert.equal(document.querySelector('[data-slot="trace"]'),null,'Hidden activity does not mount trace sections');
  await settle(()=>setHideTechnicalActivity(false));
  const beforeLarge=metrics.projections,larger=[...history,...makeHistory(130,130)];
  started=performance.now();await render(feed({events:larger}));
  assert.equal(metrics.projections,beforeLarge+1,'A larger history still uses exactly one projection');
  assert.equal(document.querySelectorAll('[aria-label="Agent activity"]').length,520);
  console.log(JSON.stringify({check:'larger-feed',events:larger.length,activityProjections:metrics.projections-beforeLarge,domMs:Math.round(performance.now()-started)}));
  console.log('PASS shared projection, split activity, lazy native evidence, stable Markdown and activity visibility.');
  const {avatarColors,avatarFor}=await vite.ssrLoadModule('/src/components/avatar-catalogue.ts');
  const paletteBots=Object.keys(avatarColors).map(color=>({...bot,id:'agent-'+color,name:'Agent '+color,avatar:{shape:'mug',color}}));
  const automatic={...bot,id:'automatic',avatar:{shape:'mug',color:null}};
  const paletteEvents=[event('message',{text:'Human question\n<em>literal</em>'},'user'),
    ...paletteBots.map(agent=>event('bot_output',{text:'**Reply** from '+agent.id},agent.id)),
    event('message',{text:'Automatic colour'},automatic.id),event('bot_output',{text:'Missing agent metadata'},'missing-agent'),
    event('error',{message:'Controlled failure'},bot.id)];
  await render(feed({events:paletteEvents,bots:[...paletteBots,automatic,bot]}));flush();
  assert.ok(!document.body.textContent.includes('Checkpoint')&&!document.body.textContent.includes('Fork from here'),'Chat has no checkpoint controls');
  const messageRows=[...document.querySelectorAll('[data-slot="message"]')];
  assert.equal(messageRows.length,paletteEvents.length);
  const human=messageRows[0];
  assert.equal(human.dataset.align,'end','Human messages align right');
  assert.equal(human.querySelector('[data-slot="bubble"]').dataset.variant,'muted');
  assert.ok(human.querySelector('[data-slot="message-content"]').classList.contains('items-end'),'Attachments follow user alignment');
  assert.ok(human.textContent.includes('<em>literal</em>'),'User text remains literal');
  assert.equal(human.querySelector('em'),null);
  for(const [index,agent] of paletteBots.entries()){
    const row=messageRows[index+1],bubble=row.querySelector('[data-slot="bubble"]');
    assert.equal(row.dataset.align,'start','Agent messages align left');
    assert.equal(row.getAttribute('aria-label'),agent.name+' message','Sender remains accessible');
    assert.equal(bubble.dataset.variant,'tinted');
    assert.equal(bubble.style.getPropertyValue('--primary'),avatarColors[agent.avatar.color]);
    assert.equal(bubble.querySelector('strong').textContent,'Reply','Agent Markdown remains formatted');
  }
  assert.equal(messageRows.at(-3).querySelector('[data-slot="bubble"]').style.getPropertyValue('--primary'),avatarColors[avatarFor(automatic.id).color]);
  assert.equal(messageRows.at(-2).querySelector('[data-slot="bubble"]').style.getPropertyValue('--primary'),avatarColors[avatarFor('missing-agent').color]);
  assert.equal(messageRows.at(-1).querySelector('[data-slot="bubble"]').dataset.variant,'destructive','Errors retain semantic styling');
  assert.equal(messageRows.at(-1).querySelector('[data-slot="bubble"]').style.getPropertyValue('--primary'),'');
  assert.equal(document.querySelector('[data-slot="message-avatar"], [data-slot="message-header"], .bot-avatar'),null,'No message avatars or visible sender headers');
  assert.equal(document.querySelectorAll('[data-slot="message-footer"] time[datetime]').length,paletteEvents.length,'Timestamps remain in native footers');
  assert.equal(frames.size,0,'Chat rows do not mount avatar animation');
  const recoloured=paletteBots.map(agent=>({...agent,avatar:{...agent.avatar,color:'teal'}}));
  await render(feed({events:paletteEvents,bots:[...recoloured,automatic,bot]}));
  assert.equal(document.querySelectorAll('[data-slot="bubble"]')[1].style.getPropertyValue('--primary'),avatarColors.teal,'Appearance refresh updates existing bubbles');
  console.log('PASS native Message/Bubble alignment, all avatar colours, automatic/missing metadata, live recolour, accessible senders, timestamps, Markdown, literal user text and destructive errors; no chat avatar frames.');
  await render(React.createElement(React.Fragment,null,Array.from({length:60},(_,i)=>React.createElement(BotAvatar,{key:i,name:'avatar-'+i}))));flush();
  assert.equal(frames.size,1,'Visible avatars retain one shared animation loop');
  const hosts=[...document.querySelectorAll('.bot-avatar')];
  await settle(()=>hosts.forEach(host=>visible(host,false)));flush();
  assert.equal(frames.size,0,'All off-screen avatars must unsubscribe from animation');
  const avatars=(mood,animated=true)=>React.createElement(React.Fragment,null,Array.from({length:60},(_,i)=>React.createElement(BotAvatar,{key:i,name:'avatar-'+i,mood,avatar:{shape:'sprout',color:'pink',animated}})));
  await render(avatars('happy'));flush();
  assert.equal(frames.size,0,'Off-screen completion must not start an animation');
  await render(avatars('idle'));flush();
  assert.equal(frames.size,0,'Updates while off-screen must not restart animation');
  await settle(()=>visible(hosts[0],true));flush();
  assert.equal(frames.size,1);assert.equal(hosts[0].dataset.mood,'idle','An expired celebration must not replay on re-entry');assert.equal(hosts[0].dataset.shape,'sprout');
  assert.ok(hosts[0].querySelector('[data-avatar-scene]'),'Re-entry renders current appearance');
  await settle(()=>{reduced=true;for(const fn of mediaListeners)fn();});flush();assert.equal(frames.size,0);
  await settle(()=>{reduced=false;for(const fn of mediaListeners)fn();});flush();assert.equal(frames.size,1);
  await render(avatars('thinking',false));flush();assert.equal(frames.size,0,'Saved animation-off still wins for visible avatars');
  assert.ok(hosts[0].querySelector(':scope > svg'));
  await render(null);assert.equal(frames.size,0);assert.equal(intersections.size,0,'Unmount cleans visibility observers');
  console.log('PASS off-screen animation suspension, hidden updates, current-state resume, reduced motion and cleanup.');
  const api={getPermissions:async()=>({preset:'workspace-write',revision:1}),removeAttachment:async()=>{throw Error('Unexpected upload write');}};
  let sends=0;
  const composer=()=>React.createElement(Composer,{api,roomId:'main',bots:[bot],defaultBotId:'coder',onSend:async()=>{sends++;throw Error('Unexpected send');}});
  await render(composer());
  const area=document.querySelector('textarea'),form=area.closest('form');
  await settle(()=>area.focus());
  const readBefore=formReads;
  const type=text=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(area,text);area.dispatchEvent(new window.Event('input',{bubbles:true}));};
  for(let i=1;i<=25;i++)await settle(()=>type('Draft '+i));
  assert.equal(formReads,readBefore,'Steady typing must not synchronously measure the composer');
  assert.equal(area.value,'Draft 25');assert.equal(document.activeElement,area);
  await settle(()=>{resize(form,240);area.setSelectionRange(3,3);});
  await render(composer());assert.equal(area.value,'Draft 25');assert.equal(area.selectionStart,3,'Parent refresh preserves the caret');
  assert.equal(formReads,readBefore,'ResizeObserver records border-box size without another layout read');
  await settle(()=>area.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));
  assert.equal(sends,0,'IME confirmation must not attempt a send, even if the provider would refuse');
  assert.equal(area.value,'Draft 25','IME confirmation must not send the draft');
  let animation;
  form.animate=keyframes=>{animation=keyframes;return {playState:'finished',cancel(){}};};
  await settle(()=>type(''));
  await settle(()=>{form.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true}));area.blur();});
  assert.equal(form.dataset.composerExpanded,'false');
  assert.equal(animation[0].height,'240px','Pointer collapse starts from the last observed content height');
  assert.equal(animation[1].height,'56px');
  console.log('PASS 25 keystrokes without form measurement; parent refresh retains draft, focus and caret.');
  await render(null);assert.equal(resizes.size,0,'Unmount cleans resize observers');
  await render(React.createElement(Composer,{api,roomId:'main',bots:[bot],defaultBotId:'coder',showSuggestions:true,onSend:async()=>{sends++;}}));
  const suggestion=[...document.querySelectorAll('button')].find(button=>button.textContent==='Help me plan a task');assert.ok(suggestion);
  await settle(()=>suggestion.click());assert.equal(document.querySelector('textarea').value,'Help me plan a task');assert.equal(sends,0,'Suggestions prepare a draft and preserve normal send guards');
  assert.equal(document.querySelector('[aria-label="Suggested prompts"]'),null,'A draft is never replaced by a suggestion');
  await render(null);assert.equal(resizes.size,0);
  console.log('PASS suggested prompts prepare an editable draft without bypassing send/configuration guards.');
}finally{
  if(reactRoot)await act(()=>reactRoot.unmount());
  await vite?.close();dom.window.close();
  for(const [key,descriptor] of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
}
if(process.argv.includes('--serve')){
  const {startUsabilityFixture}=await import('./desk-usability-fixture.mjs');
  const fixture=await startUsabilityFixture();
  let timer;
  try{
    for(const event of previewHistory)fixture.ledger.append('main',event.actor==='coder'?'boss':event.actor,event.type,event.payload);
    let incoming=0;
    timer=setInterval(()=>{
      fixture.ledger.append('main','boss','bot_output',{text:'Incoming fixture message '+(++incoming)});
      if(incoming===60)clearInterval(timer);
    },5000);
    console.log(JSON.stringify({url:fixture.url+'/#/room/main',pairingCode:fixture.pairCode(),note:'Disposable built desk; 780 synthetic events and one incoming message every five seconds for five minutes. No live model or provider.'}));
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  }finally{clearInterval(timer);await fixture.close();}
}
