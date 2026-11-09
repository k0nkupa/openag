// Isolated HTTP/runner/browser fixture. Every provider and permission handler is controlled.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
for (const key of Object.keys(process.env)) if (!['PATH','HOME','LANG','TMPDIR'].includes(key)) delete process.env[key];
const root=resolve(import.meta.dirname,'..'), daemon=join(root,'apps/daemon');
const require=createRequire(join(daemon,'package.json')), {serve}=require('@hono/node-server');
const load=name=>import(pathToFileURL(join(daemon,'dist',name+'.js')));
const {openDb}=await load('db/index'),{createAuth}=await load('auth'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createGateway,attachStream}=await load('gateway');
const {createBot,createRoom,addMember,getRoom,getBot}=await load('rooms'),{createRunner}=await load('runtimes/runner'),{createMcpAccess}=await load('mcpserver');
const {createGoogleConnectors}=await load('google-connectors'),{createAppleAccess}=await load('apple-access'),{createMcpManager}=await load('mcp'),{createAppsManager}=await load('apps'),{getSetting,setSetting}=await load('settings');
const {integrationPackage,setupReview}=await load('integration-packages'),{toExecutors}=await load('tools/registry');
const dir=process.argv[2];
if (!dir || !realpathSync(dir).startsWith(join(realpathSync(tmpdir()),'openag-connectors-'))) throw Error('Only an isolated connector fixture directory is supported');
process.once('message',async ({ownerToken,port=0})=>{
  const db=openDb(dir),auth=createAuth({db,ownerToken}),ledger=createLedger(db),approvals=createApprovals(db,ledger);
  createBot(db,{id:'boss',name:'Connector bot',runtime:'api'});
  createRoom(db,{id:'main',leadBotId:'boss'});addMember(db,'main','boss');createRoom(db,{id:'_system',leadBotId:'boss'});
  const audit=(action,fields)=>ledger.append('_system','user','config',{action,...fields});
  let scopes='', reads=0, permissions=0;
  const {createPermissions}=await load('permissions'),sessionPermissions=createPermissions(db,ledger,dir,approvals),initial=sessionPermissions.ensure('boss','main');sessionPermissions.select('boss','main','full-access','controlled-owner',initial.revision);let isolatedReads=false;
  const google=createGoogleConnectors({dataDir:dir,env:{OPENAG_GOOGLE_CLIENT_ID:'fixture',OPENAG_GOOGLE_CLIENT_SECRET:'fixture-secret-9284821',OPENAG_GOOGLE_REDIRECT_URI:'http://127.0.0.1/google-connect',OPENAG_CONNECTOR_KEY:randomBytes(32).toString('hex')},
    audit,
    auth:{url(s,state){scopes=s.join(' ');return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({state});},async exchange(){return {access_token:'fixture-access-9284821',refresh_token:'fixture-refresh-9284821',expiry_date:Date.now()+3600000,scope:scopes};},async refresh(c){return {...c,expiry_date:Date.now()+3600000};},async revoke(){}},
    fetch:async url=>{reads++;const u=new URL(url);if(u.hostname==='openidconnect.googleapis.com')return Response.json({sub:'fixture-person',email:'fixture@example.test',email_verified:true});if(u.pathname.includes('/drive/'))return Response.json({files:[{id:'fixture-file',name:'Fixture document'}]});return Response.json({id:'fixture-message',payload:{mimeType:'text/plain',body:{data:Buffer.from('Controlled email content').toString('base64url')}}});},
  });
  const apps=createAppsManager({dataDir:dir,getEnabled:()=>getSetting(db,'apps').enabled,setEnabled:value=>setSetting(db,'apps',{...getSetting(db,'apps'),enabled:value})});apps.scan();
  const pkg=integrationPackage('apple-apps');
  const {appleInputShapes}=await import(pathToFileURL(join(pkg.sourceDir,'server.mjs')));const {z}=require('zod');const shapes=appleInputShapes(z);
  if(process.platform==='darwin'){
    const review=setupReview(dir,'apple-apps');const setup=spawnSync(process.execPath,[join(daemon,'dist/setup.js'),'install','apple-apps','--data-dir',dir,'--machine',review.machine,'--digest',review.digest,'--config-digest',review.configurationDigest],{encoding:'utf8'});
    if(setup.status!==0)throw Error(setup.stderr);
  }
  const mcp=createMcpManager({dataDir:dir,connector:async ()=>({client:{getServerVersion:()=>({name:'Controlled Apple',version:'1.0.0'}),async listTools(){return {tools:pkg.tools.map(t=>({...t,inputSchema:z.toJSONSchema(z.object(shapes[t.name]).strict())}))};},async callTool({name,arguments:args}){reads++;return {content:[{type:'text',text:'controlled Apple read '+name+' '+JSON.stringify(args)}]};}},async close(){}})});await mcp.load();
  const apple=createAppleAccess({dataDir:dir,mcp,permission:async()=>{permissions++;return 'granted';},audit:(action,app)=>audit(action,{app})});
  const executors=()=>({...toExecutors(google.tools),...mcp.executors()});
  const runner=createRunner({db,ledger,approvals,dataDir:dir,tools:{},dynamicTools:executors,runtimes:{api:{async runTurn(ctx){
    const text=ctx.message.payload.text;
    if(text==='mcp'||text==='mcp-apple'){
      const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
      const {StreamableHTTPClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')));
      const scope=access.issue(ctx.bot.id,ctx.room.id),client=new Client({name:'controlled-acp-boundary',version:'1'});
      try{
        await client.connect(new StreamableHTTPClientTransport(new URL(scope.url('http://127.0.0.1:'+server.address().port)),{requestInit:{headers:{authorization:'Bearer '+scope.token}}}));
        const names=(await client.listTools()).tools.map(t=>t.name);
        if(!names.includes('gmail_read')||names.some(n=>n.includes('send-email')))throw Error('Incorrect scoped MCP tool list');
        const result=await client.callTool(text==='mcp-apple'?{name:'mcp.apple-apps.search-emails',arguments:{query:'needle-through-both-hops',count:2}}:{name:'gmail_read',arguments:{id:'fixture-message'}});
        ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:JSON.stringify(result)});
      }finally{await client.close();access.revoke(ctx.bot.id,ctx.room.id);}
      return;
    }
    const tool=text==='drive-read'?'drive_read':text==='drive'?'drive_search':text==='apple'?'mcp.apple-apps.list-emails':'gmail_read';
    const result=await ctx.callTool(tool,tool==='gmail_read'?{id:'fixture-message'}:tool==='drive_read'?{id:'fixture-file'}:{});
    ledger.append(ctx.room.id,ctx.bot.id,'bot_output',{turnId:ctx.turnId,text:JSON.stringify(result)});
  }}}});
  const access=createMcpAccess({runner,dataDir:dir,tools:()=>[...google.tools,...mcp.toolDefs()]});
  const app=createGateway({db,ledger,approvals,auth,dataDir:dir,deskDir:join(root,'apps/desk/dist'),google,apple,mcp,apps,mcpAccess:access,dispatch:(room,bot,message)=>runner.run(room,bot,message,undefined,{isolated:isolatedReads}),work:runner.work,cancelWork:runner.cancelWork});
  const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port});const detach=attachStream(server,ledger,auth);
  server.once('listening',()=>process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port}));
  let stopping=false;
  async function stop(){if(stopping)return;stopping=true;runner.shutdown();detach();google.close();access.revokeAll();await mcp.close();server.closeAllConnections();server.close(()=>{db.close();process.exit(0);});}
  process.on('SIGTERM',stop);
  process.on('message',async message=>{
    if(message.type==='offline'){const msg=ledger.append('main','user','message',{text:message.service});await runner.run(getRoom(db,'main'),getBot(db,'boss'),msg,undefined,{noNetwork:true,unattended:true,allowApprovals:true});process.send({type:'offline-result'});}
    if(message.type==='counts')process.send({type:'counts-result',reads,permissions});
    if(message.type==='policy'){isolatedReads=message.mode==='deny';process.send({type:'policy-result'});}
    if(message.type==='stop')void stop();
  });
});
