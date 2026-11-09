// Real SDK routing in its isolated worker, against an owned loopback provider. No external traffic.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDb} from '../apps/daemon/dist/db/index.js';
import {createRoomRouter} from '../apps/daemon/dist/router.js';
import {createBot,createRoom,addMember,getRoom} from '../apps/daemon/dist/rooms.js';
const dir=mkdtempSync(join(tmpdir(),'openag-routing-transports-')),db=openDb(dir);
let mode='normal',escaped=0,last;
const server=createServer(async(req,res)=>{
  if(req.url==='/escaped'){escaped++;res.end('redirect escaped');return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  last={headers:req.headers,body:JSON.parse(raw)};
  if(mode==='redirect'){res.writeHead(302,{location:'/escaped'});res.end();return;}
  if(mode==='timeout')return;
  const text=mode==='oversize'?'x'.repeat(65536):'coder';
  const completion={id:'fixture',object:'chat.completion',created:1,model:'fixture-returned-model',choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
  if(last.body.stream){res.setHeader('content-type','text/event-stream');res.end([{...completion,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]},{...completion,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]}].map(c=>'data: '+JSON.stringify(c)+'\n\n').join(''));}
  else {res.setHeader('content-type','application/json');res.end(JSON.stringify(completion));}
});
try{
  server.listen(0,'127.0.0.1');await once(server,'listening');
  for(const id of ['boss','coder'])createBot(db,{id,runtime:'api',model:'lmstudio/openai/gpt-oss-20b'});
  createRoom(db,{id:'main',leadBotId:'boss'});for(const id of ['boss','coder'])addMember(db,'main',id);
  const env={LMSTUDIO_API_KEY:'synthetic-selected-key',LMSTUDIO_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,OPENAI_API_KEY:'synthetic-unrelated-key',OPENAG_TOKEN:'synthetic-owner-secret'};
  const router=createRoomRouter({db,env});
  const room={...getRoom(db,'main'),router:'cheap-same-model',routerConfig:{provider:'lmstudio',model:'lmstudio/openai/gpt-oss-20b',reasoning:{effort:'low'}}};
  assert.equal((await router.route(room,'write code')).botId,'coder');
  assert.equal(last.body.model,'openai/gpt-oss-20b');assert.equal(last.body.reasoning_effort,'low');assert.equal(last.body.max_tokens,1024);
  assert.equal(last.headers.authorization,'Bearer synthetic-selected-key');assert.ok(!JSON.stringify(last).includes('synthetic-owner-secret'));
  for(mode of ['redirect','oversize','timeout']){
    const result=await router.route(room,'write code');assert.equal(result.botId,'boss',mode);assert.match(result.reason,/fallback/,mode);
  }
  assert.equal(escaped,0,'Provider redirects must never be followed');
  console.log('PASS: real isolated Mastra routing uses selected provider/model/reasoning, caps output, refuses redirects and oversized bodies, enforces a hard deadline, and falls back to the lead. Loopback traffic only.');
}finally{server.closeAllConnections();server.close();db.close();rmSync(dir,{recursive:true,force:true});}
