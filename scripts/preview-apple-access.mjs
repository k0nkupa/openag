// Disposable integration desk preview. All connection state/actions are synthetic; no native apps or providers are contacted.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
for (const name of Object.keys(process.env)) if (!['PATH','HOME','LANG','TMPDIR'].includes(name)) delete process.env[name];
const root=fileURLToPath(new URL('../',import.meta.url)), require=createRequire(root+'apps/daemon/package.json');
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {serve}=require('@hono/node-server'), {openDb}=await load('db/index'), {createLedger}=await load('ledger'), {createAuth}=await load('auth');
const {createBot,createRoom,addMember}=await load('rooms'), {createApprovals}=await load('approvals'), {createGateway,attachStream}=await load('gateway');
const dir=mkdtempSync(join(tmpdir(),'openag-apple-preview-')), db=openDb(dir), token=randomUUID();
const ledger=createLedger(db),auth=createAuth({db,ownerToken:token}),approvals=createApprovals(db,ledger);
createBot(db,{id:'bot',name:'Bot',runtime:'api',model:'openai/gpt-5',config:{}});
for(const id of ['main','_system']){createRoom(db,{id,leadBotId:'bot'});addMember(db,id,'bot');}
const entry={id:'mcp:apple-apps',runtimeId:'apple-apps',kind:'mcp',name:'Apple apps',description:'Read and search apps on your Mac.',category:'Productivity',setupId:'apple-apps',installed:true,state:'failed',reason:'invalid: package pin does not match this connector entry',source:'Administrator-managed mcp.json; publisher not verified',version:'1.0.0',requirements:['Administrator-managed MCP configuration'],tools:[],toolEvidence:'discovered'};
const apps=['mail','calendar','contacts','reminders','notes','messages','safari'].map(app=>({app,available:true,requirement:app==='calendar'||app==='reminders'?'Full Access on the daemon host via EventKit; reads are checked separately':app==='messages'?'Full Disk Access for the launching service; history access is not verified':'Automation access on the daemon host; app data access is not verified',permission:app==='safari'?'unknown':app==='contacts'?'denied':app==='notes'?'failed':'granted',verifiedAt:null}));
const composio={...entry,id:'connector:composio-connect',runtimeId:'composio-connect',kind:'connector',name:'Composio',brand:'composio',setupId:undefined,state:'ready',reason:'Composio tools are connected.',description:'Connect services for your agents to use.',source:'Composio hosted MCP',requirements:[],tools:Array.from({length:12},(_,i)=>({name:'mcp.composio-connect.COMPOSIO_'+['SEARCH_TOOLS','MANAGE_CONNECTIONS','MULTI_EXECUTE_TOOL'][i%3]+'_'+i,class:i===0?'search':'act-external',description:'Synthetic untrusted tool description. '.repeat(30)}))};
const reference={...entry,id:'mcp:reference',runtimeId:'reference',name:'Local reference',setupId:undefined,state:'ready',reason:'Connected',description:'A generic MCP integration using the same details panel.',requirements:[],tools:[{name:'mcp.reference.clock',class:'read',description:'Return the local time.'}]};
let composioAccount=true,connected=false;const calls=[];
const app=createGateway({db,ledger,auth,approvals,dataDir:dir,deskDir:root+'apps/desk/dist',dispatch(){throw Error('Chat is disabled in this preview');},modelEnv:{OPENAG_OLLAMA_URL:'http://127.0.0.1:1'}});
const fetch=async request=>{
 const path=new URL(request.url).pathname;
 if(path==='/app-library')return Response.json({machine:'Preview Mac · synthetic data',appsDir:null,configPath:null,apps:[],servers:[],entries:[entry,composio,reference],counts:{installed:3,ready:connected?3:2}});
 if(path==='/connectors/composio')return Response.json({configured:true,state:composioAccount?'connected':'needs_access',reason:null,hasAccount:composioAccount});
 if(path==='/connectors/composio/start'){calls.push({action:'composio-start'});console.log('Synthetic reconnect requested; provider navigation blocked');return Response.json({error:'Synthetic sign-in unavailable; existing connection preserved'},{status:503});}
 if(path==='/connectors/composio/disconnect'){composioAccount=false;composio.state='setup';calls.push({action:'composio-disconnect'});console.log('Synthetic disconnect confirmed');return Response.json({ok:true});}
 if(path==='/connectors')return Response.json({apple:{connected,busy:false,apps},google:null});
 if(path.startsWith('/connectors/apple/')){
  const {app:target}=await request.json(),row=apps.find(a=>a.app===target);assert.ok(row);
  const action=path.split('/').at(-1);assert.ok(['permission','verify'].includes(action));
  if(action==='verify'&&!connected)return Response.json({error:'Runtime disconnected'},{status:409});
  if(action==='verify')row.verifiedAt=Date.now();else row.permission='granted';
  calls.push({action,app:target});console.log(JSON.stringify({syntheticAction:calls.at(-1)}));return Response.json({ok:true});
 }
 return app.fetch(request);
};
const server=serve({hostname:'127.0.0.1',port:0,fetch}),detach=attachStream(server,ledger,auth);
if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
const url='http://127.0.0.1:'+server.address().port;
assert.equal((await (await globalThis.fetch(url+'/connectors')).json()).apple.apps.length,7);
assert.equal(calls.length,0);
console.log(JSON.stringify({url,code:auth.createPairingCode('owner','full').code}));
process.stdin.setEncoding('utf8');process.stdin.on('data',line=>{
 if(line.trim()==='connected'){connected=true;entry.state='ready';entry.reason='Connected to the local Apple apps runtime.';ledger.append('_system','daemon','config',{action:'apple_preview_changed'});console.log('Synthetic runtime connected');}
 if(line.trim()==='calls')console.log(JSON.stringify(calls));
 if(line.trim()==='check'){assert.equal(calls.filter(call=>call.action==='composio-start').length,1);assert.equal(calls.filter(call=>call.action==='composio-disconnect').length,1);console.log('PASS: one synthetic reconnect request and one confirmed disconnect');}
});
async function stop(){detach();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});process.exit(0);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
