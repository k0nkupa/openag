// Standalone runner/executor/SQLite integration; disposable files and deliberately lost local responses only.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,linkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const require=createRequire(root+'apps/daemon/package.json'),Database=require('better-sqlite3');
const {openDb}=await load('db/index'),{createLedger}=await load('ledger'),{createApprovals}=await load('approvals'),{createPermissions}=await load('permissions');
const {createRunner}=await load('runtimes/runner'),rooms=await load('rooms'),{toExecutors}=await load('tools/registry');
const {writeFileTool}=await load('tools/files'),{inspectionTools}=await load('tools/inspection'),{commandTool}=await load('tools/execution');
const {writeTarget}=await load('effect-scope');
const dir=mkdtempSync(join(tmpdir(),'openag-effect-isolation-')),data=join(dir,'data');
let db=openDb(data),ledger=createLedger(db),approvals=createApprovals(db,ledger),permissions=createPermissions(db,ledger,data,approvals),runner;
for(const id of ['bot','peer']){rooms.createBot(db,{id,runtime:'api',model:'openai/fixture'});mkdirSync(join(data,'bots',id,'work'),{recursive:true});}
for(const id of ['main','other']){rooms.createRoom(db,{id,leadBotId:'bot'});for(const bot of ['bot','peer']){rooms.addMember(db,id,bot);const s=permissions.ensure(bot,id);permissions.select(bot,id,'full-access','disposable',s.revision);}}
const workspace=join(data,'bots/bot/work'),a=join(workspace,'a.txt'),b=join(workspace,'b.txt');
let operations=[],results=[],lost=false;
const writer={...writeFileTool,async execute(ctx,args){const result=await writeFileTool.execute(ctx,args);if(args.content==='confirmed-local-write-with-lost-response'){lost=true;throw Error('Controlled response loss after a confirmed disposable file write');}return result;}};
const alias={...writeFileTool,name:'fixture_alias',effectScope:()=>({kind:'paths',paths:[writeTarget(a)]}),async execute(){throw Error('Conflicting alias must not dispatch');}};
const declaredRead={...alias,name:'fixture_declared_read',effectScope:undefined,permission:()=>({approval:'allow',effects:'read'}),async execute(){throw Error('Controlled opaque process failure despite read classification');}};
const defs=[...inspectionTools,writer,alias,declaredRead,commandTool];
const runtimes={api:{async runTurn(ctx){for(const [tool,args] of operations)results.push(await ctx.callTool(tool,args));}}};
function start(){runner=createRunner({db,ledger,approvals,permissions,dataDir:data,tools:toExecutors(defs),runtimes});}
start();
async function run(tool,args,room='main',bot='bot',meta){operations=[[tool,args]];results=[];const message=ledger.append(room,'user','message',{text:'One controlled disposable operation'});await runner.run(rooms.getRoom(db,room),rooms.getBot(db,bot),message,undefined,meta);assert.equal(results.length,1);return results[0];}
const scoped=path=>({kind:'paths',paths:[writeTarget(path)]});
function pending(path){return approvals.request({roomId:'main',botId:'bot',toolName:'write_file',toolClass:'act-local',payload:{path,content:'controlled'},review:{effectScope:scoped(path)}});}
try{
  const first=await run('write_file',{path:'a.txt',content:'confirmed-local-write-with-lost-response'});
  assert.equal(first.executionOutcome,'unknown');assert.ok(lost);assert.equal(readFileSync(a,'utf8'),'confirmed-local-write-with-lost-response');
  const unknown=approvals.receipts.get(first.receiptId);assert.equal(unknown.effectScope.kind,'paths');
  assert.equal((await run('write_file',{path:'b.txt',content:'independent'},'other')).ok,true);
  assert.equal((await run('write_file',{path:'same-chat.txt',content:'independent'})).ok,true);
  const same=await run('write_file',{path:'a.txt',content:'must-not-run'},'other');assert.equal(same.status,'denied');assert.equal(same.reason,'receipt_conflict');assert.equal(same.nextStep,'owner_inspection');assert.equal(same.blockingReceiptId,undefined);assert.ok(!same.message.includes(first.receiptId),'Other-room receipt identifiers are not disclosed');
  const sameRoom=await run('write_file',{path:'a.txt',content:'must-not-run'});assert.ok(sameRoom.message.includes(first.receiptId));assert.equal(sameRoom.blockingReceiptId,first.receiptId);
  assert.equal((await run('fixture_alias',{path:'anything',content:'must-not-run'},'other','peer')).status,'denied');
  assert.equal((await run('run_shell',{command:'printf must-not-run'},'other')).status,'denied','Opaque commands can overlap scoped writes');
  assert.equal((await run('read_file',{path:a},'other')).result.text,'confirmed-local-write-with-lost-response');
  assert.equal((await run('list_files',{path:join(workspace,'absent')},'other')).result.found,false);
  assert.equal((await run('search_files',{path:workspace,query:'independent'},'other')).ok,true);
  const body='SYNTHETIC_PRIVATE_BODY_'+crypto.randomUUID();writeFileSync(join(workspace,'private.pem'),'-----BEGIN PRIVATE KEY-----\n'+body+'\n-----END PRIVATE KEY-----\npublic-after-key');
  const secretSearch=await run('search_files',{path:workspace,query:'SYNTHETIC_PRIVATE_BODY_'});assert.equal(secretSearch.ok,true);assert.equal(secretSearch.result.matches.length,0);
  const publicSearch=await run('search_files',{path:workspace,query:'public-after-key'});assert.ok(publicSearch.result.matches.some(m=>m.line===null));
  assert.ok(!JSON.stringify(ledger.list('main',{limit:1000})).includes(body),'Multiline secret body must not enter model results or ledger');
  const {getDefaultRedactor}=await load('redact'),fileSecret='filesystem-secret-'+crypto.randomUUID();getDefaultRedactor().addSecret(fileSecret);
  const errorResult=await run('read_file',{path:join(workspace,fileSecret,'absent')});assert.equal(errorResult.executionOutcome,'failed');assert.ok(!errorResult.message.includes(fileSecret),'Filesystem error must be redacted before adapter delivery');
  const many=join(workspace,'many');mkdirSync(many);for(let i=0;i<1000;i++)writeFileSync(join(many,i+'.txt'),'not the needle\n');
  const timeout=await run('search_files',{path:many,query:'needle-that-is-absent',timeoutMs:1},'other');assert.equal(timeout.executionOutcome,'failed');assert.match(timeout.message,/timed out/);
  assert.equal((await run('write_file',{path:'after-timeout.txt',content:'continued'},'other')).ok,true);
  assert.equal(approvals.receipts.get(first.receiptId).inspectedAt,null);
  symlinkSync(a,join(workspace,'link'));assert.equal((await run('read_file',{path:join(workspace,'link')})).executionOutcome,'failed');
  assert.equal((await run('write_file',{path:'link',content:'must-not-run'})).status,'denied');
  linkSync(b,join(workspace,'hard-link'));assert.equal((await run('write_file',{path:'hard-link',content:'must-not-run'})).status,'denied');assert.equal(readFileSync(b,'utf8'),'independent');unlinkSync(join(workspace,'hard-link'));
  assert.equal((await run('list_files',{path:many})).result.truncated,true);
  const capped=await run('search_files',{path:many,query:'not the needle'});assert.equal(capped.ok,true);assert.equal(capped.result.truncated,true);assert.equal(capped.result.matches.length,100);
  assert.equal((await run('write_file',{path:'../escape',content:'must-not-run'})).status,'denied');
  assert.equal((await run('write_file',{path:'after-timeout.txt',content:'must-not-run'},'other','bot',{isolated:true})).status,'denied');
  const stale=pending(a);approvals.resolve(stale.approvalId,{kind:'accept'},approvals.get(stale.approvalId).reviewVersion);
  const overlapping=pending(a),independent=pending(b);
  const history={outcome:unknown.outcome,evidence:unknown.evidence,effective:unknown.effective};
  approvals.inspectReceipt(unknown.id,unknown.reviewVersion,'Inspected the controlled file readback; this is synthetic lost-response evidence, not an automatic replay.',a);
  assert.equal(approvals.get(overlapping.approvalId).status,'ignored');assert.equal(approvals.get(overlapping.approvalId).responseText,'expired');assert.equal(approvals.get(independent.approvalId).status,'pending');
  assert.throws(()=>approvals.receipts.start(stale.approvalId,null,null),/inspection/);
  approvals.resolve(independent.approvalId,{kind:'accept'},approvals.get(independent.approvalId).reviewVersion);approvals.receipts.start(independent.approvalId,null,null);approvals.receipts.finish(independent.approvalId,{outcome:'completed',detail:'Controlled dispatch only; no action replay'});
  assert.deepEqual({outcome:approvals.receipts.get(unknown.id).outcome,evidence:approvals.receipts.get(unknown.id).evidence,effective:approvals.receipts.get(unknown.id).effective},history);
  const permissionForCase=permissions.ensure('bot','main');
  const caseReceipts=['Report.txt','report.txt'].map(name=>approvals.receipts.automatic({roomId:'main',botId:'bot',turnId:'case-fixture',toolCallId:name,toolName:'write_file',toolClass:'act-local',args:{path:name}},permissionForCase,undefined,{parents:[],effectScope:scoped(join(workspace,name))}));
  approvals.receipts.start(caseReceipts[0],'case-fixture','first');
  assert.throws(()=>approvals.receipts.start(caseReceipts[1],'case-fixture','second'),error=>error.conflict?.reason==='receipt_conflict'&&error.conflict.nextStep==='wait');
  approvals.receipts.finish(caseReceipts[0],{outcome:'completed',detail:'Synthetic dispatch marker; no file command executed'});approvals.receipts.finish(caseReceipts[1],{outcome:'not-run',detail:'Conflicting case alias correctly refused'});
  const epoch=approvals.receipts.inspectionEpoch(scoped(b));assert.equal(epoch,0);
  const readPermission=permissions.ensure('bot','other');
  const readReceipt=approvals.receipts.automatic({roomId:'other',botId:'bot',turnId:'controlled-recovery',toolCallId:'read',toolName:'read_file',toolClass:'read',args:{path:b}},readPermission,undefined,{parents:[],effectScope:{kind:'read'}});
  approvals.receipts.start(readReceipt,'controlled-recovery','read');approvals.receipts.recover('controlled-recovery');assert.equal(approvals.receipts.get(readReceipt).outcome,'failed');
  const opaqueRead=await run('fixture_declared_read',{path:'anything',content:'synthetic'});assert.equal(opaqueRead.executionOutcome,'unknown');assert.equal(approvals.receipts.get(opaqueRead.receiptId).effectScope.kind,'opaque');
  assert.equal((await run('read_file',{path:b},'other')).ok,true);assert.equal((await run('write_file',{path:'blocked-by-opaque.txt',content:'must-not-run'},'other')).status,'denied');
  const opaqueReceipt=approvals.receipts.get(opaqueRead.receiptId);approvals.inspectReceipt(opaqueReceipt.id,opaqueReceipt.reviewVersion,'Inspected synthetic opaque failure; no executable or provider was invoked.','controlled opaque fixture');
  const {createRedactor}=await load('redact'),redactor=createRedactor({env:{},extraSecrets:['sensitive-component-fixture']}),privateApprovals=createApprovals(db,ledger,redactor);
  const sensitive=join(workspace,'sensitive-component-fixture','a.txt'),sensitiveScope=scoped(sensitive),permission=permissions.ensure('bot','main');
  const redacted=privateApprovals.receipts.automatic({roomId:'main',botId:'bot',turnId:'redaction-fixture',toolCallId:'secret',toolName:'write_file',toolClass:'act-local',args:{path:sensitive}},permission,undefined,{parents:[],effectScope:sensitiveScope});
  assert.equal(privateApprovals.receipts.get(redacted).effectScope.kind,'opaque');privateApprovals.receipts.start(redacted,'redaction-fixture','secret');privateApprovals.receipts.finish(redacted,{outcome:'unknown',detail:'Synthetic redaction scope only'});
  assert.equal(privateApprovals.receipts.blocker(sensitiveScope).id,redacted);privateApprovals.inspectReceipt(redacted,privateApprovals.receipts.get(redacted).reviewVersion,'Synthetic redaction inspection; no actual write occurred.','disposable scope fixture');
  const request=privateApprovals.request({roomId:'main',botId:'bot',toolName:'write_file',toolClass:'act-local',payload:{path:sensitive},review:{effectScope:sensitiveScope}});
  assert.equal(privateApprovals.get(request.approvalId).review.effectScope.kind,'opaque');privateApprovals.resolve(request.approvalId,{kind:'accept'},privateApprovals.get(request.approvalId).reviewVersion);
  assert.equal(privateApprovals.receipts.get(request.approvalId).effectScope.kind,'opaque');assert.ok(!db.prepare('SELECT review_json FROM approvals WHERE id=?').get(request.approvalId).review_json.includes('sensitive-component-fixture'));
  // A stalled filesystem seam must not stall invocation completion, unlike cooperative traversal checks alone.
  const delayed=spawnSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';const original=fs.realpath;fs.realpath=async p=>{await new Promise(r=>setTimeout(r,250));return original(p)};syncBuiltinESMExports();const {searchFilesTool}=await import(${JSON.stringify(root+'apps/daemon/dist/tools/inspection.js')});const ctx={botId:'bot',dataDir:${JSON.stringify(data)},permission:{mode:'danger-full-access',workspace:${JSON.stringify(workspace)}}};let before=performance.now();await assert.rejects(searchFilesTool.execute(ctx,{path:ctx.permission.workspace,query:'anything',timeoutMs:20}),/timed out/);assert.ok(performance.now()-before<180);const controller=new AbortController();setTimeout(()=>controller.abort(),20);before=performance.now();await assert.rejects(searchFilesTool.execute({...ctx,signal:controller.signal},{path:ctx.permission.workspace,query:'anything',timeoutMs:500}),/cancelled/);assert.ok(performance.now()-before<180);await new Promise(r=>setTimeout(r,300));`],{encoding:'utf8',timeout:5000});assert.equal(delayed.status,0,delayed.stderr);
  // Migrate a private copy with the new column/version removed; never touch the installed database.
  const legacy=join(dir,'legacy');mkdirSync(legacy);await db.backup(join(legacy,'openag.db'));
  const old=new Database(join(legacy,'openag.db'));old.exec('ALTER TABLE action_receipts DROP COLUMN effect_scope_json; DELETE FROM schema_version WHERE version=38');const before=old.prepare('SELECT id,outcome,evidence_json,inspection_json FROM action_receipts ORDER BY seq').all();old.close();
  const migrated=openDb(legacy);assert.deepEqual(migrated.prepare('SELECT id,outcome,evidence_json,inspection_json FROM action_receipts ORDER BY seq').all(),before);assert.equal(migrated.prepare('SELECT effect_scope_json FROM action_receipts LIMIT 1').get().effect_scope_json,null);assert.equal(migrated.pragma('integrity_check',{simple:true}),'ok');migrated.close();
  runner.shutdown();await runner.drain();db.close();db=openDb(data);ledger=createLedger(db);approvals=createApprovals(db,ledger);permissions=createPermissions(db,ledger,data,approvals);start();
  assert.deepEqual(approvals.receipts.get(unknown.id).effectScope,unknown.effectScope);assert.ok(approvals.receipts.get(unknown.id).inspectedAt);
  assert.equal((await run('write_file',{path:'restart.txt',content:'continued after restart'},'other')).ok,true);
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);
  const evidence={passed:true,groups:['independent chats and same-chat targets','cross-bot alias conflict','opaque protection','bounded reads and timeout','path refusal','scoped inspection and stale proposals','read recovery','opaque classification and redaction safety','multiline secret protection','filesystem error redaction','case-alias conflict','stalled I/O deadline/cancellation','legacy migration','restart'],receiptId:unknown.id};writeFileSync(join(dir,'acceptance.json'),JSON.stringify(evidence,null,2));
  console.log('PASS effect isolation: '+evidence.groups.join('; '));console.log('Disposable evidence: '+dir);
}finally{runner.shutdown();await runner.drain();db.close();}
