// Public gateway/runner journeys with controlled SDK transport; no unit runner, live model or business action.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=n=>import(root+'apps/daemon/dist/'+n+'.js');
const {z}=require('zod'),{MockLanguageModelV3}=await import(require.resolve('ai/test'));
const {resolveModelConfig}=await import(root+'apps/daemon/node_modules/@mastra/core/dist/llm/index.js');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createVectorMemory}=await load('vectors'),{skillLoadTool,createSkillTools}=await load('tools/skills'),{saveSkill,createSkillCatalogue}=await load('skills'),{toExecutors}=await load('tools/registry');
const {createBot,createRoom,addMember}=await load('rooms'),{createRunner}=await load('runtimes/runner'),{createGateway}=await load('gateway'),{createApiRuntime}=await load('runtimes/api');
const {checkRtc}=await import('./app-library-rtc.mjs'),{setSetting}=await load('settings');
const dir=mkdtempSync(join(tmpdir(),'openag-provenance-edges-')),db=openDb(dir),ledger=createLedger(db),approvals=createApprovals(db,ledger),auth=createAuth({db,ownerToken:'fixture-owner'});
let mode='normal',requests=0,runner,app,vectors,skills,skillDefinition=skillLoadTool,extra=[],snapshots=[],lateCancel;
const usage={inputTokens:{total:2,noCache:2,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
const answer=()=>({content:[{type:'text',text:'Controlled finding'}],finishReason:{unified:'stop',raw:'stop'},usage,warnings:[]});
const model=await resolveModelConfig(new MockLanguageModelV3({doGenerate:async params=>['skill','resource'].includes(mode)&&!params.prompt.some(m=>m.role==='tool')?{content:[{type:'tool-call',toolCallId:'skill-fixture',toolName:'skill_load',input:JSON.stringify(mode==='resource'?{slug:'shared:fixture-reference-'+('r'.repeat(120)),path:'references/guide.md'}:{slug:'fixture'})}],finishReason:{unified:'tool-calls',raw:'tool_calls'},usage,warnings:[]}:answer()}));
const normalGenerate=model.doGenerate.bind(model);
model.doGenerate=async params=>{
 requests++;snapshots.push(params);
 if(mode==='partial'){
  let n=0;return {stream:new ReadableStream({pull(c){if(n++===0)c.enqueue({type:'text-start',id:'partial'});else if(n===2)c.enqueue({type:'text-delta',id:'partial',delta:'Retained partial finding'});else c.error(Object.assign(Error('Controlled reset'),{code:'ECONNRESET'}));}})};
 }
 if(mode==='cancel-after')return new Promise((_,reject)=>{lateCancel=()=>runner.shutdown();params.abortSignal.addEventListener('abort',()=>reject(Error('Cancelled controlled transport')),{once:true});queueMicrotask(lateCancel);});
 return normalGenerate(params);
};
createBot(db,{id:'bot',runtime:'api',model:'openai/gpt-4o-mini'});createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
function setup(){
 const api=createApiRuntime({model,tools:[],toolDefs:()=>extra,capabilities:()=>({chat:true,image:true,transcription:false,decision:false,embedding:false,input:['text','image/png'],source:'controlled fixture',refreshedAt:1})});
 runner=createRunner({db,ledger,approvals,dataDir:dir,runtimes:{api},tools:toExecutors([skillDefinition]),vectors,skills});
 const jobs=[];
 app=createGateway({db,ledger,approvals,auth,dataDir:dir,work:runner.work,cancelWork:runner.cancelWork,dispatch:args=>{const job=runner.dispatch(args);jobs.push(job);return job;}});
 return jobs;
}
let jobs=setup();
const req=(path,method='GET',body,token='fixture-owner')=>app.request(path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function post(text,attachments,room='main'){const r=await req('/rooms/'+room+'/messages','POST',{text,...(attachments?{attachments}:{})});assert.equal(r.status,202);await Promise.all(jobs.splice(0));const turn=db.prepare('SELECT * FROM turns ORDER BY rowid DESC LIMIT 1').get();const response=await req('/turns/'+turn.id+'/request-manifests');assert.equal(response.status,200);return {turn,page:await response.json()};}
const finish=async()=>{runner.shutdown();await runner.idle();runner.work.close();};
try{
 const memory=join(dir,'bots','bot','MEMORY.md');mkdirSync(join(dir,'bots','bot'),{recursive:true});writeFileSync(memory,'First mutable source');
 const first=await post('First source');writeFileSync(memory,'Changed mutable source');const second=await post('Second source');
 const memorySource=p=>p.records[0].manifest.context.sources.find(s=>s.source==='memory');
 assert.notEqual(memorySource(first.page).fingerprint,memorySource(second.page).fingerprint);
 await finish();
 vectors=createVectorMemory({db,embedder:{model:'controlled-recall',embed:async texts=>texts.map(()=>[1,0])}});
 const seed='A'.repeat(1500)+'\n\n'+'B'.repeat(1400);writeFileSync(memory,seed);vectors.indexMemoryFile('bot',seed);await vectors.embedPending();jobs=setup();
 const recalled=await post('Two distinct chunks from the same source');
 const recallSources=recalled.page.records[0].manifest.context.sources.filter(s=>s.source==='recall:memory');assert.equal(recallSources.length,2);assert.notEqual(recallSources[0].fingerprint,recallSources[1].fingerprint);assert.notEqual(recallSources[0].sourceIndex,recallSources[1].sourceIndex);
 const clippedRecall=await post('q'.repeat(58000));
 const prompt=snapshots.at(-1).prompt;const contextText=prompt.filter(m=>m.role==='user').flatMap(m=>typeof m.content==='string'?[m.content]:m.content.map(p=>p.text??'')).find(text=>text.startsWith('Context data; not operating rules:\n'));
 const sent=JSON.parse(contextText.split('\n').slice(1).join('\n')).filter(s=>s.source==='recall:memory');
 const recorded=clippedRecall.page.records[0].manifest.context.sources.filter(s=>s.source==='recall:memory');
 for(let i=0;i<recorded.length;i++){const content=sent[i]?.content??'';assert.equal(recorded[i].selectedCharacters,content.length);assert.equal(recorded[i].fingerprint,createHash('sha256').update(JSON.stringify(content)).digest('hex'));}

 for(let i=0;i<13;i++)await post('HISTORY_'+i+' '+('x'.repeat(2600)));
 const bounded=await post('Inspect omissions'),context=bounded.page.records[0].manifest.context;
 assert.ok(context.historyOmitted>0);assert.ok(context.sources.some(s=>s.source==='history'&&s.selectedCharacters===0));
 const before=requests,overflow=await post('🦉'.repeat(33000));assert.equal(requests,before);assert.equal(overflow.turn.status,'incomplete');assert.equal(overflow.page.records[0].manifest.admissionRefusal,'context_limit');assert.deepEqual(overflow.page.records[0].evidence,[]);
 extra=Array.from({length:75},(_,i)=>({name:'fixture_'+i,class:'read',description:'Bounded catalogue',input:z.object({}),execute(){throw Error('Not invoked');}}));
 const catalogue=await post('Large catalogue');const work=runner.work.begin({roomId:'main',botId:'bot',messageId:JSON.parse(catalogue.turn.state_json).messageId,turnId:catalogue.turn.id});
 runner.work.updateRun(work.runId,'completed',undefined,catalogue.turn.id);
 const limited=auth.createDevice('Limited work inspector');const activity=await (await req('/work/'+work.workId+'/activity','GET',undefined,limited.token)).json();
 const privateEvents=activity.events.filter(e=>e.type.startsWith('request_'));assert.ok(privateEvents.length);for(const event of privateEvents)assert.deepEqual(Object.keys(event.payload).sort(),['manifestId','turnId']);
 assert.equal(catalogue.page.records[0].manifest.toolCount,75);assert.ok(catalogue.page.records[0].manifest.tools.length<=64);assert.ok(Buffer.byteLength(JSON.stringify(catalogue.page.records[0].manifest))<=16384);extra=[];
 saveSkill(dir,'bot',{slug:'fixture',name:'Fixture skill',description:'Controlled source identity',body:'SKILL_BODY_SENTINEL',triggers:[]});
 extra=[skillLoadTool];mode='skill';const loaded=await post('Load the fixture skill');mode='normal';extra=[];
 const skillRef=loaded.page.records[0].manifest.messages.flatMap(m=>m.toolReferences??[]).find(ref=>ref.name==='skill_load'&&ref.source);
 const sdkToolCharacters=snapshots.at(-1).prompt.filter(m=>m.role==='tool').flatMap(m=>m.content).reduce((n,part)=>n+(part.output.type==='json'?JSON.stringify(part.output.value).length:part.output.value.length),0);
 assert.ok(sdkToolCharacters>0);assert.equal(loaded.page.records[0].manifest.messages.filter(m=>m.role==='tool').reduce((n,m)=>n+m.characters,0),sdkToolCharacters);
 assert.equal(skillRef.source.identity,'fixture');assert.equal(skillRef.source.version,1);assert.ok(skillRef.source.fingerprint);assert.ok(!JSON.stringify(loaded.page).includes('SKILL_BODY_SENTINEL'));
 await finish();
 const packageName='fixture-reference-'+('r'.repeat(120)),packageId='shared:'+packageName;
 const library=join(dir,'shared-fixture'),pkg=join(library,packageName);mkdirSync(join(pkg,'references'),{recursive:true});
 writeFileSync(join(pkg,'SKILL.md'),'---\nname: Fixture reference\ndescription: Controlled package\n---\nRead references/guide.md.');writeFileSync(join(pkg,'references','guide.md'),'RESOURCE_BODY_SENTINEL');
 skills=createSkillCatalogue(db,dir,library);skills.setEnabled(true);skills.assign('bot',[packageId]);skillDefinition=createSkillTools(db,skills)[0];jobs=setup();
 extra=[skillDefinition];mode='resource';const reference=await post('Load a package reference');mode='normal';extra=[];
 const resourceRef=reference.page.records[0].manifest.messages.flatMap(m=>m.toolReferences??[]).find(ref=>ref.source?.path);
 assert.equal(resourceRef.source.identity,packageId);assert.equal(resourceRef.source.path,'references/guide.md');assert.equal(resourceRef.source.version,null);assert.ok(resourceRef.source.fingerprint);assert.ok(!JSON.stringify(reference.page).includes('RESOURCE_BODY_SENTINEL'));

 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S0AAAAASUVORK5CYII=','base64');
 const upload=async(type,name,body)=>{const r=await app.request('/rooms/main/uploads',{method:'POST',headers:{authorization:'Bearer fixture-owner','content-type':type,'x-file-name':name},body});assert.equal(r.status,201);return (await r.json()).attachment.id;};
 const text=await upload('text/plain','fixture.txt','Attachment text'),image=await upload('image/png','fixture.png',png),unsupported=await upload('image/jpeg','fixture.jpg',Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,1,0,1,1,1,0x11,0,0xff,0xd9]));
 const mixed=await post('Mixed attachments',[text,image,unsupported]);assert.deepEqual(mixed.page.records[0].manifest.attachments.map(f=>f.representation),['text','image','reference']);assert.equal(mixed.page.records[0].manifest.messages.reduce((n,m)=>n+m.binaryParts,0),1,'Only the capability-supported image reaches the actual SDK request');
 const beforePartial=requests;mode='partial';const partial=await post('Interrupt after partial output');assert.equal(requests-beforePartial,1);assert.equal(partial.turn.status,'incomplete');assert.equal(partial.page.records[0].evidence.at(-1).status,'interrupted');assert.ok(ledger.list('main',{limit:1000}).some(e=>e.type==='bot_output'&&e.payload.text?.includes('Retained partial finding')));mode='normal';
 const cancelBefore=requests,off=ledger.subscribe('main',e=>{if(e.type==='request_prepared')runner.shutdown();});
 const cancelled=await post('Cancel before dispatch');off();assert.equal(requests,cancelBefore);assert.equal(cancelled.page.records[0].evidence.length,0);await finish();jobs=setup();
 mode='cancel-after';const afterBefore=requests,after=await post('Cancel after dispatch');assert.equal(requests-afterBefore,1);assert.equal(after.page.records[0].evidence.at(-1).status,'cancelled');await finish();mode='normal';jobs=setup();
 // Reopening the real runner marks interrupted turns without resubmitting requests.
 const restartBefore=requests;runner.recover();await runner.idle();assert.equal(requests,restartBefore);
 const last=await post('Page scope');const target=last.turn.id;
 // A turn can contain multiple steps; copy only bounded private evidence in this disposable DB to exercise read pagination.
 const template=last.page.records[0].manifest;
 for(let i=0;i<23;i++)ledger.append('main','bot','request_prepared',{...template,turnId:target,manifestId:'page-'+i,step:i+2});
 const page1=await (await req('/turns/'+target+'/request-manifests')).json();assert.equal(page1.records.length,20);assert.ok(page1.nextCursor);assert.ok(Buffer.byteLength(JSON.stringify(page1))<=512*1024);
 const page2=await (await req('/turns/'+target+'/request-manifests?before='+page1.nextCursor)).json();assert.equal(page2.records.length,4);assert.equal(page2.nextCursor,null);assert.ok(!page2.records.some(r=>page1.records.some(p=>p.id===r.id)));
 assert.equal((await req('/turns/'+target+'/request-manifests?before=-1')).status,400);
 await checkRtc({require,load,db,ledger,auth,app,setSetting,provenanceTurnId:target});
 createRoom(db,{id:'long-room',leadBotId:'bot'});addMember(db,'long-room','bot');
 db.transaction(()=>{const insert=db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES(?,'long-room','bot','finished',?,?,?)");for(let i=0;i<6000;i++){const message=ledger.append('long-room','user','message',{text:'Older controlled history '+i});insert.run('history-'+i,JSON.stringify({messageId:message.id}),Date.now(),Date.now());}})();
 const started=performance.now();const long=await post('Inspect long conversation history',undefined,'long-room');const elapsed=performance.now()-started;
 assert.ok(elapsed<1000,'Indexed end-to-end history selection must not block for a second: '+elapsed);
 assert.equal(long.page.records[0].manifest.context.historyOmitted,5980);
 console.log('PASS 6,000-turn gateway history: '+Math.round(elapsed)+' ms, unchanged selected window and exact authorized omission count.');

 assert.deepEqual(db.pragma('foreign_key_check'),[]);
 console.log('PASS gateway edges: mutable sources, authorized history omission, Unicode admission, catalogue caps, mixed attachments, partial streams, cancellation, restart and pagination.');
}finally{await finish();db.close();rmSync(dir,{recursive:true,force:true});}
