// Standalone integration checks: temporary setup and real MCP wire, never native app access.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..'), daemon = join(root, 'apps/daemon');
const { defaultConnector } = await import(pathToFileURL(join(daemon, 'dist/mcp.js')));
const { integrationPackage, setupReview, packageProblem } = await import(pathToFileURL(join(daemon, 'dist/integration-packages.js')));
const { requestApplePermission } = await import(pathToFileURL(join(daemon, 'dist/apple-permissions.js')));
const dir = mkdtempSync(join(tmpdir(), 'openag-apple-'));
let conn;
try {
  const pkg = integrationPackage('apple-apps');
  if (process.platform === 'darwin') {
    const binary = join(pkg.sourceDir, 'calendar-reader');
    for (const args of [['unknown'], ['events','0','7'], ['events','1','366'], ['events','1;exec','1'], ['calendars','extra'], ['reminders','0','false'], ['reminders','1','false','list','extra'], ['reminders','1','yes'], ['search-reminders','1',''], ['search-reminders','1','query','extra'], ['search-reminders','1','bad\nquery']]) {
      const response = spawnSync(binary, args, {encoding:'utf8',timeout:5000});
      assert.notEqual(response.status,0);assert.equal(JSON.parse(response.stdout).error,'invalid_calendar_request');
    }
    const rebuild = spawnSync(process.execPath,[join(root,'scripts/build-apple-calendar.mjs')],{encoding:'utf8',timeout:20000});assert.equal(rebuild.status,0);assert.equal(integrationPackage('apple-apps').digest,pkg.digest,'unchanged build retains reviewed digest');
    const reminderStatus=spawnSync(binary,['reminders-status'],{encoding:'utf8',timeout:5000});assert.equal(reminderStatus.status,0);assert.equal(typeof JSON.parse(reminderStatus.stdout).authorized,'boolean');
    const status = spawnSync(binary,['status'],{encoding:'utf8',timeout:5000});
    assert.equal(status.status,0);assert.equal(typeof JSON.parse(status.stdout).authorized,'boolean');
  }

  const { claudeOwnMcpTool, codexOwnMcpTool } = await import(pathToFileURL(join(daemon, 'dist/runtimes/acp.js')));
  const server = 'openag-fixture';
  for (const tool of ['read_file', ...pkg.tools.map(t => `mcp.apple-apps.${t.name}`)]) {
    const name = `mcp__${server}__${tool}`;
    const call = { name, _meta: { claudeCode: { toolName: name, mcpServer: { name: server, source: 'dynamic' } } } };
    const tracked = { title: `mcp.${server}.${tool}`, rawInput: { server, tool } };
    assert.equal(claudeOwnMcpTool(call, undefined, server), tool, 'Claude recognizes pinned Apple tool names');
    assert.equal(codexOwnMcpTool({}, tracked, server), tool, 'Codex recognizes pinned Apple tool names');
    assert.equal(claudeOwnMcpTool(call, undefined, 'other-server'), null);
    assert.equal(codexOwnMcpTool({}, tracked, 'other-server'), null);
    assert.equal(claudeOwnMcpTool({ ...call, _meta: { claudeCode: { toolName: name, mcpServer: { name: server, source: 'user' } } } }, undefined, server), null);
    assert.equal(codexOwnMcpTool({}, { ...tracked, rawInput: { server: 'other-server', tool } }, server), null);
  }
  for (const tool of ['bad tool', 'bad/tool', 'tool;exec', 'tool\n']) {
    assert.equal(claudeOwnMcpTool({ name: `mcp__${server}__${tool}`, _meta: { claudeCode: { mcpServer: { name: server, source: 'dynamic' } } } }, undefined, server), null);
    assert.equal(codexOwnMcpTool({}, { title: `mcp.${server}.${tool}`, rawInput: { server } }, server), null);
  }

  const { notesScript, mailReadScript, notesListScript } = await import(pathToFileURL(join(pkg.sourceDir,'server.mjs')));
  const mailMessage = { id: () => 42, subject: () => 'Known subject', sender: () => 'sender@example.test', toRecipients: () => [], ccRecipients: () => [], dateReceived: () => new Date('2026-11-02T00:00:00Z'), content: () => 'Known body', readStatus: () => false, exists: () => true };
  const MailApplication = () => ({ accounts: () => [{ mailboxes: { byName: name => ({ exists: () => name === 'INBOX', messages: { byId: id => id === 42 ? mailMessage : { exists: () => false } } }) } }], get messages() { throw Error('Mail has no root messages collection'); } });
  assert.equal(typeof mailReadScript, 'function', 'Mail reads need a mailbox-scoped script');
  const readMail = args => JSON.parse(new vm.Script(mailReadScript(args)).runInNewContext({ Application: MailApplication }));
  assert.deepEqual(readMail({ uid: '42', folder: 'inbox' }), { id: 42, subject: 'Known subject', from: 'sender@example.test', to: [], cc: [], date: '2026-11-02T00:00:00.000Z', body: 'Known body', read: false });
  assert.equal(readMail({ uid: '43', folder: 'inbox' }), null);
  assert.equal(readMail({ uid: '42', folder: 'sent' }), null, 'read stays in selected mailbox');
  for (const args of [{ uid: '42);delete()' }, { uid: '9007199254740992' }, { uid: '42', folder: 'INBOX;delete()' }]) assert.throws(() => mailReadScript(args));
  const noteItems={id:()=>['older','newest'],modificationDate:()=>[new Date('2026-01-01'),new Date('2026-11-01')],byId:id=>({name:()=>id,creationDate:()=>new Date('2026-01-01')})};
  const noteFolders=[{notes:noteItems}];noteFolders.name=()=>['Notes'];
  const listNotes=args=>JSON.parse(new vm.Script(notesListScript(args)).runInNewContext({Application:()=>({folders:noteFolders})}));
  assert.equal(listNotes({count:1})[0].id,'newest');assert.throws(()=>listNotes({folderName:'missing',count:1}));
  const Application = () => ({folders:()=>[{name:()=> 'Folder',notes:()=>[{id:()=> 'note-id',name:()=> 'Known note',plaintext:()=> 'Known body'}]}]});
  assert.equal(JSON.parse(new vm.Script(notesScript({noteId:'note-id'})).runInNewContext({Application})).plaintext,'Known body');
  assert.equal(JSON.parse(new vm.Script(notesScript({query:'known',count:1})).runInNewContext({Application}))[0].id,'note-id');
  assert.equal(JSON.parse(new vm.Script(notesScript({noteId:'missing'})).runInNewContext({Application})),null);
  if (process.platform === 'darwin') {
    const { localHandlers } = await import(pathToFileURL(join(pkg.sourceDir,'server.mjs')));
    const handlers = localHandlers(daemon);
    for (const name of ['list-emails','list-events','list-contacts','list-reminders','list-notes','list-safari-tabs']) assert.equal(typeof handlers[name], 'function');
  }
  const fixture = join(dir, 'controlled.mjs');
  writeFileSync(fixture, `import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
    import {createAppleServer} from ${JSON.stringify(pathToFileURL(join(pkg.sourceDir, 'server.mjs')).href)};
    const require=createRequire(${JSON.stringify(join(daemon,'package.json'))});
    const {StdioServerTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')));
    const names=${JSON.stringify(pkg.tools.map(t=>t.name))};
    const handlers=Object.fromEntries(names.map(n=>[n,async a=>({marker:'controlled-native-read',name:n,args:a,...(a.query==='note-redaction'?{plaintext:'hello\\npassword: synthetic-private-value'}:{}),...(a.query==='boundary'?{body:'x'.repeat(19990)+'boundary-whole-secret-4821976410'+'tail'}:{})})]));
    const server=await createAppleServer(${JSON.stringify(daemon)},handlers);await server.connect(new StdioServerTransport());`);
  conn = await defaultConnector({ id: 'controlled-apple', transport: 'stdio', command: process.execPath, args: [fixture], env: {}, headers: {}, timeoutMs: 10000 });
  const list = await conn.client.listTools();
  assert.deepEqual(list.tools.map(t=>t.name).sort(), pkg.tools.map(t=>t.name).sort());
  for (const tool of pkg.tools) {
    const args = tool.name === 'read-contact' ? {contactUrl:'person-id'} : tool.name === 'read-note' ? {noteId:'note-id'} : tool.name === 'read-messages' ? {chatId:42} : tool.name === 'read-email' ? { uid: '42' } : tool.name.startsWith('search-') ? { query: 'controlled phrase' } : {};
    const result = await conn.client.callTool({ name: tool.name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result)); assert.match(result.content[0].text, /controlled-native-read/);
  }
  for (const [name,args] of [['send-email',{to:'nobody'}],['set-mode',{mode:'cloud'}],['read-email',{uid:'1); malicious()'}],['list-events',{count:10000}],['list-emails',{command:'send'}],['search-emails',{query:'x',action:'send'}]]) {
    let refused = false;
    try { refused = !!(await conn.client.callTool({name,arguments:args})).isError; } catch { refused = true; }
    assert.ok(refused, `unsafe call accepted: ${name}`);
  }
  const boundary = await conn.client.callTool({name:'search-emails',arguments:{query:'boundary'}});
  assert.ok(boundary.content[0].text.includes('boundary-whole-secret-4821976410tail'));
  // Exercise serialized Notes through the actual MCP redaction and persisted ledger boundaries.
  const {createMcpManager} = await import(pathToFileURL(join(daemon,'dist/mcp.js')));
  const {createRedactor} = await import(pathToFileURL(join(daemon,'dist/redact.js')));
  const {openDb} = await import(pathToFileURL(join(daemon,'dist/db/index.js')));
  const {createLedger} = await import(pathToFileURL(join(daemon,'dist/ledger.js')));
  const redactor=createRedactor({env:{}});
  writeFileSync(join(dir,'mcp.json'),JSON.stringify({servers:[{id:'notes-fixture',transport:'stdio',command:process.execPath,args:[fixture]}]}),{mode:0o600});
  const manager=createMcpManager({dataDir:dir,redactor});
  const db=openDb(dir);
  try {
    await manager.load();
    const result=await manager.executors()['mcp.notes-fixture.search-notes']({}, {query:'note-redaction'});
    const ledger=createLedger(db,redactor);
    db.prepare("INSERT INTO rooms (id,name,created_at) VALUES ('synthetic','Synthetic',0)").run();
    const event=ledger.append('synthetic','fixture','tool_result',result);
    const saved=ledger.get(event.id).payload;
    assert.equal(saved.content,result.content,'ledger redaction is idempotent');
    const envelope=JSON.parse(saved.content);
    assert.ok(!saved.content.includes('synthetic-private-value'));
    assert.match(JSON.stringify(envelope),/REDACTED/);
    const benign=' { "content": ["ordinary text"] } ';
    assert.equal(redactor.redactString(benign),benign,'benign JSON retains exact bytes');
    const nested=JSON.stringify({content:[{text:JSON.stringify({plaintext:'password: synthetic-private-value',quote:'"\\'})}]});
    assert.match(JSON.parse(JSON.parse(redactor.redactString(nested)).content[0].text).plaintext,/REDACTED/);
    assert.ok(!redactor.redactString('{\"password\":123456789012}').includes('123456789012'),'numeric password stays protected');
    redactor.addSecret('123456789012');
    assert.ok(!redactor.redactString('{\"value\":123456789012}').includes('123456789012'),'numeric registered secret stays protected');
    const special=JSON.parse(redactor.redactString('{"__proto__":{"password":"synthetic-private-value"}}'));
    assert.equal(special.__proto__.password,'[REDACTED:key]');
  } finally {await manager.close();db.close();}
  const original = { note:'preserve administrator metadata', servers:[{id:'unrelated',transport:'stdio',command:'node',enabled:false}] };
  writeFileSync(join(dir,'mcp.json'),JSON.stringify(original),{mode:0o600});
  // Pure review/CLI calls do not start the native connector.
  const review = process.platform === 'darwin' ? setupReview(dir,'apple-apps') : null;
  if (review) {
    const run = (r, action='install') => spawnSync(process.execPath,[join(daemon,'dist/setup.js'),action,'apple-apps','--data-dir',dir,'--machine',hostname(),'--digest',r.digest,'--config-digest',r.configurationDigest],{encoding:'utf8'});
    assert.equal(run(review).status,0);
    const nativeStatus=spawnSync(join(review.destination,'calendar-reader'),['status'],{encoding:'utf8',timeout:5000});assert.equal(nativeStatus.status,0);assert.equal(typeof JSON.parse(nativeStatus.stdout).authorized,'boolean');
    let config=JSON.parse(readFileSync(join(dir,'mcp.json'),'utf8'));
    assert.deepEqual(config.servers[0],original.servers[0]);assert.equal(config.note,original.note);
    assert.equal(packageProblem(dir,config.servers[1]),null);
    const {createMcpManager} = await import(pathToFileURL(join(daemon,'dist/mcp.js')));
    let changes=0;
    const manager=createMcpManager({dataDir:dir,onChange:()=>{changes++;},connector:async()=>defaultConnector({id:'fixture',transport:'stdio',command:process.execPath,args:[fixture],env:{},headers:{},timeoutMs:10000})});
    await manager.load();await manager.reload();assert.ok(changes>=1);await manager.close();
    assert.equal(run(setupReview(dir,'apple-apps'),'disable').status,0);
    assert.equal(JSON.parse(readFileSync(join(dir,'mcp.json'),'utf8')).servers[1].enabled,false);
    assert.ok(existsSync(review.destination));
    writeFileSync(join(review.destination,'server.mjs'),'// changed');
    assert.ok(packageProblem(dir,config.servers[1]));
  }
  let prompts=0;
  const fake = (_cmd,args,opts,cb) => { prompts++; assert.match(args[1],/com.apple.mail/);assert.ok(!('OPENAG_TOKEN' in opts.env));cb(null,'',''); };
  assert.equal(await requestApplePermission('mail',fake,'darwin'),'granted');
  assert.equal(await requestApplePermission('unknown',fake,'darwin'),'failed');assert.equal(prompts,1);
  let nativeRequests = 0;
  const calendarPermission = (cmd,args,opts,cb) => { nativeRequests++;assert.ok(cmd.endsWith('/calendar-reader'));assert.deepEqual(args,['permission']);assert.ok(!('OPENAG_TOKEN' in opts.env));cb(null,'{"permission":"granted"}',''); };
  assert.equal(await requestApplePermission('calendar',calendarPermission,'darwin'),'granted');assert.equal(nativeRequests,1);
  assert.equal(await requestApplePermission('reminders',(_cmd,args,_opts,cb)=>{assert.deepEqual(args,['reminders-permission']);cb(null,'{\"permission\":\"granted\"}','');},'darwin'),'granted');
  assert.equal(await requestApplePermission('calendar',(_cmd,_args,_opts,cb)=>cb(null,'{"permission":"failed"}',''),'darwin'),'failed');

  console.log(`Apple connector controlled MCP/CLI integration passed (${pkg.tools.length} read tools). No Apple app or permission prompt invoked.`);
} finally {await conn?.close();rmSync(dir,{recursive:true,force:true});}
