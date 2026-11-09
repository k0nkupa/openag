// Bounded subscription/local inference acceptance in disposable data. Never uses the installed daemon.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startFixture} from './bot-models-fixture.mjs';
if(!process.argv.includes('--real'))throw Error('Pass --real to authorize four tiny subscription turns and two local Ollama turns in disposable data');
const dir=mkdtempSync(join(tmpdir(),'openag-bot-models-')),token=randomUUID();
const f=await startFixture(dir,token,0,{real:true,realOllama:true,warm:false});
async function api(path,method='GET',body){const r=await fetch(f.url+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,`${path}: ${r.status}`);return v;}
try {
 await f.botModels.catalogue.refresh();
 for(const target of ['claude','codex','ollama']){
  const source=f.botModels.catalogue.status().sources.find(s=>s.id===target);assert.ok(source.refreshedAt&&!source.error,`${target}: ${source.error ?? "refresh failed"}`);
  const c=await api('/bots/coder/model/discover','POST',{target});
  await api('/bots/coder/model','PUT',{revision:c.revision,snapshotId:c.snapshotId,model:c.model,reasoning:{}});
  const sessionIds=[];
  for(let i=0;i<2;i++){
   const message=f.ledger.append('main','user','message',{text:'Reply with exactly OPENAG_CACHE_OK. Do not use tools, read files, or perform any actions.'});
   await f.runner.dispatch({room:(await api('/rooms/main')).room,botIds:['coder'],message});
   const turn=f.db.prepare("SELECT * FROM turns WHERE bot_id='coder' ORDER BY created_at DESC LIMIT 1").get();
   assert.equal(turn.status,'finished',`${target}: failed or uncertain turn ${turn.id}`);
   assert.equal(f.db.prepare("SELECT count(*) n FROM action_receipts WHERE turn_id=?").get(turn.id).n,0,'No tools authorized');
   const events=f.ledger.list('main',{afterId:message.id});
   assert.ok(events.some(e=>e.actor==='coder'&&e.type==='bot_output'&&e.payload.text?.trim()==='OPENAG_CACHE_OK'),`${target}: missing exact provider reply for ${turn.id}`);
   sessionIds.push(JSON.parse(turn.state_json).acpSessionId);
  }
  if(target!=='ollama')assert.ok(sessionIds[0]&&sessionIds[0]===sessionIds[1],`${target}: second turn reused the session`);
  console.log(`PASS ${target}: cached selection, two exact replies, ${target==='ollama'?'local inference':'same ACP session'}, no tool actions`);
 }
} finally {await f.close();rmSync(dir,{recursive:true,force:true});}
