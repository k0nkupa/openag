// Disposable 100-agent UI preview. Build first; stdin accepts working, idle, work, pair and stats. No inference.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const {startFixture}=await import(root+'/scripts/bot-models-fixture.mjs');
const {createBot,createRoom,addMember,getBot}=await import(root+'/apps/daemon/dist/rooms.js');
const {modelRevision}=await import(root+'/apps/daemon/dist/botmodels.js');
const dir=mkdtempSync(join(tmpdir(),'openag-bot-models-')),token=randomUUID(),f=await startFixture(dir,token);
for(let n=5;n<=100;n++)createBot(f.db,{id:'agent-'+String(n).padStart(3,'0'),name:n===100?'Very long specialist name for investigating a complicated issue':'Agent '+String(n).padStart(3,'0'),runtime:'api',model:'openai/gpt-5',config:{avatar:{shape:n%2?'hexagon':'blob',color:n%2?'mint':'violet'}}});
createRoom(f.db,{id:'panel-preview',name:'Planning',leadBotId:'coder'});
for(const id of ['coder','boss','agent-100'])addMember(f.db,'panel-preview',id);
f.db.prepare("UPDATE bots SET model='codex',config_json=? WHERE id='coder'").run(JSON.stringify({adapter:'codex',modelConfig:{model:'gpt-6-astra',reasoning:{reasoning_effort:'medium'}},avatar:{shape:'mug',color:'pink'}}));
function report(id,roomId,model,modelName,effort,revision){f.ledger.append(roomId,id,'model_report',{source:'session',model,modelName,effort,revision:revision??modelRevision(getBot(f.db,id),f.env)});}
report('coder','panel-preview','gpt-6-astra','6 Astra','low');
f.ledger.append('panel-preview','coder','model_report',{source:'response',model:'gpt-6-astra-served',modelName:'6 Astra',revision:modelRevision(getBot(f.db,'coder'),f.env)});
report('boss','second','openai/other-room-only','Other room only','high');
report('agent-100','panel-preview','openai/stale','Stale model','high','stale-revision');
const headers={authorization:'Bearer '+token,'content-type':'application/json'};
const pair=async access=>(await(await fetch(f.url+'/devices/pairing-codes',{method:'POST',headers,body:JSON.stringify({access})})).json()).code;
if(f.db.prepare('select count(*) n from bots').get().n!==100)throw Error('Expected 100 controlled agents');
console.log(JSON.stringify({url:f.url,code:await pair('full'),dir}));
process.stdin.setEncoding('utf8');process.stdin.on('data',async line=>{const cmd=line.trim();if(cmd==='working'){f.ledger.append('panel-preview','coder','turn_started',{turnId:'controlled-display-turn'});}else if(cmd==='idle'){f.ledger.append('panel-preview','coder','turn_finished',{turnId:'controlled-display-turn',status:'finished'});}else if(cmd==='work'){const event=f.ledger.append('panel-preview','user','message',{text:'Controlled planning Work'});const work=f.runner.work.begin({roomId:'panel-preview',botId:'coder',messageId:event.id});f.runner.work.updateRun(work.runId,'completed');f.runner.work.report(work.workId,{nextStep:'Review the controlled result'});console.log(JSON.stringify({workId:work.workId}));}else if(cmd==='pair')console.log(await pair('full'));else if(cmd==='stats')console.log(JSON.stringify({agents:f.db.prepare('select count(*) n from bots').get().n,turns:f.db.prepare('select count(*) n from turns').get().n,prompts:f.stats.prompts.length}));});
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
process.once('SIGINT',async()=>{await f.close();rmSync(dir,{recursive:true,force:true});process.exit(0);});
