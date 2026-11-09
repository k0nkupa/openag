import { assignedWorkDispatch } from './assigned-work-fixture.mjs';
// Disposable public API/runner assertions. No unit runner, real account or project data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,writeFileSync,symlinkSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
for(const key of Object.keys(process.env))if(!['PATH','HOME','LANG','TMPDIR'].includes(key))delete process.env[key];
const root=fileURLToPath(new URL('../',import.meta.url)),load=p=>import(root+'apps/daemon/dist/'+p+'.js'),require=createRequire(root+'apps/daemon/package.json');
const {openDb}=await load('db/index'),{createBot,createRoom,addMember,getBot,getRoom}=await load('rooms'),{createAuth}=await load('auth'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createRunner}=await load('runtimes/runner'),{createGateway,attachStream}=await load('gateway'),{createResults}=await load('results'),{createFirstPartyTools}=await load('tools/firstparty'),{getDefaultRedactor}=await load('redact'),{createMcpAccess}=await load('mcpserver');
const dir=mkdtempSync(join(tmpdir(),'openag-results-')),db=openDb(dir),token=randomBytes(32).toString('hex'),auth=createAuth({db,ownerToken:token}),ledger=createLedger(db),approvals=createApprovals(db,ledger),results=createResults(db,ledger);
getDefaultRedactor().addSecret('result-secret-398671');
for(const id of ['boss','other','_hidden']){createBot(db,{id,runtime:'api'});createRoom(db,{id,leadBotId:id});addMember(db,id,id);}
const firstParty=createFirstPartyTools({computer:{capabilities:()=>({shell:false})},pusher:{status:()=>({configured:false,enabled:false})},results});
assert.ok(firstParty.defs.find(d=>d.name==='save_result').input.shape.name,'MCP receives a real object schema');
let app,mcp,runner;const outcomes=[];
const runtime={async runTurn(ctx){
 const input=JSON.parse(ctx.message.payload.text);let previous;
 for(const item of input.operations??[input]){
  if(input.parallelAfterFirst&&previous){const base=previous;const answers=await Promise.all(input.operations.slice(1).map(op=>ctx.callTool('save_result',{...op,id:base.id,baseVersion:base.version})));outcomes.push(...answers);previous=answers.find(a=>a.ok)?.result??previous;break;}
  const args={...item};if(args.id==='$previous'){args.id=previous.id;args.baseVersion??=previous.version;}
  if(input.largeMcp)args.content='\u0001'.repeat(262144);
  if(input.generatedSecret)args.content+=' result-secret-398671';
  let outcome;
  if(input.viaMcp){
   const binding=mcp.issue(ctx.bot.id,ctx.room.id);
   const response=await app.request('/mcp',{method:'POST',headers:{authorization:'Bearer '+binding.token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:'save-check',method:'tools/call',params:{name:'save_result',arguments:args}})});
   const value=await response.json();assert.equal(response.status,200);assert.ok(!value.error,JSON.stringify(value.error));outcome=value.result.isError?{ok:false}:{ok:true,result:JSON.parse(value.result.content[0].text)};
  }else outcome=await ctx.callTool('save_result',args);
  outcomes.push(outcome);
  if(!outcome.ok)break;previous=outcome.result;
 }
 ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:previous?`Saved ${previous.name}, version ${previous.version}.`:'No result saved.'});
}};
runner=createRunner({db,ledger,approvals,dataDir:dir,tools:firstParty.executors,dynamicTools:()=>firstParty.executors,runtimes:{api:runtime}});
mcp=createMcpAccess({runner,dataDir:dir,tools:()=>firstParty.defs});
app=createGateway({db,ledger,approvals,auth,dataDir:dir,deskDir:root+'apps/desk/dist',work:runner.work,cancelWork:runner.cancelWork,mcpAccess:mcp,dispatch:assignedWorkDispatch(runner,db)});
const req=(path,opts={},authorized=true)=>app.request(path,{...opts,headers:{...(authorized?{authorization:'Bearer '+token}:{}),...opts.headers}});
const json=async(path)=>{const r=await req(path);assert.equal(r.status,200,path);return r.json();};
const post=async(input,room='boss')=>{const r=await req('/rooms/'+room+'/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:JSON.stringify(input)})});assert.equal(r.status,202);return(await r.json()).message;};
const wait=async(f,p)=>{for(let i=0;i<300;i++){const value=await f();if(p(value))return value;await new Promise(r=>setTimeout(r,15));}throw Error('verification deadline');};
const work=async message=>(await wait(()=>json('/work'),p=>p.work.some(w=>w.requestId===message.id))).work.find(w=>w.requestId===message.id);
const settled=async message=>{const w=await work(message);return(await wait(()=>json('/work/'+w.id),p=>!['working','needs_approval'].includes(p.work.status))).work;};
try{
 const shadow=join(dir,'shadow-desk');mkdirSync(shadow);writeFileSync(join(shadow,'index.html'),'static index');writeFileSync(join(shadow,'results'),'must not shadow API');const shadowApp=createGateway({db,ledger,auth,approvals,dataDir:dir,deskDir:shadow});assert.equal((await shadowApp.request('/results')).status,401);
 const binding=mcp.issue('boss','boss');const schemaResponse=await app.request('/mcp',{method:'POST',headers:{authorization:'Bearer '+binding.token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:'list-check',method:'tools/list'})});
 const schemaReply=await schemaResponse.json();assert.ok(schemaReply.result,JSON.stringify(schemaReply));const saveSchema=schemaReply.result.tools.find(t=>t.name==='save_result');assert.ok(saveSchema.inputSchema.properties.content);assert.ok(saveSchema.inputSchema.properties.baseVersion);
 assert.equal((await req('/results',{},false)).status,401);assert.equal((await req('/results/missing')).status,404);
 for(const query of ['limit=101','before=-1','workId=bad','unexpected=true'])assert.equal((await req('/results?'+query)).status,400);
 // Daemon-owned result bookkeeping is automatic under the session contract; no category override or fabricated review.
 const message=await post({operations:[{name:'comparison.md',kind:'comparison',content:'Version one result-secret-398671 <script>window.BAD=true</script>'},{id:'$previous',name:'comparison.md',kind:'comparison',content:'Version two'}]});
 const completed=await settled(message);assert.equal(completed.status,'completed');const listed=(await json('/results?workId='+completed.id)).results;assert.equal(listed.length,1);const latest=listed[0];assert.equal(latest.version,2);assert.equal(latest.provenance,'proposed');assert.equal(latest.roomId,'boss');assert.equal(latest.botId,'boss');assert.equal(latest.workId,completed.id);
 const versions=(await json('/results/'+latest.id+'/versions')).results;assert.deepEqual(versions.map(r=>r.version),[2,1]);assert.notEqual(versions[0].toolCallId,versions[1].toolCallId);
 const old=await json('/results/'+latest.id+'?version=1');assert.ok(old.content.includes('[REDACTED:secret]'));assert.ok(!JSON.stringify(await json('/results')).includes('result-secret-398671'));assert.ok(old.content.includes('<script>'),'source is inert text, not HTML');
 const download=await req('/results/'+latest.id+'/download?version=1');assert.equal(download.headers.get('content-type'),'text/plain; charset=utf-8');assert.equal(download.headers.get('x-content-type-options'),'nosniff');assert.equal(download.headers.get('content-disposition'),'attachment');assert.equal(await download.text(),old.content);assert.equal((await req('/results/'+latest.id+'/download',{},false)).status,401);
 assert.equal((await json('/results?roomId=other')).results.length,0);assert.equal((await json('/results?botId=other')).results.length,0);
 for(const input of [{name:'../escape.txt',kind:'note',content:'x'},{name:'page.html',kind:'note',content:'x'},{name:'x.txt',kind:'html',content:'x'},{name:'x.txt',kind:'note',content:'x',path:'/tmp/untrusted'},{name:'x.txt',kind:'note',content:'😀'.repeat(100000)},{name:'x.txt',kind:'note',content:'x'.repeat(262145)},{id:latest.id,baseVersion:1,name:'x.txt',kind:'note',content:'stale or different Work'}]){
  const before=(await json('/results')).results.length;await settled(await post(input));assert.equal((await json('/results')).results.length,before);assert.equal(outcomes.at(-1).ok,false);
 }
 const revised=await post({operations:[{name:'note.txt',kind:'note',content:'First'},{id:'$previous',baseVersion:1,name:'note.txt',kind:'note',content:'Second'},{id:'$previous',baseVersion:1,name:'note.txt',kind:'note',content:'Third'}]});const revisedWork=await settled(revised);assert.equal(outcomes.at(-1).ok,false);assert.equal((await json('/results?workId='+revisedWork.id)).results[0].version,2);
 const mcpWork=await settled(await post({viaMcp:true,generatedSecret:true,operations:[{name:'mcp-note.txt',kind:'note',content:'From scoped MCP'}]}));assert.equal(mcpWork.status,'completed');assert.ok(!db.prepare('SELECT content FROM saved_results WHERE work_id=?').get(mcpWork.id).content.includes('result-secret-398671'));
 const raced=await settled(await post({parallelAfterFirst:true,operations:[{name:'race.txt',kind:'note',content:'Base'},{name:'race.txt',kind:'note',content:'Candidate A'},{name:'race.txt',kind:'note',content:'Candidate B'}]}));assert.deepEqual(outcomes.slice(-2).map(a=>a.ok).sort(),[false,true]);assert.equal((await json('/results?workId='+raced.id)).results[0].version,2);
 const page1=await json('/results/'+latest.id+'/versions?limit=1');assert.ok(page1.nextCursor);assert.equal((await json('/results/'+latest.id+'/versions?limit=1&before='+page1.nextCursor)).results[0].version,1);
 // Exercise the 100-version Work quota across turns without exceeding the 40-tool turn allowance.
 const resultBatch=(start,length)=>({operations:Array.from({length},(_,i)=>({name:`note-${start+i}.txt`,kind:'note',content:'Bounded result '+(start+i)}))});
 const crowded=await settled(await post(resultBatch(0,40)));
 assert.equal(outcomes.at(-1).ok,true);
 for(const [start,length] of [[40,40],[80,21]]){
  const continuation=ledger.append('boss','user','message',{text:JSON.stringify(resultBatch(start,length))});
  await runner.run(getRoom(db,'boss'),getBot(db,'boss'),continuation,undefined,{workId:crowded.id});
  assert.equal(outcomes.at(-1).ok,start===40);
 }
 assert.match(outcomes.at(-1).message,/Work result limit reached/);
 const many1=await json('/results?workId='+crowded.id);assert.equal(many1.results.length,50);const many2=await json('/results?workId='+crowded.id+'&before='+many1.nextCursor);assert.equal(many2.results.length,50);assert.equal(new Set([...many1.results,...many2.results].map(r=>r.id)).size,100);assert.equal(many2.nextCursor,null);
 const chatMessage=ledger.append('boss','user','message',{text:JSON.stringify({name:'chat-after-work.md',kind:'note',content:'Conversation quota is independent of Work.'})});
 await runner.run(getRoom(db,'boss'),getBot(db,'boss'),chatMessage);
 assert.equal(outcomes.at(-1).ok,true);assert.equal(outcomes.at(-1).result.workId,null,'100 Work versions do not consume conversation quota');
 const largeWork=await settled(await post({viaMcp:true,largeMcp:true,operations:[{name:'large.txt',kind:'note',content:'generated'}]}));assert.equal(largeWork.status,'completed');const large=(await json('/results?workId='+largeWork.id)).results[0];assert.equal((await json('/results/'+large.id)).content.length,262144);
 // Exercise the actual RTC auth/router/chunking against the same gateway with controlled signaling/peer I/O.
 const {createRtcService,offerMac,sdpFingerprint,newRtcTopic}=await load('rtc'),{setSetting}=await load('settings');
 const device=auth.createDevice('RTC verifier','owner','full'), sent=[];let deliver,onData,onMessage,answered=false;
 const fingerprint=Array(32).fill('11').join(':'),sdp='v=0\r\na=fingerprint:sha-256 '+fingerprint+'\r\n';
 const channel={label:'openag-api',send:value=>sent.push(value),close:()=>{},onMessage:{subscribe:cb=>{onMessage=cb;}}};
 const peer={iceGatheringState:'complete',localDescription:{sdp},onDataChannel:{subscribe:cb=>{onData=cb;}},connectionStateChange:{subscribe:()=>{}},iceGatheringStateChange:{subscribe:()=>{}},setRemoteDescription:async()=>onData(channel),createAnswer:async()=>({sdp}),setLocalDescription:async()=>{},close:()=>{}};
 setSetting(db,'rtc',{enabled:true,server:'https://ntfy.sh',topic:newRtcTopic(),stun:[]});
 const rtc=createRtcService({db,ledger,auth,fetch:r=>Promise.resolve(app.fetch(r)),env:{},createPeer:async()=>peer,signaling:()=>({subscribe:cb=>{deliver=cb;return()=>{};},publish:async()=>{answered=true;}})});rtc.reload();
 try{
  const offer={v:1,t:'offer',id:'result-verifier',ts:Date.now(),sdp,auth:{kind:'device',device:device.device.id,mac:''}};offer.auth.mac=offerMac(auth.deviceKey(device.device.id),{id:offer.id,ts:offer.ts,fingerprint:sdpFingerprint(sdp),kind:'device',device:device.device.id});deliver(JSON.stringify(offer));await wait(()=>answered,x=>x);
  let counter=0;const rtcCall=async(path,credential=device.token,method='GET',body)=>{const id='call'+(++counter);onMessage(JSON.stringify({id,method,path,body,headers:{authorization:'Bearer '+credential}}));await wait(()=>sent.map(s=>JSON.parse(s)).filter(f=>f.id===id),frames=>frames.some(f=>f.last));const frames=sent.map(s=>JSON.parse(s)).filter(f=>f.id===id).sort((a,b)=>a.seq-b.seq);return{status:frames[0].status,body:frames.map(f=>f.body).join('')};};
  assert.equal((await rtcCall('/results')).status,200);assert.equal((await rtcCall('/work/'+completed.id)).status,200);assert.equal((await rtcCall('/results?roomId=boss%20other')).status,200);assert.equal((await rtcCall('/results/%2e%2e')).status,400);assert.equal((await rtcCall('/results','wrong')).status,401);assert.equal((await rtcCall('/work/'+completed.id+'/start',device.token,'POST',JSON.stringify({revision:completed.revision}))).status,404,'Start Work reaches owner-gated gateway through RTC');assert.equal((await rtcCall('/settings')).status,403);assert.equal((await rtcCall('/work/'+completed.id+'/cancel',device.token,'POST')).status,409);assert.equal((await rtcCall('/results/'+latest.id,device.token,'POST')).status,403);
  const preview=await rtcCall('/results/'+large.id);assert.equal(preview.status,200);assert.equal(JSON.parse(preview.body).content.length,262144);const raw=await rtcCall('/results/'+large.id+'/download');assert.equal(raw.status,200);assert.equal(raw.body,'\u0001'.repeat(262144));assert.ok(sent.every(frame=>Buffer.byteLength(frame)<64*1024),'even escaped control-text chunks fit RTC frames');
  // Compile the actual desk API/RTC-fetch modules, then drive them through the same authenticated RTC service.
  const {stripTypeScriptTypes}=await import('node:module');const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');const compile=file=>stripTypeScriptTypes(readFileSync(root+'apps/desk/src/'+file,'utf8'),{mode:'transform'});
  const ownerUrl=moduleUrl(compile('ownerSession.ts'));const apiModule=await import(moduleUrl(compile('api.ts').replace(/from ["']\.\/ownerSession["']/,`from "${ownerUrl}"`)));const rtcModule=await import(moduleUrl(compile('rtc/rtcFetch.ts')));
  const desk=apiModule.createApi(device.token,()=>{throw Error('unexpected auth failure');},rtcModule.createRtcFetch({request:(method,path,opts)=>rtcCall(path,opts?.headers?.authorization?.slice(7),method,opts?.body)}),{ownerRetry:false});
  assert.ok((await desk.listWork()).work.length);assert.ok((await desk.listResults()).results.length);assert.ok((await desk.getWorkActivity(completed.id)).events.length);assert.ok((await desk.listWork({q:'漢字'.repeat(100)})).work.length===0);assert.equal((await desk.downloadResult(large.id,1)).size,262144);

 }finally{rtc.stop();}
 // Trusted scope checks reject ended turns and fabricated calls before any write.
 assert.throws(()=>results.save({botId:'boss',roomId:'boss',workId:completed.id,turnId:latest.turnId,toolCallId:latest.toolCallId},{name:'bad.txt',kind:'note',content:'bad'}),/not an active/);
 const outside=join(dir,'outside.txt');writeFileSync(outside,'Do not modify');symlinkSync(outside,join(dir,'link.txt'));const note=await settled(await post({name:'link.txt',kind:'code',content:'Proposed code'}));assert.equal(note.status,'completed');assert.equal(readFileSync(outside,'utf8'),'Do not modify','display names never resolve a path or symlink');
 // A fresh Node process reopens storage and serves the authenticated preview.
 const source=`const load=p=>import(${JSON.stringify(root+'apps/daemon/dist/')}+p+'.js');const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createAuth}=await load('auth'),{createApprovals}=await load('approvals'),{createGateway}=await load('gateway');const db=openDb(process.argv[1]),ledger=createLedger(db),app=createGateway({db,ledger,auth:createAuth({db,ownerToken:'restart-proof'}),approvals:createApprovals(db,ledger),dataDir:process.argv[1]});const response=await app.request('/results/'+process.argv[2]+'?version=1',{headers:{authorization:'Bearer restart-proof'}});console.log(JSON.stringify({status:response.status,...await response.json()}));db.close();`;
 const reopened=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',source,dir,latest.id],{encoding:'utf8'}));assert.equal(reopened.status,200);assert.equal(reopened.content,old.content);assert.equal(reopened.result.toolCallId,old.result.toolCallId);
 console.log('Saved-result automatic receipts, immutable versions/provenance, validation, redaction, auth, scope, inert bytes and fresh-process persistence assertions passed');
 if(process.argv.includes('--serve')){
  const {serve}=require('@hono/node-server');const server=serve({hostname:'127.0.0.1',port:0,fetch:app.fetch});const detach=attachStream(server,ledger,auth);await new Promise(r=>server.once('listening',r));console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/#/room/boss`,pairCode:auth.createPairingCode('owner','full').code,dir,workId:completed.id,resultId:latest.id}));await new Promise(r=>{process.once('SIGTERM',r);process.once('SIGINT',r);});detach();server.closeAllConnections();await new Promise(r=>server.close(r));
 }
}finally{runner.shutdown();mcp.revokeAll();db.close();}
