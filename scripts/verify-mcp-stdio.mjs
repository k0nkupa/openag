// Standalone acceptance for OA-456: local command (stdio) MCP servers written from the desk behind a hash-bound command review.
// Temporary data, a real local stdio fixture process and synthetic devices only; no provider calls.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync,mkdirSync,realpathSync,chmodSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json');
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {openDb}=await load('db/index'),{createAuth}=await load('auth'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals');
const {createGateway}=await load('gateway'),{createMcpManager}=await load('mcp'),{createMcpServerService}=await load('mcp-servers'),{createMcpCommandReview}=await load('mcp-command-review');
const {createMcpSecrets}=await load('mcp-secrets'),{buildReview}=await load('mcp-command-review-core');
const dir=mkdtempSync(join(tmpdir(),'openag-mcp-stdio-')),work=mkdtempSync(join(tmpdir(),'openag-mcp-stdio-fixture-'));
const db=openDb(dir),ledger=createLedger(db),approvals=createApprovals(db,ledger);
const OWNER='owner-token-stdio-synthetic-60606',FLAG='flag-value-DO-NOT-LEAK-27182818',CHILD='child-secret-value-DO-NOT-LEAK-31415926';
process.env.OPENAG_TOKEN='daemon-owner-token-must-not-reach-the-child-1234';process.env.OPENAI_API_KEY='sk-must-not-reach-the-child-0123456789abcdef';
const auth=createAuth({db,ownerToken:OWNER});
const sdk=name=>require.resolve('@modelcontextprotocol/sdk/'+name);
const fixture=join(work,'server.mjs');
const fixtureSource=body=>`import {Server} from ${JSON.stringify(sdk('server/index.js'))};import {StdioServerTransport} from ${JSON.stringify(sdk('server/stdio.js'))};import {ListToolsRequestSchema,CallToolRequestSchema} from ${JSON.stringify(sdk('types.js'))};import {appendFileSync} from 'node:fs';
appendFileSync('started','x\\n');${body}
const server=new Server({name:'stdio-fixture',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'ENV_NAMES',description:'fixture',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));
server.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:'text',text:JSON.stringify({env:process.env,lens:Object.fromEntries(Object.entries(process.env).map(([k,v])=>[k,v.length])),cwd:process.cwd()})}]}));
await server.connect(new StdioServerTransport());`;
writeFileSync(fixture,fixtureSource(''));
const secrets=createMcpSecrets({dataDir:dir,env:{}});
const manager=createMcpManager({dataDir:dir,env:{OPENAG_MCP_FLAG:FLAG},secrets});
const service=createMcpServerService({dataDir:dir,mcp:manager,approvals,secrets});
let review=createMcpCommandReview({db,ledger,approvals,mcp:manager,service});
const app=createGateway({db,auth,ledger,approvals,dataDir:dir,mcp:manager,mcpServers:service,mcpCommandReview:review,dispatch(){}});
const limited=auth.createDevice('Phone','owner','limited').token;
const req=async(method,path,{token=OWNER,body}={})=>{const res=await app.request(path,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await res.text();return {status:res.status,json:text?JSON.parse(text):undefined,text};};
const listing=async()=>(await req('GET','/mcp/servers')).json;
const digest=async()=>(await listing()).entries.digest;
const statusOf=async id=>(await listing()).servers.find(server=>server.id===id);
const configPath=join(dir,'mcp.json'),readConfig=()=>JSON.parse(readFileSync(configPath,'utf8')),writeConfig=value=>writeFileSync(configPath,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const until=async(read,predicate,what='deadline')=>{const end=Date.now()+10000;do{const value=await read();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<end);throw Error(what);};
const startedCount=id=>{const file=join(dir,'mcp-work',id,'started');return existsSync(file)?readFileSync(file,'utf8').split('\n').filter(Boolean).length:0;};
let groups=0;const group=name=>{groups++;console.log('PASS '+name);};
const proposal=(extra={})=>({id:'tool',command:process.execPath,args:[fixture],env:{FIXTURE_FLAG:'${OPENAG_MCP_FLAG}'},...extra});
const propose=async body=>req('POST','/mcp/servers/command-review',{body});
const decide=async(approvalId,kind)=>approvals.resolve(approvalId,{kind},approvals.get(approvalId).reviewVersion);
const result=async approvalId=>until(async()=>(await req('GET','/mcp/servers/command-review/'+approvalId)).json,s=>!['pending','running'].includes(s.state),'review result');
const accepted=async body=>{const res=await propose(body);assert.equal(res.status,202,res.text);await decide(res.json.approvalId,'accept');const state=await result(res.json.approvalId);return {res,state};};
const leaks=value=>[[configPath,readFileSync(configPath)],[join(dir,'setup-audit.jsonl'),existsSync(join(dir,'setup-audit.jsonl'))?readFileSync(join(dir,'setup-audit.jsonl')):Buffer.alloc(0)],[join(dir,'openag.db'),readFileSync(join(dir,'openag.db'))],['ledger',Buffer.from(JSON.stringify(ledger.list('_system',{limit:5000})))],['approvals',Buffer.from(JSON.stringify(approvals.listPending()))],['entries',Buffer.from(JSON.stringify(manager.entries()))],['status',Buffer.from(JSON.stringify(manager.status()))]].filter(([,bytes])=>bytes.includes(value)).map(([name])=>name);
const callTool=async id=>{const out=await manager.executors()[`mcp.${id}.ENV_NAMES`]({botId:'bot',dataDir:dir},{});assert.ok(out.untrusted,'wrapped as untrusted');return JSON.parse(out.content);};
try{
 // An operator wrote these by hand: a stdio command, and a desk-style entry that was never reviewed.
 writeConfig({servers:[{id:'ops',transport:'stdio',command:process.execPath,args:[fixture]},{id:'sneaky',transport:'stdio',command:process.execPath,args:[fixture],managedBy:'desk'}]});
 await manager.load();
 assert.equal((await statusOf('ops')).state,'connected','an operator command runs exactly as before');
 const sneaky=await statusOf('sneaky');assert.equal(sneaky.state,'invalid');assert.match(sneaky.detail,/command not reviewed/);assert.equal(startedCount('sneaky'),0,'an unreviewed desk command never spawns');
 group('operator commands unchanged; unreviewed desk entry never spawns');

 // 1. Authority and what a proposal may contain.
 for(const [method,path,body] of [['POST','/mcp/servers/command-review',proposal()],['GET','/mcp/servers/command-review/x']])assert.equal((await req(method,path,{token:limited,body})).status,403,`limited ${method}`);
 const refused=async(body,status,pattern)=>{const res=await propose(body);assert.equal(res.status,status,res.text);assert.match(res.json.error,pattern);};
 await refused(proposal({command:'/bin/sh',args:['-c','echo hi']}),400,/shell/);
 await refused(proposal({command:'sh',args:[fixture]}),400,/shell/);
 await refused(proposal({args:[]}),400,/interpreter needs a script/);
 await refused(proposal({args:['-e','process.exit(0)']}),400,/inline code/);
 await refused(proposal({command:'./relative-tool'}),400,/absolute/);
 await refused(proposal({command:'definitely-not-a-real-program-xyz'}),400,/not found/);
 await refused(proposal({args:[fixture,'${HOME}']}),400,/no references/);
 await refused(proposal({env:{A:'${HOME}'}}),400,/OPENAG_MCP_/);
 await refused(proposal({env:{A:'${GITHUB_TOKEN}'}}),400,/OPENAG_MCP_/);
 await refused(proposal({env:{A:'${OPENAG_TOKEN}'}}),400,/OPENAG_MCP_|daemon secret/);
 await refused(proposal({env:{A:'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'}}),400,/secret/);
 await refused(proposal({env:{'bad-name':'x'}}),400,/bad-name/);
 await refused(proposal({id:'ops'}),409,/managed in mcp.json/);
 await refused(proposal({id:'Bad Id'}),400,/id must match/);
 assert.equal(approvals.listPending().length,0,'a refused proposal creates no approval');
 group('authority and what a proposal may contain');

 // 2. Nothing is written or started before an accept; ignore writes nothing.
 const before=readFileSync(configPath,'utf8');
 let res=await propose(proposal());assert.equal(res.status,202,res.text);const first=res.json;
 assert.deepEqual(first.review.argv,[realpathSync(process.execPath),fixture]);assert.match(first.review.hash,/^[a-f0-9]{64}$/);assert.equal(first.review.cwd,'$OPENAG_DATA/mcp-work/tool');assert.deepEqual(first.review.env,[{name:'FIXTURE_FLAG',template:'${OPENAG_MCP_FLAG}'}]);assert.equal(first.review.files.length,1,'the script content is part of the review');
 const approval=approvals.get(first.approvalId);assert.equal(approval.toolClass,'act-external');assert.equal(approval.source,'mcp-command-review');assert.equal(approval.turnId,null);
 assert.equal(readFileSync(configPath,'utf8'),before,'nothing written before the approval');assert.ok(!existsSync(join(dir,'mcp-work','tool')),'no working directory, no spawn');assert.equal(await statusOf('tool'),undefined);
 await decide(first.approvalId,'ignore');assert.equal((await result(first.approvalId)).state,'declined');assert.equal(readFileSync(configPath,'utf8'),before,'ignore writes nothing');assert.equal(await statusOf('tool'),undefined);
 // An approval a bot could create with the same tool name is never applied: only this module's own source counts.
 const forged=approvals.request({roomId:'_system',botId:'daemon',toolName:'mcp_command_review',toolClass:'act-external',payload:approvals.get(first.approvalId).payload}).approvalId;
 await decide(forged,'accept');await new Promise(resolve=>setTimeout(resolve,150));assert.equal(await statusOf('tool'),undefined,'a lookalike approval with a valid proposal still writes nothing');assert.equal(readFileSync(configPath,'utf8'),before);
 group('nothing is written or started before accept');

 // 3. Accept writes the stored proposal; the child runs as reviewed with exactly the declared environment.
 res=await propose(proposal({env:{FIXTURE_FLAG:'${OPENAG_MCP_FLAG}',CHILD_KEY:'${secret:CHILD}'}}));assert.equal(res.status,202,res.text);
 await decide(res.json.approvalId,'accept');let state=await result(res.json.approvalId);assert.equal(state.ok,true,JSON.stringify(state));
 const stored=readConfig().servers.find(s=>s.id==='tool');assert.equal(stored.managedBy,'desk');assert.equal(stored.review.hash,res.json.review.hash);assert.equal(stored.env.FIXTURE_FLAG,'${OPENAG_MCP_FLAG}');
 let status=await statusOf('tool');assert.equal(status.state,'skipped');assert.match(status.detail,/missing secret CHILD/,'fails closed until the secret exists');assert.equal(startedCount('tool'),0);
 assert.equal((await req('PUT','/mcp/secrets/tool/CHILD',{body:{value:CHILD}})).status,200);
 status=await until(()=>statusOf('tool'),s=>s.state==='connected','the reviewed command connects');
 const seen=await callTool('tool');
 // macOS itself adds __CF_USER_TEXT_ENCODING to every spawned process; it is not ours and carries no secret.
 const names=Object.keys(seen.env).filter(k=>k!=='__CF_USER_TEXT_ENCODING').sort();
 assert.deepEqual(names,[...['PATH','HOME','LANG','TMPDIR'].filter(k=>process.env[k]!==undefined),'CHILD_KEY','FIXTURE_FLAG'].sort(),'the child holds only the base variables and the declared names');
 assert.equal(seen.env.FIXTURE_FLAG,FLAG);assert.equal(seen.lens.CHILD_KEY,CHILD.length,'the stored secret reached the child (the result itself is redacted)');assert.equal(seen.env.CHILD_KEY,'[REDACTED:secret]','and its value is masked in what the bot would see');assert.ok(!('OPENAG_TOKEN' in seen.env)&&!('OPENAI_API_KEY' in seen.env));
 assert.equal(realpathSync(seen.cwd),realpathSync(join(dir,'mcp-work','tool')),'it runs in its own directory');
 for(const value of [FLAG,CHILD])assert.deepEqual(leaks(value),[],'no value in mcp.json, audit, DB, ledger, approvals, status or entries: '+value.slice(0,10));
 assert.ok(ledger.list('_system',{limit:5000}).some(e=>e.payload?.action==='mcp_command_review_applied'&&e.payload.id==='tool'),'audited');
 assert.ok(readFileSync(join(dir,'setup-audit.jsonl'),'utf8').includes('desk-command-approved'));
 const view=(await listing()).entries.servers.find(s=>s.id==='tool');assert.equal(view.managedBy,'desk');assert.equal(view.review.hash,stored.review.hash);
 group('accept writes the stored proposal; the child env is exactly the declared set');

 // 4. Tampering with the file never spawns anything different: every mismatch is refused at load and before each spawn.
 const good=readConfig();
 const tamper=async(change,pattern,what)=>{const copy=JSON.parse(JSON.stringify(good));change(copy.servers.find(s=>s.id==='tool'));writeConfig(copy);const spawned=startedCount('tool');await manager.reload();
  const s=await statusOf('tool');assert.equal(s.state,'invalid',what);assert.match(s.detail,pattern,what);assert.equal(startedCount('tool'),spawned,what+': no spawn');};
 await tamper(e=>{e.args=[fixture,'extra'];},/changed since it was reviewed/,'edited argument');
 await tamper(e=>{e.env.EXTRA='${OPENAG_MCP_FLAG}';},/changed since it was reviewed/,'added environment name');
 await tamper(e=>{e.review.hash='0'.repeat(64);},/changed since it was reviewed/,'wrong hash');
 await tamper(e=>{delete e.review;},/not reviewed/,'removed review');
 await tamper(e=>{e.command='/usr/bin/env';},/changed since it was reviewed|needs a script|wrapper/,'another command');
 await tamper(e=>{e.review.executable='/bin/ls';},/changed since it was reviewed/,'another executable');
 writeConfig(good);writeFileSync(fixture,fixtureSource('// edited after review'));const spawned=startedCount('tool');await manager.reload();
 let s=await statusOf('tool');assert.equal(s.state,'invalid');assert.match(s.detail,/reviewed file changed/);assert.equal(startedCount('tool'),spawned,'a changed script never starts');
 writeFileSync(fixture,fixtureSource(''));await manager.reload();assert.equal((await statusOf('tool')).state,'connected','restoring the reviewed content restores it');
 group('tampering, a changed program or a changed script never spawns');

 // 5. An edit is a new review. Until it is accepted the running entry is unchanged; a changed program or arguments drops its secrets.
 const reviewedHash=readConfig().servers.find(s=>s.id==='tool').review.hash;
 res=await propose(proposal({env:{FIXTURE_FLAG:'${OPENAG_MCP_FLAG}',CHILD_KEY:'${secret:CHILD}',MORE:'${OPENAG_MCP_FLAG}'}}));assert.equal(res.status,202);assert.equal(res.json.replaces,true);const envEdit=res.json;
 assert.equal(readConfig().servers.find(s=>s.id==='tool').review.hash,reviewedHash,'the entry is unchanged until the edit is accepted');assert.equal((await statusOf('tool')).state,'connected');
 await decide(envEdit.approvalId,'accept');assert.equal((await result(envEdit.approvalId)).ok,true);
 assert.notEqual(readConfig().servers.find(s=>s.id==='tool').review.hash,reviewedHash);assert.equal((await req('GET','/mcp/secrets')).json.secrets.length,1,'an environment-only edit keeps the secret (same program and arguments)');
 await until(()=>statusOf('tool'),x=>x.state==='connected');assert.ok('MORE' in (await callTool('tool')).env);
 // Two reviews proposed against the same entry: the second is refused as stale.
 const a=await propose(proposal({env:{FIXTURE_FLAG:'${OPENAG_MCP_FLAG}',CHILD_KEY:'${secret:CHILD}',A:'${OPENAG_MCP_FLAG}'}})),b=await propose(proposal({env:{FIXTURE_FLAG:'${OPENAG_MCP_FLAG}',CHILD_KEY:'${secret:CHILD}',B:'${OPENAG_MCP_FLAG}'}}));
 await decide(a.json.approvalId,'accept');assert.equal((await result(a.json.approvalId)).ok,true);
 await decide(b.json.approvalId,'accept');state=await result(b.json.approvalId);assert.equal(state.ok,false);assert.match(state.reason,/changed since this review was requested/);assert.ok(!('B' in readConfig().servers.find(s=>s.id==='tool').env),'the stale review wrote nothing');
 // A script that changes between the proposal and the accept is refused.
 const pending=await propose(proposal({env:{FIXTURE_FLAG:'${OPENAG_MCP_FLAG}',CHILD_KEY:'${secret:CHILD}',C:'${OPENAG_MCP_FLAG}'}}));writeFileSync(fixture,fixtureSource('// changed before approval'));
 await decide(pending.json.approvalId,'accept');state=await result(pending.json.approvalId);assert.equal(state.ok,false);assert.match(state.reason,/changed since it was reviewed|no longer be reviewed/);assert.ok(!('C' in readConfig().servers.find(s=>s.id==='tool').env));
 writeFileSync(fixture,fixtureSource(''));
 // Changed arguments: new binding, so the secret goes with the old command.
 const other=join(work,'other.mjs');writeFileSync(other,fixtureSource(''));
 ({state}=await accepted(proposal({args:[other],env:{FIXTURE_FLAG:'${OPENAG_MCP_FLAG}',CHILD_KEY:'${secret:CHILD}'}})));assert.equal(state.ok,true,JSON.stringify(state));
 assert.deepEqual((await req('GET','/mcp/secrets')).json.secrets,[],'a different program or arguments drop the secrets');assert.equal((await statusOf('tool')).state,'skipped');assert.deepEqual(leaks(CHILD),[]);
 group('an edit is a new review; stale and changed reviews write nothing; changed command drops secrets');

 // 6. Switches and removal work directly; the command itself cannot be patched.
 await req('PUT','/mcp/secrets/tool/CHILD',{body:{value:CHILD}});await until(()=>statusOf('tool'),x=>x.state==='connected');
 for(const body of [{command:'/bin/ls'},{args:['x']},{env:{A:'b'}},{url:'https://x.example/mcp'},{headers:{A:'b'}},{allowPrivateNetwork:true}]){res=await req('PATCH','/mcp/servers/tool',{body:{...body,digest:await digest()}});assert.equal(res.status,400,JSON.stringify(body));}
 res=await req('PATCH','/mcp/servers/tool',{body:{offerToAgents:false,timeoutMs:5000,digest:await digest()}});assert.equal(res.status,200,res.text);
 res=await req('PATCH','/mcp/servers/tool',{body:{enabled:false,digest:await digest()}});assert.equal(res.status,200);assert.equal((await statusOf('tool')).state,'skipped');
 res=await req('PATCH','/mcp/servers/tool',{body:{enabled:true,digest:await digest()}});assert.equal(res.status,200);await until(()=>statusOf('tool'),x=>x.state==='connected');
 res=await req('PATCH','/mcp/servers/ops',{body:{enabled:false,digest:await digest()}});assert.equal(res.status,409,'an operator command is not managed from the desk');
 res=await req('DELETE',`/mcp/servers/ops?digest=${await digest()}`);assert.equal(res.status,409);
 assert.equal((await propose(proposal({id:'ops'}))).status,409,'an operator entry is never replaced');
 res=await req('DELETE',`/mcp/servers/tool?digest=${await digest()}`);assert.equal(res.status,200,res.text);assert.equal(await statusOf('tool'),undefined);assert.deepEqual((await req('GET','/mcp/secrets')).json.secrets,[],'removal drops its secrets');
 assert.ok(readConfig().servers.some(e=>e.id==='ops'),'the operator entry is untouched');
 group('switches and removal work; the command cannot be patched; operator entries are not overridden');

 // 6b. What the review cannot see must not be able to run: scripts that do not exist yet, repointed symlinks, shebang programs, wrappers, loader variables.
 await refused(proposal({args:['relative-server.mjs']}),400,/script must be an existing file given by its absolute path/);
 await refused(proposal({args:[join(work,'not-written-yet.mjs')]}),400,/existing file/);
 await refused(proposal({command:'env',args:['sh','-c','id']}),400,/wrapper/);
 await refused(proposal({command:'/usr/bin/env',args:[fixture]}),400,/wrapper/);
 await refused(proposal({command:'perl',args:['-e','print 1']}),400,/interpreter needs a script/);
 for(const name of ['NODE_OPTIONS','PATH','DYLD_INSERT_LIBRARIES','LD_PRELOAD','PYTHONPATH','HOME'])await refused(proposal({env:{[name]:'/tmp/x'}}),400,/cannot be set for a desk command/);
 // A symlink argument: the content hash alone would not notice it being repointed.
 const good1=join(work,'good.mjs'),evil=join(work,'evil.mjs'),link=join(work,'link.mjs');writeFileSync(good1,fixtureSource(''));writeFileSync(evil,fixtureSource('// evil'));symlinkSync(good1,link);
 ({state}=await accepted(proposal({id:'linked',args:[link]})));assert.equal(state.ok,true,JSON.stringify(state));await until(()=>statusOf('linked'),x=>x.state==='connected');
 const startedLinked=startedCount('linked');unlinkSync(link);symlinkSync(evil,link);await manager.reload();
 s=await statusOf('linked');assert.equal(s.state,'invalid');assert.match(s.detail,/reviewed file changed/);assert.equal(startedCount('linked'),startedLinked,'a repointed symlink never starts');
 // A program that is itself a script is part of what runs.
 const shebang=join(work,'run.mjs');writeFileSync(shebang,`#!${process.execPath}\n${fixtureSource('')}\n`);chmodSync(shebang,0o755);
 res=await propose(proposal({id:'shebang',command:shebang,args:[]}));assert.equal(res.status,202,res.text);assert.ok(res.json.review.files.some(file=>file.path===realpathSync(shebang)),'the script program is hashed');
 await decide(res.json.approvalId,'accept');assert.equal((await result(res.json.approvalId)).ok,true);await until(()=>statusOf('shebang'),x=>x.state==='connected');
 writeFileSync(shebang,`#!${process.execPath}\n// changed\n`);chmodSync(shebang,0o755);await manager.reload();
 s=await statusOf('shebang');assert.equal(s.state,'invalid');assert.match(s.detail,/reviewed file changed/);
 group('unreviewable code is refused: missing or relative scripts, repointed symlinks, shebang programs, wrappers, loader variables');

 // 6c. Only the owner may decide a command review. A switched-off server stays off through an edit; an edit drops what belonged to the old program.
 res=await propose(proposal({id:'gated'}));const gated=res.json.approvalId;
 for(const kind of ['accept','ignore','respond'])assert.equal((await req('POST','/approvals/'+gated,{token:limited,body:{kind,text:'x'}})).status,403,'a limited device cannot '+kind);
 assert.equal(approvals.get(gated).status,'pending');assert.equal(await statusOf('gated'),undefined,'nothing was written');
 assert.equal((await req('POST','/approvals/'+gated,{body:{kind:'edit',payload:{id:'gated',command:'/bin/ls'}}})).status===200&&(await statusOf('gated'))!==undefined,false,'an edit decision cannot change what is written');
 await decide(gated,'ignore');
 ({state}=await accepted(proposal({id:'keep',timeoutMs:5000})));assert.equal(state.ok,true);
 res=await req('PATCH','/mcp/servers/keep',{body:{enabled:false,digest:await digest()}});assert.equal(res.status,200);
 const classed=readConfig();classed.toolClasses={...classed.toolClasses,keep:{ENV_NAMES:'read'}};writeConfig(classed);await manager.reload();
 const other2=join(work,'other2.mjs');writeFileSync(other2,fixtureSource(''));
 ({state}=await accepted(proposal({id:'keep',args:[other2]})));assert.equal(state.ok,true,JSON.stringify(state));
 const kept=readConfig().servers.find(e=>e.id==='keep');assert.equal(kept.enabled,false,'an edit keeps a server that was switched off switched off');assert.equal(kept.timeoutMs,undefined,'a timeout the new review does not set is not inherited');
 assert.ok(!readConfig().toolClasses?.keep,'class overrides written for the old program do not apply to the new one');
 group('only the owner decides; an edit keeps enabled, drops the old timeout and class overrides');

 // 7. An unanswered review expires and writes nothing.
 review.dispose();review=createMcpCommandReview({db,ledger,approvals,mcp:manager,service,expiryMs:200});
 const app2=createGateway({db,auth,ledger,approvals,dataDir:dir,mcp:manager,mcpServers:service,mcpCommandReview:review,dispatch(){}});
 const short=await app2.request('/mcp/servers/command-review',{method:'POST',headers:{authorization:`Bearer ${OWNER}`,'content-type':'application/json'},body:JSON.stringify(proposal({id:'late'}))});assert.equal(short.status,202);const {approvalId}=await short.json();
 await until(async()=>review.result(approvalId),x=>x?.state==='expired','expiry');assert.equal(approvals.get(approvalId).status==='pending',false);assert.equal(await statusOf('late'),undefined);
 group('an unanswered review expires and writes nothing');
 review.dispose();await review.idle();
 let finishOwnedReview;const ownedReview=createMcpCommandReview({db,ledger,approvals,mcp:manager,service:{...service,upsertCommand:()=>new Promise(resolve=>{finishOwnedReview=resolve;})}});
 const owned=await ownedReview.request(proposal({id:'shutdown-owned',offerToAgents:true}));approvals.resolve(owned.approvalId,{kind:'accept'},approvals.get(owned.approvalId).reviewVersion);await until(()=>finishOwnedReview||ownedReview.result(owned.approvalId)?.state==='done',Boolean,'owned review');assert.equal(ownedReview.result(owned.approvalId)?.state,'running',JSON.stringify(ownedReview.result(owned.approvalId)));ownedReview.dispose();let drained=false;const drain=ownedReview.idle().then(()=>{drained=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);finishOwnedReview({action:'added',status:null});await drain;assert.equal(approvals.receipts.get(owned.approvalId).outcome,'completed');group('accepted command reviews drain before storage closes');
 console.log(`PASS ${groups} MCP stdio groups; synthetic data only.`);
}finally{review.dispose();await manager.close();await review.idle();rmSync('started',{force:true}); // the operator-written fixture command has no working directory of its own, so it wrote here
 db.close();rmSync(dir,{recursive:true,force:true});rmSync(work,{recursive:true,force:true});}
