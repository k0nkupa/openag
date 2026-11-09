// Owned temporary acceptance target: real gateway, policy, storage and runner; controlled providers.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
for (const key of Object.keys(process.env)) if (!['PATH','HOME','LANG','TMPDIR'].includes(key)) delete process.env[key];
process.env.OPENAG_OLLAMA_URL = 'http://127.0.0.1:1';
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(root+'apps/daemon/package.json'), load = p => import(root+'apps/daemon/dist/'+p+'.js');
const { serve } = require('@hono/node-server');
const { openDb } = await load('db/index'), { createLedger } = await load('ledger'), { createAuth } = await load('auth'), { createApprovals } = await load('approvals'), { createBot,createRoom,addMember,listBots } = await load('rooms'), { createRunner } = await load('runtimes/runner'), { createGateway,attachStream } = await load('gateway'), { createResults } = await load('results'), { createResultTool } = await load('tools/results'), { toExecutors } = await load('tools/registry'), { defaultTools } = await load('tools/index'), { createScheduler } = await load('scheduler'), { createAutomationManager } = await load('automations'), { createWakeFilter } = await load('wake'), { registerReflection } = await load('reflection'), { createRoomRouter } = await load('router'), { createAppsManager } = await load('apps'), { createMcpManager } = await load('mcp'), { getSetting,setSetting } = await load('settings');
const dir=process.argv[2];
if (!dir || !realpathSync(dir).startsWith(join(realpathSync(tmpdir()),'openag-settings-'))) throw Error('Owned temporary Settings directory required');
process.once('message', async ({ownerToken,port=0}) => {
 const db=openDb(dir),ledger=createLedger(db),auth=createAuth({db,ownerToken}),approvals=createApprovals(db,ledger),results=createResults(db,ledger);
 if (!listBots(db).length) {
  for (const id of ['boss','coder']) createBot(db,{id,name:id==='boss'?'Boss':'Coder',runtime:'api',config:{instructions:'Private temporary instructions',description:'Controlled acceptance agent'}});
  for (const id of ['main','_system']) { createRoom(db,{id,leadBotId:'boss'}); for (const bot of ['boss','coder']) addMember(db,id,bot); }
 }
 const apps=createAppsManager({dataDir:dir,env:process.env,getEnabled:()=>getSetting(db,'apps').enabled,setEnabled:enabled=>setSetting(db,'apps',{...getSetting(db,'apps'),enabled}),getPaused:()=>getSetting(db,'apps').paused,setPaused:paused=>setSetting(db,'apps',{...getSetting(db,'apps'),paused})});apps.scan();
 const mcp=createMcpManager({dataDir:dir,env:process.env});await mcp.load();
 const runtime={async runTurn(ctx) {
  const text=ctx.message.payload.text??'';
  if (text.includes('JOINED')) { if (!ctx.resumed) await ctx.callTool('save_result',{name:'oa330-proposal.md',kind:'draft',content:'Proposed exact local action. Review before writing.'}); await ctx.callTool('write_file',{path:'oa330-check.txt',content:'Exact reviewed temporary action'}); await ctx.callTool('app_hello_time',{}); }
  ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:'Controlled flow finished for '+ctx.bot.id});
 }};
 const runner=createRunner({db,ledger,approvals,dataDir:dir,tools:{...defaultTools,...toExecutors([createResultTool(results)])},dynamicTools:()=>({...apps.executors(),...mcp.executors()}),runtimes:{api:runtime}});runner.recover();
 const scheduler=createScheduler({tickMs:1000}),wake=createWakeFilter({db,ledger,tz:'Pacific/Auckland'}),automations=createAutomationManager({db,ledger,runner,scheduler,wake,tz:'Pacific/Auckland',fetch:async()=>new Response(null,{status:304})});automations.sync();
 const reflection=registerReflection({db,ledger,approvals,runner,scheduler,tz:'Pacific/Auckland',dataDir:dir,skillsEnabled:true});
 const env={};let routerCalls=0;
 const router=createRoomRouter({db,env,fetch:async()=>{routerCalls++;return new Response('Controlled provider unavailable',{status:503});}});
 const app=createGateway({db,ledger,auth,approvals,dataDir:dir,deskDir:root+'apps/desk/dist',dispatch:runner.dispatch,work:runner.work,cancelWork:runner.cancelWork,automations,reflection,router,apps,mcp});
 const counts={};let savingMode='normal';
 const server=serve({hostname:'127.0.0.1',port,fetch:async req=>{
  const path=new URL(req.url).pathname;
  if(req.method==='GET'&&path==='/router'&&existsSync(join(dir,'slow-router'))) { const end=Date.now()+15000; while(existsSync(join(dir,'slow-router'))&&Date.now()<end)await new Promise(r=>setTimeout(r,30)); }
  if (existsSync(join(dir,'router-config'))) env.OPENROUTER_API_KEY='synthetic-unusable-key';
  if (existsSync(join(dir,'router-unavailable'))) delete env.OPENROUTER_API_KEY;
  if(req.method==='PUT'&&path.endsWith('/router')&&existsSync(join(dir,'delay-router'))) await new Promise(r=>setTimeout(r,1800));
  counts[req.method+' '+path]=(counts[req.method+' '+path]??0)+1;
  const save=req.method==='PUT'&&(path.startsWith('/settings/')||path.endsWith('/settings')||path.endsWith('/memory'));
  const mode=existsSync(join(dir,'refuse-save'))?'refuse':existsSync(join(dir,'lost-save'))?'lost':existsSync(join(dir,'delay-save'))?'delay':savingMode;
  if(save&&mode==='refuse')return Response.json({error:'Controlled save refusal'},{status:503});
  if(save&&mode==='delay')await new Promise(r=>setTimeout(r,1800));
  const response=await app.fetch(req);
  if(req.method==='PUT'&&path.endsWith('/settings')&&existsSync(join(dir,'concurrent-bot-edit'))) {
   await app.fetch(new Request(req.url,{method:'PUT',headers:{authorization:'Bearer '+ownerToken,'content-type':'application/json'},body:JSON.stringify({instructions:'Concurrent owner value'})}));
  }
  if(req.method==='GET'&&path==='/approvals'&&existsSync(join(dir,'slow-proposals'))) {
   process.send({type:'captured-proposals'});
   const end=Date.now()+15000;while(existsSync(join(dir,'slow-proposals'))&&Date.now()<end)await new Promise(r=>setTimeout(r,30));
   await new Promise(r=>setTimeout(r,1800));
  }
  if(save&&mode==='lost')return Response.json({error:'Controlled response lost after persistence'},{status:503});
  return response;
 }});
 let detach=attachStream(server,ledger,auth),stopping=false;
 server.once('listening',()=>process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port}));
 async function stop(){if(stopping)return;stopping=true;scheduler.stop();automations.shutdown();runner.shutdown();detach();await mcp.close();server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});}
 process.on('message',async message=>{
  if(message.type==='stop')return stop();
  if(message.type==='mode')savingMode=message.value;
  if(message.type==='router-config'){if(message.enabled)env.OPENROUTER_API_KEY='synthetic-unusable-key';else delete env.OPENROUTER_API_KEY;}
  if(message.type==='disconnect')detach();
  if(message.type==='connect')detach=attachStream(server,ledger,auth);
  if(message.type==='proposal'){const a=approvals.request({roomId:'main',botId:'boss',toolName:'reflection_memory',toolClass:'act-local',payload:{bot_id:'boss',text:'Controlled pending proposal'}});process.send({type:'proposal-result',id:a.approvalId});return;}
  if(message.type==='stats')process.send({type:'stats-result',counts,routerCalls});
  else process.send({type:message.type+'-result'});
 });
 process.on('disconnect',stop);process.once('SIGTERM',stop);process.once('SIGINT',stop);
});
