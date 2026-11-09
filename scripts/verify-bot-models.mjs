import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {startFixture} from './bot-models-fixture.mjs';
const dir=mkdtempSync(join(tmpdir(),'openag-bot-models-')),token=randomBytes(32).toString('hex');
let f=await startFixture(dir,token),base=f.url;
const request=(path,method='GET',body,auth=token)=>fetch(base+path,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
async function json(path,method='GET',body,auth=token){const r=await request(path,method,body,auth);const data=await r.json();assert.ok(r.ok,`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);return data;}
async function until(read,predicate){const deadline=Date.now()+15000;for(;;){const value=await read();if(predicate(value))return value;if(Date.now()>deadline)throw Error('Controlled acceptance deadline');await new Promise(r=>setTimeout(r,20));}}
const state=id=>json(`/bots/${id}/model`);
const discover=(id,target,model)=>json(`/bots/${id}/model/discover`,'POST',{target,...(model?{model}:{})});
const save=(id,choice,reasoning={})=>json(`/bots/${id}/model`,'PUT',{revision:choice.revision,snapshotId:choice.snapshotId,model:choice.model,reasoning});
const turn=async(id,room='main',text='plain')=>{const message=f.ledger.append(room,'user','message',{text});await f.runner.dispatch({room:{...((await json('/rooms/'+room)).room)},botIds:[id],message});};
try{
 const html=await (await request('/')).text();assert.equal(html,readFileSync(new URL('../apps/desk/dist/index.html',import.meta.url),'utf8'));
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)){const response=await request(match[1]);assert.ok(response.ok);assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync(new URL('../apps/desk/dist'+match[1],import.meta.url)));}
 assert.equal((await request('/bots/boss/model','GET',undefined,null)).status,401);
 const full=(await json('/devices','POST',{name:'Fixture full',access:'full'})).token,limited=(await json('/devices','POST',{name:'Fixture limited'})).token;
 for(const [method,path,body]of [['GET','/bots/boss/model'],['POST','/bots/boss/model/discover',{target:'openai'}],['PUT','/bots/boss/model',{}]])assert.equal((await request(path,method,body,limited)).status,403);
 assert.equal((await request('/bots/boss/model','GET',undefined,full)).status,200);
 assert.equal((await request('/bots/missing/model')).status,404);
 const first=await state('boss');assert.equal(first.model,'openai/gpt-5');assert.equal(f.stats.requests.length,0);assert.equal(f.stats.launches.length,0);
 assert.equal((await request('/bots/boss/model/discover','POST',{target:'codex'})).status,200);
 assert.equal((await request('/bots/boss/model/discover','POST',{target:'openai',secret:'not-allowed'})).status,400);
 f.mode('leak');await f.botModels.catalogue.refresh();const redacted=await discover('boss','openai','openai/gpt-5');f.mode('normal');await f.botModels.catalogue.refresh();assert.ok(!JSON.stringify(redacted).includes(f.env.OPENAI_API_KEY));
 const choice=await discover('boss','openai','openai/gpt-5');
 assert.ok(choice.models.length);const effort=choice.controls.find(c=>c.id==='effort')?.values[0].value;
 const reasoning=effort?{effort}:{};const saved=await save('boss',choice,reasoning);assert.deepEqual(saved.reasoning,reasoning);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM turns').get().n,0);
 assert.equal((await request('/bots/boss/model','PUT',{revision:saved.revision,snapshotId:choice.snapshotId,model:choice.model,reasoning:{arbitrary:'bad'}})).status,400);
 await turn('boss');assert.ok(f.stats.requests.some(r=>r.kind==='selected-api'&&r.model==='openai/gpt-5'));assert.ok((await state('boss')).reports.some(r=>r.model==='hosted-fixture-served'&&r.source==='response'));
 for(const [target,model]of [['anthropic','anthropic/claude-opus-4-6'],['openrouter','openrouter/openai/gpt-5']]){
  const c=await discover('boss',target,model);const e=c.controls.find(x=>x.id==='effort')?.values[0]?.value;await save('boss',c,e?{effort:e}:{});await turn('boss');
  const sent=f.stats.requests.filter(r=>r.kind==='selected-api').at(-1);assert.equal(sent.model,model);if(e)assert.deepEqual(sent.options[target],target==='openrouter'?{reasoning:{effort:e}}:{effort:e});
 }
 assert.ok((await state('boss')).reports.some(r=>r.freshness==='last-reported'));
 const staleChoice=await discover('boss','openai','openai/gpt-4o-mini');
 await save('boss',staleChoice);assert.ok((await state('boss')).reports.every(r=>r.freshness==='previous-configuration'));
 const beforeRequests=f.stats.requests.length;const repeated=await save('boss',staleChoice);assert.equal(repeated.model,'openai/gpt-4o-mini');assert.equal(f.stats.requests.length,beforeRequests);
 assert.equal((await request('/bots/boss/model','PUT',{revision:staleChoice.revision,snapshotId:staleChoice.snapshotId,model:'openai/gpt-5',reasoning:{}})).status,409);
 f.env.OPENAG_BOSS_MODEL='openai/admin-override';assert.notEqual((await state('boss')).revision,repeated.revision);assert.ok((await state('boss')).reports.every(r=>r.freshness==='previous-configuration'));assert.equal((await json('/bots')).bots.find(b=>b.id==='boss').modelRevision,(await state('boss')).revision);assert.equal((await state('boss')).override,'openai/admin-override');assert.equal((await request('/bots/boss/model','PUT',{revision:repeated.revision,snapshotId:staleChoice.snapshotId,model:'openai/gpt-5',reasoning:{}})).status,409);delete f.env.OPENAG_BOSS_MODEL;
 f.env.OPENAG_BOSS_MODEL='not a model and private';const invalidOverride=await state('boss');assert.ok(!JSON.stringify(invalidOverride).includes('not a model and private'));assert.equal(invalidOverride.effectiveModel,null);delete f.env.OPENAG_BOSS_MODEL;
 f.env.OPENAG_BOSS_MODEL='unknown-provider/private-value';const unknownOverride=await state('boss');assert.equal(unknownOverride.effectiveModel,null);assert.ok(!JSON.stringify(unknownOverride).includes('private-value'));delete f.env.OPENAG_BOSS_MODEL;
 const local=await discover('local','ollama','ollama/fixture-b');assert.deepEqual(local.controls[0].values.map(v=>v.value),[false,true,'high']);
 await save('local',local,{think:'high'});await turn('local');assert.ok(f.stats.requests.some(r=>r.url?.endsWith('/api/chat')&&r.body.model==='fixture-b'&&r.body.think==='high'));assert.ok((await state('local')).reports.some(r=>r.model==='fixture-served'));
 assert.equal((await request('/bots/local/model','PUT',{revision:(await state('local')).revision,snapshotId:local.snapshotId,model:local.model,reasoning:{think:'unsupported'}})).status,400);
 f.mode('unavailable');await f.botModels.catalogue.refresh();assert.equal((await request('/bots/boss/model/discover','POST',{target:'openai'})).status,200);assert.ok(f.botModels.catalogue.status().sources.find(s=>s.id==='openai').error);f.mode('normal');await f.botModels.catalogue.refresh();
 // Unavailable credentials, unsupported controls and failed persistence remain recoverable.
 const invalid=await discover('boss','openai','openai/gpt-5');
 assert.equal((await request('/bots/boss/model','PUT',{revision:invalid.revision,snapshotId:invalid.snapshotId,model:invalid.model,reasoning:{unknown:'bad'}})).status,400);
 const key=f.env.OPENAI_API_KEY;delete f.env.OPENAI_API_KEY;assert.equal((await request('/bots/boss/model/discover','POST',{target:'openai'})).status,503);f.env.OPENAI_API_KEY=key;
 const beforeFailure=await state('boss');f.db.exec("CREATE TEMP TRIGGER reject_model BEFORE UPDATE ON bots BEGIN SELECT RAISE(FAIL,'Controlled storage failure'); END");
 assert.equal((await request('/bots/boss/model','PUT',{revision:invalid.revision,snapshotId:invalid.snapshotId,model:invalid.model,reasoning:{}})).status,503);f.db.exec('DROP TRIGGER reject_model');assert.equal((await state('boss')).revision,beforeFailure.revision);
 f.mode('warning');await turn('boss');f.mode('normal');assert.ok((await state('boss')).reports.some(r=>r.warnings?.some(w=>w.includes('reasoningEffort'))));
 f.mode('missing-chat');await turn('local');f.mode('normal');assert.ok(f.db.prepare("SELECT 1 FROM events WHERE actor='local' AND type='error' AND payload_json LIKE '%not installed%' LIMIT 1").get());
 f.mode('missing-thinking');await f.botModels.catalogue.refresh();const unknown=await discover('local','ollama','ollama/fixture');f.mode('normal');assert.equal(unknown.controls.length,0);assert.ok(unknown.reason);await f.botModels.catalogue.refresh();
 f.mode('adapter-fail');await f.botModels.catalogue.refresh();const partial=await discover('coder','claude');assert.ok(partial.reason.includes('omitted'));assert.equal(partial.models.length,1);f.mode('normal');await f.botModels.catalogue.refresh();
 f.mode('adapter-unavailable');await f.botModels.catalogue.refresh();assert.ok(f.botModels.catalogue.status().sources.find(s=>s.id==='claude').error);f.mode('normal');await f.botModels.catalogue.refresh();
 // Start another bot's connection, then prove selected-bot replacement leaves it alone.
 await turn('other');const otherLaunch=f.stats.launches.findIndex(l=>l.bot==='other');
 for(const adapter of ['claude','codex','claude']){
  const c=await discover('coder',adapter,'model-b');const field=adapter==='claude'?'effort':'reasoning_effort';await save('coder',c,{[field]:'high'});
  await turn('coder');const prompt=f.stats.prompts.at(-1);assert.equal(prompt.adapter,adapter);assert.equal(prompt.model,'model-b');assert.equal(prompt.effort,'high');
 }
 assert.ok(!f.stats.closed.includes(otherLaunch));assert.ok(f.stats.modes.includes('default')&&f.stats.modes.includes('read-only'));
 assert.ok((await state('coder')).reports.some(r=>r.source==='response'&&r.model==='claude-fixture-served'));
 assert.ok(f.stats.closed.filter(i=>f.stats.launches[i].bot==='coder').length>=2,'old adapters close');
 // Real policy/approval gate on each controlled execution path; pending approval blocks switching.
 for(const [id,target,model]of [['boss','openai','openai/gpt-5'],['boss','anthropic','anthropic/claude-opus-4-6'],['boss','openrouter','openrouter/openai/gpt-5'],['local','ollama','ollama/fixture'],['coder','codex','model-a'],['coder','claude','model-a']]){
  const c=await discover(id,target,model);await save(id,c);
  console.log('Checking approval gate:',target);const job=turn(id,'second','gate');
  const a=await until(()=>json('/approvals?status=pending'),v=>v.approvals.some(a=>a.botId===id));const approval=a.approvals.find(a=>a.botId===id);
  const busy=await discover(id,target,model);assert.equal((await request(`/bots/${id}/model`,'PUT',{revision:busy.revision,snapshotId:busy.snapshotId,model:busy.model,reasoning:{}})).status,409);
  await json('/approvals/'+approval.id,'POST',{kind:'accept',reviewVersion:approval.reviewVersion});await job;
 }
 await turn('coder','second','switch-model');const switched=await state('coder');assert.equal(switched.model,'model-a');assert.ok(switched.reports.some(r=>r.roomId==='second'&&r.source==='session'&&r.model==='model-b'&&r.effort==='high'));
 assert.equal(readFileSync(join(dir,'bots/boss/work/api-gate.txt'),'utf8'),'controlled');assert.equal(readFileSync(join(dir,'bots/local/work/ollama-gate.txt'),'utf8'),'controlled');
 // Configuration exclusion queues a new turn until release and uses current stored selection.
 let release;const lock=f.runner.withIdleBot('boss',()=>new Promise(r=>{release=r;}));
 const prior=f.stats.requests.filter(r=>r.kind==='selected-api').length;const waiting=turn('boss');await new Promise(r=>setTimeout(r,30));assert.equal(f.stats.requests.filter(r=>r.kind==='selected-api').length,prior);assert.ok(f.db.prepare("SELECT 1 FROM chat_dispatches WHERE bot_id='boss' AND turn_id IS NULL AND settled_at IS NULL LIMIT 1").get());release();await lock;await waiting;
 // Reconciled interruption history is not a permanent configuration lock.
 const interrupted=f.runner.work.begin({roomId:'main',botId:'boss',messageId:f.ledger.append('main','user','message',{text:'Interrupted controlled work'}).id});
 f.runner.work.updateRun(interrupted.runId,'interrupted','Controlled interruption');
 await discover('boss','openai');
 const recovery=await json('/work/'+interrupted.workId+'/recovery');await json('/work/'+interrupted.workId+'/recovery','POST',{issueKey:recovery.issueKey,revision:recovery.work.revision,action:'dismiss'});
 await discover('boss','openai');
 for(const [id,target,missing]of [['boss','openai','openai/removed'],['local','ollama','ollama/removed'],['coder','claude','removed']])assert.equal((await request(`/bots/${id}/model/discover`,'POST',{target,model:missing})).status,409);
 const modes=await discover('boss','anthropic','anthropic/claude-opus-5');assert.ok(modes.controls.find(c=>c.id==='thinking').values.some(v=>v.value==='disabled'));assert.equal((await request('/bots/boss/model','PUT',{revision:modes.revision,snapshotId:modes.snapshotId,model:modes.model,reasoning:{effort:'max',thinking:'disabled'}})).status,400);
 const budget=await discover('boss','anthropic','anthropic/claude-opus-4-6');assert.ok(budget.controls.filter(c=>!c.values).every(c=>Number.isFinite(c.min)&&Number.isFinite(c.max)));
 assert.equal(budget.controls.find(c=>c.id==='budget_tokens').max,63999);assert.ok(!budget.controls.find(c=>c.id==='thinking').values.some(v=>v.value==='disabled'),'Never invent Off when the provider did not report it');
 assert.equal((await request('/bots/boss/model','PUT',{revision:budget.revision,snapshotId:budget.snapshotId,model:budget.model,reasoning:{thinking:'enabled',budget_tokens:64000}})).status,400);
 await save('boss',budget,{thinking:'enabled',budget_tokens:2048});await turn('boss');

 assert.ok(f.db.prepare("EXPLAIN QUERY PLAN SELECT id FROM events WHERE actor='boss' AND type='model_report' ORDER BY id DESC LIMIT 100").all().some(r=>r.detail.includes('events_model_reports')));
 // Native tools without an approval still block model changes until result evidence exists.
 const nativeMessage=f.ledger.append('main','user','message',{text:'Interrupted native fixture'});
 const native=f.runner.work.begin({roomId:'main',botId:'boss',messageId:nativeMessage.id});const nativeTurn='fixture-native-turn';
 f.db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES(?,?,?,'interrupted','{}',?,?)").run(nativeTurn,'main','boss',Date.now(),Date.now());
 f.runner.work.updateRun(native.runId,'interrupted','Controlled native interruption',nativeTurn);
 f.ledger.append('main','boss','tool_call',{turnId:nativeTurn,toolCallId:'native-1',title:'Native write',status:'pending'});
 const unresolved=await json('/work/'+native.workId+'/recovery');await json('/work/'+native.workId+'/recovery','POST',{issueKey:unresolved.issueKey,revision:unresolved.work.revision,action:'dismiss'});
 const nativeChoice=await discover('boss','openai');const nativeSave={revision:nativeChoice.revision,snapshotId:nativeChoice.snapshotId,model:nativeChoice.model,reasoning:{}};assert.equal((await request('/bots/boss/model','PUT',nativeSave)).status,409,'Dismissing recovery does not establish a native tool outcome');
 await json('/work/'+native.workId+'/cancel','POST',{revision:(await json('/work/'+native.workId)).work.revision});assert.equal((await request('/bots/boss/model','PUT',nativeSave)).status,409,'Cancelling work does not establish a native tool outcome');
 f.ledger.append('main','boss','tool_result',{turnId:nativeTurn,toolCallId:'native-1',status:'completed'});await discover('boss','openai');
 const reportRevision=(await state('boss')).revision;for(let i=0;i<150;i++)f.ledger.append('main','boss','model_report',{source:'response',model:'busy-room',revision:reportRevision});
 assert.ok((await state('boss')).reports.some(r=>r.roomId==='second'),'A busy room must not hide quieter rooms');
 // Lost response is reconciled by GET, never retried automatically.
 const lost=await discover('boss','openai','openai/gpt-4o-mini');f.mode('lost');assert.equal((await request('/bots/boss/model','PUT',{revision:lost.revision,snapshotId:lost.snapshotId,model:lost.model,reasoning:{}})).status,503);f.mode('normal');assert.equal((await state('boss')).model,lost.model);
 const finalState=await state('boss');await f.close();f=await startFixture(dir,token);base=f.url;assert.equal((await state('boss')).model,finalState.model);assert.equal((await state('boss')).revision,finalState.revision);assert.ok((await state('coder')).reports.every(r=>r.freshness!=='live'));
 console.log('PASS: owner/full/limited, strict validation, provider configuration, ACP switching/teardown, six policy-gate paths, cross-room refusal, configuration admission, reports/freshness, overrides, lost response and restart persistence.');
 if(process.argv.includes('--keep')){const credentialsFile=join(dir,'browser-login.json');writeFileSync(credentialsFile,JSON.stringify({url:base,token}),{mode:0o600});console.log(JSON.stringify({url:base,credentialsFile}));await new Promise(resolve=>process.once('SIGINT',resolve));}
}catch(error){console.error(error);console.error(JSON.stringify({requests:f.stats.requests.slice(-3),turns:f.db.prepare("SELECT bot_id,status FROM turns ORDER BY created_at DESC LIMIT 3").all(),errors:f.db.prepare("SELECT payload_json FROM events WHERE type='error' ORDER BY id DESC LIMIT 3").all()}));throw error;}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
