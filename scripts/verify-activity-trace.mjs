// Standalone real-component projection/render acceptance; --serve opens a disposable Vite preview.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/desk/package.json');
const {createServer}=await import(require.resolve('vite')),{createElement}=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const dir=mkdtempSync(join(tmpdir(),'openag-activity-view-'));
const vite=await createServer({root:root+'apps/desk',server:{host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root,dir]}},appType:'mpa'});
const {activityItems}=await vite.ssrLoadModule('/src/activity.ts');
const {ActivityTrace,isActivity}=await vite.ssrLoadModule('/src/components/ActivityTrace.tsx');
let id=0;
const event=(type,payload,actor='bot')=>({id:++id,ts:Date.now(),roomId:'main',actor,type,payload:{turnId:'original',...payload}});
function operation(call,outcome,{command='rg marker connector.txt',wrapper='codex',turnId='original'}={}){
 const args={command},receiptId='receipt-'+call,toolCallId='daemon-'+call,outerId='adapter-'+call;
 const title=wrapper==='codex'?'mcp.openag-0123456789abcdef.run_shell':'mcp__openag-0123456789abcdef__run_shell';
 return [event('tool_call',{turnId,toolCallId:outerId,title,input:wrapper==='codex'?{server:'openag-0123456789abcdef',tool:'run_shell',arguments:args}:{}}),
  event('tool_call',{turnId,toolCallId,tool:'run_shell',args}),
  ...['pending','pending',outcome].map(outcome=>event('receipt_updated',{turnId,receiptId,toolCallId,outcome},'daemon')),
  event('tool_result',{turnId,toolCallId,tool:'run_shell',receiptId,ok:outcome==='completed',invocationOutcome:'returned',executionOutcome:outcome,result:{stderr:outcome==='failed'?'rg: command not found':''}}),
  event('tool_result',{turnId,toolCallId:outerId,title,input:wrapper==='claude'?args:undefined,status:outcome==='completed'?'completed':'failed'})];
}
const screenshot=[event('turn_started',{}),...operation('missing-rg','failed'),...operation('timeout','unknown',{command:'grep -R marker /fixture'}),event('turn_finished',{status:'finished'})];
try{
 const projected=activityItems(screenshot),steps=projected.filter(item=>item.event.type==='tool_result');
 assert.equal(steps.length,2);assert.deepEqual(steps.map(item=>item.event.payload.executionOutcome),['failed','unknown']);
 assert.ok(steps.every(item=>item.history.length===7));
 const html=renderToStaticMarkup(createElement(ActivityTrace,{events:screenshot}));
 assert.equal((html.match(/data-slot="trace-line"/g)??[]).length,1,'Settled activity starts as one collapsed summary');
 assert.ok(!html.includes('execution: pending'));assert.ok(html.includes('1 unconfirmed')&&html.includes('1 failed'),'Summary retains failure and uncertainty');
 assert.equal((html.match(/data-status="error"/g)??[]).length,1,'Unknown must not become adapter Failed');
 for(const wrapper of ['claude','codex']){
  const repeated=[...operation('one','completed',{wrapper}),...operation('two','failed',{wrapper})];
  assert.equal(activityItems(repeated).length,2,'Repeated equal arguments are separate invocations');
  const pending=operation('pending','completed',{wrapper}).slice(0,4);
  assert.equal(activityItems(pending).filter(item=>item.event.type==='receipt_updated').length,1,'Authorization and start are one pending step');
 }
 const first=operation('split','completed'),interrupted=[...first.slice(0,2),event('bot_output',{text:'Still checking'}),...first.slice(2)];
 const firstSegment=first.slice(0,2);const splitHtml=renderToStaticMarkup(createElement(ActivityTrace,{events:firstSegment,items:activityItems(interrupted)}));
 assert.ok(splitHtml.includes('1 operation')&&!splitHtml.includes('unconfirmed'),'Later results update a grouped step across message boundaries');
 const separate=operation('same-id','completed');const other=separate.map(item=>({...item,roomId:'another-room'}));
 assert.equal(activityItems([...separate,...other]).filter(item=>item.event.type==='tool_result').length,2,'Rooms do not merge');
 const native=[event('tool_call',{toolCallId:'native',title:'native_tool',input:{}}),event('tool_result',{toolCallId:'native',status:'failed'})];
 assert.equal(activityItems(native).length,1,'Unforwarded adapter failure remains visible');
 const defaultOnly=operation('defaults','completed');
 defaultOnly[0].payload.input.arguments={};defaultOnly[1].payload.args={query:'',offset:0};
 assert.equal(activityItems(defaultOnly).length,1,'Complete empty arguments may acquire schema defaults');
 const subset=operation('subset','completed'),specific=operation('specific','failed');
 subset[0].payload.input.arguments={query:'x'};subset[1].payload.args={query:'x',count:10};
 specific[0].payload.input.arguments={query:'x',count:2};specific[1].payload.args={query:'x',count:2};
 const reordered=[subset[0],specific[0],...specific.slice(1),...subset.slice(1)];
 const matched=activityItems(reordered);
 assert.equal(matched.length,2);assert.equal(matched.find(item=>item.event.id===subset[0].id).event.payload.receiptId,'receipt-subset');
 assert.equal(matched.find(item=>item.event.id===specific[0].id).event.payload.receiptId,'receipt-specific');
 const ambiguous=operation('ambiguous','failed');ambiguous[0].payload.input.arguments={query:'x'};ambiguous[1].payload.args={query:'x',count:2};
 const empty=operation('empty','completed');empty[0].payload.input.arguments={};
 const unresolved=activityItems([ambiguous[0],empty[0],...ambiguous.slice(1)]);
 assert.ok(unresolved.filter(item=>item.history.some(event=>event.type==='tool_call')).length>1,'Ambiguous subsets must stay separate');
 const raw=JSON.stringify(screenshot);activityItems(screenshot);assert.equal(JSON.stringify(screenshot),raw,'Ledger input is immutable');
 console.log('PASS screenshot lifecycle, pending/completed/failed/unknown, repeated calls, split feed, independent rooms and native failure; actual Trace SSR');
 const journeyArg=process.argv.indexOf('--journey');
 let journeys=[];
 if(journeyArg!==-1){
  for(const adapter of ['claude','codex']){
   const events=JSON.parse(readFileSync(join(process.argv[journeyArg+1],adapter,'events.json'),'utf8')).filter(isActivity);
   const items=activityItems(events),daemon=events.filter(event=>event.type==='tool_result'&&event.payload.tool);
   assert.equal(daemon.length,3);assert.equal(items.filter(item=>item.event.type==='tool_result').length,3,adapter+' wrappers must collapse into their three real operations');
   assert.ok(items.filter(item=>item.event.type==='tool_result').every(item=>item.event.payload.executionOutcome==='completed'));
   const rendered=renderToStaticMarkup(createElement(ActivityTrace,{events}));assert.ok(!rendered.includes('execution: pending'));
   journeys.push({adapter,events});console.log('PASS '+adapter+' actual gateway/ACP events render three completed operations without duplicate wrappers');
  }
 }
 if(process.argv.includes('--serve')){
  writeFileSync(join(dir,'events.json'),JSON.stringify({screenshot,journeys}));
  const entry=root+'apps/desk/.activity-review.tsx',page=root+'apps/desk/.activity-review.html';
  writeFileSync(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{Feed}from'./src/components/Feed';import{StreamProvider}from'./src/stream';import{ActivityTrace}from'./src/components/ActivityTrace';import{Button}from'./src/components/ui/button';import'./src/styles.css';import data from ${JSON.stringify(join(dir,'events.json'))};const stream={onClose:()=>()=>{},subscribe:async()=>()=>{}};function Review(){const[state,setState]=React.useState('finished');const events=state==='pending'?data.screenshot.slice(0,5):data.screenshot;return <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6"><h1>Activity verification</h1><div className="flex gap-2"><Button onClick={()=>setState('pending')}>Pending</Button><Button onClick={()=>setState('finished')}>Finished</Button></div><section><h2>Original failure sequence</h2><Feed events={events}/></section>{data.journeys.map(j=><section key={j.adapter}><h2>{j.adapter} verified journey</h2><ActivityTrace events={j.events}/></section>)}</main>}createRoot(document.getElementById('root')!).render(<StreamProvider token="fixture" onAuthFailure={()=>{}} rtcTransport={stream as any}><Review/></StreamProvider>);`);
  writeFileSync(page,'<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.activity-review.tsx"></script></body></html>');
  try{await vite.listen();console.log('PREVIEW '+vite.resolvedUrls.local[0]+'.activity-review.html');await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});}
  finally{rmSync(entry,{force:true});rmSync(page,{force:true});}
 }
}finally{await vite.close();rmSync(dir,{recursive:true,force:true});}
