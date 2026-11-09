// Disposable Settings preview: real gateway/storage, no model runs or external services.
import { mkdtempSync, rmSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
for (const name of Object.keys(process.env)) if (!['PATH','HOME','LANG','TMPDIR'].includes(name)) delete process.env[name];
process.env.OPENAI_API_KEY='preview-synthetic-openai';
process.env.OPENAG_OLLAMA_URL='http://127.0.0.1:1';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(root + 'apps/daemon/package.json');
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { serve } = require('@hono/node-server');
const { openDb, MIGRATIONS_DIR } = await load('db/index'), { createLedger } = await load('ledger'), { createAuth } = await load('auth');
const { createBot, createRoom, addMember } = await load('rooms'), { createApprovals } = await load('approvals');
const { createGateway, attachStream } = await load('gateway'), { createBackups } = await load('backup'), { createOps } = await load('ops');
const { createBotModels } = await load('botmodels');
const { createReadiness } = await load('readiness'), { getSetting, setSetting } = await load('settings');
const { createScheduler } = await load('scheduler'), { createAutomationManager } = await load('automations'), { createWakeFilter } = await load('wake');
const { createPusher } = await load('push'), { registerReflection } = await load('reflection');
const dir = mkdtempSync(join(tmpdir(), 'openag-settings-preview-')), token = randomUUID(), permissionPreview=process.argv.includes('--permission-adoption');
if(permissionPreview){
 const migrationDir=join(dir,'previous-migrations');mkdirSync(migrationDir);for(const name of readdirSync(MIGRATIONS_DIR))if(parseInt(name,10)<34)copyFileSync(join(MIGRATIONS_DIR,name),join(migrationDir,name));
 const old=new(require('better-sqlite3'))(join(dir,'openag.db'));require('sqlite-vec').load(old);const {migrate}=await load('db/migrate');migrate(old,migrationDir);
 for(const [id,name] of [['boss','Boss'],['bot','Bot'],['coder','Coder'],['codex','Codex'],['researcher','Researcher']])createBot(old,{id,name,runtime:'api'});
 old.prepare("INSERT INTO tool_modes VALUES('boss','act-local','auto'),('coder','act-local','auto'),('codex','act-local','auto'),('researcher','act-local','auto'),('researcher','act-external','deny')").run();old.close();
}
const db = openDb(dir), env = {OPENAI_API_KEY:'preview-synthetic-openai',OPENAG_OLLAMA_URL:'http://127.0.0.1:1'};
const ledger = createLedger(db), auth = createAuth({ db, ownerToken: token }), approvals = createApprovals(db, ledger);
for (const [id, name, color] of [['bot','Bot','pink'],['coder','Coder','orange'],['researcher','Researcher','mint']]) if(!db.prepare('SELECT 1 FROM bots WHERE id=?').get(id))createBot(db, {id,name,runtime:'api',model:'openai/gpt-5',config:{avatar:{shape:'blob',color},description:id==='bot'?'Your default agent':'A specialist for your workspace'}});
for (const id of ['main','_system']) {createRoom(db,{id,name:id,leadBotId:'bot'}); for (const bot of ['bot','coder','researcher']) addMember(db,id,bot);}
setSetting(db,'defaultBot',{botId:'bot'});
for (const key of ['heartbeat','reflection','brief']) setSetting(db,key,{...getSetting(db,key),enabled:true});
setSetting(db,'backup',{...getSetting(db,'backup'),enabled:true});
const backups = createBackups({db,ledger,dataDir:dir,env}), ops = createOps({db,dataDir:dir,env});
await backups.run();
const scheduler=createScheduler({tickMs:60_000}), runner={run(){throw Error('Inference is disabled in the Settings preview');},isBusy(){return false;}};
const wake=createWakeFilter({db,ledger,tz:'Pacific/Auckland'}), automations=createAutomationManager({db,ledger,runner,scheduler,wake,tz:'Pacific/Auckland'});
const reflection=registerReflection({db,ledger,approvals,runner,scheduler,tz:'Pacific/Auckland',dataDir:dir,skillsEnabled:true});
const readiness=createReadiness({db,ledger,auth,backups,ops,env});
const push=createPusher({db,fetch:async()=>new Response(null,{status:503})});
const computer={status:async()=>({backend:'cua',name:'Preview computer',exists:false,state:'absent',status:null,image:null,kind:null,runtime:null,busy:false,lastError:null}),capabilities:()=>({shell:true,view:'proxy',hosted:false}),busy:()=>false};
const modelManager=createBotModels({db,ledger,env,withIdleBot:async(_id,run)=>run(),fetch:async url=>{
 if(String(url).startsWith('https://api.openai.com/'))return Response.json({data:[{id:'gpt-5'},{id:'gpt-4o-mini'}]});
 throw Error('Preview has no external provider access');
},acp:{stopBot:async()=>{},discover:async()=>{throw Error('Preview uses API agents only');}}});
const botModels={...modelManager,creationTargets:()=>[{id:"openai",name:"OpenAI (preview)",configured:true}]};
const {createPermissions}=await load('permissions'),permissions=createPermissions(db,ledger,dir,approvals);
const app=createGateway({db,ledger,auth,approvals,permissions,dataDir:dir,deskDir:root+'apps/desk/dist',dispatch(){throw Error('Chat is disabled in this preview');},backups,ops,readiness,automations,reflection,push,computer,botModels,modelEnv:env});
for (const [name,cron,prompt] of [['Morning project brief','0 9 * * 1-5','Summarize project activity and highlight decisions that need my attention.'],['Weekly maintenance','0 9 * * 1','Review the workspace and suggest maintenance tasks.'],['Research watch','0 * * * *','Look for meaningful changes in the research queue. Stay quiet when nothing needs attention.']]) {
 const response=await app.request('/automations',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({name,scheduleCron:cron,prompt,botId:'bot',roomId:'main',enabled:true,allowApprovals:false})});
 if(!response.ok)throw Error(await response.text());
}
const previewDevice=permissionPreview?auth.createDevice('Disposable permission design preview','owner','full'):null;
const server=serve({hostname:'127.0.0.1',port:0,fetch:request=>{
 if(previewDevice&&new URL(request.url).pathname==='/preview-permissions')return new Response('<!doctype html><script>localStorage.setItem("openag-token",'+JSON.stringify(previewDevice.token)+');localStorage.setItem("openag.theme","dark");location.replace("/#/settings")</script>',{headers:{'content-type':'text/html','cache-control':'no-store'}});
 return app.fetch(request);
}});
const detach=attachStream(server,ledger,auth);
if(!server.listening) await new Promise(resolve=>server.once('listening',resolve));
const url='http://127.0.0.1:'+server.address().port;
const pair=()=>auth.createPairingCode('owner','full');
console.log(JSON.stringify({url:permissionPreview?url+'/preview-permissions':url,...(!permissionPreview?{code:pair().code}:{}),dir,disposable:true}));
process.stdin.setEncoding('utf8');process.stdin.on('data',line=>{if(line.trim()==='pair')console.log(JSON.stringify(pair()));});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;scheduler.stop();automations.shutdown();reflection.close?.();detach();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});process.exit(0);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
