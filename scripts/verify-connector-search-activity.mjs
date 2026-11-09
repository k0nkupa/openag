// Disposable real gateway/MCP/ACP journey. No installed daemon or business-provider invocation.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const cataloguePath=process.argv[process.argv.indexOf('--catalogue')+1];
assert.ok(process.argv.includes('--catalogue'),'Supply the catalogue exported by Bivouac verify-mcp-input-schemas.cjs');
assert.ok(process.argv.includes('--real'),'Use --real for both bounded real subscription adapters');
const {z}=require('zod'),{serve}=require('@hono/node-server');
const {ListToolsResultSchema}=await import(require.resolve('@modelcontextprotocol/sdk/types.js'));
const catalogue=ListToolsResultSchema.parse(JSON.parse(readFileSync(cataloguePath,'utf8')));
const history=catalogue.tools.find(tool=>tool.name==='bivouac_list_product_sync_history');assert.ok(history);
const {createMcpManager}=await load('mcp'),{createMcpAccess}=await load('mcpserver');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals');
const {createAuth}=await load('auth'),{createGateway}=await load('gateway'),{createPermissions}=await load('permissions');
const {createBot,createRoom,addMember}=await load('rooms'),{createRunner}=await load('runtimes/runner'),{createAcpRuntime}=await load('runtimes/acp');
const {commandTool}=await load('tools/execution'),{executeCommand}=await load('execution'),{toExecutors}=await load('tools/registry');
const directory=mkdtempSync(join(tmpdir(),'openag-search-activity-'));console.log('Disposable evidence: '+directory);
const marker='BIVOUAC_SCHEMA_FLOW',search='SHELL_SEARCH_FLOW';
const emptyPath=process.env.PATH;process.env.PATH='/usr/bin:/bin';
try{
 const workspace=join(directory,'search');mkdirSync(workspace);writeFileSync(join(workspace,'connector.txt'),search);
 for(const mode of ['read-only','workspace-write','danger-full-access']){
  const result=await executeCommand({mode,workspace},'rg -n --fixed-strings '+search+' connector.txt');
  assert.equal(result.exitCode,0,result.stderr);assert.ok(result.stdout.includes(search));assert.equal(result.timedOut,false);
 }
 console.log('PASS bundled rg with minimal service PATH in all three filesystem modes');
}finally{process.env.PATH=emptyPath;}
for(const adapter of ['claude','codex']){
 const dataDir=join(directory,adapter),db=openDb(dataDir),ledger=createLedger(db),approvals=createApprovals(db,ledger),token=randomUUID();
 const permissions=createPermissions(db,ledger,dataDir,approvals),calls=[];
 const remote=serve({hostname:'127.0.0.1',port:0,fetch:async request=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  const body=await request.json();
  const reply=result=>Response.json({jsonrpc:'2.0',id:body.id,result});
  if(body.method==='initialize')return reply({protocolVersion:body.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'bivouac-schema-fixture',version:'1'}});
  if(body.method==='tools/list')return reply({tools:[history]});
  if(body.method==='tools/call'){
   assert.equal(body.params.name,history.name);assert.ok(z.fromJSONSchema(history.inputSchema).safeParse(body.params.arguments).success);
   assert.deepEqual(body.params.arguments,z.fromJSONSchema(history.inputSchema).parse({scope:'global'}));calls.push(body.params);
   return reply({content:[{type:'text',text:marker}],structuredContent:{marker}});
  }
  return new Response(null,{status:202});
 }});
 if(!remote.listening)await new Promise(resolve=>remote.once('listening',resolve));
 writeFileSync(join(dataDir,'mcp.json'),JSON.stringify({servers:[{id:'bivouac-fixture',transport:'http',url:'http://127.0.0.1:'+remote.address().port,toolClasses:{[history.name]:'read'}}]}),{mode:0o600});
 const mcp=createMcpManager({dataDir,env:{}});await mcp.load();assert.equal(mcp.status()[0].state,'connected');
 const workspace=join(dataDir,'bots','bot','work');mkdirSync(workspace,{recursive:true});writeFileSync(join(workspace,'connector.txt'),search);
 const command='rg -n --fixed-strings '+search+' connector.txt';let shellCalls=0,runner,base;
 const shell={...commandTool,execute:async(ctx,args)=>{assert.equal(args.command,command);assert.ok(!args.escalation);shellCalls++;return commandTool.execute(ctx,args);}};
 const defs=[shell,...mcp.toolDefs()];
 const access=createMcpAccess({dataDir,runner:{activeTurn:(...args)=>runner.activeTurn(...args)},tools:()=>defs});
 const acp=createAcpRuntime({dataDir,mcp:{access,baseUrl:()=>base,tools:new Set(defs.map(def=>def.name))}});
 const bot=createBot(db,{id:'bot',runtime:'acp',config:{adapter}});createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
 runner=createRunner({db,ledger,approvals,dataDir,permissions,runtimes:{acp},tools:toExecutors(defs)});
 const runs=[];const app=createGateway({db,ledger,approvals,dataDir,permissions,auth:createAuth({db,ownerToken:token}),dispatch:args=>{const run=runner.dispatch(args);runs.push(run);return run;}});
 const server=serve({hostname:'127.0.0.1',port:0,fetch:request=>new URL(request.url).pathname==='/mcp'?access.handle(request):app.fetch(request)});
 if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
 const request=(path,method='GET',body)=>app.request(path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const choice=await acp.discover(bot,adapter);assert.ok(choice.model);
  const model=adapter==='codex'&&choice.models.some(m=>m.id==='gpt-6.1-terra')?'gpt-6.1-terra':choice.model;
  db.prepare('UPDATE bots SET config_json=? WHERE id=?').run(JSON.stringify({...bot.config,modelConfig:{model}}),bot.id);
  const old=await (await request('/bots/bot/permissions?roomId=main')).json();
  assert.equal((await request('/bots/bot/permissions?roomId=main','PUT',{preset:'full-access',revision:old.revision,acknowledgeFullAccess:true})).status,200);
  for(const [tool,args,expected] of [[defs[1].name,{scope:'global'},marker],[defs[1].name,{scope:'global'},marker],['run_shell',{command},search]]){
   console.log('Starting '+adapter+' '+tool);
   const before=ledger.list('main',{limit:1000}).at(-1)?.id??0;
   assert.equal((await request('/rooms/main/messages','POST',{text:`Use only the offered OpenAg tool ${tool} exactly once with these exact arguments: ${JSON.stringify(args)}. Report the returned marker. Do not use native tools, another command, or retry. This is a disposable controlled fixture.`})).status,202);
   let timer;try{await Promise.race([Promise.all(runs.splice(0)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Unknown adapter deadline; stop without retry')),120000);})]);}finally{clearTimeout(timer);}
   const events=ledger.list('main',{limit:1000}).filter(e=>e.id>before),results=events.filter(e=>e.type==='tool_result'&&e.payload.tool===tool);
   assert.equal(results.length,1,'Exactly one daemon invocation');assert.equal(results[0].payload.ok,true,JSON.stringify(results[0].payload));
   assert.equal(results[0].payload.executionOutcome,'completed');assert.ok(JSON.stringify(results[0].payload.result).includes(expected));
   assert.ok(events.some(e=>e.type==='bot_output'&&e.payload.text.includes(expected)),'Bot must consume the nested result');
   assert.equal(events.findLast(e=>e.type==='turn_finished')?.payload.status,'finished');
  }
  const events=ledger.list('main',{limit:1000});
  assert.equal(calls.length,2);assert.equal(shellCalls,1);assert.equal(approvals.listPending().length,0);
  const sessions=new Set(events.filter(e=>e.type==='model_report'&&e.payload.source==='session').map(e=>e.payload.sessionId));assert.equal(sessions.size,1,'Second call must reuse the actual ACP session');
  assert.equal(db.prepare("SELECT count(*) n FROM action_receipts WHERE outcome IN ('pending','unknown')").get().n,0);
  writeFileSync(join(dataDir,'events.json'),JSON.stringify(events),{mode:0o600});
  console.log('PASS '+adapter+': object-union schema reaches bot, two controlled reads through scoped MCP in one session, one daemon rg search, nested results and completed receipts');
 }finally{await acp.close();await mcp.close();server.closeAllConnections();remote.closeAllConnections();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>remote.close(resolve))]);db.close();}
}
console.log('PASS evidence '+directory);
