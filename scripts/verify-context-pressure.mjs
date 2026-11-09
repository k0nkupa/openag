// Real model acceptance in disposable conversations. Requires --real and the configured OpenAI key.
// Never imports production chat records or exposes external business tools.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
if(!process.argv.includes('--real'))throw Error('Use --real to authorize bounded real API/Ollama/ACP acceptance.');
const available=['openai','ollama','ollama-qwen','claude','codex'],selected=process.argv.slice(2).filter(arg=>!arg.startsWith('--')),targets=selected.length?selected:available;
assert.ok(targets.every(target=>available.includes(target)),'Unknown context acceptance target');
const deadlineMs=Number(process.argv.find(arg=>arg.startsWith('--deadline-ms='))?.split('=')[1]??125000);
assert.ok(Number.isSafeInteger(deadlineMs)&&deadlineMs>=1&&deadlineMs<=125000,'Deadline must be 1–125000 ms');
if(targets.includes('openai'))assert.ok(process.env.OPENAI_API_KEY,'Provide the configured OpenAI key through the process environment, never arguments.');
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=n=>import(root+'apps/daemon/dist/'+n+'.js');
const checkoutRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const artifactHashes=Object.fromEntries(['gateway','prompt','request-provenance','ledger','permissions','action-receipts','runtimes/runner','runtimes/api','runtimes/ollama','runtimes/acp','runtimes/model-retries','runtimes/hosted-execution'].map(name=>[name,createHash('sha256').update(readFileSync(root+'apps/daemon/dist/'+name+'.js')).digest('hex')]));
const {serve}=require('@hono/node-server'),{z}=require('zod');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createBot,createRoom,addMember}=await load('rooms'),{createRunner}=await load('runtimes/runner'),{createGateway}=await load('gateway');
const {createApiRuntime}=await load('runtimes/api'),{createOllamaRuntime}=await load('runtimes/ollama'),{createAcpRuntime}=await load('runtimes/acp');
const {createMcpAccess}=await load('mcpserver'),{toExecutors}=await load('tools/registry');
const directory=mkdtempSync(join(tmpdir(),'openag-context-pressure-')),db=openDb(directory),ledger=createLedger(db),approvals=createApprovals(db,ledger),token=randomUUID(),rows=[];
const memory=`Alex prefers short, plain-English answers. Source changes, deployment and provider acceptance are separate evidence. Permission for DEV does not extend to PROD. These preferences inform this synthetic test, not a real work authorization.\nSynthetic project Alder: approved environment DEV; status source-only; provider effect unconfirmed.\n`;
let runner,base,toolCharacters=12000,toolCalls=0,markerValues=[];
const def={name:'context_sample',class:'read',description:'Return a fixed synthetic text sample. Read-only; no external account, file target or business effect.',input:z.object({}).strict(),permission:()=>({approval:'allow',effects:'read'}),execute:async()=>{
 toolCalls++;const half='x'.repeat(Math.floor(toolCharacters/2));return {untrusted:true,content:'BEGIN_VALUE='+markerValues[0]+'\n'+half+'\nMIDDLE_VALUE='+markerValues[1]+'\n'+half+'\nEND_VALUE='+markerValues[2]};
}};
const access=createMcpAccess({dataDir:directory,runner:{activeTurn:(...args)=>runner.activeTurn(...args)},tools:()=>[def]});
const acp=createAcpRuntime({dataDir:directory,mcp:{access,baseUrl:()=>base,tools:new Set([def.name])}});
const ollama=createOllamaRuntime({tools:[def],timeoutMs:90000});
const api=createApiRuntime({tools:[def],ollama});
runner=createRunner({db,ledger,approvals,dataDir:directory,runtimes:{api,acp},tools:toExecutors([def])});
let running;
const app=createGateway({db,ledger,approvals,auth:createAuth({db,ownerToken:token}),dataDir:directory,work:runner.work,cancelWork:runner.cancelWork,dispatch:args=>{running=runner.dispatch(args);return running;}});
const server=serve({hostname:'127.0.0.1',port:0,fetch:req=>new URL(req.url).pathname==='/mcp'?access.handle(req):app.fetch(req)});
if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const save=()=>writeFileSync(join(directory,'acceptance.json'),JSON.stringify({checkoutRevision,artifactHashes,attribution:'Checkout revision is not build provenance; hashes describe the executed core modules.',fixture:'Synthetic project plus owner response/evidence preferences; no private work records',rows},null,2));
function room(bot,suffix){const id=bot+'-'+suffix;createRoom(db,{id,leadBotId:bot});addMember(db,id,bot);return id;}
function seedHistory(bot,id){
 db.transaction(()=>{for(let i=0;i<24;i++){
  const message=ledger.append(id,'user','message',{text:`Synthetic planning note ${i}. Latest planning label ALDER_${i}. `+'This is invented project filler; no work action is requested. '.repeat(32)}),turnId=randomUUID();
  db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES(?,?,?,'finished',?,?,?)").run(turnId,id,bot,JSON.stringify({messageId:message.id}),Date.now(),Date.now());
  ledger.append(id,bot,'bot_output',{turnId,text:'Synthetic history acknowledgement '+i+' (fixture, not an actual model reply).'});
 }})();
}
async function post(bot,id,name,text,expected,tool=false,overflow=false){
 const before=toolCalls,start=performance.now(),posted=await request('/rooms/'+id+'/messages','POST',{text});assert.equal(posted.status,202);const messageId=(await posted.json()).message.id;
 const currentTurn=()=>db.prepare("SELECT * FROM turns WHERE room_id=? AND json_extract(state_json,'$.messageId')=? ORDER BY rowid DESC LIMIT 1").get(id,messageId);
 let timer;try{await Promise.race([running,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Acceptance deadline expired; no resubmission.')),deadlineMs);})]);}
 catch(error){
  const turn=currentTurn(),events=turn?ledger.list(id,{limit:1000}).filter(e=>e.payload.turnId===turn.id):[];
  let records=[];try{if(turn){const r=await request('/turns/'+turn.id+'/request-manifests');if(r.ok)records=(await r.json()).records;}}catch{}
  const failure={bot,case:name,requestMessageId:messageId,turnId:turn?.id??null,status:'acceptance-failed',runtimeStatus:turn?.status??'not-started',contract:'fail',modelAnswer:'fail',reason:error?.message==='Acceptance deadline expired; no resubmission.'?'acceptance-deadline':'invocation-error',elapsedMs:Math.round(performance.now()-start),toolCalls:toolCalls-before,manifests:records.map(r=>({id:r.manifest.manifestId,boundary:r.manifest.boundary,attempts:r.evidence.map(e=>({status:e.status}))})),toolResults:events.filter(e=>e.type==='tool_result').map(e=>({toolCallId:e.payload.toolCallId,receiptId:e.payload.receiptId??null,status:e.payload.status,executionOutcome:e.payload.executionOutcome})),approvals:approvals.listPending().filter(a=>a.turnId===turn?.id).map(a=>({id:a.id,status:a.status}))};
  rows.push(failure);save();console.error(JSON.stringify(failure));throw Error('Acceptance stopped; inspect '+join(directory,'acceptance.json')+'. Do not resubmit.');
 }finally{clearTimeout(timer);}
 const turn=currentTurn(),events=ledger.list(id,{limit:1000}).filter(e=>e.payload.turnId===turn.id);
 const response=await request('/turns/'+turn.id+'/request-manifests');assert.equal(response.status,200);const page=await response.json();assert.ok(page.records.length);
 const output=events.filter(e=>e.type==='bot_output').map(e=>e.payload.text??'').join('\n'),manifests=page.records.map(r=>r.manifest),state=JSON.parse(turn.state_json),calls=toolCalls-before;
 const results=events.filter(e=>e.type==='tool_result'&&e.payload.tool===def.name).map(e=>e.payload);
 const returned=results.length===calls&&results.every(r=>r.ok===true&&r.executionOutcome==='completed');
 const exercised=!tool||calls>0;
 const contract=returned&&(overflow?(calls===0?turn.status==='finished':turn.status==='incomplete'&&state.hostedStop==='output_truncated'&&calls===1&&manifests.length===1):['finished','incomplete'].includes(turn.status));
 const behavior=overflow?null:turn.status==='finished'&&expected.every(value=>output.toLowerCase().includes(value.toLowerCase()))&&calls===(tool?1:0);
 const row={bot,case:name,turnId:turn.id,status:turn.status,stopReason:state.hostedStop??null,contract:!exercised?'not-exercised':contract?'pass':'fail',modelAnswer:behavior===null?'not-requested':behavior?'pass':'fail',output,expectedValues:overflow?[]:expected,toolCalls:calls,toolResults:results.map(r=>({ok:r.ok,executionOutcome:r.executionOutcome,receiptId:r.receiptId})),elapsedMs:Math.round(performance.now()-start),manifests:manifests.map(m=>({id:m.manifestId,boundary:m.boundary,historyOmitted:m.context?.historyOmitted??0,historySources:m.context?.sources.filter(s=>s.source==='history').map(s=>({reference:s.reference,selectedCharacters:s.selectedCharacters,originalCharacters:s.characters,reason:s.reason}))??[],memory:m.context?.sources.filter(s=>s.source==='memory').map(s=>({selectedCharacters:s.selectedCharacters,originalCharacters:s.characters}))??[],session:m.session??null,messageCharacters:m.messages.reduce((n,v)=>n+v.characters,0)}))};
 rows.push(row);save();
 console.log(`${bot} ${name}: contract=${row.contract}, answer=${row.modelAnswer}, status=${turn.status}, omitted=${row.manifests[0].historyOmitted}, ${row.elapsedMs}ms`);
 assert.equal(approvals.listPending().length,0);assert.equal(db.prepare("SELECT count(*) n FROM action_receipts WHERE outcome='unknown'").get().n,0);
 if(turn.status==='failed'||!contract)throw Error('Contract/model invocation failed; retained evidence: '+join(directory,'acceptance.json'));
 return row;
}
console.log('Disposable context acceptance: '+directory);
try{
 for(const target of targets){
  const adapter=['claude','codex'].includes(target),bot=createBot(db,{id:target,runtime:adapter?'acp':'api',...(adapter?{}:{model:target==='openai'?'openai/gpt-4.1-mini':target==='ollama'?'ollama/lfm3-omni:latest':'ollama/huihui_ai/qwen3.5-abliterated:9b'}),config:{...(adapter?{adapter:target}:{}),...(target==='ollama-qwen'?{modelConfig:{reasoning:{think:false}}}:{}),maxSteps:3,instructions:'This is a read-only context acceptance check. Use only context_sample when explicitly requested. Never use native tools, files, memory writes, integrations or delegation. Answer in at most two short lines.'}});
  const memoryDir=join(directory,'bots',target);mkdirSync(memoryDir,{recursive:true});writeFileSync(join(memoryDir,'MEMORY.md'),memory);
  if(adapter){const choice=await acp.discover(bot,target);assert.ok(choice.model);db.prepare('UPDATE bots SET config_json=? WHERE id=?').run(JSON.stringify({...bot.config,modelConfig:{model:choice.model}}),target);console.log('Selected '+target+': '+choice.model);}
  const short=room(target,'short'),marker='ALDER-'+randomUUID().slice(0,8);
  const first=await post(target,short,'short','From your standing notes, report Alder\'s approved environment, status and provider-effect confirmation. Also remember this conversation-only marker: '+marker+'. Reply with all four values. Do not call tools.',['DEV','source-only','unconfirmed',marker]);
  const second=await post(target,short,'reused','Reply with the earlier conversation-only marker and Alder\'s approved environment. Do not use tools.',['DEV',marker]);
  if(adapter){assert.equal(first.manifests[0].session.context,'fresh');assert.equal(second.manifests[0].session.context,'reused');assert.equal(first.manifests[0].session.idFingerprint,second.manifests[0].session.idFingerprint);}
  const long=room(target,'long');seedHistory(target,long);
  const history=await post(target,long,'long','What is the latest ALDER_<number> planning label in the selected conversation history? Also state Alder\'s approved environment from standing notes. Do not call tools.',['ALDER_23','DEV']);assert.ok(history.manifests[0].historyOmitted>0);
  markerValues=Array.from({length:3},()=>randomUUID().slice(0,8));toolCharacters=12000;await post(target,room(target,'tool'),'tool-result','Call context_sample exactly once. Then report the exact values after BEGIN_VALUE, MIDDLE_VALUE and END_VALUE in its returned content. Do not use another tool or retry.',markerValues,true);
  if(!adapter){toolCharacters=30000;await post(target,room(target,'overflow'),'oversized-tool-result','Call context_sample exactly once. Then stop; do not retry or use another tool.',[],true,true);}
 }
}finally{runner.shutdown();await Promise.allSettled([...(running?[running]:[]),acp.close()]);await runner.idle();runner.work.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
console.log('Context acceptance evidence: '+join(directory,'acceptance.json'));
if(rows.some(r=>r.contract!=='pass'||r.modelAnswer==='fail'))process.exitCode=1;
