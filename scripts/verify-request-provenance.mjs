if(process.argv.includes('--real-acp')){await import('./verify-request-provenance-acp.mjs');process.exit(0);}
// Controlled provider HTTP transports + actual gateway/runner/gate. Read-only synthetic tool; no shell or live API calls.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(root + 'apps/daemon/package.json');
const load = p => import(root + 'apps/daemon/dist/' + p + '.js');
const { serve } = require('@hono/node-server'), { z } = require('zod');
const { openDb } = await load('db/index'), { createLedger } = await load('ledger'), { createAuth } = await load('auth');
const { createApprovals } = await load('approvals'), { createRunner } = await load('runtimes/runner');
const { createGateway, attachStream } = await load('gateway'), { createBot, createRoom, addMember } = await load('rooms');
const { createApiRuntime } = await load('runtimes/api'), { createOllamaRuntime } = await load('runtimes/ollama');
const { toExecutors } = await load('tools/registry');
const { modelProviders } = await load('providers');
const { createPermissions } = await load('permissions');
const { requestPage, requestFingerprint } = await load('request-provenance');
const { getDefaultRedactor } = await load('redact');
const secret = 'fixture-κλειδί-value-398'; getDefaultRedactor().addSecret(secret);
const directory = mkdtempSync(join(tmpdir(), 'openag-request-provenance-'));
console.log('Disposable evidence: ' + directory);
const originalFetch = globalThis.fetch;
let base, command='read-only-fixture', step = 0, modelName, wire = [], failures=0,omitUsage=false;
const preview=process.argv.includes('--preview');
const sse = items => new Response(items.map(item => 'data: ' + JSON.stringify(item) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (base && url.startsWith(base + '/')) return originalFetch(input, init);
  assert.ok(/^https:\/\/(api\.openai\.com|api\.anthropic\.com|openrouter\.ai|generativelanguage\.googleapis\.com|api\.groq\.com|api\.tokenfactory\.nebius\.com|api\.x\.ai|api\.deepseek\.com|api\.perplexity\.ai|dashscope-intl\.aliyuncs\.com|api\.mistral\.ai|api\.cerebras\.ai|api\.deepinfra\.com)\//.test(url) || url.startsWith('http://127.0.0.1:1/api/'), 'Unexpected network request refused');
  const body = init.body ? JSON.parse(init.body) : {};
  if (url.endsWith('/api/show')) return Response.json({ capabilities: ['tools'], details: { family: 'fixture' } });
  if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'fixture' }] });
  if(failures-->0)return new Response(null,{status:503});
  const call = step++ === 0;
  wire.push({ url, tools: body.tools ?? [], body });
  const args = JSON.stringify({ command }), id = 'call_permission';
  if (url.endsWith('/api/chat')) return Response.json({ model: 'fixture', done: true, done_reason: 'stop', prompt_eval_count:17,eval_count:4,message: call ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'run_shell', arguments: { command } } }] } : { role: 'assistant', content: 'Settled fixture result.' } });
  const functionItem = { id: 'fc_permission', type: 'function_call', call_id: id, name: 'run_shell', arguments: args, status: 'completed' };
  const textItem = { id: 'msg_permission', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Settled fixture result.', annotations: [] }] };
  const response = { id: 'resp_permission', object: 'response', created_at: 1, model: modelName, status: 'completed', output: [call ? functionItem : textItem], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, output_tokens_details: { reasoning_tokens: 0 } } };
  if (url.includes('perplexity.ai')) return Response.json(response);
  if (url.includes('googleapis.com')) {
    const google = { candidates: [{ index: 0, content: { role: 'model', parts: call ? [{ functionCall: { name: 'run_shell', args: { command } } }] : [{ text: 'Settled fixture result.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }, modelVersion: modelName };
    return url.includes('streamGenerateContent') ? sse([google]) : Response.json(google);
  }
  if (url.includes('/responses')) {
    if (!body.stream) return Response.json(response);
    const item = response.output[0];
    return sse([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: call ? { ...item, status: 'in_progress', arguments: '' } : { ...item, status: 'in_progress', content: [] } },
      call ? { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: args } : { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Settled fixture result.' },
      ...(call ? [{ type: 'response.function_call_arguments.done', item_id: item.id, output_index: 0, arguments: args }] : []),
      { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response },
    ]);
  }
  if (url.includes('anthropic.com')) {
    const block = call ? { type: 'tool_use', id, name: 'run_shell', input: { command } } : { type: 'text', text: 'Settled fixture result.' };
    const message = { id: 'msg_fixture', type: 'message', role: 'assistant', model: modelName, content: [block], stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) return Response.json(message);
    return sse([{ type: 'message_start', message: { ...message, content: [], stop_reason: null } }, { type: 'content_block_start', index: 0, content_block: call ? { ...block, input: {} } : { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: args } : { type: 'text_delta', text: 'Settled fixture result.' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 1 } }, { type: 'message_stop' }]);
  }
  const completion = { id: 'chat_permission', object: 'chat.completion', created: 1, model: modelName, choices: [{ index: 0,message: call ? { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'run_shell', arguments: args } }] } : { role: 'assistant', content: 'Settled fixture result.' }, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  if(omitUsage)delete completion.usage;
  if (!body.stream) return Response.json(completion);
  return sse([{ ...completion, object: 'chat.completion.chunk', choices: [{ index: 0, delta: call ? { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: 'run_shell', arguments: args } }] } : { role: 'assistant', content: 'Settled fixture result.' }, finish_reason: null }] }, { ...completion, object: 'chat.completion.chunk', ...(omitUsage?{}:{usage:{prompt_tokens:17,completion_tokens:4,total_tokens:21}}),choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] }]);
};
const models = ['ollama/fixture', 'deepseek/deepseek-v4-flash', 'openai/gpt-5', 'anthropic/claude-opus-4-6', 'google/gemini-2.5-pro', 'openrouter/openai/gpt-5', 'groq/openai/gpt-oss-120b', 'nebius/Qwen/Qwen3.8-27B', 'xai/grok-4.6', 'alibaba/qwen3.8-flash', 'mistral/magistral-small-latest', 'cerebras/gpt-oss-120b', 'deepinfra/deepseek-ai/DeepSeek-V4-Pro', 'perplexity/sonar-pro'];
for (const provider of modelProviders()) for (const key of provider.envVars) process.env[key] = 'synthetic-permission-fixture';
for (const key of Object.keys(process.env)) if (/^OPENAG_.+_MODEL$/.test(key) || key === 'OPENAG_OVERRIDE_MODEL') delete process.env[key];
const { WebSocket } = require('ws');
const evidence=[];
try {
 for(const model of (preview?['ollama/fixture']:models)){
  const dataDir=join(directory,model.split('/')[0]),token=randomUUID();
  const db=openDb(dataDir),ledger=createLedger(db),approvals=createApprovals(db,ledger),auth=createAuth({db,ownerToken:token});
  createBot(db,{id:'bot',name:'Provenance fixture',runtime:'api',model,config:{instructions:'Fixture instructions '+secret,...(model.startsWith('deepseek/')?{modelConfig:{reasoning:{toggle:true,effort:'high'}}}:{})}});
  createRoom(db,{id:'main',name:'Request provenance',leadBotId:'bot'});addMember(db,'main','bot');
  let executed=0;
  const def={name:'run_shell',class:'read',description:'Controlled read-only fixture; never runs a shell',input:z.object({command:z.string()}).strict(),permission:()=>({approval:'allow'}),execute:()=>{executed++;return {exitCode:0,stdout:'source fixture '+secret};},confirm:()=>({outcome:'completed',detail:'Read-only synthetic result counted once.'})};
  const permissions=createPermissions(db,ledger,dataDir,approvals);
  const ollama=createOllamaRuntime({tools:[def],env:{OPENAG_OLLAMA_URL:'http://127.0.0.1:1'},retry:{wait:async()=>{}}});
  const api=createApiRuntime({tools:[def],ollama,retry:{wait:async()=>{}}});
  const runner=createRunner({db,ledger,approvals,dataDir,permissions,runtimes:{api},tools:toExecutors([def])});
  const runs=[];
  const app=createGateway({db,ledger,approvals,auth,dataDir,permissions,work:runner.work,deskDir:root+'apps/desk/dist',dispatch:args=>{const run=runner.dispatch(args);runs.push(run);return run;}});
  const server=serve({hostname:'127.0.0.1',port:0,fetch:req=>app.fetch(req)});
  if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  base='http://127.0.0.1:'+server.address().port;
  const detach=attachStream(server,ledger,auth);
  const request=(path,method='GET',body,credential=token)=>fetch(base+path,{method,headers:{authorization:'Bearer '+credential,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  async function post(text){
   step=0;wire=[];
   const response=await request('/rooms/main/messages','POST',{text});assert.equal(response.status,202);await Promise.all(runs.splice(0));
   return db.prepare('SELECT * FROM turns ORDER BY rowid DESC LIMIT 1').get();
  }
  async function inspect(id,credential=token){const r=await request('/turns/'+id+'/request-manifests','GET',undefined,credential);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');return r.json();}
  let socket;
  try{
   const limited=auth.createDevice('Limited fixture'),full=auth.createDevice('Full fixture',undefined,'full');
   const publicEvents=[];
   socket=new WebSocket(base.replace('http:','ws:')+'/stream?token='+limited.token);socket.on('message',data=>publicEvents.push(JSON.parse(String(data))));await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
   modelName=model.slice(model.indexOf('/')+1);
   const first=await post('Inspect this local fixture. '+secret+' 🦉');
   assert.equal(first.status,'finished',JSON.stringify(ledger.list('main').filter(e=>e.type==='error')));
   assert.equal(executed,1,'Exactly one read-only fixture invocation');
   const page=await inspect(first.id),records=[...page.records].reverse();
   assert.equal(records.length,2,'One manifest per dispatched step');
   assert.equal(wire.length,2);
   assert.equal(records[0].manifest.toolCount,1);
   assert.equal(records[1].manifest.step,2);
   assert.notEqual(records[0].manifest.fingerprint,records[1].manifest.fingerprint,'Later tool results change observed request');
   assert.ok(records[1].manifest.messages.some(m=>m.role==='tool'),'Actual later step includes tool result');
   for(const record of records){
    assert.equal(record.manifest.boundary,model.startsWith('ollama/')?'ollama-payload':'sdk-request');
    assert.deepEqual(record.evidence.map(e=>e.status),['started','returned']);
    assert.ok(Buffer.byteLength(JSON.stringify(record.manifest))<=16384);
    assert.ok(record.manifest.context.sources.some(s=>s.source==='current'&&s.characters>0));
    assert.ok(!JSON.stringify(record).includes(secret));
   }
   if(model.startsWith('ollama/')){
    assert.equal(records[0].evidence.at(-1).usage.prompt_eval_count,17);
    assert.deepEqual(records[0].manifest.messages.map(m=>({role:m.role,characters:m.characters})),wire[0].body.messages.map(m=>({role:m.role,characters:m.content.length})));
   }
   assert.equal((await inspect(first.id,full.token)).records.length,2);
   assert.equal((await request('/turns/'+first.id+'/request-manifests','GET',undefined,limited.token)).status,403);
   assert.equal((await request('/turns/'+first.id+'/request-manifests','GET',undefined,'invalid')).status,401);
   const events=await (await request('/rooms/main/events','GET',undefined,limited.token)).json();
   for(const e of [...events.events,...publicEvents].filter(e=>e.type.startsWith('request_')))assert.deepEqual(Object.keys(e.payload).sort(),['manifestId','turnId']);
   if(model.startsWith('deepseek/')){
    assert.equal(records[0].manifest.requestedSettings.toggle,true);
    assert.equal(records[0].manifest.settings['deepseek.thinking.type'],'enabled');
    db.prepare('UPDATE bots SET config_json=? WHERE id=?').run(JSON.stringify({instructions:'Fixture instructions '+secret,modelConfig:{reasoning:{toggle:false,effort:'high'}}}),'bot');
   }
   const executedBefore=executed;
   const second=await post('Second conversation request.');
   assert.equal(executed-executedBefore,1,'Second conversation tool result executes once');
   if(model.startsWith('deepseek/'))assert.equal((await inspect(second.id)).records[0].manifest.settings['deepseek.thinking.type'],'disabled');
   if(model.startsWith('deepseek/')){omitUsage=true;try{const absent=await post('Provider reports no usage.');assert.ok((await inspect(absent.id)).records.every(record=>record.evidence.at(-1).usage===null),'Absent API usage is unavailable, never zero');}finally{omitUsage=false;}}

   assert.ok((await inspect(second.id)).records[0].manifest.context.sources.some(s=>s.source==='history'&&s.reference),'Trusted history references survive selection');
   if(model.startsWith('deepseek/')){
    const override='deepseek/'+('fixture-override-'.repeat(8));process.env.OPENAG_BOT_MODEL=override;
    try{
      for(const saved of [model,null]){
        db.prepare('UPDATE bots SET model=? WHERE id=?').run(saved,'bot');
        const refused=await post('o'.repeat(65000));assert.equal(wire.length,0);
        const manifest=(await inspect(refused.id)).records[0].manifest;assert.equal(manifest.boundary,'admission');assert.equal(manifest.requestedModel,override);
      }
    }finally{delete process.env.OPENAG_BOT_MODEL;db.prepare('UPDATE bots SET model=? WHERE id=?').run(model,'bot');}
   }
   const old=db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES(?, 'main','bot','finished','{}',?,?)");
   const historical=randomUUID();old.run(historical,Date.now(),Date.now());assert.deepEqual((await inspect(historical)).records,[]);
   const reopen=openDb(dataDir);try{assert.equal(requestPage(reopen,first.id).records.length,2,'Durable after reopening DB');}finally{reopen.close();}
   if(model.startsWith('ollama/')){
    failures=1;const retried=await post('One transient request failure.');
    const retryRecords=(await inspect(retried.id)).records;
    assert.deepEqual(retryRecords.at(-1).evidence.map(e=>e.status),['started','failed','started','returned']);
    const append=ledger.append;ledger.append=(room,actor,type,payload)=>{if(type==='request_prepared')throw Error('fixture persistence failure');return append(room,actor,type,payload);};
    const failed=await post('Refuse before dispatch when evidence cannot be stored.');
    ledger.append=append;assert.equal(wire.length,0);assert.equal(failed.status,'failed');
    ledger.append=(room,actor,type,payload)=>{if(type==='request_attempt'&&payload.status==='returned')throw Error('fixture settlement failure');return append(room,actor,type,payload);};
    const gap=await post('Do not replay after settlement evidence fails.');ledger.append=append;
    assert.equal(wire.length,2);assert.equal(gap.status,'finished');assert.ok((await inspect(gap.id)).records.every(r=>r.evidence.at(-1).status==='started'));
   }
   evidence.push({model,turn:first.id,steps:records.length,privacy:'owner/full only',status:'passed'});
   console.log('PASS '+model+': final request, later tool step, history, access, redaction and durable inspection');
   if(preview){
    console.log(JSON.stringify({preview:base,token,dir:dataDir}));
    await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});
   }
  }finally{socket?.terminate();detach();runner.shutdown();await runner.idle();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
 }
 writeFileSync(join(directory,'acceptance.json'),JSON.stringify(evidence,null,2));
 console.log('PASS '+evidence.length+' provider journeys. Evidence: '+join(directory,'acceptance.json'));
}finally{globalThis.fetch=originalFetch;}
