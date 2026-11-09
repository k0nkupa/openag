// Standalone acceptance for OA-455 direct secrets on custom MCP servers. Temporary data, a fake connector and synthetic devices only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,renameSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {openDb}=await load('db/index'),{createAuth}=await load('auth'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals');
const {createGateway}=await load('gateway'),{createMcpManager}=await load('mcp'),{createMcpServerService}=await load('mcp-servers'),{createMcpServerCheck}=await load('mcp-check');
const {createMcpSecrets}=await load('mcp-secrets'),{createRedactor,getDefaultRedactor}=await load('redact'),{createBot,createRoom,addMember}=await load('rooms');
const dir=mkdtempSync(join(tmpdir(),'openag-mcp-secrets-')),db=openDb(dir),ledger=createLedger(db),approvals=createApprovals(db,ledger);
const OWNER='owner-token-secrets-synthetic-90210',SECRET='direct-secret-value-DO-NOT-LEAK-48151623',OTHER='second-secret-value-DO-NOT-LEAK-4242';
const auth=createAuth({db,ownerToken:OWNER});
createBot(db,{id:'bot',runtime:'acp'});createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
const connects=[];
const connector=async cfg=>{connects.push({id:cfg.id,url:cfg.url,headers:{...cfg.headers}});
 return {client:{setNotificationHandler(){},getServerVersion:()=>({name:'Synthetic',version:'1'}),listTools:async()=>({tools:[{name:'SEARCH',description:'fixture',inputSchema:{type:'object',properties:{}}}]}),callTool:async()=>({content:[{type:'text',text:'ok'}]})},close:async()=>{}};};
const secrets=createMcpSecrets({dataDir:dir,env:{}});
const manager=createMcpManager({dataDir:dir,env:{},secrets,connector});
const service=createMcpServerService({dataDir:dir,mcp:manager,approvals,secrets});
let check=createMcpServerCheck({db,ledger,approvals,mcp:manager});
const app=createGateway({db,auth,ledger,approvals,dataDir:dir,mcp:manager,mcpServers:service,mcpCheck:check,dispatch(){}});
const limited=auth.createDevice('Phone','owner','limited').token;
const req=async(method,path,{token=OWNER,body}={})=>{const res=await app.request(path,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await res.text();let json;try{json=text?JSON.parse(text):undefined;}catch{}return {status:res.status,json,text};};
const listing=async()=>(await req('GET','/mcp/servers')).json;
const digest=async()=>(await listing()).entries.digest;
const statusOf=async id=>(await listing()).servers.find(server=>server.id===id);
const configPath=join(dir,'mcp.json'),readConfig=()=>JSON.parse(readFileSync(configPath,'utf8'));
let groups=0;const group=name=>{groups++;console.log('PASS '+name);};
const last=id=>connects.filter(c=>c.id===id).at(-1);
const URL1='https://linear.example/mcp';
const linear=(extra={})=>({id:'linear',url:URL1,headers:{Authorization:'Bearer ${secret:TOKEN}'},...extra});
const put=(id,name,value,opts)=>req('PUT',`/mcp/secrets/${id}/${name}`,{token:opts?.token,body:{value,...(opts?.origin?{origin:opts.origin}:{})}});
const sinks=()=>{
 const files=[configPath,join(dir,'connector-mcp.enc'),join(dir,'setup-audit.jsonl'),join(dir,'openag.db'),join(dir,'openag.db-wal')].filter(existsSync).map(f=>[f,readFileSync(f)]);
 return [...files,['ledger',Buffer.from(JSON.stringify(ledger.list('_system',{limit:5000})))],['approvals',Buffer.from(JSON.stringify(approvals.listPending()))],['status',Buffer.from(JSON.stringify(manager.status()))],['entries',Buffer.from(JSON.stringify(manager.entries()))],['env',Buffer.from(JSON.stringify(process.env))]];
};
const leaks=value=>sinks().filter(([,bytes])=>bytes.includes(value)).map(([name])=>name);
try{
 await manager.load();
 // 1. Authority and input rules.
 let res=await req('POST','/mcp/servers',{body:linear()});assert.equal(res.status,201,res.text);
 for(const [method,path,body] of [['GET','/mcp/secrets'],['PUT','/mcp/secrets/linear/TOKEN',{value:SECRET}],['DELETE','/mcp/secrets/linear/TOKEN']])assert.equal((await req(method,path,{token:limited,body})).status,403,`limited ${method}`);
 assert.deepEqual(leaks(SECRET),[],'a refused write stores nothing');
 assert.equal((await put('nothere','TOKEN',SECRET)).status,404,'unknown server');
 for(const bad of ['token','1TOKEN','TOKEN-X','A'.repeat(65),''])assert.equal((await put('linear',bad||'%20',SECRET)).status,400,`name ${bad.slice(0,10)}`);
 for(const bad of ['', 'x'.repeat(1025), 'line\nbreak','short-one','has spaces inside the value','/looks/like/a/path/value'])assert.equal((await put('linear','TOKEN',bad)).status,400,'value rule: '+bad.slice(0,12));
 assert.deepEqual(leaks('has spaces inside the value'),[],'a refused value is not stored');
 assert.equal((await req('PUT','/mcp/secrets/linear/TOKEN',{body:undefined})).status,400);
 assert.equal((await req('PUT','/mcp/secrets/linear/TOKEN',{body:{value:SECRET,extra:1}})).status,400,'strict body');
 writeFileSync(configPath,JSON.stringify({servers:[...readConfig().servers,{id:'tool',transport:'stdio',command:'node',args:['x.js']}]}),{mode:0o600});await manager.reload();
 assert.equal((await put('tool','TOKEN',SECRET)).status,409,'stdio entries take no secrets');
 assert.equal((await put('apple-apps','TOKEN',SECRET)).status,404);
 group('authority and input rules');

 // 2. Add with a reference: fails closed until the secret exists; then connects with the real value, never showing it.
 let status=await statusOf('linear');assert.equal(status.state,'skipped');assert.match(status.detail,/missing secret TOKEN/);assert.equal(connects.filter(c=>c.id==='linear').length,0,'nothing connected without the secret');
 assert.equal((await put('linear','TOKEN',SECRET,{origin:'https://moved.example'})).status,409,'a secret typed for another origin is refused, not bound to the current one');
 res=await put('linear','TOKEN',SECRET,{origin:'https://linear.example'});assert.equal(res.status,200,res.text);assert.deepEqual(res.json.secret,{serverId:'linear',name:'TOKEN',origin:'https://linear.example',last4:SECRET.slice(-4)});
 assert.ok(!res.text.includes(SECRET),'the response never carries the value');
 status=await statusOf('linear');assert.equal(status.state,'connected');assert.equal(last('linear').headers.Authorization,`Bearer ${SECRET}`,'resolved only at connect time');
 assert.equal(readConfig().servers.find(s=>s.id==='linear').headers.Authorization,'Bearer ${secret:TOKEN}','the file keeps the reference');
 res=await req('GET','/mcp/secrets');assert.equal(res.status,200);assert.equal(res.json.secrets.length,1);assert.ok(!res.text.includes(SECRET));
 assert.ok(!(await req('GET','/mcp/servers')).text.includes(SECRET),'the status and entry views carry no value');
 assert.equal(statSync(join(dir,'connector-mcp.enc')).mode&0o077,0,'private file');
 group('reference fails closed, then resolves at connect');

 // 3. Nothing durable or visible holds the plaintext.
 assert.deepEqual(leaks(SECRET),[],'no plaintext in mcp.json, the store, the audit file, the DB, the ledger, approvals, status or the environment');
 assert.ok(readFileSync(join(dir,'connector-mcp.enc')).length>29,'the store is present and encrypted');
 assert.ok(ledger.list('_system',{limit:5000}).some(e=>e.payload?.action==='mcp_secret_set'&&e.payload.name==='TOKEN'&&e.payload.id==='linear'),'audited by name');
 assert.notEqual(getDefaultRedactor().redactString(`x ${SECRET} y`),`x ${SECRET} y`,'registered with the redactor');
 const fresh=createRedactor();createMcpSecrets({dataDir:dir,env:{},redactor:fresh}).register();assert.notEqual(fresh.redactString(`x ${SECRET} y`),`x ${SECRET} y`,'registered again at startup');
 group('no plaintext in any sink');

 // 4. Literals still rejected; references have a strict shape; the value is never re-expanded.
 for(const [headers,pattern] of [[{Authorization:'Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'},/looks like a secret/],[{Authorization:'${secret:lower}'},/malformed/],[{Authorization:'${secret:}'},/malformed/],[{Authorization:'Bearer ${secret:TOKEN'},/malformed/]]){
  res=await req('POST','/mcp/servers',{body:{id:'bad1',url:'https://bad.example/mcp',headers}});assert.equal(res.status,400,JSON.stringify(headers));assert.match(res.json.error,pattern);
 }
 res=await req('POST','/mcp/servers',{body:{id:'bad2',url:'https://bad.example/mcp?k=${secret:TOKEN}'}});assert.equal(res.status,400,'a url never takes a reference');
 res=await put('linear','TOKEN','abc${HOME}defghijkl');assert.equal(res.status,200);assert.equal(last('linear').headers.Authorization,'Bearer abc${HOME}defghijkl','one pass: the secret value is not expanded again');
 res=await put('linear','TOKEN',SECRET);assert.equal(res.status,200);
 // A long secret name is only a name: the redactor must not mask the reference in the owner's view or in an approval.
 res=await req('POST','/mcp/servers',{body:{id:'longname',url:'https://long.example/mcp',headers:{Authorization:'Bearer ${secret:A_VERY_LONG_SECRET_NAME}'},digest:await digest()}});assert.equal(res.status,201,res.text);
 assert.equal((await listing()).entries.servers.find(e=>e.id==='longname').headers[0].template,'Bearer ${secret:A_VERY_LONG_SECRET_NAME}','the reference is shown as written');
 res=await req('POST','/mcp/servers/check',{body:{id:'longname',url:'https://long.example/mcp',headers:{Authorization:'Bearer ${secret:A_VERY_LONG_SECRET_NAME}'}}});assert.equal(res.status,202,res.text);
 res=await req('DELETE',`/mcp/servers/longname?digest=${await digest()}`);assert.equal(res.status,200,res.text);
 {const r=createRedactor();for(const real of ['export X=${DB_PASSWORD:-hunter2hunter2xyz}','${API_TOKEN=abcdefgh12345678}','password: hunter2hunter2xyz'])assert.notEqual(r.redactString(real),real,'still redacted: '+real);
  for(const reference of ['Bearer ${secret:A_VERY_LONG_SECRET_NAME}','${secret:TOKEN}'])assert.equal(r.redactString(reference),reference,'a reference is left alone: '+reference);}
 group('literal rule, reference shape, single-pass resolution');

 // 5. A same-origin edit keeps the secret; a header that reuses it elsewhere works; a new env reference still follows the OA-454 rule.
 res=await req('PATCH','/mcp/servers/linear',{body:{url:'https://linear.example/other-path',digest:await digest()}});assert.equal(res.status,200,res.text);
 assert.equal((await statusOf('linear')).state,'connected');assert.equal(last('linear').headers.Authorization,`Bearer ${SECRET}`);
 res=await req('PATCH','/mcp/servers/linear',{body:{headers:{Authorization:'Bearer ${secret:TOKEN}','X-Other':'${GITHUB_TOKEN}'},digest:await digest()}});assert.equal(res.status,400,'env references keep their own rule');
 group('same-origin edit keeps the secret');

 // 6. A different origin drops the secret, even if the header still references it.
 res=await req('PATCH','/mcp/servers/linear',{body:{url:'https://elsewhere.example/mcp',digest:await digest()}});assert.equal(res.status,200,res.text);
 const before=connects.length;
 status=await statusOf('linear');assert.equal(status.state,'skipped');assert.match(status.detail,/missing secret TOKEN/);
 assert.deepEqual((await req('GET','/mcp/secrets')).json.secrets,[],'the secret went with the origin change');
 assert.ok(!connects.slice(before-1).some(c=>c.url?.includes('elsewhere')&&JSON.stringify(c.headers).includes(SECRET)),'the new host never saw it');
 assert.deepEqual(leaks(SECRET),[],'and no copy remains');
 group('origin change drops the secret');

 // 7. Hand-editing the file to repoint a stored secret cannot send it elsewhere (binding checked at connect).
 res=await req('PATCH','/mcp/servers/linear',{body:{url:URL1,digest:await digest()}});assert.equal(res.status,200);
 assert.equal((await put('linear','TOKEN',SECRET)).status,200);assert.equal((await statusOf('linear')).state,'connected');
 const edited=readConfig();edited.servers.find(s=>s.id==='linear').url='https://attacker.example/mcp';writeFileSync(configPath,JSON.stringify(edited),{mode:0o600});await manager.reload();
 status=await statusOf('linear');assert.equal(status.state,'skipped');assert.ok(!connects.some(c=>c.url?.includes('attacker')),'bound to its origin, not to its id');
 edited.servers.find(s=>s.id==='linear').url=URL1;writeFileSync(configPath,JSON.stringify(edited),{mode:0o600});await manager.reload();assert.equal((await statusOf('linear')).state,'connected');
 group('binding is checked at connect');

 // 8. Deleting a secret fails closed, also after a restart; remove and id reuse inherit nothing.
 res=await req('DELETE','/mcp/secrets/linear/TOKEN');assert.equal(res.status,200);assert.equal((await statusOf('linear')).state,'skipped');
 assert.equal((await req('DELETE','/mcp/secrets/linear/TOKEN')).status,404);
 assert.equal((await put('linear','TOKEN',SECRET)).status,200);
 const again=createMcpManager({dataDir:dir,env:{},secrets:createMcpSecrets({dataDir:dir,env:{}}),connector});await again.load();assert.equal(again.status().find(s=>s.id==='linear').state,'connected','survives a restart');
 await again.close();
 res=await req('DELETE',`/mcp/servers/linear?digest=${await digest()}`);assert.equal(res.status,200,res.text);
 assert.deepEqual((await req('GET','/mcp/secrets')).json.secrets,[],'removal drops its secrets');
 res=await req('POST','/mcp/servers',{body:linear({digest:await digest()})});assert.equal(res.status,201);assert.equal((await statusOf('linear')).state,'skipped','a reused id inherits nothing');
 assert.deepEqual(leaks(SECRET),[],'no copy after removal');
 group('delete fails closed; removal and id reuse inherit nothing');

 // 9. Server check: the approval carries the template only; a secret resolves for its own server and origin, never for a candidate elsewhere.
 assert.equal((await put('linear','TOKEN',SECRET)).status,200);
 const until=async(read,predicate)=>{const end=Date.now()+8000;do{const value=await read();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);throw Error('check deadline');};
 const runCheck=async candidate=>{res=await req('POST','/mcp/servers/check',{body:candidate});assert.equal(res.status,202,res.text);const id=res.json.approvalId;
  const payload=JSON.stringify(approvals.get(id).payload);assert.ok(payload.includes('${secret:TOKEN}')&&!payload.includes(SECRET),'the approval holds the reference, not the value');
  approvals.resolve(id,{kind:'accept'},approvals.get(id).reviewVersion);return until(async()=>(await req('GET',`/mcp/servers/check/${id}`)).json,s=>s.state==='done');};
 const checkHeaders={Authorization:'Bearer ${secret:TOKEN}'};
 let done=await runCheck({id:'linear',url:URL1,headers:checkHeaders});assert.equal(done.ok,true,JSON.stringify(done));assert.equal(last('linear').headers.Authorization,`Bearer ${SECRET}`);
 done=await runCheck({id:'linear',url:'https://elsewhere.example/mcp',headers:checkHeaders});assert.equal(done.ok,false);assert.match(done.reason,/missing secret TOKEN/,'another origin gets nothing');
 done=await runCheck({url:URL1,headers:checkHeaders});assert.equal(done.ok,false,'an unsaved candidate has no secrets');
 assert.deepEqual(leaks(SECRET),[],'checks leave no copy');
 group('server check');

 // 10. Two secrets for two servers stay separate; the cap holds.
 res=await req('POST','/mcp/servers',{body:{id:'other',url:'https://other.example/mcp',headers:{'X-Key':'${secret:TOKEN}'},digest:await digest()}});assert.equal(res.status,201);
 assert.equal((await put('other','TOKEN',OTHER)).status,200);assert.equal(last('other').headers['X-Key'],OTHER);assert.equal(last('linear').headers.Authorization,`Bearer ${SECRET}`);
 assert.deepEqual((await req('GET','/mcp/secrets')).json.secrets.map(s=>`${s.serverId}/${s.name}`),['linear/TOKEN','other/TOKEN']);
 for(let i=0;i<38;i++)assert.equal((await put('other',`K${i}`,`filler-value-${i}-abcdefgh`)).status,200,'cap '+i);
 assert.equal((await put('other','ONEMORE','filler-value-xx-abcdefgh')).status,409,'at most 40 secrets');
 assert.equal((await put('other','K0','replaced-value-abcdefgh')).status,200,'replacing is not adding');
 group('separate secrets, cap');

 // 11. A key that needs recovery fails closed: nothing resolves, nothing is rotated.
 const keyDir=join(dir,'.connectors'),moved=join(dir,'.connectors-away');
 renameSync(keyDir,moved);
 const stuck=createMcpSecrets({dataDir:dir,env:{}});
 assert.equal(stuck.get('linear','TOKEN','https://linear.example'),undefined,'unreadable store resolves nothing');
 assert.throws(()=>stuck.list(),/cannot be read/);assert.ok(!existsSync(join(keyDir,'key')),'no replacement key is generated behind an existing store');
 rmSync(keyDir,{recursive:true,force:true});renameSync(moved,keyDir);
 assert.equal(createMcpSecrets({dataDir:dir,env:{}}).get('linear','TOKEN','https://linear.example'),SECRET,'restored key works');
 group('missing key fails closed');
 const auditPath=join(dir,'setup-audit.jsonl');fs.chmodSync(auditPath,0o644);
 try{assert.equal((await req('PATCH','/mcp/servers/linear',{body:{url:'https://other.example/mcp',digest:await digest()}})).status,409);assert.equal((await req('DELETE','/mcp/servers/linear?digest='+await digest())).status,409);assert.equal(secrets.get('linear','TOKEN','https://linear.example'),SECRET,'A refused audit preserves working credentials');}finally{fs.chmodSync(auditPath,0o600);}
 const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(String(to).endsWith('/mcp.json'))throw Error('Injected config rename failure');return rename(from,to);};syncBuiltinESMExports();
 try{assert.equal((await req('PATCH','/mcp/servers/linear',{body:{url:'https://other.example/mcp',digest:await digest()}})).status,500);assert.equal(secrets.get('linear','TOKEN','https://linear.example'),SECRET,'Failed config replacement rolls back credential cleanup');assert.equal(readConfig().servers.find(s=>s.id==='linear').url,URL1);}finally{fs.renameSync=rename;syncBuiltinESMExports();}
 group('refused audit and failed replacement preserve credentials');

 console.log(`PASS ${groups} MCP secrets groups; synthetic data only.`);
}finally{check.dispose();await manager.close();db.close();rmSync(dir,{recursive:true,force:true});}
