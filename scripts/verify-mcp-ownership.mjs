// Actual MCP manager, local stdio/HTTP handshakes, owned process liveness. No model or business calls.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,mkdirSync,watch} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json'),load=n=>import(root+'apps/daemon/dist/'+n+'.js');
const {createMcpManager,defaultConnector}=await load('mcp'),{serve}=require('@hono/node-server');
const dir=mkdtempSync(join(tmpdir(),'openag-mcp-ownership-'));console.log('MCP ownership evidence: '+dir);
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const waitForFile=path=>new Promise((resolve,reject)=>{const listener=watch(join(path,'..'),()=>{if(existsSync(path)){clearTimeout(timer);listener.close();resolve();}}),timer=setTimeout(()=>{listener.close();reject(Error('Child ready deadline'));},5000);if(existsSync(path)){clearTimeout(timer);listener.close();resolve();}});
const within=async(p,ms)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('MCP ownership deadline')),ms);})]);}finally{clearTimeout(timer);}};
const child=join(dir,'server.cjs');
writeFileSync(child,`const fs=require('node:fs'),readline=require('node:readline');process.on('SIGTERM',()=>{});setInterval(()=>{},1000);fs.writeFileSync(process.argv[2],String(process.pid));const lines=readline.createInterface({input:process.stdin});lines.on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;const respond=()=>{const result=q.method==='initialize'?{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'ownership',version:'1'}}:q.method==='tools/list'?{tools:[{name:'read',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}:{};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');};if(q.method==='initialize')setTimeout(respond,Number(process.argv[3]));else respond();});`);
const evidence=[];
for(const test of ['close-pending','reload-pending','timeout','late-connection','late-close-failed','close-failed','reload']){
 const path=join(dir,test);mkdirSync(path);const pidFile=join(path,'pid'),wait=['timeout','close-pending','reload-pending'].includes(test)?20000:test.startsWith('late-')?16000:0;
 writeFileSync(join(path,'mcp.json'),JSON.stringify({servers:[{id:'probe',transport:'stdio',command:process.execPath,args:[child,pidFile,String(wait)],toolClasses:{read:'read'}}]}),{mode:0o600});
 let closed=0,starts=0;
 const connector=async(cfg,signal)=>{
  starts++;
  const conn=await defaultConnector(cfg,test.startsWith('late-')?undefined:signal);
  return {client:conn.client,close:async()=>{closed++;await conn.close();if(test.endsWith('failed'))throw Error('Controlled handle cleanup failure');}};
 };
 const manager=createMcpManager({dataDir:path,connector,env:{}});
 try{
  const ready=waitForFile(pidFile),loading=manager.load();await ready;const firstPid=Number(readFileSync(pidFile,'utf8'));
  if(test==='close-pending'){await within(Promise.all([loading,manager.close()]),6000);assert.equal(alive(firstPid),false);}
  else if(test==='reload-pending'){const config=JSON.parse(readFileSync(join(path,'mcp.json'),'utf8'));config.servers[0].args[2]='0';writeFileSync(join(path,'mcp.json'),JSON.stringify(config),{mode:0o600});await within(Promise.all([loading,manager.reload()]),6000);assert.equal(alive(firstPid),false);assert.equal(manager.status()[0].state,'connected');const nextPid=Number(readFileSync(pidFile,'utf8'));assert.notEqual(nextPid,firstPid);await manager.close();assert.equal(alive(nextPid),false);}
  else if(test==='timeout'||test.startsWith('late-')){await within(loading,18000);assert.equal(manager.status()[0].state,'down');assert.equal(manager.toolDefs().length,0);if(test==='late-close-failed')await assert.rejects(within(manager.close(),6000),/MCP cleanup unconfirmed/);else await within(manager.close(),6000);assert.equal(alive(firstPid),false);if(test.startsWith('late-'))assert.equal(closed,1);}
  else if(test==='close-failed'){await loading;await assert.rejects(within(manager.close(),6000),/MCP cleanup unconfirmed/);assert.equal(alive(firstPid),false);assert.equal(closed,1);}
  else{await loading;assert.equal(manager.status()[0].state,'connected');await manager.reload();assert.equal(alive(firstPid),false);assert.equal(manager.status()[0].state,'connected');const secondPid=Number(readFileSync(pidFile,'utf8'));assert.notEqual(secondPid,firstPid);await within(manager.close(),6000);assert.equal(alive(secondPid),false);}
  evidence.push({test,starts,closed,childStopped:true,...(test.endsWith('failed')?{cleanupFailureReported:true}:{})});console.log('PASS MCP '+test);
 }finally{await within(manager.close(),8000).catch(error=>{if(!test.endsWith('failed'))throw error;});}
}
// Independent process grace periods must overlap rather than consume the daemon's overall ceiling in series.
{
 const path=join(dir,'multi-close');mkdirSync(path);const files=['first','second'].map(name=>join(path,name));
 writeFileSync(join(path,'mcp.json'),JSON.stringify({servers:files.map((file,i)=>({id:'probe'+i,transport:'stdio',command:process.execPath,args:[child,file,'0']}))}),{mode:0o600});
 const manager=createMcpManager({dataDir:path,env:{}});
 try{await manager.load();assert.equal(manager.status().filter(s=>s.state==='connected').length,2);const start=performance.now();await within(manager.close(),3500);for(const file of files)assert.equal(alive(Number(readFileSync(file,'utf8'))),false);evidence.push({test:'multi-close',childrenStopped:2,elapsedMs:Math.round(performance.now()-start)});console.log('PASS MCP concurrent owned closures');}
 finally{await manager.close();}
}
// A real HTTP initializer blocked before headers must also be cancelled, not left waiting for SDK timeout.
let initialized;const began=new Promise(resolve=>{initialized=resolve;});
const http=serve({hostname:'127.0.0.1',port:0,fetch:async req=>{await req.json();initialized();return new Promise(resolve=>{req.signal.addEventListener('abort',()=>resolve(new Response(null,{status:499})),{once:true});});}});
if(!http.listening)await new Promise(resolve=>http.once('listening',resolve));
const path=join(dir,'http');mkdirSync(path);writeFileSync(join(path,'mcp.json'),JSON.stringify({servers:[{id:'probe',transport:'http',allowPrivateNetwork:true,url:'http://127.0.0.1:'+http.address().port+'/mcp'}]}),{mode:0o600});
const manager=createMcpManager({dataDir:path,env:{}});
try{const loading=manager.load();await within(began,5000);await within(Promise.all([loading,manager.close()]),5000);assert.equal(manager.toolDefs().length,0);evidence.push({test:'http-close-pending',closed:true});console.log('PASS MCP HTTP pending cancellation');}
finally{await manager.close();http.closeAllConnections();await new Promise(resolve=>http.close(resolve));}
writeFileSync(join(dir,'acceptance.json'),JSON.stringify(evidence,null,2));console.log('PASS MCP ownership: '+join(dir,'acceptance.json'));
