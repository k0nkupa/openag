// Explicit owner-authorized manual acceptance: two subscription adapters, synthetic inputs, temporary workspaces.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {deflateSync} from 'node:zlib';
if (!process.argv.includes('--real')) throw new Error('Requires explicit authorization and --real');
for (const key of Object.keys(process.env)) if (!['PATH','HOME','LANG','TMPDIR'].includes(key)) delete process.env[key];
const root=fileURLToPath(new URL('../',import.meta.url)), load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const {openDb}=await load('db/index'),{createBot,createRoom,addMember}=await load('rooms'),{createAuth}=await load('auth'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createRunner}=await load('runtimes/runner'),{createAcpRuntime}=await load('runtimes/acp'),{createGateway}=await load('gateway');
const dir=mkdtempSync(join(tmpdir(),'openag-attachments-real-')), db=openDb(dir),token=randomBytes(32).toString('hex');
const ledger=createLedger(db),auth=createAuth({db,ownerToken:token}),approvals=createApprovals(db,ledger);
const instructions='Use only the supplied attachment prompt content. Read the text and describe the image. Do not use any tools, commands, external actions, network requests, file reads or writes. Never run tests, Jest, scripts, hooks or builds. This is an isolated synthetic attachment acceptance check.';
for (const id of ['claude','codex']) { createBot(db,{id,name:id,runtime:'acp',config:{adapter:id,instructions}});createRoom(db,{id,leadBotId:id});addMember(db,id,id); }
const acp=createAcpRuntime({dataDir:dir}),runner=createRunner({db,ledger,approvals,dataDir:dir,runtimes:{acp}});
const app=createGateway({db,ledger,auth,approvals,dataDir:dir,dispatch:args=>runner.dispatch(args)});
// A real PNG with a blue square. The filename and prompt do not disclose its colour.
function crc(data){let c=0xffffffff;for(const byte of data){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const kind=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([kind,data])));return Buffer.concat([size,kind,data,sum]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(32,0);ihdr.writeUInt32BE(32,4);ihdr[8]=8;ihdr[9]=2;
const pixels=Buffer.alloc(32*(32*3+1));for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=y*97+1+x*3;pixels[i]=20;pixels[i+1]=70;pixels[i+2]=240;}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
writeFileSync(join(dir,'picture.png'),png,{mode:0o600});writeFileSync(join(dir,'document.txt'),'The acceptance marker is ORCHID-317.',{mode:0o600});
const request=(path,opts={})=>app.request(path,{...opts,headers:{authorization:'Bearer '+token,...opts.headers}});
const results={};
console.log(JSON.stringify({temporaryData:dir,adapters:['claude','codex'],listeningPorts:0}));
try {
 await Promise.all(['claude','codex'].map(async id=>{
  const ids=[];for(const [name,type,body] of [['document.txt','text/plain','The acceptance marker is ORCHID-317.'],['picture.png','image/png',png]]){
   const response=await request('/rooms/'+id+'/uploads',{method:'POST',headers:{'content-type':type,'x-file-name':name},body});assert.equal(response.status,201);ids.push((await response.json()).attachment.id);
  }
  const response=await request('/rooms/'+id+'/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'Read both attached files without tools. Return the exact marker from the text and describe the dominant colour in the image. If either content is unavailable, say so.',attachments:ids})});assert.equal(response.status,202);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{unsubscribe();reject(new Error(id+' timeout'));},240000);const unsubscribe=ledger.subscribe(id,event=>{if(event.type==='turn_finished'){clearTimeout(timer);unsubscribe();event.payload.status==='finished'?resolve():reject(new Error(id+' '+JSON.stringify(event.payload)));}});});
  const events=ledger.list(id,{limit:500}),text=events.filter(e=>e.type==='bot_output').map(e=>e.payload.text??'').join('\n');
  results[id]={text,textRead:text.includes('ORCHID-317'),imageRead:/blue/i.test(text),toolCalls:events.filter(e=>e.type==='tool_call').length};
  console.log(JSON.stringify({adapter:id,...results[id]}));assert.ok(results[id].textRead&&results[id].imageRead,id+' must read actual text and image');assert.equal(results[id].toolCalls,0);
 }));
 console.log('Real Claude and Codex attachment acceptance passed');
} finally {runner.shutdown();await acp.close();writeFileSync(join(dir,'acceptance.json'),JSON.stringify(results,null,2),{mode:0o600});db.close();}
