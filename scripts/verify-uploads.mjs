// Standalone assertions against a disposable gateway/runner; no test runner or real model account.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,lstatSync,symlinkSync,unlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),load=p=>import(root+'apps/daemon/dist/'+p+'.js'),require=createRequire(root+'apps/daemon/package.json');
const {openDb}=await load('db/index'),{createBot,createRoom,addMember,getBot,getRoom}=await load('rooms'),{createAuth}=await load('auth'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createRunner}=await load('runtimes/runner'),{createGateway,attachStream}=await load('gateway'),{createUploads}=await load('uploads'),{createIngress}=await load('ingress'),{getDefaultRedactor}=await load('redact'),{createAcpRuntime}=await load('runtimes/acp'),{createApiRuntime}=await load('runtimes/api'),{createOllamaRuntime}=await load('runtimes/ollama'),{apiImageInput}=await load('attachment-prompt');
const dir=mkdtempSync(join(tmpdir(),'openag-uploads-')),db=openDb(dir),token=randomBytes(32).toString('hex'),auth=createAuth({db,ownerToken:token}),ledger=createLedger(db),approvals=createApprovals(db,ledger),uploads=createUploads(db,dir),received=[];
getDefaultRedactor().addSecret('upload-secret-698157');
for(const id of ['boss','other','_internal']){createBot(db,{id,runtime:'api'});createRoom(db,{id,leadBotId:id});addMember(db,id,id);}
const runtime={async runTurn(ctx){received.push(ctx.attachments);ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:`Read ${ctx.attachments.length} attachments. ${ctx.attachments.map(f=>f.text??f.name).join(' ')}`});}};
const runner=createRunner({db,ledger,approvals,dataDir:dir,runtimes:{api:runtime}});
const app=createGateway({db,ledger,approvals,auth,dataDir:dir,deskDir:root+'apps/desk/dist',dispatch:args=>runner.dispatch(args)});
const req=(path,opts={},authorized=true)=>app.request(path,{...opts,headers:{...(authorized?{authorization:'Bearer '+token}:{}),...opts.headers}});
const save=(name,body,type='text/plain',room='boss')=>req(`/rooms/${room}/uploads`,{method:'POST',headers:{'content-type':type,'x-file-name':encodeURIComponent(name)},body});
const post=ids=>req('/rooms/boss/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'',attachments:ids})});
const wait=async(f,p)=>{for(let i=0;i<200;i++){const r=await f();if(p(r))return r;await new Promise(r=>setTimeout(r,25));}throw Error('verification deadline');};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S0AAAAASUVORK5CYII=','base64');
try{
 assert.equal((await req('/rooms/boss/uploads',{method:'POST',body:'x'},false)).status,401);
 assert.equal((await save('x.txt','x','text/plain','missing')).status,404);assert.equal((await save('x.txt','x','text/plain','_internal')).status,404);
 for(const [name,body,type,status] of [['../escape','x','text/plain',400],['a/b','x','text/plain',400],['x.txt',Buffer.from([255]),'text/plain',400],['x.txt','x\0y','text/plain',400],['x.html','<script>bad()</script>','text/html',400],['x.png','fake','image/png',400],['empty.txt','','text/plain',413],['big.txt','a'.repeat(65537),'text/plain',413],['big.png',Buffer.alloc(5*1024*1024+1),'image/png',413]])assert.equal((await save(name,body,type)).status,status,name);
 const a=(await (await save('document.txt','Hello upload-secret-698157')).json()).attachment,b=(await (await save('picture.png',png,'image/png')).json()).attachment;
 assert.ok(a.id&&!JSON.stringify(a).includes(dir));const path=join(dir,'uploads',Buffer.from('boss').toString('hex'),a.id);
 assert.equal(lstatSync(path).mode&0o777,0o600);assert.ok(!readFileSync(path,'utf8').includes('upload-secret-698157'));
 assert.equal((await req('/rooms/other/uploads/'+a.id)).status,404);assert.equal((await req('/rooms/boss/uploads/'+a.id,{},false)).status,401);
 assert.equal((await req('/rooms/boss/uploads/'+b.id)).headers.get('x-content-type-options'),'nosniff');
 for(const ids of [null,[a.id,a.id],Array(7).fill(a.id)])assert.equal((await post(ids)).status,400);
 const foreign=(await (await save('other.txt','Other','text/plain','other')).json()).attachment;assert.equal((await post([foreign.id])).status,404);
 const result=await post([a.id,b.id]);assert.equal(result.status,202);const sent=await result.json();await wait(()=>received.length,n=>n===1);assert.equal(received[0][1].data,png.toString('base64'));assert.ok(received[0][0].text.includes('Hello')&&!received[0][0].text.includes('upload-secret-698157'));
 assert.equal((await post([a.id])).status,409);assert.equal((await req('/rooms/boss/uploads/'+a.id,{method:'DELETE'})).status,409);
 const stored=db.prepare('SELECT message_id FROM uploads WHERE id=?').get(a.id);assert.equal(stored.message_id,sent.message.id);
 const before=ledger.list('boss').length;let published=false;const off=ledger.subscribe('boss',()=>published=true);
 await assert.rejects(createIngress({ledger,dispatch:()=>{throw Error('must not dispatch');}}).post(getRoom(db,'boss'),'rollback',{onMessage:()=>{throw Error('bind failed');}}),/bind failed/);off();assert.equal(ledger.list('boss').length,before);assert.equal(published,false);
 const orphan=(await (await save('remove.txt','remove')).json()).attachment;assert.equal((await req('/rooms/boss/uploads/'+orphan.id,{method:'DELETE'})).status,204);assert.equal((await req('/rooms/boss/uploads/'+orphan.id)).status,404);
 const linked=(await (await save('link.txt','original')).json()).attachment,link=join(dir,'uploads',Buffer.from('boss').toString('hex'),linked.id);unlinkSync(link);symlinkSync(path,link);assert.equal((await req('/rooms/boss/uploads/'+linked.id)).status,404);assert.equal((await req('/rooms/boss/uploads/'+linked.id,{method:'DELETE'})).status,400);unlinkSync(link);writeFileSync(link,'original');
 const padded=Buffer.alloc(5*1024*1024);png.copy(padded);const large=[];for(let i=0;i<3;i++)large.push((await(await save('large.png',padded,'image/png')).json()).attachment.id);assert.equal((await post(large)).status,413);
 const db2=openDb(dir);assert.equal(createUploads(db2,dir).forMessage('boss',sent.message.id,[a.id,b.id])[1].data,png.toString('base64'));db2.close();
 const ctx={bot:{...getBot(db,'boss'),model:'openai/gpt-4o-mini'},room:getRoom(db,'boss'),message:sent.message,prompt:'Read files',turnId:'controlled',state:{},saveState:()=>{},toolCalls:0,attachments:received[0],ledger,callTool:async()=>{throw Error('no tools');},authorize:async()=>{throw Error('no tools');}};
 const {agent,methods}=require('@agentclientprotocol/sdk/unstable');
 for(const capabilities of [{image:true,embeddedContext:true},{}]){
  let prompt;const target=agent({name:'upload-assertion'}).onRequest(methods.agent.initialize,async()=>({protocolVersion:1,agentCapabilities:{promptCapabilities:capabilities,sessionCapabilities:{systemPrompt:{}}}})).onRequest(methods.agent.session.new,async()=>({sessionId:'fixture',modes:{currentModeId:'read-only',availableModes:[{id:'read-only',name:'Read only'}]}})).onRequest(methods.agent.session.setMode,async()=>({})).onRequest(methods.agent.session.prompt,async({params})=>{prompt=params.prompt;return{stopReason:'end_turn'};});
  const acp=createAcpRuntime({dataDir:dir,launcher:()=>({target,close:()=>{}})});try{await acp.runTurn({...ctx,bot:{...ctx.bot,runtime:'acp',config:{adapter:'codex'}}});assert.equal(prompt.some(p=>p.type==='resource'),!!capabilities.embeddedContext);assert.equal(prompt.some(p=>p.type==='image'),!!capabilities.image);assert.ok(JSON.stringify(prompt).includes('Hello'));if(!capabilities.image)assert.ok(prompt[0].text.includes('image content unavailable'));}finally{await acp.close();}
 }
 const {MockLanguageModelV3}=await import(require.resolve('ai/test'));let modelPrompt;const model=new MockLanguageModelV3({doGenerate:async opts=>{modelPrompt=opts.prompt;return {content:[{type:'text',text:'Controlled response'}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}},warnings:[]};}});
 const suppliedAttachments=ctx.attachments; ctx.attachments=[...suppliedAttachments,{...suppliedAttachments.find(file=>file.data),id:'unsupported-jpeg',name:'unsupported.jpg',mimeType:'image/jpeg'}];
 ctx.hostedInput={instructions:'Controlled upload instructions',current:ctx.prompt,data:[],history:[]};
 await createApiRuntime({model,tools:[],capabilities:()=>({chat:true,image:true,transcription:false,decision:false,embedding:false,input:["image/png"],source:"controlled",refreshedAt:1})}).runTurn(ctx);assert.ok(JSON.stringify(modelPrompt).includes('Hello'));assert.ok(modelPrompt.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='file'&&c.mediaType==='image/png'&&c.data===png.toString('base64'))));
 assert.match(JSON.stringify(modelPrompt),/unsupported\.jpg[^\]]*image content unavailable/);assert.ok(!modelPrompt.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='file'&&c.mediaType==='image/jpeg')));ctx.attachments=suppliedAttachments;
 assert.equal(apiImageInput(),false);assert.equal(apiImageInput({image:true}),true);assert.equal(apiImageInput({image:true,input:['image/jpeg']},'image/png'),false);assert.equal(apiImageInput({image:true,input:['image/png']},'image/png'),true);
 for(const vision of [true,false]){let chat;await createOllamaRuntime({env:{OPENAG_OLLAMA_URL:'http://127.0.0.1:1'},tools:[],fetch:async(url,opts)=>{if(url.endsWith('/api/show'))return Response.json({capabilities:vision?['vision']:[]});chat=JSON.parse(opts.body);return Response.json({done:true,done_reason:'stop',message:{role:'assistant',content:'Controlled local response'}});}}).runTurn({...ctx,bot:{...ctx.bot,model:'ollama/synthetic'}});assert.equal(!!chat.messages.at(-1).images,vision);assert.ok(chat.messages.at(-1).content.includes('Hello'));}
  const expired=(await(await save('expired.txt','expired')).json()).attachment;
 db.prepare('UPDATE uploads SET created_at=0 WHERE id=?').run(expired.id);assert.equal((await save('prune.txt','prune')).status,201);assert.equal((await req('/rooms/boss/uploads/'+expired.id)).status,404);
 const pendingRow=db.prepare('SELECT id,bytes FROM uploads WHERE message_id IS NULL LIMIT 1').get();
 db.prepare('UPDATE uploads SET bytes=? WHERE id=?').run(100*1024*1024,pendingRow.id);assert.equal((await save('quota.txt','x')).status,413);db.prepare('UPDATE uploads SET bytes=? WHERE id=?').run(pendingRow.bytes,pendingRow.id);
 const current=db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE message_id IS NULL').get().n;
 for(let i=current;i<32;i++)assert.equal((await save('pending.txt','x')).status,201);
 assert.equal((await save('full.txt','x')).status,413);
 db.prepare('UPDATE uploads SET created_at=0 WHERE message_id IS NULL').run();assert.equal((await save('recovered.txt','x')).status,201);
 console.log('Upload boundary, atomic binding, restart and ACP/API/Ollama delivery assertions passed');
 if(process.argv.includes('--serve')){
  const {serve}=require('@hono/node-server');const server=serve({hostname:'127.0.0.1',port:0,fetch:request=>{if(request.method==='POST'&&request.url.endsWith('/messages'))return request.clone().json().then(async body=>{if(body.text==='/reject')return Response.json({error:'Controlled send failure'},{status:503});if(body.text==='delayed delivery')await new Promise(resolve=>setTimeout(resolve,1800));return app.fetch(request);});return app.fetch(request);}});const detach=attachStream(server,ledger,auth);await new Promise(r=>server.once('listening',r));
  console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/#/room/boss`,pairCode:auth.createPairingCode('owner','full').code,dir}));
  await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});detach();server.closeAllConnections();await new Promise(r=>server.close(r));
 }
}finally{runner.shutdown();db.close();}
