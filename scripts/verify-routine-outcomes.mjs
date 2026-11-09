// Controlled acceptance through real scheduler, manager, history HTTP and restart interfaces. No live sources.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'openag-automation-routines-')),ownerToken=randomBytes(32).toString('hex');
let child,base,clock=Date.UTC(2026,9,31,22,0);
const bounded=p=>Promise.race([p,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture timed out')),20000);timer.unref();})]);
function ipc(type,extra={}){const requestId=randomBytes(8).toString('hex');return bounded(new Promise(resolve=>{const receive=value=>{if(value.requestId!==requestId)return;child.off('message',receive);resolve(value);};child.on('message',receive);child.send({type,requestId,...extra});}));}
async function start(){child=fork(root+'scripts/automation-fixture.mjs',[dir],{stdio:['ignore','ignore','inherit','ipc']});const ready=once(child,'message');child.send({ownerToken,clock});base=(await bounded(ready))[0].url;}
async function kill(){const exited=once(child,'exit');child.kill('SIGKILL');await bounded(exited);}
async function json(path,{method='GET',body,status=200}={}){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+ownerToken,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,status,await r.clone().text());return r.json();}
const create=async(name,extra={})=>(await json('/automations',{method:'POST',body:{name,prompt:'Quiet',botId:'boss',scheduleCron:'*/15 * * * *',outputMode:'wake',...extra},status:201})).automation;
const history=async a=>(await json('/automation-runs?automationId='+a.id)).runs;
const pause=a=>json('/automations/'+a.id,{method:'PUT',body:{enabled:false}});
async function tick(at){clock=at;await ipc('tick',{at});}
async function settled(a){for(let i=0;i<100;i++){const rows=await history(a);if(rows.length&&rows.every(r=>r.outcome!=='running'))return rows;await new Promise(r=>setTimeout(r,20));}throw Error('Run did not settle');}
await start();
try{
 const a=await create('Restart gap');assert.equal((await history(a)).length,0,'new baseline does not invent history');
 await kill();clock+=60*60000;await start();let rows=await history(a);assert.equal(rows.length,1);const missed=rows[0];
 assert.equal(missed.outcome,'missed');assert.equal(missed.scheduledAt,Date.UTC(2026,9,31,22,15));assert.equal(missed.gapUntil,clock);assert.equal(missed.startedAt,null);assert.equal(missed.turnId,null);assert.equal(missed.workId,null);assert.equal(missed.delivery.kind,'none');
 await ipc('sync');await kill();await start();assert.deepEqual(await history(a),rows,'restart/sync does not duplicate a gap');assert.equal((await ipc('stats')).active,0);
 await tick(clock);assert.equal((await history(a)).length,1,'overdue work was not caught up');
 await tick(clock+15*60000);rows=await settled(a);assert.equal(rows.length,2);assert.equal(rows[0].recordKind,'run');assert.equal(rows[0].scheduledAt,clock);await pause(a);
 const p=await create('Paused baseline',{enabled:false});await kill();clock+=60*60000;await start();assert.equal((await history(p)).length,0);await json('/automations/'+p.id,{method:'PUT',body:{enabled:true}});assert.equal((await history(p)).length,0);await pause(p);
 const delay=await create('Late live tick');await tick(clock+60*60000);rows=await settled(delay);assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.recordKind==='run').length,1);assert.equal(rows.find(r=>r.outcome==='missed').gapUntil,clock-15*60000);await pause(delay);
 const hold=await create('Busy scheduled check',{prompt:'HOLD'});await json('/automations/'+hold.id+'/run',{method:'POST',status:202});await tick(clock+15*60000);rows=await history(hold);assert.equal(rows[0].outcome,'skipped');assert.equal(rows[0].reason,'busy');assert.equal(rows[0].startedAt,null);await ipc('release-runs');assert.notEqual((await json('/automations/'+hold.id)).automation.lastStatus,'running','a newer diagnostic must not block the older execution from settling');await pause(hold);
 const overlap=await create('Scheduler overlap',{prompt:'HOLD'});const due=clock+15*60000;
 const tickReply=ipc('tick',{at:due});clock=due;
 // Observe admission through history before a second tick visits the same busy scheduler job.
 for(let i=0;i<100&&!(await history(overlap)).some(r=>r.outcome==='running');i++)await new Promise(r=>setTimeout(r,20));
 await ipc('tick',{at:clock+15*60000});clock+=15*60000;
 assert.equal((await history(overlap))[0].outcome,'skipped');
 await ipc('release-runs');await tickReply;await pause(overlap);
 const approvalWait=await create('Pending approval',{prompt:'AWAIT_APPROVAL',outputMode:'room',roomId:'main',allowApprovals:true});await json('/automations/'+approvalWait.id+'/run',{method:'POST',status:202});
 let approval;for(let i=0;i<100&&!approval;i++){approval=(await json('/approvals')).approvals.find(a=>a.status==='pending');if(!approval)await new Promise(r=>setTimeout(r,20));}assert.ok(approval,'controlled run reached the actual approval gate');
 await tick(clock+15*60000);assert.equal((await history(approvalWait))[0].reason,'busy');
 const reviewed=(await json('/approvals/'+approval.id)).approval;await json('/approvals/'+approval.id,{method:'POST',body:{kind:'ignore',reviewVersion:reviewed.reviewVersion}});await settled(approvalWait);await pause(approvalWait);
 // A completed long run still proves earlier availability was restricted; checking only current busy state is wrong.
 const historicalBusy=await create('Historical busy period',{prompt:'HOLD'});await json('/automations/'+historicalBusy.id+'/run',{method:'POST',status:202});await ipc('clock',{at:clock+=50*60000});await ipc('release-runs');clock+=10*60000;const historicalTick=ipc('tick',{at:clock});for(let i=0;i<100&&!(await history(historicalBusy)).some(r=>r.recordKind==='diagnostic');i++)await new Promise(r=>setTimeout(r,20));rows=await history(historicalBusy);assert.equal(rows.find(r=>r.recordKind==='diagnostic').outcome,'coverage_gap');assert.equal(rows.find(r=>r.recordKind==='diagnostic').reason,'availability_unknown');await ipc('release-runs');await historicalTick;await pause(historicalBusy);
 const broken=await create('Start failure');await ipc('fail-start');await tick(clock+15*60000);rows=await history(broken);assert.equal(rows.length,1);assert.equal(rows[0].outcome,'start_failed');assert.equal(rows[0].reason,'admission_error');assert.equal(rows[0].startedAt,null);await ipc('sync');await tick(clock);assert.equal((await history(broken)).length,1);await pause(broken);
 const noMember=await create('Missing member',{outputMode:'room',roomId:'other'});await ipc('remove-member',{roomId:'other'});await tick(clock+15*60000);rows=await history(noMember);assert.equal(rows[0].reason,'room or membership unavailable');assert.equal(rows[0].outcome,'start_failed');await pause(noMember);
 await ipc('fail-registration',{enabled:true});const reg=await create('Registration refusal');rows=await history(reg);assert.equal(rows[0].phase,'registration');await ipc('sync');assert.equal((await history(reg)).length,1);await ipc('fail-registration',{enabled:false});await ipc('sync');await pause(reg);
 const poll=await create('Backoff source',{triggerKind:'github_poll',scheduleCron:null,pollRepo:'owner/repo',pollToken:'synthetic-routine-token-837628',pollEveryMinutes:15,hookEvents:['issues']});await ipc('poll-mode',{mode:'backoff'});await json('/automations/'+poll.id+'/run',{method:'POST',status:202});await settled(poll);const before=await history(poll),timing=(await json('/automations/'+poll.id)).automation.runtime;await tick(clock+60000);assert.deepEqual(await history(poll),before);assert.equal((await json('/automations/'+poll.id)).automation.runtime.pollEligibleAt,timing.pollEligibleAt);await pause(poll);
 // Retained wake delivery is neither recreated nor bypassed by gap reporting.
 await ipc('quiet-hours');const q=await create('Quiet hours',{prompt:'PING'});await json('/automations/'+q.id+'/run',{method:'POST',status:202});rows=await settled(q);assert.equal(rows[0].delivery.kind,'digest');const delivered=rows[0];await kill();clock+=30*60000;await start();rows=await history(q);assert.deepEqual(rows.find(r=>r.id===delivered.id),delivered);assert.ok(rows.some(r=>r.outcome==='missed'&&r.delivery.kind==='none'));await kill();await start();assert.deepEqual(await history(q),rows);await pause(q);
 // Editing and pausing close evidence intervals; a new schedule is never projected backwards.
 const edit=await create('Schedule edit');await ipc('clock',{at:clock+=60*60000});await json('/automations/'+edit.id,{method:'PUT',body:{scheduleCron:'0 * * * *'}});rows=await history(edit);assert.equal(rows[0].outcome,'coverage_gap');assert.equal(rows[0].snapshot.scheduleCron,'*/15 * * * *');await pause(edit);
 const rollback=await create('Clock rollback');await tick(clock+15*60000);await settled(rollback);const completedBeforeRollback=await history(rollback),future=(await json('/automations/'+rollback.id)).automation.runtime.nextRunAt;
 await kill();clock-=15*60000;await start();assert.equal((await json('/automations/'+rollback.id)).automation.runtime.nextRunAt,future);await tick(clock+15*60000);assert.deepEqual(await history(rollback),completedBeforeRollback,'clock rollback cannot readmit consumed occurrences');await pause(rollback);
 const savedClock=clock;await ipc('clock',{at:Date.UTC(2026,3,4,13,0)});const dst=await create('Timezone schedule',{scheduleCron:'30 3 * * *',tz:'Pacific/Auckland'});assert.equal((await json('/automations/'+dst.id)).automation.runtime.nextRunAt,Date.UTC(2026,3,4,15,30));await pause(dst);await ipc('clock',{at:savedClock});
 // Spring-forward's nonexistent local 02:30 is advanced by the scheduler; reverse cron lookup loses it.
 clock=Date.UTC(2026,8,26,12,0);await ipc('clock',{at:clock});
 const spring=await create('Spring-forward admission',{scheduleCron:'30 2 * * *',tz:'Pacific/Auckland'});assert.equal((await json('/automations/'+spring.id)).automation.runtime.nextRunAt,Date.UTC(2026,8,26,14,30));
 await tick(Date.UTC(2026,8,26,14,30));rows=await settled(spring);assert.equal(rows.length,1);assert.equal(rows[0].recordKind,'run');assert.equal(rows[0].scheduledAt,clock);await pause(spring);
 clock=Date.UTC(2026,8,26,12,0);await ipc('clock',{at:clock});const springRestart=await create('Spring-forward restart',{scheduleCron:'30 2 * * *',tz:'Pacific/Auckland'});
 await kill();clock=Date.UTC(2026,8,26,14,31);await start();rows=await history(springRestart);assert.equal(rows[0].outcome,'missed');assert.equal(rows[0].scheduledAt,Date.UTC(2026,8,26,14,30));assert.equal(rows[0].gapUntil,rows[0].scheduledAt);await pause(springRestart);
 clock=Date.UTC(2026,3,4,12,0);await ipc('clock',{at:clock});const fall=await create('Fall-back admission',{scheduleCron:'30 2 * * *',tz:'Pacific/Auckland'});await tick(Date.UTC(2026,3,4,13,30));await settled(fall);await tick(Date.UTC(2026,3,4,14,30));assert.equal((await history(fall)).length,1,'do not invent a second occurrence for a repeated local label');await pause(fall);
 const large=await create('Bounded long gap');await tick(clock+100*24*60*60000);rows=await history(large);assert.equal(rows.length,1);assert.equal(rows[0].outcome,'coverage_gap');assert.equal(rows[0].reason,'scan_limit');assert.equal(rows[0].startedAt,null);await pause(large);
 console.log('OA-372 controlled routine outcomes passed: baseline, restart, grouped gaps, no catch-up, bounded live admission, busy/overlap, pre-launch/registration failure, backoff, quiet hours, delivery preservation and schedule edits.');
 // Migration acceptance exercises the actual numbered migrations, including empty history with a retained sequence.
 const require=createRequire(root+'apps/daemon/package.json'),Database=require('better-sqlite3'),{migrate}=await import(root+'apps/daemon/dist/db/migrate.js');
 for(const populated of [false,true]){
  const db=new Database(':memory:'),migrations=join(dir,'migrations-'+populated);mkdirSync(migrations);
  for(const f of readdirSync(root+'apps/daemon/dist/db/migrations').filter(f=>/^\d+_/.test(f)&&Number(f.slice(0,3))<=25))copyFileSync(root+'apps/daemon/dist/db/migrations/'+f,join(migrations,f));
  migrate(db,migrations);db.prepare("INSERT INTO automation_runs(seq,id,automation_id,snapshot_json,trigger,started_at,outcome,delivery_json) VALUES(41,'retained','removed','{}','manual',123,'completed',?)").run('{"kind":"ping","destination":"main","referenceId":12}');
  const old=db.prepare('SELECT * FROM automation_runs').all();if(!populated)db.exec('DELETE FROM automation_runs');copyFileSync(root+'apps/daemon/dist/db/migrations/026_routine_outcomes.sql',join(migrations,'026_routine_outcomes.sql'));migrate(db,migrations);
  assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='automation_runs'").get().seq,41);if(populated){const migrated=db.prepare('SELECT * FROM automation_runs').get();for(const [k,v]of Object.entries(old[0]))assert.equal(migrated[k],v);assert.equal(migrated.record_kind,'run');}assert.deepEqual(db.pragma('foreign_key_check'),[]);db.close();
 }
 console.log('OA-372 v25 migration passed: immutable old columns, delivery, empty/populated paging sequence and foreign keys.');
 writeFileSync(join(dir,'evidence.json'),JSON.stringify({missedId:missed.id,dir},null,2));
 if(process.argv.includes('--serve')){console.log(JSON.stringify({url:base+'/#/automations',pairCode:(await ipc('pair')).code,dir}));await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
}finally{if(child?.connected){const exited=once(child,'exit');child.send({type:'stop'});await bounded(exited);}}
