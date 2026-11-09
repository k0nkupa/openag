// Standalone public HTTP/stream/runner assertions. No unit runner or live account.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),{WebSocket}=require('ws');
const dir=mkdtempSync(join(tmpdir(),'openag-avatar-')),ownerToken=randomBytes(32).toString('hex');let child,base,ws;
async function start(){child=fork(root+'scripts/avatar-fixture.mjs',[dir],{stdio:['ignore','ignore','inherit','ipc']});const ready=once(child,'message');child.send({ownerToken,port:0});base=(await ready)[0].url;}
async function stop(){if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
const req=(path,{method='GET',body,token=ownerToken}={})=>fetch(base+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
async function json(path,opts){const res=await req(path,opts);assert.ok(res.ok,path+' '+res.status);return res.json();}
const put=(avatar,token)=>json('/bots/coder/settings',{method:'PUT',body:{avatar},token});
async function until(read,check){const end=Date.now()+10000;do{const value=await read();if(check(value))return value;await new Promise(r=>setTimeout(r,25));}while(Date.now()<end);throw Error('Acceptance deadline exceeded');}
try{
 await start();const initial=(await json('/bots')).bots;
 assert.deepEqual(initial.find(b=>b.id==='legacy-circle').avatar,{shape:'circle',color:'yellow'});
 assert.deepEqual(initial.find(b=>b.id==='legacy-pill').avatar,{shape:'pill',color:'mint'});
 assert.deepEqual(initial.find(b=>b.id==='legacy-triangle').avatar,{shape:'triangle',color:'violet'});
 assert.ok(!JSON.stringify(initial).includes('Owner private instructions'));
 const limited=(await json('/devices',{method:'POST',body:{name:'Avatar limited'}})).token,full=(await json('/devices',{method:'POST',body:{name:'Avatar full',access:'full'}})).token;
 assert.equal((await req('/bots/coder/settings',{token:limited})).status,403);
 assert.equal((await req('/bots',{token:null})).status,401);
 ws=new WebSocket(base.replace('http','ws')+'/stream?token='+limited);await once(ws,'open');const events=[];ws.on('message',data=>events.push(JSON.parse(data)));
 const shapes=['blob','circle','square','pill','triangle','hexagon','star','pebble','cloud','droplet','controller','mug','sprout','chat','barbell','lightbulb','watering-can','book','compass','robot','rocket','telescope'];
 const colors=['red','orange','yellow','green','mint','teal','blue','violet','pink','amber','purple','brown','grey','white'];
 for(const shape of shapes)assert.deepEqual((await put({shape,color:'red',animated:false},limited)).bot.avatar,{shape,color:'red',animated:false});
 for(const color of colors)assert.deepEqual((await put({shape:'star',color,animated:true},full)).bot.avatar,{shape:'star',color,animated:true});
 for(const avatar of [{shape:'bad',color:'red'},{shape:'star',color:'#fff'},{shape:'star',color:'red',animated:'false'},{shape:'star',color:null,animated:null},[],{},'star'])assert.equal((await req('/bots/coder/settings',{method:'PUT',body:{avatar}})).status,400);
 for(const body of [{name:'Changed'},{instructions:'Changed'},{description:'Changed'},{avatar:{shape:'mug',color:null,animated:false},name:'Changed'}])assert.equal((await req('/bots/coder/settings',{method:'PUT',body,token:limited})).status,403);
 assert.equal((await json('/bots/coder/settings')).instructions,'Owner private instructions');
 await put({shape:'sprout',color:null,animated:false},limited);await until(()=>Promise.resolve(events),xs=>xs.some(e=>e.type==='config'&&e.payload.action==='bot_settings'));
 const audit=events.filter(e=>e.type==='config'&&e.payload.action==='bot_settings');assert.ok(audit.every(e=>Object.keys(e.payload).sort().join(',')==='action,botId,fields'));assert.ok(!JSON.stringify(events).includes('Owner private instructions'));
 ws.close();ws=undefined;await stop();await start();assert.deepEqual((await json('/bots/coder/settings')).avatar,{shape:'sprout',color:null,animated:false});
 await put(null,limited);assert.equal((await json('/bots/coder/settings')).avatar,null);assert.ok(!('avatar'in(await json('/bots')).bots.find(b=>b.id==='coder')));
 // Real runner lifecycle supplies the browser's expressions; no synthetic UI state.
 await req('/rooms/dm-coder/messages',{method:'POST',body:{text:'Approval'}});const pending=await until(()=>json('/approvals?status=pending'),r=>r.approvals.length);const a=pending.approvals[0];
 assert.ok((await json('/rooms/dm-coder/events')).events.some(e=>e.type==='turn_started'));
 await json('/approvals/'+a.id,{method:'POST',body:{kind:'ignore',reviewVersion:a.reviewVersion}});
 await until(()=>json('/rooms/dm-coder/events'),r=>r.events.some(e=>e.type==='turn_finished'));
 assert.ok((await json('/rooms/dm-coder/events')).events.some(e=>e.type==='work_updated'&&e.payload.previousStatus==='needs_approval'));
 const before=(await json('/rooms/dm-coder/events')).events.length;
 await req('/rooms/dm-coder/messages',{method:'POST',body:{text:'Failure'}});await until(()=>json('/rooms/dm-coder/events'),r=>r.events.slice(before).some(e=>e.type==='turn_finished'&&e.payload.status==='failed'));
 for(const text of ['ACPFailed','ACPUnknown']){
  const prior=(await json('/rooms/dm-coder/events')).events.at(-1).id;
  await req('/rooms/dm-coder/messages',{method:'POST',body:{text}});
  await until(()=>json('/rooms/dm-coder/events'),r=>r.events.some(e=>e.id>prior&&e.type==='work_updated'&&['failed','interrupted'].includes(e.payload.status)));
 }
 const rtcResult=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('RTC deadline')),20000);const receive=message=>{if(message.type==='rtc-result'){clearTimeout(timer);child.off('message',receive);resolve(message.result);}};child.on('message',receive);});child.send({type:'rtc'});assert.equal((await rtcResult).avatarRefresh,true);
 const lateStarted=Date.now();await req('/rooms/dm-coder/messages',{method:'POST',body:{text:'LateComplete'}});
 await until(()=>json('/work?q=LateComplete'),r=>r.work.some(w=>w.parentId===null&&w.status==='completed'));assert.ok(Date.now()-lateStarted>=3500);
 const transitions=(await json('/rooms/dm-coder/events')).events.filter(e=>e.type==='work_updated'&&e.payload.status==='completed');assert.ok(transitions.some(e=>e.payload.previousStatus==='working'));
 assert.ok(transitions.every(e=>e.payload.previousStatus!=='completed'));
 await req('/rooms/dm-coder/messages',{method:'POST',body:{text:'Working'}});
 await until(()=>json('/work?status=working'),r=>r.work.length);
 await stop();await start();assert.equal((await json('/work?status=working')).work.length,0);assert.ok((await json('/work?status=interrupted')).work.length);
 mkdirSync(root+'docs/notes/avatars',{recursive:true});writeFileSync(root+'docs/notes/avatars/http.json',JSON.stringify({result:'passed',checks:['legacy shapes/colours and absent animation retained','12 characters, legacy inputs and 14 colours','automatic colour/motion/reset roundtrip','invalid input rejected','owner/full/limited permissions and mixed-patch refusal','instruction privacy and sanitized stream audit','saved appearance after actual temporary restart','real runner approval/completion/failure and ACP-shaped failed/unknown outcomes','actual process restart settles interrupted Work','deferred child Work settles after more than three seconds','real local WebRTC avatar refresh notice, hidden-audit privacy and management refusal']},null,2)+'\n');
 console.log('Avatar public HTTP/stream/runner acceptance passed.');
 if(process.argv.includes('--keep')){
  writeFileSync('/tmp/oa329-browser-target.json',JSON.stringify({base,token:full,limited,dir}),{mode:0o600});console.log('Temporary avatar fixture ready at '+base);
  process.stdin.on('data',data=>{try{child.send(JSON.parse(data.toString()));}catch{console.error('Expected fixture JSON command');}});
  await new Promise(resolve=>process.once('SIGTERM',resolve));
 }
}finally{ws?.close();await stop();}
