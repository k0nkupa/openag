// Temporary real gateway/gate + OS subprocesses, real local MCP transports and shared computer wrapper. No unit runner.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const {serve}=require('@hono/node-server'),{z}=require('zod');
const {Server}=await import(require.resolve('@modelcontextprotocol/sdk/server/index.js')),{WebStandardStreamableHTTPServerTransport}=await import(require.resolve('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js')),{ListToolsRequestSchema,CallToolRequestSchema}=await import(require.resolve('@modelcontextprotocol/sdk/types.js'));
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createAuth}=await load('auth');
const {createPermissions}=await load('permissions'),{createRunner}=await load('runtimes/runner'),{createGateway}=await load('gateway');
const {createBot,createRoom,addMember,getBot,getRoom}=await load('rooms'),{toExecutors}=await load('tools/registry');
const {commandTool}=await load('tools/execution'),{writeFileTool}=await load('tools/files'),{createAppsManager}=await load('apps'),{createMcpManager}=await load('mcp');
const {createComputer}=await load('computer'),{ActionFailure}=await load('action-receipts'),{createDriverComputer}=await load('computer/driver'),{createComputerTools}=await load('tools/computer'),{createNotifyTool}=await load('tools/notify'),{createCapabilityCatalogue}=await load('capabilities'),{createCapabilitiesTool}=await load('tools/capabilities');
const {memoryAppendTool}=await load('tools/memory'),{createSkillTools}=await load('tools/skills'),{openagHelpTool}=await load('tools/knowledge');
const directory=mkdtempSync(join(tmpdir(),'openag-permission-worlds-')),token=randomUUID(),db=openDb(directory),ledger=createLedger(db),approvals=createApprovals(db,ledger),permissions=createPermissions(db,ledger,directory,approvals);
console.log('Disposable evidence: '+directory);
const unsupportedMarker=join(directory,'unsupported-effect'),unsupported=spawnSync(process.execPath,['--input-type=module','-e',`const {executeCommand}=await import(${JSON.stringify(root+'apps/daemon/dist/execution.js')});Object.defineProperty(process,'platform',{value:'linux'});try{await executeCommand({mode:'workspace-write',workspace:${JSON.stringify(directory)}},'touch '+${JSON.stringify(unsupportedMarker)});process.exit(9)}catch(e){if(e.outcome!=='not-run')throw e}`],{encoding:'utf8'});assert.equal(unsupported.status,0,unsupported.stderr);assert.equal(existsSync(unsupportedMarker),false);console.log('PASS simulated unsupported host refuses confinement without a fallback or effect');
for(const id of ['bot','child'])createBot(db,{id,runtime:'api'});createRoom(db,{id:'main',leadBotId:'bot'});for(const id of ['bot','child'])addMember(db,'main',id);
const stdioMarker=join(directory,'stdio-marker'),httpMarker=join(directory,'http-marker'),appMarker=join(directory,'apps','case','data','marker');
const append=path=>{writeFileSync(path,'effect\n',{flag:'a'});};
const {createMcpClient}=await load('mcp/client'),{StreamableHTTPClientTransport}=await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
let httpCalls=0,httpFailure=false,managedCalls=0;const protocolServers=[];
const remote=serve({hostname:'127.0.0.1',port:0,fetch:async request=>{
 const server=new Server({name:'permission-world-fixture',version:'1'},{capabilities:{tools:{}}});protocolServers.push(server);
 const names=new URL(request.url).pathname==='/composio'?['COMPOSIO_SEARCH_TOOLS','COMPOSIO_MULTI_EXECUTE_TOOL','COMPOSIO_REMOTE_BASH_TOOL']:['mark'];
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:names.map(name=>({name,description:'Controlled local contract',inputSchema:{type:'object',properties:{},additionalProperties:name!=='mark'},annotations:{readOnlyHint:true}}))}));
 server.setRequestHandler(CallToolRequestSchema,async request=>{if(request.params.name!=='mark'){managedCalls++;const tools=request.params.arguments?.tools??[];return {content:[{type:'text',text:JSON.stringify({successful:true,data:{results:tools.map((tool,index)=>({tool_slug:tool.tool_slug,index,response:{successful:true,data:{marker:'controlled read'}}})),total_count:tools.length,success_count:tools.length,error_count:0},log_id:'controlled-read'})}]};}httpCalls++;if(httpFailure)return {isError:true,content:[{type:'text',text:'Controlled explicit tool failure'}]};append(httpMarker);return {content:[{type:'text',text:'Controlled marker appended'}]};});
 const transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:true});await server.connect(transport);return transport.handleRequest(request);
}});if(!remote.listening)await new Promise(r=>remote.once('listening',r));
const childSource=join(directory,'mcp-fixture.cjs');writeFileSync(childSource,`const r=require('node:readline').createInterface({input:process.stdin});r.on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;let result;if(q.method==='initialize')result={protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'permission-fixture',version:'1'}};else if(q.method==='tools/list')result={tools:[{name:'mark',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}}]};else if(q.method==='tools/call'){require('node:fs').appendFileSync(${JSON.stringify(stdioMarker)},'effect\\n');result={content:[{type:'text',text:'Controlled marker appended'}]};}else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');});`);
writeFileSync(join(directory,'mcp.json'),JSON.stringify({servers:[{id:'stdio',transport:'stdio',command:process.execPath,args:[childSource],toolClasses:{mark:'read'}},{id:'http',transport:'http',url:'http://127.0.0.1:'+remote.address().port+'/mcp',toolClasses:{mark:'act-local'}}]}),{mode:0o600});
const mcp=createMcpManager({dataDir:directory,composio:{enabled:()=>true,connect:async()=>{const client=createMcpClient();await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+remote.address().port+'/composio')));return {client,close:()=>client.close()};}}});await mcp.load();assert.equal(mcp.toolDefs().length,5);
let enabled={};const appDir=join(directory,'apps','case');mkdirSync(appDir,{recursive:true});writeFileSync(join(appDir,'main.cjs'),"const f=require('node:fs');f.mkdirSync('data',{recursive:true});f.appendFileSync('data/marker','effect\\n');process.stdout.write(JSON.stringify({wrote:true}));");writeFileSync(join(appDir,'manifest.json'),JSON.stringify({id:'case',name:'Permission fixture',version:'1.0.0',description:'Controlled local effect with misleading read classification',tools:[{name:'mark',class:'read',description:'Controlled marker',input:{type:'object',properties:{}},exec:{argv:['node','main.cjs'],timeoutSec:5}}]}));
const apps=createAppsManager({dataDir:directory,getEnabled:()=>enabled,setEnabled:value=>{enabled=value;}});const appInfo=apps.scan().find(app=>app.id==='case');apps.enable('case',appInfo.hash);
let inspections=0,actions=0,shells=0,notifications=0,shellTimeout=false;
const png=Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64'),Buffer.alloc(40)]);
const computer=createDriverComputer({kind:'ssh',name:'controlled',capabilities:{shell:true,view:'none',hosted:false},inspect:async()=>{inspections++;return {state:'running',status:'running',image:null,kind:'controlled'};},create:async()=>{},start:async()=>{},stop:async()=>{},destroy:async()=>{},screenshot:async()=>png,act:async()=>{actions++;return {message:'Controlled input accepted'};},shell:async()=>{shells++;return {exitCode:shellTimeout?0:1,stdout:'',stderr:'',truncated:false,timedOut:shellTimeout};},viewLink:async()=>({kind:'none'})},{dataDir:directory,ledger});await computer.status();
const pusher={status:()=>({enabled:true,configured:true}),notifyUser:async()=>{notifications++;return {ok:true};}};
const defs=[writeFileTool,commandTool,...createComputerTools(computer),createNotifyTool(pusher),memoryAppendTool,...createSkillTools(),openagHelpTool];
const catalogue=createCapabilityCatalogue(db,()=>defs),capabilities=createCapabilitiesTool(catalogue,()=>true);defs.push(capabilities);
let current,results=[],childResults=[],pending,releaseChild,childEntered;
const quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
const runtime={async runTurn(ctx){
 if(current.delegation){
  if(ctx.state.resultFor)return;
  if(ctx.bot.id==='bot'){ledger.append('main','bot','bot_output',{turnId:ctx.turnId,text:'@child Perform the one controlled scope operation.'});return;}
  assert.ok(ctx.state.permissionParents.length);assert.throws(()=>ctx.saveState({permissionParents:[]}));assert.throws(()=>{ctx.state.permissionParents[0].revision=999;});
  childResults.push(await ctx.callTool(current.tool,current.args));ledger.append('main','child','bot_output',{turnId:ctx.turnId,text:'Controlled child result recorded.'});return;
 }
 results.push(await ctx.callTool(current.tool,current.args));
}};
const executors=toExecutors(defs),commandExecute=executors.run_shell;executors.run_shell=Object.assign(async(ctx,args)=>{if(current.delayChild&&ctx.botId==='child'){childEntered();await new Promise(r=>{releaseChild=r;});}return commandExecute(ctx,args);},commandExecute);
const runner=createRunner({db,ledger,approvals,dataDir:directory,permissions,runtimes:{api:runtime},tools:executors,dynamicTools:()=>({...apps.executors(),...mcp.executors()})});
const gateway=createGateway({db,ledger,approvals,auth:createAuth({db,ownerToken:token}),dataDir:directory,permissions,apps,mcp,computer,work:runner.work,dispatch:args=>{pending=runner.dispatch(args);return pending;}});
const server=serve({hostname:'127.0.0.1',port:0,fetch:request=>gateway.fetch(request)});if(!server.listening)await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const json=async path=>{const response=await request(path);assert.equal(response.status,200);return response.json();};
async function select(preset,bot='bot',writeRoots){const old=await json('/bots/'+bot+'/permissions?roomId=main');const response=await request('/bots/'+bot+'/permissions?roomId=main','PUT',{preset,revision:old.revision,acknowledgeFullAccess:preset==='full-access',...(writeRoots?{writeRoots}:{})});assert.equal(response.status,200);return response.json();}
async function begin(tool,args,options={}){current={tool,args,...options};const response=await request('/rooms/main/messages','POST',{text:'One bounded execution-world operation.'});assert.equal(response.status,202);}
async function run(tool,args){await begin(tool,args);await pending;return results.at(-1);}
async function trusted(tool,args,meta){current={tool,args};const message=ledger.append('main','user','message',{text:'Controlled independent turn ceiling'});await runner.run(getRoom(db,'main'),getBot(db,'bot'),message,undefined,meta);return results.at(-1);}
try{
 await select('workspace-write');const workspace=permissions.get('bot','main').workspace;
 let result=await run('write_file',{path:'nested/inside.txt',content:'workspace'});assert.equal(result.ok,true);assert.equal(readFileSync(join(workspace,'nested/inside.txt'),'utf8'),'workspace');assert.equal(result.approvalId,undefined);
 symlinkSync(directory,join(workspace,'escape'));result=await run('write_file',{path:'escape/escape.txt',content:'forbidden'});assert.equal(result.ok,false);assert.equal(existsSync(join(directory,'escape.txt')),false);
 console.log('PASS workspace file effect/readback and symlink refusal');
 await select('read-only');await begin('write_file',{path:'reviewed.txt',content:'one exact file'});const proposal=approvals.listPending()[0];assert.ok(proposal);assert.equal(existsSync(join(workspace,'reviewed.txt')),false);assert.equal((await request('/approvals/'+proposal.id,'POST',{kind:'accept',reviewVersion:proposal.reviewVersion})).status,200);await pending;assert.equal(results.at(-1).ok,true);assert.equal(readFileSync(join(workspace,'reviewed.txt'),'utf8'),'one exact file');assert.equal(permissions.get('bot','main').preset,'read-only');
 for(const preset of ['read-only','workspace-write']){
  await select(preset);for(const name of ['app_case_mark','mcp.stdio.mark','mcp.http.mark','computer_click','computer_shell']){const args=name==='computer_click'?{x:1,y:1}:name==='computer_shell'?{command:'fixture',timeoutSec:1}:{};result=await run(name,args);assert.equal(result.status,'denied',preset+' '+name);}
  assert.equal(existsSync(appMarker),false);assert.equal(existsSync(stdioMarker),false);assert.equal(existsSync(httpMarker),false);assert.equal(actions,0);assert.equal(shells,0);
 }
 console.log('PASS opaque MCP/App/computer refusal despite misleading read hints/classes');
 result=await run('memory_append',{text:'must not write outside the confined workspace'});assert.equal(result.status,'denied');
 const readArgs={tools:[{tool_slug:'OUTLOOK_GET_PROFILE',arguments:{}}]};
 result=await run('mcp.composio-connect.COMPOSIO_MULTI_EXECUTE_TOOL',readArgs);assert.equal(result.ok,true);assert.equal(db.prepare('SELECT tool_class FROM action_receipts WHERE id=?').get(result.receiptId).tool_class,'read');
 const callsBefore=managedCalls;result=await run('mcp.composio-connect.COMPOSIO_MULTI_EXECUTE_TOOL',{...readArgs,sync_response_to_workbench:true});assert.equal(result.status,'denied');result=await run('mcp.composio-connect.COMPOSIO_MULTI_EXECUTE_TOOL',{...readArgs,effects:'read'});assert.equal(result.status,'denied');result=await run('mcp.composio-connect.COMPOSIO_REMOTE_BASH_TOOL',{});assert.equal(result.status,'denied');assert.equal(managedCalls,callsBefore);
 result=await trusted('mcp.composio-connect.COMPOSIO_MULTI_EXECUTE_TOOL',readArgs,{unattended:true});assert.equal(result.ok,true,'Reviewed read request keeps background read semantics');
 console.log('PASS reviewed managed read contracts, untrusted effects rejection and background read classification');
 const observed=inspections;result=await run('openag_capabilities',{family:'computer'});assert.equal(result.ok,true);assert.equal(inspections,observed,'Inspection must not probe the computer');assert.equal(result.result.tools.find(tool=>tool.name==='computer_click').permission.mode,'deny');assert.match(result.result.tools.find(tool=>tool.name==='computer_click').permission.reason,/cannot enforce/);assert.equal(result.result.tools.find(tool=>tool.name==='computer_screenshot').permission.mode,'auto');
 await select('full-access');for(const name of ['app_case_mark','mcp.stdio.mark','mcp.http.mark']){result=await run(name,{});assert.equal(result.ok,true,name);assert.equal(result.approvalId,undefined);assert.ok(result.receiptId);}
 for(const marker of [appMarker,stdioMarker,httpMarker])assert.equal(readFileSync(marker,'utf8'),'effect\n');
 console.log('PASS actual Full access App and both MCP transports');
 httpFailure=true;result=await run('mcp.http.mark',{});assert.equal(result.ok,false,'Nested MCP failure must not be success');assert.equal(readFileSync(httpMarker,'utf8'),'effect\n');httpFailure=false;
 result=await run('memory_append',{text:'Controlled Full access memory note'});assert.equal(result.ok,true);
 result=await run('skill_save',{slug:'controlled',name:'Controlled skill',description:'Disposable workflow',body:'Perform one controlled operation.'});assert.equal(result.ok,true);result=await run('skill_load',{slug:'controlled'});assert.equal(result.ok,true);assert.match(result.result.skill.body,/controlled operation/);
 computer.setInputGuard(()=> 'human has control');result=await run('computer_click',{x:1,y:1});assert.equal(result.executionOutcome,'not-run');assert.equal(actions,0);await select('read-only');result=await run('computer_screenshot',{});assert.equal(result.ok,true);assert.ok(existsSync(join(directory,result.result.screenshot.path)));
 computer.setInputGuard(undefined);await select('full-access');result=await run('computer_click',{x:1,y:1});assert.equal(result.ok,true);assert.equal(actions,1);
 result=await run('computer_shell',{command:'controlled explicit failure',timeoutSec:1});assert.equal(result.ok,false);assert.equal(result.executionOutcome,'failed');shellTimeout=true;result=await run('computer_shell',{command:'controlled timeout',timeoutSec:1});assert.equal(result.executionOutcome,'unknown');const unknownId=result.receiptId;
 const readDuringUnknown=await run('mcp.composio-connect.COMPOSIO_MULTI_EXECUTE_TOOL',readArgs);assert.equal(readDuringUnknown.ok,true);assert.equal(approvals.receipts.get(unknownId).inspectedAt,null,'A read never clears older uncertainty');shellTimeout=false;
 let unlock,locked;const ready=new Promise(r=>{locked=r;});const lock=computer.withLock(async()=>{locked();await new Promise(r=>{unlock=r;});});await ready;await begin('computer_click',{x:1,y:1});await select('read-only');unlock();await lock;await pending;assert.equal(results.at(-1).executionOutcome,'not-run');assert.equal(actions,1,'Queued input must recheck after a mode change');
 console.log('PASS computer takeover, queue revision check and actual nested failure/timeout outcomes');
 result=await run('notify_user',{text:'Synthetic notification only'});assert.equal(result.ok,true,'Filesystem Read Only is not read-only remote accounts');const sent=notifications;
 result=await trusted('notify_user',{text:'offline cannot send'},{noNetwork:true});assert.equal(result.status,'denied');assert.equal(notifications,sent);
 await select('full-access');for(const allowApprovals of [false,true]){result=await trusted('notify_user',{text:'background cannot inherit interactive Full'},{unattended:true,allowApprovals});assert.equal(result.status,'denied');assert.equal(approvals.listPending().length,0);}
 for(const name of ['app_case_mark','mcp.stdio.mark']){result=await trusted(name,{}, {unattended:true,allowApprovals:true});assert.equal(result.status,'denied','A read declaration cannot authorize opaque background writes');}
 assert.equal(readFileSync(appMarker,'utf8'),'effect\n');assert.equal(readFileSync(stdioMarker,'utf8'),'effect\n');
 result=await trusted('openag_help',{topic:'overview'}, {isolated:true});assert.equal(result.status,'denied');result=await trusted('openag_help',{topic:'overview'}, {unattended:true,noNetwork:true});assert.equal(result.ok,true);
 console.log('PASS independent offline/unattended/isolated ceilings and filesystem/remote-account distinction');
 const child=await select('full-access','child'),childTarget=join(child.workspace,'delegated.txt');
 await select('read-only');await begin('run_shell',{command:'printf forbidden > '+quote(childTarget)},{delegation:true});await pending;assert.equal(childResults.at(-1).ok,false);assert.equal(existsSync(childTarget),false);assert.equal(permissions.get('child','main').preset,'full-access');
 await select('workspace-write');await begin('run_shell',{command:'printf forbidden > '+quote(childTarget)},{delegation:true});await pending;assert.equal(childResults.at(-1).ok,false);assert.equal(existsSync(childTarget),false);await begin('openag_help',{topic:'overview'},{delegation:true});await pending;assert.equal(childResults.at(-1).ok,true);
 await select('workspace-write','bot',[child.workspace]);await begin('run_shell',{command:'printf mapped > '+quote(childTarget)},{delegation:true});await pending;assert.equal(childResults.at(-1).ok,true);assert.equal(readFileSync(childTarget,'utf8'),'mapped');
 const outside=join(directory,'parent-revision-escape.txt');let entered;const childWaiting=new Promise(r=>{entered=r;});childEntered=entered;await begin('run_shell',{command:'printf forbidden > '+quote(outside)},{delegation:true,delayChild:true});await childWaiting;await select('full-access');releaseChild();await pending;assert.equal(childResults.at(-1).executionOutcome,'not-run');assert.equal(existsSync(outside),false);
 let valid=true,cuaInputs=0,cuaShells=0,flipInfo=false;
 const cua=createComputer({dataDir:directory,name:'controlled-cua',run:async(_bin,args)=>{if(args[0]==='sandbox'&&args[1]==='info'){if(flipInfo)valid=false;return {code:0,stdout:JSON.stringify({state:'running',status:'ready'}),stderr:'',timedOut:false};}if(args[0]==='do'&&args[1]==='switch')valid=false;else if(args[0]==='do')cuaInputs++;else if(args[0]==='sandbox'&&args[1]==='exec')cuaShells++;return {code:0,stdout:'Controlled CLI result',stderr:'',timedOut:false};}});
 const guard=()=>{if(!valid)throw new ActionFailure('Controlled permission revision changed','not-run');};
 await assert.rejects(cua.act(['click','1','1'],guard),error=>error instanceof ActionFailure&&error.outcome==='not-run');assert.equal(cuaInputs,0);valid=true;flipInfo=true;await assert.rejects(cua.shell('fixture',1,guard),error=>error instanceof ActionFailure&&error.outcome==='not-run');assert.equal(cuaShells,0);
 assert.equal(approvals.listPending().length,0);console.log('PASS execution worlds: real file confinement/readback, actual App and stdio/HTTP MCP, explicit unavailable worlds, computer guards/queue/takeover, nested failures, remote-effects distinction, independent ceilings and mapped/revision-bound delegation.');
}finally{await runner.idle();await mcp.close();await Promise.all(protocolServers.map(server=>server.close().catch(()=>{})));await new Promise(r=>server.close(r));await new Promise(r=>remote.close(r));db.close();}
console.log('Disposable evidence: '+directory);
