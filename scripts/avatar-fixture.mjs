// Owned temporary daemon for public avatar acceptance; no models or external services.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignedWorkDispatch } from './assigned-work-fixture.mjs';
for (const key of Object.keys(process.env)) if (!['PATH','HOME','LANG','TMPDIR'].includes(key)) delete process.env[key];
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const {serve}=require('@hono/node-server');
const {openDb}=await load('db/index'),{createBot,createRoom,addMember,listBots,getBot}=await load('rooms'),{createLedger}=await load('ledger'),{createAuth}=await load('auth'),{createApprovals}=await load('approvals'),{createRunner}=await load('runtimes/runner'),{createGateway,attachStream}=await load('gateway');
const {createAvatarLibrary}=await load('avatars'),{createAvatarTools}=await load('tools/avatars'),{toExecutors}=await load('tools/registry');
const dir=process.argv[2];if(!dir||!realpathSync(dir).startsWith(join(realpathSync(tmpdir()),'openag-avatar-')))throw Error('Owned temporary avatar directory required');
process.once('message',({ownerToken,port=0})=>{
 const db=openDb(dir),ledger=createLedger(db),auth=createAuth({db,ownerToken}),approvals=createApprovals(db,ledger);
 if(!listBots(db).length){
  for(const[id,shape,color]of[['boss','square','blue'],['coder','blob','red'],['researcher','hexagon','teal'],['legacy-circle','circle','yellow'],['legacy-pill','pill','mint'],['legacy-triangle','triangle','violet'],['custom',null,null]])createBot(db,{id,name:id,runtime:'api',config:{instructions:'Owner private instructions',...(shape?{avatar:{shape,color}}:{})}});
  for(const[id,members]of[['main',['boss','coder','researcher']],['dm-coder',['coder']],['_system',['boss']]]){createRoom(db,{id,leadBotId:members[0]});for(const bot of members)addMember(db,id,bot);}
 }
 const avatarLibrary=createAvatarLibrary(db,ledger);
 let release,failSave=false,delaySave=false,delayLists=0,delaySettings=false;
 const runtime={async runTurn(ctx){
  const text=ctx.message.payload.text??'';
  if(ctx.resumed&&ctx.state.pregrant?.toolName==='avatar_library_add'){await ctx.callTool('avatar_library_add',ctx.state.pregrant.args);return;}
  if(text.startsWith('GenerateAvatarAddUnattended:')){await ctx.callTool('avatar_library_add',{previewId:text.split(':')[1]});return;}
  if(text.startsWith('GenerateAvatarAdd:')||text.startsWith('GenerateAvatarForeign:')){await ctx.callTool('avatar_library_add',{previewId:text.split(':')[1]});return;}
  if(/GenerateAvatar|generate.*avatar/i.test(text)){
   const definition={version:1,id:'test-robot-avatar',name:'Test Robot',body:{path:'M25 20H75Q85 20 85 30V75Q85 85 75 85H25Q15 85 15 75V30Q15 20 25 20Z'},eyes:{x:50,y:47,spacing:17,scale:1.1}};
   if(text.includes('Invalid'))definition.body.path='M0 0<script>';
   const preview=await ctx.callTool('avatar_preview',definition);
   if(preview.ok&&!text.includes('PreviewOnly'))await ctx.callTool('avatar_library_add',{previewId:preview.result.previewId});
   return;
  }
  if(text.includes('Failure'))throw Error('Controlled runtime failure.');
  if(text.includes('ACPFailed')||text.includes('ACPUnknown')){
   ledger.append(ctx.room.id,ctx.bot.id,'tool_call',{turnId:ctx.turnId,toolCallId:'native-check',title:'Controlled ACP-shaped update',status:'in_progress'});
   ledger.append(ctx.room.id,ctx.bot.id,'tool_result',{turnId:ctx.turnId,toolCallId:'native-check',title:'Controlled ACP-shaped update',status:text.includes('ACPFailed')?'failed':'completed',executionOutcome:'unknown'});
   return;
  }
  if(text.includes('LateComplete')){
   const message=ledger.append(ctx.room.id,'user','message',{text:'Controlled delayed child'});
   const child=runner.work.begin({roomId:ctx.room.id,botId:ctx.bot.id,messageId:message.id,parentId:ctx.workId});runner.work.updateRun(child.runId,'running');
   setTimeout(()=>runner.work.updateRun(child.runId,'completed'),4200).unref();return;
  }
  if(text.includes('Working'))await new Promise((resolve,reject)=>{release=resolve;ctx.signal.addEventListener('abort',()=>{reject(Error('Controlled wait cancelled'));},{once:true});});
  if(text.includes('Approval'))await ctx.callTool('avatar_check',{});
  ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Controlled avatar activity finished.'});
 }};
 const runner=createRunner({db,ledger,approvals,dataDir:dir,tools:{avatar_check:async()=>({ok:true}),...toExecutors(createAvatarTools(avatarLibrary))},runtimes:{api:runtime}});runner.recover();
 const app=createGateway({db,ledger,auth,approvals,dataDir:dir,deskDir:root+'apps/desk/dist',work:runner.work,cancelWork:runner.cancelWork,dispatch:args=>String(args.message.payload.text).includes('Unattended')?Promise.all(args.botIds.map(id=>runner.run(args.room,getBot(db,id),args.message,undefined,{unattended:true,allowApprovals:true}))):/GenerateAvatar|generate.*avatar/i.test(String(args.message.payload.text))?runner.dispatch(args):assignedWorkDispatch(runner,db)(args)});
 const server=serve({hostname:'127.0.0.1',port,fetch:async req=>{
  if(req.method==='PUT'&&new URL(req.url).pathname.endsWith('/settings')){
   if(delaySave)await new Promise(resolve=>setTimeout(resolve,1200));
   if(failSave)return Response.json({error:'Controlled save refusal'},{status:503});
  }
  const path=new URL(req.url).pathname;
  if(req.method==='GET'&&path==='/work'&&existsSync(join(dir,'slow-work'))){const response=await app.fetch(req);await new Promise(resolve=>setTimeout(resolve,4200));return response;}
  if(req.method==='GET'&&((path==='/bots'&&delayLists>0)||(path.endsWith('/settings')&&delaySettings))){
   if(path==='/bots')delayLists--;
   const response=await app.fetch(req);process.send({type:'captured',path});
   await new Promise(resolve=>setTimeout(resolve,1800));return response;
  }
  return app.fetch(req);
 }});
 let detach=attachStream(server,ledger,auth);
 server.once('listening',()=>process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port}));
 let stopping=false;function stop(){if(stopping)return;stopping=true;runner.shutdown();detach();server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});}
 process.on('message',async message=>{
  if(message.type==='rtc'){const {checkRtc}=await import('./app-library-rtc.mjs');const {setSetting}=await load('settings');const result=await checkRtc({require,load,db,ledger,auth,app,setSetting,checkAvatar:true});process.send({type:'rtc-result',result});}
  if(message.type==='avatar-secret'){const {getDefaultRedactor}=await load('redact');getDefaultRedactor().addSecret(message.value);process.send({type:'avatar-secret-result'});}
  if(message.type==='stop')stop();
  if(message.type==='stale-list')delayLists=message.count??2;
  if(message.type==='delay-settings')delaySettings=message.value;
  if(message.type==='release'){release?.();process.send({type:'release-result'});}
  if(message.type==='fail-save'){failSave=message.value;process.send({type:'fail-save-result'});}
  if(message.type==='delay-save'){delaySave=message.value;process.send({type:'delay-save-result'});}
  if(message.type==='disconnect'){detach();process.send({type:'disconnect-result'});}
  if(message.type==='connect'){detach=attachStream(server,ledger,auth);process.send({type:'connect-result'});}
 });
 process.on('disconnect',stop);process.once('SIGTERM',stop);process.once('SIGINT',stop);
});
