// Public manager/runner acceptance over real SDK HTTP; synthetic provider, no unit runner.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json');
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {serve}=require('@hono/node-server'),{Server}=await import(require.resolve('@modelcontextprotocol/sdk/server/index.js'));
const {WebStandardStreamableHTTPServerTransport}=await import(require.resolve('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'));
const {ListToolsRequestSchema,CallToolRequestSchema}=await import(require.resolve('@modelcontextprotocol/sdk/types.js'));
const {StreamableHTTPClientTransport}=await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const {createMcpClient}=await load('mcp/client'),{createMcpManager}=await load('mcp'),{classify}=await load('policy');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createRunner}=await load('runtimes/runner');
const {createBot,createRoom,addMember,getBot,getRoom}=await load('rooms');
const {createPermissions}=await load('permissions');
const names=['SEARCH_TOOLS','GET_TOOL_SCHEMAS','SEARCH_SKILLS','USE_SKILL','WAIT_FOR_CONNECTIONS','MANAGE_CONNECTIONS','MULTI_EXECUTE_TOOL','PROXY_EXECUTE','REMOTE_WORKBENCH','REMOTE_BASH_TOOL','MANAGE_SKILL','SUBMIT_FEEDBACK','FUTURE_QUERY'].map(v=>'COMPOSIO_'+v);
const instances=[];let mode='success',calls=0,groups=0;
const server=serve({hostname:'127.0.0.1',port:0,fetch:async req=>{
 if(req.method!=='POST')return new Response(null,{status:405});
 const s=new Server({name:'contract',version:'1'},{capabilities:{tools:{}}});instances.push(s);
 s.setRequestHandler(ListToolsRequestSchema,async()=>({tools:names.map(name=>({name,inputSchema:{type:'object',properties:{},additionalProperties:true},annotations:{readOnlyHint:true}}))}));
 s.setRequestHandler(CallToolRequestSchema,async request=>{calls++;const sent=request.params.arguments;let value={successful:true,data:{marker:'expected'},log_id:'fixture-log'};
  if(request.params.name.endsWith('MULTI_EXECUTE_TOOL')&&Array.isArray(sent?.tools)){const echoed=sent.tools.map((t,i)=>({tool_slug:t.tool_slug,index:i,response:{successful:true,data:{marker:'one'}}}));
   if(mode==='success'||mode==='flagged-success')value={successful:true,data:{results:echoed,total_count:echoed.length,success_count:echoed.length,error_count:0},log_id:'fixture-log'};
   if(mode==='nested-failure')value={successful:true,data:{results:echoed.map(item=>({...item,response:{successful:false,data:null}}))},log_id:'fixture-log'};
   if(mode==='nested-error')value={successful:true,data:{results:echoed.map(item=>({...item,response:{successful:true,error:'Fixture nested refusal'}}))},log_id:'fixture-log'};
   if(mode==='missing-response')value={successful:true,data:{results:echoed.map(({response,...item})=>item)},log_id:'fixture-log'};
   if(mode==='null-response')value={successful:true,data:{results:echoed.map(item=>({...item,response:null}))},log_id:'fixture-log'};
   if(mode==='array-response')value={successful:true,data:{results:echoed.map(item=>({...item,response:[]}))},log_id:'fixture-log'};
   if(mode==='missing-success')value={successful:true,data:{results:echoed.map(item=>({...item,response:{data:{marker:'unconfirmed'}}}))},log_id:'fixture-log'};
   if(mode==='string-success')value={successful:true,data:{results:echoed.map(item=>({...item,response:{successful:'true',data:{marker:'unconfirmed'}}}))},log_id:'fixture-log'};
   if(mode==='mixed-response')value={successful:true,data:{results:echoed.map((item,i)=>i===0?item:{tool_slug:item.tool_slug})},log_id:'fixture-log'};
   if(mode==='empty-results')value={successful:true,data:{results:[]},log_id:'fixture-log'};
   if(mode==='null-data')value={successful:true,data:null,log_id:'fixture-log'};
   if(mode==='wrong-slug')value={successful:true,data:{results:echoed.map(r=>({...r,tool_slug:'OUTLOOK_SEND_EMAIL'}))},log_id:'fixture-log'};
   if(mode==='short-results')value={successful:true,data:{results:echoed.slice(0,1)},log_id:'fixture-log'};}
  if(mode==='provider-failure')value={successful:false,data:null,error:'Fixture provider refusal',log_id:'fixture-error'};
  if(mode==='malformed')value={successful:'true',data:{marker:'must-not-complete'}};
  if(mode==='partial')value={successful:true,data:{results:[{response:{successful:true,data:{marker:'one'}}},{error:'second failed'}]},log_id:'batch-log'};
  if(mode==='non-envelope')value={marker:'no-contract'};
  if(mode==='large-failure')value={successful:false,error:'x'.repeat(40000),data:null,log_id:'large-error-log'};
  if(mode==='proxy-http')value={successful:true,data:{status:403,body:{message:'Not permitted'}},log_id:'proxy-log'};
  if(mode==='oversized-diagnostic')return {content:[{type:'text',text:JSON.stringify(value)}],providerDiagnostic:{code:'x'.repeat(21000),logId:'y'.repeat(30000),ignored:{nested:'z'.repeat(10000)}}};
  if(mode==='structured-failure')return {content:[],structuredContent:{successful:false,data:null,error:'Structured refusal',log_id:'structured-log'}};
  if(mode==='flagged-provider-failure')return {isError:true,content:[{type:'text',text:JSON.stringify({successful:false,data:{results:[{tool_slug:'OUTLOOK_GET_PROFILE',index:0,error:'No response to elicitation prompt within the allowed time.'}],total_count:1,success_count:0,error_count:1},error:'1 out of 1 tools failed',log_id:'flagged-error'})}]};
  if(mode==='flagged-structured-failure')return {isError:true,content:[],structuredContent:{successful:false,data:null,error:'Structured refusal',log_id:'flagged-structured-error'}};
  if(mode==='flagged-success')return {isError:true,content:[{type:'text',text:JSON.stringify(value)}]};
  if(mode==='flagged-malformed')return {isError:true,content:[{type:'text',text:JSON.stringify({successful:'false',error:'Malformed refusal'})}]};
  if(mode==='flagged-plain-error')return {isError:true,content:[{type:'text',text:'No trustworthy provider envelope'}]};
  return {content:[{type:'text',text:JSON.stringify(value)}]};
 });
 const transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:true});await s.connect(transport);return transport.handleRequest(req);
}});
if(!server.listening)await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/mcp`;
const dir=mkdtempSync(join(tmpdir(),'composio-contract-'));const db=openDb(dir),ledger=createLedger(db),approvals=createApprovals(db,ledger);
writeFileSync(join(dir,'mcp.json'),JSON.stringify({servers:[{id:'untrusted',transport:'http',url,allowPrivateNetwork:true}]}),{mode:0o600});
const mcp=createMcpManager({dataDir:dir,composio:{enabled:()=>true,connect:async()=>{const client=createMcpClient();await client.connect(new StreamableHTTPClientTransport(new URL(url)));return {client,close:()=>client.close()};}}});
let runner;
try{
 await mcp.load();
 for(const [suffix,cls] of [['SEARCH_TOOLS','search'],['GET_TOOL_SCHEMAS','read'],['SEARCH_SKILLS','search'],['USE_SKILL','read']])assert.equal(classify('mcp.composio-connect.COMPOSIO_'+suffix),cls,suffix+' reviewed classification');
 for(const suffix of ['WAIT_FOR_CONNECTIONS','MANAGE_CONNECTIONS','MULTI_EXECUTE_TOOL','PROXY_EXECUTE','REMOTE_WORKBENCH','REMOTE_BASH_TOOL','MANAGE_SKILL','SUBMIT_FEEDBACK','FUTURE_QUERY'])assert.equal(classify('mcp.composio-connect.COMPOSIO_'+suffix),'act-external');
 for(const name of names)assert.equal(classify('mcp.untrusted.'+name),'act-external','same spelling/hint on another server grants nothing');
 groups++;console.log('PASS full known surface and future names remain correctly gated');
 createBot(db,{id:'bot',runtime:'api'});createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
 const permissions=createPermissions(db,ledger,dir,approvals);
 let tool='COMPOSIO_GET_TOOL_SCHEMAS',toolArgs={},observed;
 runner=createRunner({db,ledger,approvals,permissions,dataDir:dir,dynamicTools:()=>mcp.executors(),tools:{},runtimes:{api:{async runTurn(ctx){observed=await ctx.callTool(tool.startsWith('mcp.')?tool:'mcp.composio-connect.'+tool,toolArgs);}}}});
 async function run(){await runner.run(getRoom(db,'main'),getBot(db,'bot'),ledger.append('main','user','message',{text:'Read the synthetic schema'}));return observed;}
 const success=await run();assert.equal(success.ok,true);assert.equal(success.result.providerDiagnostic.logId,'fixture-log');assert.equal(approvals.listPending().length,0);groups++;console.log('PASS metadata read completes through runner without action approval');
 for(mode of ['provider-failure','malformed','non-envelope','structured-failure','large-failure']){const r=await run();assert.equal(r.ok,false,mode);assert.equal(r.executionOutcome,'failed',mode);assert.equal(r.invocationOutcome,'returned');assert.ok(r.result.untrusted);if(mode==='provider-failure')assert.equal(r.result.providerDiagnostic.logId,'fixture-error');if(mode==='large-failure'){assert.equal(r.result.providerDiagnostic.logId,'large-error-log');assert.ok(r.result.truncated);assert.ok(JSON.stringify(r.result).length<=20000);}}
 groups++;console.log('PASS explicit provider failure and malformed envelopes never become completed reads');
 mode='partial';tool='COMPOSIO_MULTI_EXECUTE_TOOL';const exec=mcp.executors()['mcp.composio-connect.'+tool];const value=await exec({botId:'bot',dataDir:dir},{});assert.equal(value.isError,true);assert.match(value.content,/second failed/);groups++;console.log('PASS partial batch failure retains per-item evidence');
 mode='proxy-http';const proxy=await mcp.executors()['mcp.composio-connect.COMPOSIO_PROXY_EXECUTE']({botId:'bot',dataDir:dir},{});assert.equal(proxy.isError,true);assert.equal(proxy.providerDiagnostic.code,'provider_http_error');groups++;console.log('PASS delivered proxy HTTP failure is not provider success');
 mode='oversized-diagnostic';
 await new Promise((resolve,reject)=>{
  const code=`import assert from 'node:assert/strict';import {createMcpManager} from ${JSON.stringify(root+'apps/daemon/dist/mcp.js')};const m=createMcpManager({dataDir:${JSON.stringify(dir)}});try{await m.load();const r=await m.executors()['mcp.untrusted.COMPOSIO_GET_TOOL_SCHEMAS']({botId:'fixture',dataDir:${JSON.stringify(dir)}},{});assert.ok(JSON.stringify(r).length<=20000);assert.ok(r.providerDiagnostic.code.length<=64);assert.ok(r.providerDiagnostic.logId.length<=300);assert.deepEqual(Object.keys(r.providerDiagnostic).sort(),['code','logId']);}finally{await m.close();}`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let output='';child.stderr.on('data',chunk=>{output+=chunk;});
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Oversized remote diagnostic hung the process'));},4000);
  child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',status=>{clearTimeout(timer);status===0?resolve():reject(Error(output||'Isolated diagnostic check failed'));});
 });groups++;console.log('PASS oversized untrusted diagnostics cannot hang result projection');
 // Completion follows connector results; reviewed slugs still affect permission only.
 async function approved(){
  let settled=false;const turn=run().finally(()=>{settled=true;});
  for(let i=0;i<300&&!settled&&!approvals.listPending().length;i++)await new Promise(r=>setTimeout(r,10));
  const a=approvals.listPending()[0];if(a)approvals.resolve(a.id,{kind:'accept'},a.reviewVersion);
  const r=await turn;assert.ok(r.receiptId??r.approvalId,'An admitted operation retains its receipt');return {r,receipt:approvals.receipts.get(r.receiptId??r.approvalId)};
 }
 const session=permissions.ensure('bot','main');permissions.select('bot','main','full-access','fixture',session.revision);

 const batch=(...slugs)=>({tools:slugs.map(tool_slug=>({tool_slug,arguments:{}})),session_id:'fixture'});
 mode='success';tool='COMPOSIO_MULTI_EXECUTE_TOOL';
 toolArgs={...batch('OUTLOOK_GET_PROFILE','OUTLOOK_QUERY_EMAILS'),sync_response_to_workbench:false,thought:'read profile'};let got=await approved();assert.equal(got.r.ok,true);assert.equal(got.r.executionOutcome,'completed');assert.equal(got.receipt.outcome,'completed');
 mode='partial';toolArgs=batch('OUTLOOK_GET_PROFILE');got=await approved();assert.equal(got.r.ok,false);assert.equal(got.receipt.outcome,'failed','an explicit provider failure on a read stays failed');
 for(mode of ['flagged-provider-failure','flagged-structured-failure']){toolArgs=batch('OUTLOOK_GET_PROFILE');got=await approved();assert.equal(got.r.ok,false,mode);assert.equal(got.r.invocationOutcome,'returned',mode);assert.equal(got.r.result.isError,true,mode);assert.equal(got.receipt.outcome,'failed',mode+' preserves a confirmed read failure');assert.equal(got.r.result.providerDiagnostic.code,'provider_error',mode);}
 for(mode of ['flagged-success','flagged-malformed','flagged-plain-error']){toolArgs=batch('OUTLOOK_GET_PROFILE');got=await approved();assert.equal(got.r.ok,false,mode);assert.equal(got.r.result.isError,true,mode);assert.equal(got.receipt.outcome,'failed',mode+' cannot report successful invocation');}
 mode='flagged-provider-failure';toolArgs=batch('OUTLOOK_SEND_EMAIL');got=await approved();assert.equal(got.receipt.outcome,'failed','a returned write failure reports invocation failure');assert.equal(got.receipt.evidence.effectVerification,'not-checked');
 tool='mcp.untrusted.COMPOSIO_MULTI_EXECUTE_TOOL';toolArgs=batch('OUTLOOK_GET_PROFILE');got=await approved();assert.equal(got.receipt.outcome,'failed','MCP errors report invocation failure on any server');tool='COMPOSIO_MULTI_EXECUTE_TOOL';
 for(mode of ['nested-failure','nested-error']){toolArgs=batch('OUTLOOK_GET_PROFILE');got=await approved();assert.equal(got.r.ok,false,mode);assert.equal(got.receipt.outcome,'failed',mode+' stays an explicit failure');}
 mode='success';
 const permissionOpaqueCases=[
  ['write slug mixed into a read batch',batch('OUTLOOK_GET_PROFILE','OUTLOOK_SEND_EMAIL')],
  ['unreviewed slug',batch('GITHUB_GET_A_REPOSITORY')],
  ['reported folder lookup',batch('OUTLOOK_GET_MAIL_FOLDER')],
  ['new connector slug',batch('FUTURE_CONNECTOR_GET_WIDGET')],
  ['empty batch',{tools:[]}],
  ['lowercase slug',batch('outlook_get_profile')],
  ['padded slug',batch(' OUTLOOK_GET_PROFILE')],
  ['workbench offload requested',{...batch('OUTLOOK_GET_PROFILE'),sync_response_to_workbench:true}],
  ['unknown top-level key',{...batch('OUTLOOK_GET_PROFILE'),extra_side_effect:true}],
  ['unknown key inside a tool entry',{tools:[{tool_slug:'OUTLOOK_GET_PROFILE',arguments:{},run_as:'other'}]}],
  ['over the batch cap',batch(...Array(11).fill('OUTLOOK_GET_PROFILE'))],
 ];
 for(const [label,args] of permissionOpaqueCases){toolArgs=args;got=await approved();assert.equal(got.receipt.outcome,'completed',label);assert.equal(got.r.ok,true,label);assert.equal(got.receipt.evidence.effectVerification,'not-checked',label);assert.equal(got.r.result.effectVerification,'not-checked',label);}
 mode='malformed';toolArgs=batch('OUTLOOK_GET_PROFILE');got=await approved();assert.equal(got.receipt.outcome,'failed','malformed provider evidence fails validation');
 for(const [label,m,args] of [['missing nested response','missing-response',batch('OUTLOOK_GET_PROFILE')],['null nested response','null-response',batch('OUTLOOK_GET_PROFILE')],['array nested response','array-response',batch('OUTLOOK_GET_PROFILE')],['missing nested success','missing-success',batch('OUTLOOK_GET_PROFILE')],['non-boolean nested success','string-success',batch('OUTLOOK_GET_PROFILE')],['one missing response in a mixed batch','mixed-response',batch('OUTLOOK_GET_PROFILE','OUTLOOK_QUERY_EMAILS')],['empty results','empty-results',batch('OUTLOOK_GET_PROFILE')],['null data','null-data',batch('OUTLOOK_GET_PROFILE')],['result for a different operation','wrong-slug',batch('OUTLOOK_GET_PROFILE')],['fewer results than requested','short-results',batch('OUTLOOK_GET_PROFILE','OUTLOOK_QUERY_EMAILS')]]){mode=m;toolArgs=args;got=await approved();assert.equal(got.receipt.outcome,'failed',label+' fails result validation');assert.equal(got.r.status,'error',label);}
 mode='success';toolArgs=batch('OUTLOOK_GET_PROFILE');tool='mcp.untrusted.COMPOSIO_MULTI_EXECUTE_TOOL';got=await approved();assert.equal(got.receipt.outcome,'completed','MCP success on another server reports invocation completion');assert.equal(got.receipt.evidence.effectVerification,'not-checked');
 for(tool of ['COMPOSIO_MANAGE_CONNECTIONS','COMPOSIO_FUTURE_QUERY']){toolArgs={};mode='success';got=await approved();assert.equal(got.r.ok,true,tool);assert.equal(got.receipt.outcome,'completed',tool);assert.equal(got.receipt.evidence.effectVerification,'not-checked');mode='provider-failure';got=await approved();assert.equal(got.r.ok,false,tool);assert.equal(got.receipt.outcome,'failed',tool);}
 mode='success';
 toolArgs={};tool='COMPOSIO_GET_TOOL_SCHEMAS';groups++;console.log('PASS invocation results are independent of permission allowlists; effects remain separately unchecked');
 // Historical uncertainty never rewrites old evidence or blocks a fresh authorized call.
 const request=approvals.request({roomId:'main',botId:'bot',turnId:null,toolName:'mcp.composio-connect.COMPOSIO_MULTI_EXECUTE_TOOL',toolClass:'act-external',payload:{}});
 const earlier=approvals.get(request.approvalId);approvals.resolve(earlier.id,{kind:'accept'},earlier.reviewVersion);approvals.receipts.start(earlier.id,null,null);approvals.receipts.finish(earlier.id,{outcome:'unknown',detail:'Fixture unresolved earlier result'});
 mode='success';tool='COMPOSIO_GET_TOOL_SCHEMAS';assert.equal((await run()).ok,true);tool='COMPOSIO_MULTI_EXECUTE_TOOL';const before=calls;assert.equal((await run()).ok,true);assert.equal(calls,before+1);assert.equal(approvals.receipts.get(earlier.id).inspectedAt,null);groups++;console.log('PASS unresolved earlier receipt does not block fresh authorized execution or metadata reads');
 console.log(`PASS ${groups} synthetic Composio contract groups; not live-provider acceptance`);
}finally{if(runner){await runner.shutdown();await runner.idle();}await mcp.close();for(const s of instances)await s.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
