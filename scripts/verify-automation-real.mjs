// Explicit manual gate: one installed Codex subscription run, real timer, empty disposable workspace, local delivery only.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
if(!process.argv.includes('--authorized-codex'))throw Error('This manual gate requires explicit authorization for temporary Codex usage.');
const dir=mkdtempSync(join(tmpdir(),'openag-automation-')),ownerToken=randomBytes(32).toString('hex'),child=fork(fileURLToPath(new URL('./automation-fixture.mjs',import.meta.url)),[dir,'--real-codex'],{stdio:['ignore','ignore','pipe','ipc']});
child.stderr.on('data',bytes=>process.stderr.write(bytes));const ready=once(child,'message');child.send({ownerToken});const base=(await ready)[0].url;
const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{authorization:'Bearer '+ownerToken,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
let automationId;
try{
 const at=new Date(Date.now()+70000),cron=`${at.getUTCMinutes()} ${at.getUTCHours()} * * *`,marker='OA326_SCHEDULED_LOCAL_DELIVERY_VERIFIED';
 const created=await request('/automations','POST',{name:'Temporary OA-326 real scheduled check',prompt:`Do not call tools, read files, delegate or change anything. Reply with exactly: ${marker}`,botId:'boss',roomId:'main',scheduleCron:cron,tz:'UTC',outputMode:'room',allowApprovals:false});assert.equal(created.status,201);const a=(await created.json()).automation;automationId=a.id;
 assert.ok(a.runtime.nextRunAt>Date.now());console.log(JSON.stringify({state:'armed',nextRunAt:a.runtime.nextRunAt,timezone:'UTC',target:'temporary empty workspace and local room',dir}));
 let run;const end=Date.now()+240000;
 do{const p=await(await request('/automation-runs?automationId='+a.id)).json();run=p.runs?.[0];if(run&&run.outcome!=='running')break;await new Promise(r=>setTimeout(r,1000));}while(Date.now()<end);
 assert.ok(run,'The actual scheduler started a run');assert.equal(run.trigger,'schedule');assert.equal(run.outcome,'completed',run.summary);assert.equal(run.delivery.kind,'room');assert.equal(run.delivery.destination,'main');assert.ok(run.workId);assert.ok(run.summary.includes(marker));
 const events=(await(await request('/rooms/main/events')).json()).events;const delivered=events.find(e=>e.id===run.delivery.referenceId);assert.equal(delivered?.type,'bot_output');assert.ok(delivered.payload.text.includes(marker));
 assert.equal((await(await request('/approvals')).json()).approvals.length,0);const record={adapter:'installed Codex',trigger:'real cron timer',outcome:run.outcome,delivery:'verified bot_output in temporary local room',runId:run.id,workId:run.workId,startedAt:run.startedAt,endedAt:run.endedAt,externalActions:'none',liveDesk:'unchanged',dir};writeFileSync('/tmp/oa326-real-evidence.json',JSON.stringify(record,null,2));console.log('OA-326 real scheduled Codex run and local delivery passed.');
}finally{if(automationId)await request('/automations/'+automationId,'DELETE').catch(()=>{});if(child.connected){const exit=once(child,'exit');child.send({type:'stop'});await exit;}}
