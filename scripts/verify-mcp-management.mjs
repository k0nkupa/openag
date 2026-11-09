// Standalone acceptance for the owner's MCP server management routes. Temporary data, a fake connector and synthetic devices only.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,chmodSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {openDb}=await load('db/index'),{createAuth}=await load('auth'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals');
const {createGateway}=await load('gateway'),{createMcpManager}=await load('mcp'),{createMcpServerService}=await load('mcp-servers');
const {classify}=await load('policy'),{createBot,createRoom,addMember}=await load('rooms'),{createMcpServerCheck}=await load('mcp-check'),{setSetting}=await load('settings');
const dir=mkdtempSync(join(tmpdir(),'openag-mcp-mgmt-')),db=openDb(dir),ledger=createLedger(db),approvals=createApprovals(db,ledger);
const OWNER='owner-token-mgmt-synthetic-71534',SECRET='linear-secret-value-DO-NOT-LEAK-5521';
const auth=createAuth({db,ownerToken:OWNER});
createBot(db,{id:'bot',runtime:'acp'});createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
const connects=new Map(),changes=[],resolvedHeaders=[];let hold=null;const refreshers=new Map();
const manager=createMcpManager({dataDir:dir,env:{OPENAG_MCP_LINEAR:SECRET,GITHUB_TOKEN:'github-value-5521'},
 onChange:info=>changes.push(info),
 connector:async cfg=>{connects.set(cfg.id,(connects.get(cfg.id)??0)+1);resolvedHeaders.push(cfg.headers);if(cfg.id==='bad')throw Error('unreachable '+JSON.stringify(cfg.headers));if(cfg.id==='slow'&&hold)await hold;
  const client={setNotificationHandler:(schema,handler)=>refreshers.set(cfg.id,handler),getServerVersion:()=>({name:'Synthetic',version:'1'}),listTools:async()=>({tools:[{name:'SEARCH',description:'fixture',inputSchema:{type:'object',properties:{}}}]}),callTool:async()=>({content:[{type:'text',text:'ok'}]})};
  return {client,close:async()=>{}};}});
const service=createMcpServerService({dataDir:dir,mcp:manager,approvals});
let check=createMcpServerCheck({db,ledger,approvals,mcp:manager});
const app=createGateway({db,auth,ledger,approvals,dataDir:dir,mcp:manager,mcpServers:service,mcpCheck:{request:input=>check.request(input),result:id=>check.result(id),dispose:()=>check.dispose()},dispatch(){}});
const limited=auth.createDevice('Phone','owner','limited').token,full=auth.createDevice('Desk','owner','full').token;
const configPath=join(dir,'mcp.json'),read=()=>JSON.parse(readFileSync(configPath,'utf8'));
const req=async(method,path,{token=OWNER,body}={})=>{const res=await app.request(path,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await res.text();return {status:res.status,json:text?JSON.parse(text):undefined,text};};
const listing=async()=>(await req('GET','/mcp/servers')).json;
const digest=async()=>(await listing()).entries.digest;
const statusOf=async id=>(await listing()).servers.find(server=>server.id===id);
let groups=0;const group=name=>{groups++;console.log('PASS '+name);};
const builtin={id:'apple-apps',transport:'stdio',command:'node',openagPackage:{id:'apple-apps',version:'1.0.0',digest:'a'.repeat(64)}};
const handHttp={id:'hand',transport:'http',url:'https://hand.example/mcp',headers:{Authorization:'Bearer ${GITHUB_TOKEN}'},'x-note':'keep me',timeoutMs:9000};
const handStdio={id:'localtool',transport:'stdio',command:'node',args:['server.js'],env:{KEY:'${HOME}'}};
const writeConfig=value=>writeFileSync(configPath,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const initial={note:'top-level key stays',servers:[builtin,handHttp,handStdio],toolClasses:{}};
writeConfig(initial);await manager.load();

try{
 // 1. Authority and visibility: owner and Full devices manage; a limited device cannot, and sees no editable detail.
 const probe={id:'probe',url:'https://probe.example/mcp'};
 for(const [method,path,body] of [['POST','/mcp/servers',probe],['PATCH','/mcp/servers/hand',{enabled:false,digest:'x'}],['DELETE','/mcp/servers/hand?digest=x']])assert.equal((await req(method,path,{token:limited,body})).status,403,`limited ${method} refused`);
 assert.equal((await req('GET','/mcp/servers',{token:limited})).json.entries,undefined,'a limited device gets no editable detail');
 const owner=await listing();
 assert.equal(owner.entries.servers.length,3);assert.deepEqual(owner.entries.servers.find(entry=>entry.id==='hand').headers,[{name:'Authorization',template:'Bearer ${GITHUB_TOKEN}'}],'header templates stay readable, never resolved values');
 assert.deepEqual(owner.servers.map(server=>[server.id,server.origin]),[['apple-apps','builtin'],['hand','custom'],['localtool','custom']],'servers are grouped by origin, even an invalid built-in entry');
 assert.ok(!JSON.stringify(owner).includes('github-value-5521'),'no resolved value in the listing');
 assert.equal((await req('POST','/mcp/servers',{token:full,body:{...probe,digest:await digest()}})).status,201,'a Full device is the owner');
 assert.equal((await req('DELETE',`/mcp/servers/probe?digest=${await digest()}`)).status,200);
 group('authority, visibility and origin grouping');

 // 2. Add: validation, write-time reference rule, duplicates, reserved ids, SSRF flag requirement.
 const before=readFileSync(configPath,'utf8');
 const add=body=>req('POST','/mcp/servers',{body});
 let res=await add({id:'linear',url:'https://mcp.linear.example/mcp',headers:{Authorization:'Bearer ${OPENAG_MCP_LINEAR}'},digest:await digest()});
 assert.equal(res.status,201,res.text);assert.equal(res.json.change.action,'added');assert.equal(res.json.change.status.state,'connected');assert.equal(res.json.change.status.origin,'custom');assert.equal(res.json.change.status.offerToAgents,true,'default on');
 const after=read();
 assert.deepEqual(after.servers.slice(0,3),initial.servers,'existing entries are untouched, in order, with unknown fields');assert.equal(after.note,'top-level key stays');assert.equal(after.servers[3].id,'linear');
 assert.equal(statSync(configPath).mode&0o777,0o600,'file stays owner-only');
 for(const [name,body] of [
  ['GITHUB_TOKEN is not an OPENAG_MCP_ name',{id:'a1',url:'https://a.example/mcp',headers:{X:'${GITHUB_TOKEN}'}}],
  ['daemon secret header',{id:'a2',url:'https://a.example/mcp',headers:{X:'${OPENAG_TOKEN}'}}],
  ['plain http needs the flag',{id:'a3',url:'http://a.example/mcp'}],
  ['reserved id openag',{id:'openag',url:'https://a.example/mcp'}],
  ['reserved id composio-connect',{id:'composio-connect',url:'https://a.example/mcp'}],
  ['bad id',{id:'Bad Id',url:'https://a.example/mcp'}],
  ['unknown key',{id:'a4',url:'https://a.example/mcp',command:'rm'}],
  ['credentials in url',{id:'a5',url:'https://user:pw@a.example/mcp'}],
  ['reference in url',{id:'a6',url:'https://a.example/${OPENAG_MCP_LINEAR}'}],
  ['redaction marker sent back from the editable view',{id:'a10',url:'https://a.example/mcp',headers:{X:'[REDACTED:secret]'}}],
  ['built-in package id',{id:'local-reference',url:'https://a.example/mcp'}],
  ['key in query (not caught by the redactor)',{id:'a7',url:'https://a.example/mcp?key=abcdef123456'}],
  ['signature in query',{id:'a8',url:'https://a.example/mcp?sig=ZXhhbXBsZXNpZ25hdHVyZQ'}],
  ['auth in query',{id:'a9',url:'https://a.example/mcp?v=2&auth=abcdef123456'}],
 ]){res=await add(body);assert.equal(res.status,400,`${name}: ${res.text}`);}
 assert.match((await add({id:'a1',url:'https://a.example/mcp',headers:{X:'${GITHUB_TOKEN}'}})).json.error,/OPENAG_MCP_/,'the refusal names the rule');
 assert.equal((await add({id:'linear',url:'https://x.example/mcp'})).status,409,'duplicate id');
 res=await add({id:'plainq',url:'https://q.example/mcp?region=eu'});assert.equal(res.status,201,'a harmless query string is fine');await req('DELETE',`/mcp/servers/plainq?digest=${await digest()}`);
 assert.equal(readFileSync(configPath,'utf8'),JSON.stringify(after,null,2)+'\n','refused adds change nothing');
 group('add, validation and write-time reference rule');

 // 3. Edit: raw-item merge, stale digest, enable/disable, unrelated servers stay live, onChange only when the offered set changes.
 const connectsBefore=new Map(connects);changes.length=0;
 res=await req('PATCH','/mcp/servers/hand',{body:{offerToAgents:false,digest:await digest()}});
 assert.equal(res.status,200,res.text);assert.deepEqual(read().servers[1],{...handHttp,offerToAgents:false},'only the patched field changed; unknown field and existing ${GITHUB_TOKEN} reference kept');
 assert.equal(connects.get('linear'),connectsBefore.get('linear'),'an unrelated server is not reconnected');
 res=await req('PATCH','/mcp/servers/hand',{body:{offerToAgents:false,digest:'0'.repeat(64)}});assert.equal(res.status,409);assert.match(res.json.error,/review again|reload/i,'stale digest');
 res=await req('PATCH','/mcp/servers/hand',{body:{enabled:false,digest:await digest()}});assert.equal(res.json.change.status.state,'skipped');assert.equal(res.json.change.status.enabled,false);
 res=await req('PATCH','/mcp/servers/hand',{body:{enabled:true,digest:await digest()}});assert.equal(res.json.change.status.state,'connected');
 res=await req('PATCH','/mcp/servers/hand',{body:{headers:{Authorization:'[REDACTED:key]'},digest:await digest()}});assert.equal(res.status,400,'a redaction marker is never saved in place of a value');assert.match(res.json.error,/redaction marker/);
 res=await req('PATCH','/mcp/servers/hand',{body:{headers:{Authorization:'Bearer ${GITHUB_TOKEN}',X:'${GITHUB_TOKEN}'},digest:await digest()}});assert.equal(res.status,200,'a reference already present may be reused');
 res=await req('PATCH','/mcp/servers/hand',{body:{headers:{Authorization:'Bearer ${GITHUB_TOKEN}',Y:'${HOME}'},digest:await digest()}});assert.equal(res.status,400,'a new non-OPENAG_MCP_ reference is refused');
 res=await req('PATCH','/mcp/servers/hand',{body:{url:'http://plain.example/mcp',digest:await digest()}});assert.equal(res.status,400,'plain http still needs the flag');
 res=await req('PATCH','/mcp/servers/hand',{body:{url:'https://elsewhere.example/mcp',digest:await digest()}});assert.equal(res.status,400,'repointing at another host re-checks every reference');assert.match(res.json.error,/changing the server address/);
 res=await req('PATCH','/mcp/servers/hand',{body:{url:'https://hand.example/v2/mcp',digest:await digest()}});assert.equal(res.status,200,'a path change on the same host keeps its existing references');
 res=await req('PATCH','/mcp/servers/hand',{body:{url:'https://elsewhere.example/mcp',headers:{Authorization:'Bearer ${OPENAG_MCP_LINEAR}'},digest:await digest()}});assert.equal(res.status,200,'a new host is fine once headers use OPENAG_MCP_ names');
 res=await req('PATCH','/mcp/servers/hand',{body:{url:'https://hand.example/mcp',headers:{Authorization:'Bearer ${GITHUB_TOKEN}'},digest:await digest()}});assert.equal(res.status,400,'a new GITHUB_TOKEN reference is refused');
 writeConfig({...read(),servers:read().servers.map(entry=>entry.id==='hand'?{...handHttp,offerToAgents:false}:entry)});await req('POST','/mcp/reload');
 res=await req('PATCH','/mcp/servers/hand',{body:{digest:await digest()}});assert.equal(res.status,400,'nothing to change');
 // offeredChanged: the hand server is not offered (switch off) while linear is: toggling its enabled flag must not invalidate ACP sessions.
 await req('PATCH','/mcp/servers/hand',{body:{enabled:false,digest:await digest()}});
 assert.equal(changes.at(-1).offeredChanged,false,'a change to a server that was not and is not offered keeps ACP sessions');
 await req('PATCH','/mcp/servers/hand',{body:{enabled:true,digest:await digest()}});
 await req('PATCH','/mcp/servers/hand',{body:{offerToAgents:true,digest:await digest()}});assert.equal(changes.at(-1).offeredChanged,true,'turning the switch on changes what bots are offered');
 group('edit, stale digest, enable/disable and invalidation rule');

 // 4. Origins that are not the desk's to change, stdio limits, unknown ids.
 for(const [path,body] of [['apple-apps',{enabled:false}],['composio-connect',{enabled:false}]]){res=await req('PATCH',`/mcp/servers/${path}`,{body:{...body,digest:await digest()}});assert.equal(res.status,409,`${path}: ${res.text}`);}
 assert.match((await req('DELETE',`/mcp/servers/apple-apps?digest=${await digest()}`)).json.error,/built in to OpenAg/);
 assert.equal((await req('PATCH','/mcp/servers/nope',{body:{enabled:false,digest:await digest()}})).status,404);
 for(const [method,path,body] of [['PATCH','/mcp/servers/localtool',{enabled:true}],['PATCH','/mcp/servers/localtool',{url:'https://x.example/mcp'}],['PATCH','/mcp/servers/localtool',{offerToAgents:false}]]){res=await req(method,path,{body:{...body,digest:await digest()}});assert.equal(res.status,409,`stdio ${JSON.stringify(body)}: ${res.text}`);assert.match(res.json.error,/local command server/);}
 res=await req('DELETE',`/mcp/servers/localtool?digest=${await digest()}`);assert.equal(res.status,409,'a stdio server cannot be removed from the desk until its command review exists');
 assert.deepEqual(read().servers[2],handStdio,'stdio entry untouched');
 group('built-in, connection and stdio limits');

 // 5. Stale approvals: editing, removing or switching off expires pending approvals of that server only.
 const pendingFor=toolName=>approvals.request({roomId:'main',botId:'bot',toolName,toolClass:'act-external',payload:{}}).approvalId;
 const mine=pendingFor('mcp.linear.SEARCH'),other=pendingFor('mcp.hand.SEARCH');
 res=await req('PATCH','/mcp/servers/linear',{body:{url:'https://mcp2.linear.example/mcp',digest:await digest()}});assert.equal(res.status,200,res.text);
 assert.notEqual(approvals.get(mine).status,'pending','editing a server expires its pending approvals');assert.equal(approvals.get(other).status,'pending','another server\'s approvals are untouched');
 // Every way a server stops being what the approval was for expires it, and leaves other servers (and their approvals) alone.
 const expiresOn=async(label,op)=>{
  const handBefore=JSON.stringify(await statusOf('hand')),a=pendingFor('mcp.linear.SEARCH'),o=pendingFor('mcp.hand.SEARCH');
  const r=await op();assert.equal(r.status,200,`${label}: ${r.text}`);
  assert.notEqual(approvals.get(a).status,'pending',`${label} expires pending approvals`);assert.equal(approvals.get(o).status,'pending',`${label} leaves another server's approvals`);approvals.expire(o);
  assert.equal(JSON.stringify(await statusOf('hand')),handBefore,`${label} leaves another server's state and tools unchanged`);
 };
 await expiresOn('disable',async()=>req('PATCH','/mcp/servers/linear',{body:{enabled:false,digest:await digest()}}));
 assert.equal((await req('PATCH','/mcp/servers/linear',{body:{enabled:true,digest:await digest()}})).status,200);
 await expiresOn('switch-off',async()=>req('PATCH','/mcp/servers/linear',{body:{offerToAgents:false,digest:await digest()}}));
 assert.equal((await req('PATCH','/mcp/servers/linear',{body:{offerToAgents:true,digest:await digest()}})).status,200);
 await expiresOn('remove',async()=>req('DELETE',`/mcp/servers/linear?digest=${await digest()}`));
 assert.equal((await add({id:'linear',url:'https://mcp2.linear.example/mcp',headers:{Authorization:'Bearer ${OPENAG_MCP_LINEAR}'},digest:await digest()})).status,201,'the id is reusable');
 group('stale approvals expire');

 // 6. Remove, id reuse, orphaned classification overrides.
 const handWithClasses=read();handWithClasses.toolClasses={linear:{SEARCH:'read'},ghost:{X:'read'}};writeConfig(handWithClasses);await req('POST','/mcp/reload');
 res=await req('DELETE',`/mcp/servers/linear?digest=${await digest()}`);assert.equal(res.status,200,res.text);assert.equal(res.json.change.action,'removed');
 assert.equal(await statusOf('linear'),undefined,'removed server disappears');assert.ok(!('linear' in read().toolClasses),'its classification overrides are removed with it');assert.ok('ghost' in read().toolClasses,'other ids keep theirs');
 assert.equal((await add({id:'linear',url:'https://mcp.linear.example/mcp',digest:await digest()})).status,201,'an id can be reused after removal');
 assert.match((await add({id:'ghost',url:'https://g.example/mcp'})).json.error,/overrides/,'a new server cannot inherit leftover classification overrides');
 group('remove, id reuse and classification overrides');

 // 7. Writer safety: CLI lock contention, unsafe file, size cap, and the 50-server limit.
 mkdirSync(join(dir,'.integration-setup.lock'),{mode:0o700});
 res=await add({id:'locked',url:'https://l.example/mcp'});assert.equal(res.status,409);assert.match(res.json.error,/another MCP configuration change|stale/);
 rmSync(join(dir,'.integration-setup.lock'),{recursive:true});assert.equal((await add({id:'locked',url:'https://l.example/mcp'})).status,201,'works once the lock is gone');
 assert.ok(!existsSync(join(dir,'.integration-setup.lock')),'the daemon releases its lock');
 chmodSync(configPath,0o664);res=await add({id:'unsafe',url:'https://u.example/mcp'});assert.equal(res.status,409);assert.match(res.json.error,/cannot be edited/);
 const liveBefore=JSON.stringify(await statusOf('hand'));await manager.applyServer('hand');assert.equal(JSON.stringify(await statusOf('hand')),liveBefore,'an unreadable file never makes a live server vanish');
 chmodSync(configPath,0o600);
 assert.equal((await listing()).entries!==undefined,true);
 const many=read();many.servers=[...Array(50)].map((_,i)=>({id:'s'+i,transport:'http',url:'https://s'+i+'.example/mcp',enabled:false}));many.toolClasses={};writeConfig(many);await req('POST','/mcp/reload');
 assert.equal((await add({id:'overflow',url:'https://o.example/mcp'})).status,409,'at most 50 servers');
 group('lock contention, unsafe file and server cap');

 // 7b. Audit: a refused audit stops the write BEFORE anything changes; a failure after the rename never skips applying the change.
 const auditPath=join(dir,'setup-audit.jsonl');writeConfig(initial);await req('POST','/mcp/reload');
 const untouched=readFileSync(configPath,'utf8');chmodSync(auditPath,0o666);
 res=await add({id:'auditx',url:'https://a.example/mcp'});assert.equal(res.status,409,res.text);assert.match(res.json.error,/nothing was changed/);assert.equal(readFileSync(configPath,'utf8'),untouched,'a refused audit leaves mcp.json byte-identical');assert.equal(await statusOf('auditx'),undefined);chmodSync(auditPath,0o600);
 const startedLine=Buffer.byteLength(JSON.stringify({at:new Date().toISOString(),operation:'desk-add',id:'auditx',outcome:'started'})+'\n');
 writeFileSync(auditPath,'x'.repeat(256*1024-startedLine-1),{mode:0o600}); // the started record fits, the completed one does not
 res=await add({id:'auditx',url:'https://a.example/mcp'});assert.equal(res.status,201,res.text);
 assert.ok(read().servers.some(entry=>entry.id==='auditx'),'the file was replaced');assert.equal((await statusOf('auditx')).state,'connected','and the change was applied to the running server');
 assert.ok(JSON.stringify(ledger.list('_system')).includes('mcp_server_added'),'and the ledger event was written');
 rmSync(auditPath);assert.equal((await req('DELETE',`/mcp/servers/auditx?digest=${await digest()}`)).status,200);
 group('audit before the write; failure after the rename never skips applying');

 // 7c. Server check: a tool action. Nothing is contacted until the approval is accepted, nothing is registered, and only accept runs it.
 writeConfig(initial);await req('POST','/mcp/reload');
 const until=async(read,predicate)=>{const end=Date.now()+8000;do{const value=await read();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);throw Error('check deadline');};
 const resultOf=id=>req('GET',`/mcp/servers/check/${id}`).then(r=>r.json);
 const propose=body=>req('POST','/mcp/servers/check',{body});
 const decide=(id,kind)=>approvals.resolve(id,{kind},approvals.get(id).reviewVersion);
 const candidate={id:'cand',url:'https://cand.example/mcp',headers:{Authorization:'Bearer ${OPENAG_MCP_LINEAR}'}};
 for(const [method,path,body] of [['POST','/mcp/servers/check',candidate],['GET','/mcp/servers/check/whatever']])assert.equal((await req(method,path,{token:limited,body})).status,403,`limited ${method} ${path}`);
 for(const [name,body] of [['plain http',{url:'http://x.example/mcp'}],['daemon secret',{url:'https://x.example/mcp',headers:{A:'${OPENAG_TOKEN}'}}],['GITHUB_TOKEN',{url:'https://x.example/mcp',headers:{A:'${GITHUB_TOKEN}'}}],['stdio smuggled in',{url:'https://x.example/mcp',command:'rm'}],['bad id',{id:'Bad Id',url:'https://x.example/mcp'}],['reserved id',{id:'openag',url:'https://x.example/mcp'}],['query secret',{url:'https://x.example/mcp?key=abcdef123456'}]]){res=await propose(body);assert.equal(res.status,400,`${name}: ${res.text}`);}
 assert.equal(approvals.listPending().filter(a=>a.toolName==='mcp_server_check').length,0,'a refused candidate creates no approval');
 res=await propose(candidate);assert.equal(res.status,202,res.text);const checkId=res.json.approvalId;
 let approval=approvals.get(checkId);
 assert.equal(approval.toolName,'mcp_server_check');assert.equal(approval.toolClass,'act-external','never auto');assert.equal(approval.status,'pending');assert.equal(approval.roomId,'_system','no delivery room yet: falls back to the hidden room');
 assert.deepEqual(approval.payload.headers,[{name:'Authorization',template:'Bearer ${OPENAG_MCP_LINEAR}'}],'header templates stay readable in the stored proposal');
 assert.ok(!JSON.stringify(approval.payload).includes(SECRET),'the proposal carries names and templates, never values');
 assert.equal(connects.get('cand'),undefined,'nothing is contacted before the approval is accepted');assert.deepEqual(await resultOf(checkId),{state:'pending'});
 const registeredBefore=JSON.stringify((await listing()).servers),toolsBefore=manager.toolDefs().map(def=>def.name).join();assert.ok(toolsBefore.includes('mcp.hand.SEARCH'),'the comparison below is not vacuous: real servers offer real tools');
 decide(checkId,'accept');
 const done=await until(()=>resultOf(checkId),value=>value.state==='done');
 assert.equal(done.ok,true);assert.deepEqual(done.tools.map(tool=>tool.name),['SEARCH']);assert.equal(connects.get('cand'),1,'contacted exactly once, after accept');
 assert.equal(JSON.stringify((await listing()).servers),registeredBefore,'a check registers no server');assert.equal(manager.toolDefs().map(def=>def.name).join(),toolsBefore,'and makes no tool available');
 assert.equal(read().servers.some(entry=>entry.id==='cand'),false,'and writes nothing to mcp.json');
 assert.equal(approvals.receipts.get(checkId).outcome,'completed');
 assert.ok(resolvedHeaders.some(headers=>JSON.stringify(headers).includes(SECRET)),'the reference was resolved for the real connection');assert.ok(!JSON.stringify(done).includes(SECRET),'but the result never carries the value');
 // Only accept runs it: ignore and respond never contact the endpoint.
 for(const kind of ['ignore','respond']){res=await propose({...candidate,id:'other'});const id=res.json.approvalId;const before=connects.get('other');approvals.resolve(id,kind==='respond'?{kind,text:'no'}:{kind},approvals.get(id).reviewVersion);await until(()=>resultOf(id),value=>value.state==='declined');assert.equal(connects.get('other'),before,`${kind} contacts nothing`);}
 // Failures are redacted events, not Inbox items; a missing variable is reported by name only.
 res=await propose({id:'bad',url:'https://bad.example/mcp',headers:{Authorization:'Bearer ${OPENAG_MCP_LINEAR}'}});decide(res.json.approvalId,'accept');
 const failed=await until(()=>resultOf(res.json.approvalId),value=>value.state==='done');assert.equal(failed.ok,false);assert.equal(failed.reason,'connect failed');assert.ok(!JSON.stringify(failed).includes(SECRET),'a connector error that echoed the header is not shown');
 assert.ok(ledger.list('_system').some(event=>JSON.stringify(event).includes('mcp_server_check_failed')&&JSON.stringify(event).includes('connect failed')),'the failure is a _system event');
 assert.equal(approvals.receipts.get(res.json.approvalId).outcome,'failed');
 res=await propose({url:'https://cand.example/mcp',headers:{A:'${OPENAG_MCP_NOT_SET}'}});decide(res.json.approvalId,'accept');
 const missing=await until(()=>resultOf(res.json.approvalId),value=>value.state==='done');assert.equal(missing.reason,'missing env OPENAG_MCP_NOT_SET');
 assert.ok(!JSON.stringify(ledger.list('_system')).includes(SECRET),'no value in any event');
 // The delivery room keeps a forgotten check visible in the Inbox.
 setSetting(db,'deliveryRoom',{roomId:'main'});res=await propose(candidate);assert.equal(approvals.get(res.json.approvalId).roomId,'main','proposed into the delivery room');approvals.expire(res.json.approvalId);
 // An approval accepted after a restart still runs, from its stored payload; a stale one is expired on startup; the pending cap holds.
 res=await propose(candidate);const survivor=res.json.approvalId;check.dispose();check=createMcpServerCheck({db,ledger,approvals,mcp:manager});
 assert.deepEqual(await resultOf(survivor),{state:'pending'},'the new instance picks up the pending check');decide(survivor,'accept');
 assert.equal((await until(()=>resultOf(survivor),value=>value.state==='done')).ok,true,'accepted after a restart, it still runs');
 res=await propose(candidate);const stale=res.json.approvalId;db.prepare('UPDATE approvals SET created_at=? WHERE id=?').run(Date.now()-11*60_000,stale);check.dispose();check=createMcpServerCheck({db,ledger,approvals,mcp:manager});
 assert.notEqual(approvals.get(stale).status,'pending','a check older than its window is expired at startup');assert.deepEqual(await resultOf(stale),{state:'expired'});
 const ids=[];for(let i=0;i<5;i++){res=await propose(candidate);assert.equal(res.status,202);ids.push(res.json.approvalId);}
 res=await propose(candidate);assert.equal(res.status,409,'at most 5 checks wait for a decision');for(const id of ids)approvals.expire(id);
 // Defence in depth: the manager itself never checks a command server, and a tampered stored proposal is re-validated before anything runs.
 const stdioCheck=await manager.checkServer({id:'stdiox',transport:'stdio',command:'node',args:['server.js']});assert.deepEqual(stdioCheck,{ok:false,reason:'only remote servers can be checked'});assert.equal(connects.get('stdiox'),undefined,'no command is ever started by a check');
 for(const [label,payload,reason] of [['plain http row',{url:'http://insecure.example/mcp',headers:[],allowPrivateNetwork:false},/http requires allowPrivateNetwork/],['daemon secret row',{url:'https://x.example/mcp',headers:[{name:'A',template:'${OPENAG_TOKEN}'}],allowPrivateNetwork:false},/daemon secret/],['malformed row',{foo:1},/stored proposal is invalid/]]){
  const forged=approvals.request({roomId:'_system',botId:'daemon',toolName:'mcp_server_check',toolClass:'act-external',source:'mcp-server-check',payload}).approvalId;const contacts=[...connects.values()].reduce((a,b)=>a+b,0);
  decide(forged,'accept');const outcome=await until(()=>resultOf(forged),value=>value.state==='done');assert.equal(outcome.ok,false,label);assert.match(outcome.reason,reason,label);assert.equal([...connects.values()].reduce((a,b)=>a+b,0),contacts,`${label}: nothing contacted`);
 }
 // Without the services the routes answer 503 for the owner, 403 for everyone else.
 const bare=createGateway({db,auth,ledger,approvals,dataDir:dir,mcp:manager,dispatch(){}});
 const bareReq=(method,path,token,body)=>bare.request(path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 for(const [method,path,body] of [['POST','/mcp/servers/check',candidate],['GET','/mcp/servers/check/x'],['POST','/mcp/servers',{id:'z',url:'https://z.example/mcp'}],['PATCH','/mcp/servers/hand',{enabled:false,digest:'x'}],['DELETE','/mcp/servers/hand?digest=x']]){assert.equal((await bareReq(method,path,OWNER,body)).status,503,`owner ${method} ${path} without the service`);assert.equal((await bareReq(method,path,limited,body)).status,403,`limited ${method} ${path}`);}
 // Review follow-ups. A lookalike approval (no source marker) is never run.
 const lookalike=approvals.request({roomId:'_system',botId:'daemon',toolName:'mcp_server_check',toolClass:'act-external',payload:{url:'https://cand.example/mcp',headers:[],allowPrivateNetwork:false}}).approvalId;const contactsBefore=[...connects.values()].reduce((a,b)=>a+b,0);
 decide(lookalike,'accept');await new Promise(resolve=>setTimeout(resolve,200));assert.equal([...connects.values()].reduce((a,b)=>a+b,0),contactsBefore,'an approval without the daemon\'s source marker is never run');assert.equal((await resultOf(lookalike)).error,'check not found');
 // The owner gate runs before the body is read: a limited device sending garbage learns nothing.
 for(const [method,path] of [['POST','/mcp/servers'],['PATCH','/mcp/servers/hand'],['DELETE','/mcp/servers/hand'],['POST','/mcp/servers/check']]){res=await app.request(path,{method,headers:{authorization:`Bearer ${limited}`,'content-type':'application/json'},...(method==='DELETE'?{}:{body:'{"nonsense":true}'})});assert.equal(res.status,403,`limited ${method} ${path} with an invalid body`);}
 // A check is not an external action: it never blocks one, even while it runs, and a restart mid-check leaves nothing blocking.
 hold=new Promise(resolve=>{release=resolve});var release;
 res=await propose({id:'slow',url:'https://slow.example/mcp'});const slowId=res.json.approvalId;decide(slowId,'accept');await until(()=>resultOf(slowId),value=>value.state==='running');
 const external=approvals.request({roomId:'main',botId:'bot',toolName:'some_external_tool',toolClass:'act-external',payload:{}}).approvalId;approvals.resolve(external,{kind:'accept'},approvals.get(external).reviewVersion);
 approvals.receipts.start(external,null,null);approvals.receipts.finish(external,{outcome:'completed',detail:'ok'});assert.equal(approvals.receipts.get(external).outcome,'completed','another external action runs while a check is running');
 assert.equal(approvals.receipts.blocked('bot','mcp.x.y'),false,'a running check marks nothing as started');
 check.dispose();approvals.receipts.recover();assert.equal(approvals.receipts.get(slowId).outcome,'not-run','a restart mid-check closes the receipt as not-run, never unknown');assert.equal(approvals.receipts.blocked('bot','mcp.x.y'),false,'and nothing is left blocking');
 release();check=createMcpServerCheck({db,ledger,approvals,mcp:manager});hold=null;
 // Two checks back to back both complete and both receipts are finished.
 const pair=[];for(const label of ['a','b']){res=await propose({id:'cand',url:'https://cand.example/mcp',headers:{Authorization:'Bearer ${OPENAG_MCP_LINEAR}'}});pair.push(res.json.approvalId);}
 for(const id of pair)decide(id,'accept');for(const id of pair){assert.equal((await until(()=>resultOf(id),value=>value.state==='done')).ok,true);assert.equal(approvals.receipts.get(id).outcome,'completed');}
 // A failed check is not an Inbox item.
 const pendingBefore=approvals.listPending().length;res=await propose({id:'bad',url:'https://bad.example/mcp'});decide(res.json.approvalId,'accept');await until(()=>resultOf(res.json.approvalId),value=>value.state==='done');assert.equal(approvals.listPending().length,pendingBefore,'a failure leaves no pending item behind');
 // A proposal the redactor would rewrite is refused (what ran would differ from what was approved); a stored marker is refused at run time.
 res=await propose({url:'https://cand.example/mcp',headers:{Cookie:'session_token=${OPENAG_MCP_LINEAR}'}});assert.equal(res.status,400,res.text);assert.match(res.json.error,/looks like it contains a secret/);
 const marked=approvals.request({roomId:'_system',botId:'daemon',toolName:'mcp_server_check',toolClass:'act-external',source:'mcp-server-check',payload:{url:'https://cand.example/mcp',headers:[{name:'Cookie',template:'session_token=[REDACTED:secret]'}],allowPrivateNetwork:false}}).approvalId;
 const contactsMarked=[...connects.values()].reduce((a,b)=>a+b,0);decide(marked,'accept');assert.match((await until(()=>resultOf(marked),value=>value.state==='done')).reason,/altered by redaction/);assert.equal([...connects.values()].reduce((a,b)=>a+b,0),contactsMarked,'a redacted proposal contacts nothing');
 // A check cannot send an existing reference to a different host, the same rule as saving.
 res=await propose({id:'hand',url:'https://evil.example/collect',headers:{Authorization:'Bearer ${GITHUB_TOKEN}'}});assert.equal(res.status,400,'an existing reference cannot follow the check to a new origin');assert.match(res.json.error,/OPENAG_MCP_/);
 res=await propose({id:'hand',url:'https://hand.example/v2/mcp',headers:{Authorization:'Bearer ${GITHUB_TOKEN}'}});assert.equal(res.status,202,'the same origin keeps its existing reference');approvals.expire(res.json.approvalId);
 res=await propose({id:'hand',url:'https://evil.example/collect',headers:{Authorization:'Bearer ${OPENAG_MCP_LINEAR}'}});assert.equal(res.status,202,'a new origin is fine with an OPENAG_MCP_ reference');approvals.expire(res.json.approvalId);
 // Management checks require owner/Full decisions; Limited devices cannot start network access.
 res=await propose(candidate);const viaPhone=res.json.approvalId;res=await app.request(`/approvals/${viaPhone}`,{method:'POST',headers:{authorization:`Bearer ${limited}`,'content-type':'application/json'},body:JSON.stringify({kind:'accept',reviewVersion:approvals.get(viaPhone).reviewVersion})});assert.equal(res.status,403,'a limited device cannot decide');assert.equal(approvals.get(viaPhone).status,'pending');assert.equal((await req('POST',`/approvals/${viaPhone}`,{token:full,body:{kind:'accept',reviewVersion:approvals.get(viaPhone).reviewVersion}})).status,200);
 assert.equal((await until(()=>resultOf(viaPhone),value=>value.state==='done')).ok,true);assert.equal((await req('GET',`/mcp/servers/check/${viaPhone}`,{token:limited})).status,403,'but cannot read the result');
 // A pending check keeps its expiry however many results pile up.
 res=await propose(candidate);const keeper=res.json.approvalId;for(let i=0;i<22;i++){res=await propose({...candidate,id:'other'});approvals.resolve(res.json.approvalId,{kind:'ignore'},approvals.get(res.json.approvalId).reviewVersion);}
 assert.equal((await resultOf(keeper)).state,'pending','a pending check is never evicted by finished ones');approvals.expire(keeper);
 // The expiry timer and the result TTL really fire (short windows on a fresh instance).
 check.dispose();check=createMcpServerCheck({db,ledger,approvals,mcp:manager,expiryMs:120,resultTtlMs:300});
 res=await propose(candidate);const waiting=res.json.approvalId;await until(()=>resultOf(waiting),value=>value.state==='expired');assert.notEqual(approvals.get(waiting).status,'pending','an unanswered check expires on its timer');
 res=await propose(candidate);const finished=res.json.approvalId;decide(finished,'accept');await until(()=>resultOf(finished),value=>value.state==='done');
 await until(()=>resultOf(finished),value=>value.error==='check not found');await until(()=>resultOf(waiting),value=>value.error==='check not found');
 check.dispose();check=createMcpServerCheck({db,ledger,approvals,mcp:manager});
 // Per-server changes never re-read other servers' classifications: a hand edit to another server's overrides waits for a reload.
 const classed=read();classed.toolClasses={hand:{SEARCH:'read'}};writeConfig(classed);await req('POST','/mcp/reload');assert.equal(classify('mcp.hand.SEARCH'),'read');
 const edited=read();edited.toolClasses={hand:{SEARCH:'search'}};writeConfig(edited);
 assert.equal((await add({id:'linear2',url:'https://l2.example/mcp',digest:await digest()})).status,201);
 await refreshers.get('hand')();assert.equal(classify('mcp.hand.SEARCH'),'read','when another server refreshes later, a per-server apply has not moved its classification');
 await req('POST','/mcp/reload');assert.equal(classify('mcp.hand.SEARCH'),'search','and a full reload does apply it');
 await req('DELETE',`/mcp/servers/linear2?digest=${await digest()}`);writeConfig(initial);await req('POST','/mcp/reload');
 group('server check: approval-gated, nothing registered, only accept runs it');

 // Accepted management jobs remain owned after their subscribers are disposed.
 let finishOwnedCheck;const ownedCheck=createMcpServerCheck({db,ledger,approvals,mcp:{checkServer:()=>new Promise(resolve=>{finishOwnedCheck=resolve;})}});
 const owned=ownedCheck.request({url:'https://owned.example/mcp',headers:{},allowPrivateNetwork:false});approvals.resolve(owned.approvalId,{kind:'accept'},approvals.get(owned.approvalId).reviewVersion);await until(()=>finishOwnedCheck,Boolean);
 ownedCheck.dispose();let checkDrained=false;const drainCheck=ownedCheck.idle().then(()=>{checkDrained=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(checkDrained,false);finishOwnedCheck({ok:true,tools:[],truncated:false});await drainCheck;assert.equal(approvals.receipts.get(owned.approvalId).outcome,'completed');
 group('accepted server checks drain before storage closes');

 // 8. Nothing sensitive in responses, the ledger or the setup audit.
 writeConfig(initial);await req('POST','/mcp/reload');
 await add({id:'linear',url:'https://mcp.linear.example/mcp',headers:{Authorization:'Bearer ${OPENAG_MCP_LINEAR}'},digest:await digest()});
 assert.ok(resolvedHeaders.some(headers=>JSON.stringify(headers).includes(SECRET)),'the secret really was resolved and handed to the connector, so the absence checks below can fail');
 const everything=JSON.stringify(ledger.list('_system'))+readFileSync(join(dir,'setup-audit.jsonl'),'utf8')+(await req('GET','/mcp/servers')).text;
 assert.ok(!everything.includes(SECRET)&&!everything.includes('github-value-5521'),'no resolved secret value anywhere');
 assert.match(everything,/mcp_server_added/);assert.match(everything,/desk-add/);assert.ok(everything.includes('"headerNames":["Authorization"]'),'audit names headers, not values');
 group('no secret values in responses, ledger or setup audit');
}finally{
 check.dispose();await manager.close();await check.idle();db.close();rmSync(dir,{recursive:true,force:true});
}
console.log(`MCP management verification passed (${groups} groups).`);
