// Standalone gateway/ACP acceptance. --real uses subscription adapters with only a local input fixture.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const real=process.argv.includes('--real');
if(real)for(const key of Object.keys(process.env))if(!['PATH','HOME','LANG','TMPDIR'].includes(key))delete process.env[key];
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json');
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {serve}=require('@hono/node-server');
const {agent,methods}=await import(require.resolve('@agentclientprotocol/sdk/unstable'));
const {Client}=await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const {StreamableHTTPClientTransport}=await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals');
const {createAcpRuntime}=await load('runtimes/acp'),{createRunner}=await load('runtimes/runner');
const {createMcpAccess}=await load('mcpserver'),{requestInputTool}=await load('tools/input');
const {createBot,createRoom,addMember,getBot,getRoom}=await load('rooms');
const {createGateway}=await load('gateway'),{createAuth}=await load('auth'),{createQuestions}=await load('questions');
const {toExecutors}=await load('tools/registry');
const parent=mkdtempSync(join(tmpdir(),'openag-continuity-'));
let groups=0;
try{
 for(const adapter of ['claude','codex'].filter(value=>!process.argv.includes('--adapter')||value===process.argv[process.argv.indexOf('--adapter')+1])){
  const dir=join(parent,adapter),db=openDb(dir),ledger=createLedger(db),approvals=createApprovals(db,ledger),questions=createQuestions(db,ledger);
  const marker='LOCAL-'+randomUUID(),answer='amber';
  const prompts=[],runs=[],nativeCompletions=[],actionRequests=[];
  let runner,acp,app,server,base,unsubscribe,generation=0;
  const auth=createAuth({db,ownerToken:'controlled-owner'});
  const events=(room='main')=>ledger.list(room,{limit:1000});
  const instructions='Local conversation continuity acceptance. Use only this conversation and its supplied history. Never write memory, read files, run commands, delegate or contact external services. You may discover the daemon-provided request_input tool. PAUSE means call request_input exactly once to ask which local option, then stop. An answer continues the earlier request: return the earlier local marker and chosen option. Never invent missing details.';
  createBot(db,{id:'bot',runtime:'acp',config:{adapter,instructions}});
  for(const room of ['main','private','_isolated']){createRoom(db,{id:room,leadBotId:'bot'});addMember(db,room,'bot');}
  const waitFor=(read,label,room='main')=>new Promise((resolve,reject)=>{
   let off;const timer=setTimeout(()=>{off();reject(Error(label+' deadline'));},real?120000:15000);
   const check=()=>{try{const value=read();if(value){clearTimeout(timer);off();resolve(value);}}catch(e){clearTimeout(timer);off();reject(e);}};
   off=ledger.subscribe(room,check);check();
  });
  function setup(){
   const access=createMcpAccess({runner:{activeTurn:(...args)=>runner.activeTurn(...args)},dataDir:dir,tools:()=>[requestInputTool]});
   let sessionCount=0;
   const launcher=real?undefined:()=>{
    const sessions=new Map();
    const fake=agent({name:'continuity-controlled'})
     .onRequest(methods.agent.initialize,()=>({protocolVersion:1,agentCapabilities:{sessionCapabilities:{systemPrompt:{}}}}))
     .onRequest(methods.agent.session.new,({params})=>{const id=`g${generation}-s${++sessionCount}`;sessions.set(id,{endpoint:params.mcpServers[0],marker:'',answer:''});return {sessionId:id,modes:{currentModeId:adapter==='codex'?'read-only':'default',availableModes:[{id:adapter==='codex'?'read-only':'default',name:'Ask'}]}};})
     .onRequest(methods.agent.session.setMode,()=>({}))
     .onNotification(methods.agent.session.cancel,()=>{})
     .onRequest(methods.agent.session.prompt,async({params,client})=>{
      const s=sessions.get(params.sessionId),text=params.prompt.filter(p=>p.type==='text').map(p=>p.text).join('\n');
      const current=text.split('</openag_context>').at(-1).trim();
      prompts.push({text,current,sessionId:params.sessionId});
      const notify=update=>client.notify(methods.client.session.update,{sessionId:params.sessionId,update});
      if(current.startsWith('PAUSE:')){
       let unwound;nativeCompletions.push(new Promise(resolve=>{unwound=resolve;}));
       try{
        const name='request_input',serverName=s.endpoint.name,toolCallId=randomUUID();
        const title=adapter==='codex'?`mcp.${serverName}.${name}`:`mcp__${serverName}__${name}`;
        await notify({sessionUpdate:'tool_call',toolCallId,title,kind:'execute',status:'pending',rawInput:{server:serverName,tool:name,arguments:{prompt:'Which local option?'}}});
        const toolCall=adapter==='codex'?{toolCallId,kind:'execute'}:{toolCallId,title,name:title,kind:'other',_meta:{claudeCode:{toolName:title,mcpServer:{name:serverName,source:'dynamic'}}}};
        const permission=await client.request(methods.client.session.requestPermission,{sessionId:params.sessionId,toolCall,options:[{optionId:'once',name:'Allow once',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]});
        assert.equal(permission.outcome.optionId,'once');
        const mcp=new Client({name:'continuity-fixture',version:'1'});
        try{await mcp.connect(new StreamableHTTPClientTransport(new URL(s.endpoint.url),{requestInit:{headers:Object.fromEntries(s.endpoint.headers.map(h=>[h.name,h.value]))}}));await mcp.callTool({name,arguments:{prompt:'Which local option?'}});}catch(error){if(!questions.get(events().find(e=>e.type==='question_updated')?.payload.questionId))throw error;}finally{await mcp.close();}
        // Deliberately unwind after the daemon has yielded: neither update belongs in the finished turn.
        await notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'LATE_PAUSED_OUTPUT'}});
        return {stopReason:'cancelled'};
       }finally{unwound();}
      }
      if(text.includes(marker))s.marker=marker;
      if(text.includes(answer))s.answer=answer;
      const output=current.includes('SEED:')?'The local marker is '+marker:current.includes('CANCEL:')?'':(s.marker||'MISSING_HISTORY')+(s.answer?' '+s.answer:'');
      if(output)await notify({sessionUpdate:'agent_message_chunk',content:{type:'text',text:output}});
      return {stopReason:current.includes('CANCEL:')?'cancelled':'end_turn'};
     });
    return {target:fake,close(){}};
   };
   acp=createAcpRuntime({dataDir:dir,launcher,mcp:{access,baseUrl:()=>base,tools:new Set(['request_input'])}});
   runner=createRunner({db,ledger,approvals,dataDir:dir,runtimes:{acp},tools:toExecutors([requestInputTool])});
   app=createGateway({db,ledger,approvals,auth,dataDir:dir,work:runner.work,cancelWork:runner.cancelWork,dispatch:args=>{const run=runner.dispatch(args);runs.push(run);return run;}});
   return access;
  }
  const post=async(text,room='main',meta)=>{
   const start=events(room).at(-1)?.id??0;
   const message=ledger.append(room,'user','message',{text});
   const finished=waitFor(()=>events(room).find(e=>e.id>start&&e.type==='turn_finished'),'finished '+text.slice(0,20),room);
   await runner.run(getRoom(db,room),getBot(db,'bot'),message,undefined,meta);
   await finished;
   return events(room).filter(e=>e.id>message.id);
  };
  const output=list=>list.filter(e=>e.type==='bot_output').map(e=>e.payload.text??'').join('\n');
  try{
   let access=setup();
   server=serve({fetch:req=>new URL(req.url).pathname==='/mcp'?access.handle(req):app.fetch(req),hostname:'127.0.0.1',port:0});
   if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
   base=`http://127.0.0.1:${server.address().port}`;
   unsubscribe=ledger.subscribe('main',event=>{if(event.type==='approval_requested'){actionRequests.push(event.payload.toolName);queueMicrotask(()=>{const a=approvals.get(event.payload.approvalId);approvals.resolve(a.id,{kind:'ignore'},a.reviewVersion);});}});
   console.log(`starting ${real?'real ':'controlled '}${adapter}: pause and continuation`);
   await post(`SEED: The local marker is ${marker}. This is conversation context only. Acknowledge it without tools or memory writes.`);
   const cached=await post('CACHED: Return the earlier local marker, without tools.');assert.ok(output(cached).includes(marker),'cached session remembers marker');
   if(!real)assert.ok(!prompts.at(-1).text.includes('Selected conversation history'),'cached context is not injected twice');
   const paused=await post('PAUSE: Ask which local option to use via request_input, then wait.');
   if(!real)await Promise.all(nativeCompletions);
   const questionEvent=paused.find(e=>e.type==='question_updated');assert.ok(questionEvent,'durable question exists');
   const q=questions.get(questionEvent.payload.questionId);assert.equal(q.status,'open');
   const pausedTurn=paused.find(e=>e.type==='turn_finished');assert.equal(pausedTurn.payload.status,'finished');assert.equal(pausedTurn.payload.reason,'awaiting_input');
   assert.ok(!events().some(e=>e.payload.turnId===pausedTurn.payload.turnId&&(e.payload.stopReason==='cancelled'||e.payload.text==='LATE_PAUSED_OUTPUT')),'input pause is not a cancellation or late reply');
   if(process.argv.includes('--render')&&!real){
    const deskRequire=createRequire(root+'apps/desk/package.json');
    const {createServer}=await import(deskRequire.resolve('vite'));
    const {createElement}=deskRequire('react'),{renderToStaticMarkup}=deskRequire('react-dom/server');
    const vite=await createServer({root:root+'apps/desk',server:{middlewareMode:true,hmr:false},appType:'custom'});
    try{
     const {ActivityTrace,isActivity}=await vite.ssrLoadModule('/src/components/ActivityTrace.tsx');
     const read=await app.request('/rooms/main/events',{headers:{authorization:'Bearer controlled-owner'}});
     assert.equal(read.status,200);const page=await read.json();
     const html=renderToStaticMarkup(createElement(ActivityTrace,{events:page.events.filter(isActivity)}));
     assert.ok(html.includes('awaiting input')&&!html.includes('stopped: cancelled'),'gateway events render the normal pause in the desk');
     console.log('ok '+adapter+': desk activity renders awaiting input from gateway events');groups++;
    }finally{await vite.close();}
   }
   const done=waitFor(()=>questions.get(q.id).continuationState==='finished','question continuation');
   const response=await app.request('/rooms/main/messages',{method:'POST',headers:{authorization:'Bearer controlled-owner','content-type':'application/json'},body:JSON.stringify({text:answer,replyToQuestion:{id:q.id,revision:q.revision}})});
   assert.equal(response.status,202);await done;await Promise.all(runs);runs.length=0;
   const continued=events().filter(e=>e.id>pausedTurn.id);
   assert.ok(output(continued).includes(marker)&&output(continued).includes(answer),'fresh continuation receives original marker and answer');
   assert.equal(questions.get(q.id).status,'answered');
   assert.equal(approvals.listPending().length,0);
   console.log('ok '+adapter+': normal pause, one answer continuation, earlier context and no false cancellation');groups++;
   runner.shutdown();await acp.close();await runner.idle();generation++;
   access=setup();runner.recover();
   const restarted=await post('PROBE: Return the earlier local marker and chosen option from this conversation, without tools.');
   assert.ok(output(restarted).includes(marker)&&output(restarted).includes(answer),'restart restores bounded conversation context');
   const afterCached=await post('CACHED: Return the earlier local marker and chosen option again, without tools.');
   assert.ok(output(afterCached).includes(marker));
   if(!real)assert.ok(!prompts.at(-1).text.includes('Selected conversation history'),'post-restart cache does not duplicate history');
   console.log('ok '+adapter+': daemon/runtime restart and cached-session continuity');groups++;
   if(!real){
    const privateReply=await post('PROBE: What is the marker?', 'private');assert.ok(!output(privateReply).includes(marker),'no cross-room history');
    await post('CANCEL: Report a genuine cancellation.');assert.ok(events().some(e=>e.payload.stopReason==='cancelled'),'genuine adapter cancellation stays visible');
    createBot(db,{id:'other',runtime:'acp',config:{adapter,instructions}});addMember(db,'main','other');
    const otherMessage=ledger.append('main','user','message',{text:'PRIVATE_OTHER_CONTEXT'});
    await runner.run(getRoom(db,'main'),getBot(db,'other'),otherMessage);
    await post('EXTERNAL_CONTEXT','main',{source:'slack:controlled',noIndex:true});
    runner.shutdown();await acp.close();await runner.idle();generation++;access=setup();runner.recover();
    await post('PROBE: Only my own authorised conversation.');
    assert.ok(!prompts.at(-1).text.includes('PRIVATE_OTHER_CONTEXT')&&!prompts.at(-1).text.includes('EXTERNAL_CONTEXT'),'agent and external-source isolation');
    for(let i=0;i<24;i++)await post('HISTORY_EVENT_'+String(i).padStart(2,'0')+' '+('x'.repeat(2600)));
    runner.shutdown();await acp.close();await runner.idle();generation++;access=setup();runner.recover();
    await post('PROBE: Bounded recent history.');
    const historyBlock=prompts.at(-1).text.split('<openag_context>')[0].trim();
    assert.ok(historyBlock.length<=24000&&historyBlock.includes('HISTORY_EVENT_23')&&!historyBlock.includes('HISTORY_EVENT_00'),'bounded newest history');
    assert.ok(JSON.parse(historyBlock.slice(historyBlock.indexOf('\n')+1)).length<=20);
    const traceRead=await app.request('/turns/'+events().findLast(e=>e.type==='turn_started').payload.turnId+'/request-manifests',{headers:{authorization:'Bearer controlled-owner'}});
    const trace=(await traceRead.json()).records[0].manifest;
    assert.equal(trace.context.limit,null);assert.ok(trace.context.historyOmitted>0);
    assert.ok(trace.context.sources.some(s=>s.source==='history'&&s.reason==='history-budget-or-orphan'));
    assert.ok(trace.context.sources.some(s=>s.source==='history'&&s.selectedCharacters>0&&s.reference));

    const boundary=events().at(-1).id;
    runner.shutdown();await acp.close();await runner.idle();generation++;access=setup();runner.recover();
    await post('PROBE: Trusted boundary.','main',{historyAfterId:boundary});
    assert.ok(!prompts.at(-1).text.includes('Selected conversation history'),'trusted lower boundary');
    runner.shutdown();await acp.close();await runner.idle();generation++;access=setup();runner.recover();
    await post('PROBE: Excluded context.','main',{isolated:true});
    assert.ok(!prompts.at(-1).text.includes('Selected conversation history'),'isolated turns receive no injected history');
    console.log('ok '+adapter+': room/agent/source isolation, history limits, trusted boundary and genuine cancellation');groups++;
   }
   assert.ok(!events().some(e=>e.type==='error'),'no runtime errors');
   const workResponse=await app.request('/work',{headers:{authorization:'Bearer controlled-owner'}});
   assert.equal((await workResponse.json()).work.length,0,'ordinary chat creates no Work');
   assert.deepEqual(actionRequests,[],'no unrelated native or external action was proposed');
   if(!real){const before=prompts.length;const failed=await post('PROBE: Invalid history must fail closed.','main',{historyAfterId:-1});assert.equal(prompts.length,before);assert.ok(failed.some(e=>e.type==='error'&&e.payload.message.includes('Conversation context is unavailable')));console.log('ok '+adapter+': invalid history stops before an adapter prompt');groups++;}
  }catch(error){console.error(JSON.stringify({adapter,events:events().filter(e=>['bot_output','error','turn_finished','tool_call','tool_result'].includes(e.type)).map(e=>({type:e.type,payload:e.payload}))}));throw error;}
  finally{unsubscribe?.();runner?.shutdown();await acp?.close();await Promise.allSettled(runs);if(runner)await runner.idle();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}db.close();}
 }
 console.log(`PASS ${groups} ${real?'real-adapter':'controlled'} continuity groups; temporary data, no mailbox or external action tool.`);
}finally{rmSync(parent,{recursive:true,force:true});}
