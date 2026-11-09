// Controlled provider/ACP integration through the public gateway. No account, external service or unit runner.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'openag-work-')),ownerToken=randomBytes(32).toString('hex');
const child=fork(fileURLToPath(new URL('./work-fixture.mjs',import.meta.url)),[dir],{stdio:['ignore','ignore','inherit','ipc']});
const ready=once(child,'message');child.send({ownerToken,port:0});const base=(await ready)[0].url;
const request=(path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+ownerToken,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
async function json(path){const r=await request(path);assert.equal(r.status,200,path);return r.json();}
async function until(read,predicate,label){const end=Date.now()+15000;let value;do{value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,30));}while(Date.now()<end);throw Error(label+': '+JSON.stringify(value));}
try{
 for(const mode of ['input_runtime','input_runtime_chat'])for(const [room,bot]of[['model-room','model'],['local-room','local'],['acp-room','acp']]){
  const post=await request('/rooms/'+room+'/messages',{text:mode});assert.equal(post.status,202);const message=(await post.json()).message;
  const item=(await until(()=>json('/rooms/'+room+'/requests'),p=>p.requests.some(i=>i.kind==='question'),'durable question '+bot)).requests.find(i=>i.kind==='question').question;
  assert.equal(item.botId,bot);const q=(await json('/questions/'+item.id)).question;assert.ok(q.prompt.includes(bot==='model'?'API':bot==='local'?'Ollama':'ACP'));
  const answer=await request('/questions/'+q.id+'/answer',{revision:q.revision,answer:'Use the controlled option. @everyone'});assert.equal(answer.status,202);
  if(mode==='input_runtime_chat'){
   assert.equal(item.workId,null);await until(()=>json('/questions/'+q.id),p=>p.question.continuationState==='finished','chat answer '+bot);assert.equal((await json('/work?roomId='+room)).work.length,1,'chat adds no Work');
  }else{
  await until(()=>json('/work/'+item.workId),p=>p.work.status==='completed','completed answer '+bot);
  const runs=(await json('/work/'+item.workId+'/runs')).runs;assert.equal(runs.length,2);assert.ok(runs.some(r=>r.messageId===message.id));
  assert.equal((await json('/work?roomId='+room)).work.length,1);assert.equal((await json('/work/'+item.workId)).work.progress.unsuccessfulTools,0,'input control and cancelled MCP wrapper are not failed actions');
  }
 }
 for(const room of ['model-room','local-room','acp-room'])assert.equal((await json('/rooms/'+room+'/requests')).requests.length,0);
 console.log('OA-325 runtime integration passed: API tool call, Ollama tool call and ACP scoped-MCP question/answer/pause; same Work for assignments and zero Work for chat, no second target or failed wrapper, and no action approval created.');
}finally{const exit=once(child,'exit');child.send({type:'stop'});await exit;}
