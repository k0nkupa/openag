// Real local WebRTC data channel, in-memory signaling only; no STUN/TURN or provider network.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
export async function checkRtc({require,load,db,ledger,auth,app,setSetting,checkAvatar=false,provenanceTurnId}) {
 const {RTCPeerConnection}=require('werift'),{createRtcService,newRtcTopic,offerMac,sdpFingerprint}=await load('rtc');
 let deliver;const answers=new Map(),device=auth.createDevice('RTC fixture','owner','limited'),key=createHash('sha256').update(device.token).digest('hex');
 setSetting(db,'rtc',{enabled:true,server:'https://ntfy.sh',topic:newRtcTopic(),stun:[]});
 const service=createRtcService({db,ledger,auth,fetch:r=>Promise.resolve(app.fetch(r)),signaling:()=>({subscribe(callback){deliver=callback;return()=>{};},async publish(id,text){answers.set(id,text);}})}),pc=new RTCPeerConnection({iceServers:[]});
 const timeout=(promise,label)=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error(label)),10000);timer.unref();})]);
 try {
  service.reload();const channel=pc.createDataChannel('openag-api');await pc.setLocalDescription(await pc.createOffer());
  await timeout(new Promise(resolve=>pc.iceGatheringState==='complete'?resolve():pc.iceGatheringStateChange.subscribe(s=>s==='complete'&&resolve())),'ICE deadline');
  const sdp=pc.localDescription.sdp,id=randomBytes(10).toString('hex'),ts=Date.now();
  deliver(JSON.stringify({v:1,t:'offer',id,ts,sdp,auth:{kind:'device',device:device.device.id,mac:offerMac(key,{id,ts,fingerprint:sdpFingerprint(sdp),kind:'device',device:device.device.id})}}));
  await timeout(new Promise(resolve=>{const timer=setInterval(()=>{if(answers.has(id)){clearInterval(timer);resolve();}},20);timer.unref();}),'answer deadline');
  const answer=JSON.parse(answers.get(id));assert.equal(answer.mac,offerMac(key,{id,ts,fingerprint:sdpFingerprint(answer.sdp),kind:'answer',device:device.device.id}));await pc.setRemoteDescription({type:'answer',sdp:answer.sdp});
  await timeout(new Promise(resolve=>channel.readyState==='open'?resolve():channel.stateChanged.subscribe(s=>s==='open'&&resolve())),'channel deadline');
  const waiting=new Map(),events=[];let onEvent;channel.onMessage.subscribe(bytes=>{const frame=JSON.parse(String(bytes));if(frame.type==='event'){events.push(frame.event);onEvent?.(frame.event);return;}const pending=waiting.get(frame.id);if(!pending)return;pending.chunks[frame.seq]=frame.body;if(frame.last){waiting.delete(frame.id);pending.resolve({status:frame.status,body:pending.chunks.join('')});}});
  const request=(method,path,type='request')=>timeout(new Promise(resolve=>{const fid=randomBytes(6).toString('hex');waiting.set(fid,{resolve,chunks:[]});channel.send(JSON.stringify({id:fid,type,method,path,headers:{authorization:'Bearer '+device.token}}));}),'request deadline');
  if(provenanceTurnId){
   assert.equal((await request(undefined,undefined,'subscribe')).status,200);
   const notice=timeout(new Promise(resolve=>{onEvent=event=>{if(event.payload?.manifestId==='rtc-private')resolve(event);};}),'provenance event deadline');
   ledger.append('main','bot','request_attempt',{turnId:provenanceTurnId,manifestId:'rtc-private',attempt:1,status:'returned',private:'PRIVATE_RTC_PROVENANCE'});
   const event=await notice;assert.deepEqual(event.payload,{turnId:provenanceTurnId,manifestId:'rtc-private'});
   assert.ok(!JSON.stringify(events).includes('PRIVATE_RTC_PROVENANCE'));
   const path='/turns/'+provenanceTurnId+'/request-manifests';
   assert.equal((await request('GET',path)).status,403);
   auth.setDeviceAccess(device.device.id,'full');
   const full=await request('GET',path);assert.equal(full.status,200);assert.ok(JSON.parse(full.body).records.length);
   assert.equal((await request('POST',path)).status,403);assert.equal((await request('GET','/settings')).status,403);
   return {limited:403,full:200,safeRefresh:true};
  }
  const avatarLibrary=await request('GET','/avatars');assert.equal(avatarLibrary.status,200);assert.ok(Array.isArray(JSON.parse(avatarLibrary.body).avatars));assert.equal((await request('POST','/avatars')).status,403);
  const inventory=await request('GET','/app-library');assert.equal(inventory.status,200);assert.ok(JSON.parse(inventory.body).entries.length);
  for(const [method,path] of [['POST','/app-library'],['POST','/mcp/reload'],['POST','/apps/reload'],['POST','/apps/hello/enable']])assert.equal((await request(method,path)).status,403);
  if(checkAvatar){
   assert.equal((await request(undefined,undefined,'subscribe')).status,200);
   const notice=timeout(new Promise(resolve=>{onEvent=event=>{if(event.payload?.action==='bot_settings'&&event.payload.botId==='coder')resolve(event);};}),'avatar event deadline');
   ledger.append('_system','daemon','config',{action:'private-fixture',value:'private-rtc-avatar-marker'});
   const saved=await app.request('/bots/coder/settings',{method:'PUT',headers:{authorization:'Bearer '+device.token,'content-type':'application/json'},body:JSON.stringify({avatar:{shape:'star',color:'purple',animated:false}})});assert.equal(saved.status,200);
   const event=await notice;assert.equal(event.roomId,'');assert.equal(event.actor,'daemon');assert.deepEqual(event.payload,{action:'bot_settings',botId:'coder'});assert.ok(!JSON.stringify(events).includes('private-rtc-avatar-marker'));assert.ok(!JSON.stringify(event).includes('instructions'));
   const bots=await request('GET','/bots');assert.equal(bots.status,200);assert.deepEqual(JSON.parse(bots.body).bots.find(b=>b.id==='coder').avatar,{shape:'star',color:'purple',animated:false});
  }
  return {read:200,avatarRefresh:checkAvatar||undefined,management:403,answerAuthenticated:true,responseChars:inventory.body.length};
 } finally {service.stop();await pc.close();setSetting(db,'rtc',{enabled:false});}
}
