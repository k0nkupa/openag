// Disposable HTTP/gateway/runner acceptance; no model account or unit runner.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startFixture } from './bot-models-fixture.mjs';
const dir=mkdtempSync(join(tmpdir(),'openag-bot-models-')), token=randomUUID();
let f=await startFixture(dir,token);
const request=(path,method='GET',body,auth=token)=>fetch(f.url+path,{method,headers:{authorization:'Bearer '+auth,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
async function json(path,method='GET',body){const r=await request(path,method,body);assert.ok(r.ok,`${method} ${path}: ${r.status}`);return r.json();}
try {
 for(const bot of ['coder','boss']) {
  const message=f.ledger.append('main','user','message',{text:'Cancelled discovery with no final tool result'}),turnId=randomUUID();
  const task=f.runner.work.begin({roomId:'main',botId:bot,messageId:message.id});
  f.db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES(?,'main',?,'interrupted','{}',?,?)").run(turnId,bot,Date.now(),Date.now());
  f.runner.work.updateRun(task.runId,'interrupted','Interrupted discovery',turnId);
  f.ledger.append('main',bot,'tool_call',{turnId,toolCallId:randomUUID(),title:'Historical read',status:'in_progress'});
  assert.equal((await request('/work/'+task.workId+'/recovery')).status,404);
  await f.runner.withIdleBot(bot,async()=>{});
  await json('/work/'+task.workId+'/cancel','POST',{revision:(await json('/work/'+task.workId)).work.revision});
  const retained=f.runner.work.get(task.workId);assert.equal(retained.status,'interrupted');assert.equal(retained.progress.pendingTools,1);
  await f.runner.withIdleBot(bot,async()=>{});
  // Independent guards still block even after the historical issue was reviewed.
  f.db.prepare("UPDATE work_runs SET status='running' WHERE id=?").run(task.runId);await assert.rejects(f.runner.withIdleBot(bot,async()=>{}),error=>error.status===409);
  f.db.prepare("UPDATE work_runs SET status='cancelled' WHERE id=?").run(task.runId);
  const receiptId=randomUUID();
  f.db.prepare("INSERT INTO action_receipts(id,review_version,room_id,bot_id,work_id,turn_id,tool_name,tool_class,inspection_epoch,action_key,decision,proposal_json,effective_json,outcome,evidence_json,decided_at) VALUES(?,'fixture','main',?,?,?,'historical_effect','act-external',0,'fixture','accept','{}','{}','unknown','{}',?)").run(receiptId,bot,task.workId,turnId,Date.now());
  await f.runner.withIdleBot(bot,async()=>{});
  assert.equal(f.db.prepare('SELECT outcome,inspected_at FROM action_receipts WHERE id=?').get(receiptId).outcome,'unknown');
  await f.runner.withIdleBot(bot,async()=>{});
  f.db.prepare("UPDATE action_receipts SET outcome='pending' WHERE id=?").run(receiptId);await assert.rejects(f.runner.withIdleBot(bot,async()=>{}),error=>error.status===409);
  f.db.prepare("UPDATE action_receipts SET outcome='unknown' WHERE id=?").run(receiptId);
 }
 await f.close();f=await startFixture(dir,token);
 for(const bot of ['coder','boss'])await f.runner.withIdleBot(bot,async()=>{});
 console.log('PASS: historical missing-result state no longer locks models; retained unknown history and active/pending receipt guards and restart persistence.');
} finally {await f.close();rmSync(dir,{recursive:true,force:true});}
