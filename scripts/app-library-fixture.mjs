// Disposable public HTTP/runner acceptance target. No real provider or credentials.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {realpathSync,cpSync,mkdirSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
for(const key of Object.keys(process.env))if(!['PATH','HOME','LANG','TMPDIR'].includes(key))delete process.env[key];
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const {serve}=require('@hono/node-server');
const {openDb}=await load('db/index'),{createAuth}=await load('auth'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createGateway,attachStream}=await load('gateway'),{createAppsManager}=await load('apps'),{createMcpManager,defaultConnector}=await load('mcp'),{getSetting,setSetting}=await load('settings'),{createBot,createRoom,addMember,listBots}=await load('rooms'),{createRunner}=await load('runtimes/runner'),{getDefaultRedactor}=await load('redact');
const dir=process.argv[2];
if(!dir||!realpathSync(dir).startsWith(join(realpathSync(tmpdir()),'openag-library-')))throw Error('Only an owned temporary fixture directory is supported');
process.once('message',async({ownerToken,port=0})=>{
 const db=openDb(dir),ledger=createLedger(db),auth=createAuth({db,ownerToken}),approvals=createApprovals(db,ledger);
 getDefaultRedactor().addSecret('library-synthetic-secret-48963');
 if(!listBots(db).length){createBot(db,{id:'boss',name:'Boss',runtime:'api',config:{}});for(const id of ['main','_system']){createRoom(db,{id,leadBotId:'boss'});if(id==='main')addMember(db,id,'boss');}}
 const {createPermissions}=await load('permissions'),permissionService=createPermissions(db,ledger,dir,approvals),initial=permissionService.ensure('boss','main');if(initial.preset!=='full-access')permissionService.select('boss','main','full-access','controlled-owner',initial.revision);
 const env={...process.env,COMPOSIO_API_KEY:undefined};let connections=0,calls=0,hold=false,release; const clients=new Map();let originalCode,largeTools=false;
 const apps=createAppsManager({dataDir:dir,env,onChange:()=>ledger.append('_system','daemon','config',{action:'apps_status_changed'}),getEnabled:()=>getSetting(db,'apps').enabled,setEnabled:enabled=>setSetting(db,'apps',{...getSetting(db,'apps'),enabled}),getPaused:()=>getSetting(db,'apps').paused,setPaused:paused=>setSetting(db,'apps',{...getSetting(db,'apps'),paused})});apps.scan();
 const mcp=createMcpManager({dataDir:dir,env,onChange:()=>ledger.append('_system','daemon','config',{action:'mcp_status_changed'}),connector:async cfg=>{
  connections++;if(cfg.id==='local-reference')return defaultConnector(cfg);if(hold)await new Promise(resolve=>release=resolve);
  if(cfg.id==='broken')throw Error('synthetic unreachable provider');
  const client={getServerVersion:()=>({name:'Synthetic MCP',version:'2.0.0'}),listTools:async()=>({tools:largeTools?Array.from({length:200},(_,i)=>({name:'tool_'+i+'x'.repeat(55),description:'Untrusted description '.repeat(20),inputSchema:{type:'object',properties:{},additionalProperties:false}})):[{name:'clock',description:'<img src=x onerror=alert(1)> library-synthetic-secret-48963',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}),callTool:async()=>{calls++;return {content:[{type:'text',text:'Controlled MCP clock'}]};}};clients.set(cfg.id,client);return {client,close:async()=>{}};
 }});await mcp.load();
 const runner=createRunner({db,ledger,approvals,dataDir:dir,tools:{},dynamicTools:()=>({...apps.executors(),...mcp.executors()}),runtimes:{api:{async runTurn(ctx){const tool=ctx.message.payload.text==='reference'?'mcp.local-reference.clock':ctx.message.payload.text==='mcp'?'mcp.hello.clock':'app_hello_time';const result=await ctx.callTool(tool,{});ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:JSON.stringify(result)});}}}});
 // Controlled account managers exercise real gateway access and desk flows without provider traffic.
 let accounts=false,googleAccount=true,composioAccount=true,googleWrites=0,composioDisconnects=0;
 const services=[{id:'gmail',enabled:true,state:'connected',verifiedAt:null},{id:'drive',enabled:true,state:'connected',verifiedAt:null}];
 const accountChanged=action=>ledger.append('_system','daemon','config',{action});
 const google={tools:[],status:()=>({configured:accounts,reason:accounts?null:'Controlled Google setup unavailable',account:accounts&&googleAccount?{email:'controlled@example.invalid'}:null,services:services.map(service=>({...service,state:accounts&&googleAccount?service.state:'setup'}))}),pause(id,enabled){googleWrites++;const service=services.find(service=>service.id===id);service.enabled=enabled;service.state=enabled?'connected':'paused';accountChanged('google_changed');},async verify(id){googleWrites++;services.find(service=>service.id===id).verifiedAt=Date.now();accountChanged('google_verified');return {verified:true};},async disconnect(){googleWrites++;googleAccount=false;for(const service of services){service.verifiedAt=null;service.enabled=false;service.state='needs_access';}accountChanged('google_disconnected');return {revoked:true};},start(){throw Error('Real provider sign-in is excluded from this controlled fixture');}};
 const composio={status:()=>({configured:accounts,hasAccount:accounts&&composioAccount,state:accounts&&composioAccount?'connected':accounts?'needs_access':'setup',reason:accounts?null:'Controlled Composio setup unavailable'}),async disconnect(){composioDisconnects++;composioAccount=false;accountChanged('composio_disconnected');return {disconnected:true,revoked:false};},start(){throw Error('Real provider sign-in is excluded from this controlled fixture');},revokeDevice(){}};
 const app=createGateway({db,ledger,auth,approvals,apps,mcp,google,composio,dataDir:dir,deskDir:root+'apps/desk/dist',dispatch:runner.dispatch,work:runner.work,cancelWork:runner.cancelWork});
 let failInventory=false,failAccounts=false;
 const server=serve({fetch:request=>{const path=new URL(request.url).pathname;if(request.method==='GET'&&(failInventory&&path==='/app-library'||failAccounts&&['/connectors','/connectors/composio'].includes(path)))return Response.json({error:'Controlled status read unavailable'},{status:503});return app.fetch(request);},hostname:'127.0.0.1',port});let detach=attachStream(server,ledger,auth),stopping=false;
 server.once('listening',()=>process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port}));
 async function stop(){if(stopping)return;stopping=true;runner.shutdown();detach();await mcp.close();server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});}
 process.on('SIGTERM',stop);
 process.on('message',async msg=>{try{
  if(msg.type==='fail-inventory')failInventory=true;
  if(msg.type==='restore-inventory')failInventory=false;
  if(msg.type==='fail-accounts')failAccounts=true;
  if(msg.type==='restore-accounts')failAccounts=false;
  if(msg.type==='accounts'){accounts=true;googleAccount=true;composioAccount=true;for(const service of services){service.enabled=true;service.state='connected';service.verifiedAt=null;}accountChanged('google_changed');}
  if(msg.type==='large-tools')largeTools=true;
  if(msg.type==='crash-mcp')clients.get('hello')?.onclose?.();
  if(msg.type==='rtc'){const {checkRtc}=await import('./app-library-rtc.mjs');const rtc=await checkRtc({require,load,db,ledger,auth,app,setSetting});process.send({type:'rtc-result',rtc});return;}
  if(msg.type==='install'){
   mkdirSync(join(dir,'apps'),{recursive:true});for(const id of ['hello','composio'])cpSync(join(root,'examples/apps',id),join(dir,'apps',id),{recursive:true});
   for(const [id,command] of [['custom','python3'],['missing','bash']]){const folder=join(dir,'apps',id);mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'main.py'),'# inert fixture\n');writeFileSync(join(folder,'manifest.json'),JSON.stringify({id,name:id==='custom'?'Hello (example app)':'Missing runtime',version:'0.1.0',description:'<b>Untrusted custom metadata</b>',tools:[{name:'check',description:'Inert fixture',class:'read',input:{type:'object',properties:{}},exec:{argv:[command,'main.py','https://private.example/unrecognised-literal']}}]}));}
  }
  if(msg.type==='config'){writeFileSync(join(dir,'mcp.json'),typeof msg.config==='string'?msg.config:JSON.stringify(msg.config),{mode:0o600});chmodSync(join(dir,'mcp.json'),msg.mode??0o600);}
  if(msg.type==='change-code'){originalCode=readFileSync(join(dir,'apps/hello/tool.mjs'),'utf8');writeFileSync(join(dir,'apps/hello/tool.mjs'),originalCode+'\n// changed after review\n');}
  if(msg.type==='restore-code')writeFileSync(join(dir,'apps/hello/tool.mjs'),originalCode);
  if(msg.type==='relative-runtime'){const folder=join(dir,'apps/hello',msg.entry);mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'node'),"#!/bin/sh\nprintf '%s' '{\"fixture\":\"relative PATH\"}'\n",{mode:0o700});env.PATH=msg.entry;}
  if(msg.type==='missing-runtime')env.PATH=join(dir,'empty-bin');
  if(msg.type==='restore-runtime')env.PATH=process.env.PATH;
  if(msg.type==='hold')hold=true;
  if(msg.type==='release'){hold=false;release?.();}
  if(msg.type==='disconnect'){detach();}
  if(msg.type==='reconnect')detach=attachStream(server,ledger,auth);
  process.send({type:msg.type+'-result',connections,calls,googleWrites,composioDisconnects});
 }catch(error){process.send({type:msg.type+'-result',error:error.message});}});
});
