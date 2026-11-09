// Standalone SSRF guard acceptance for user-supplied MCP URLs. No provider calls and no external network.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {lookup as dnsLookup} from 'node:dns';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'apps/daemon/package.json');
const load=name=>import(root+'apps/daemon/dist/'+name+'.js');
const {serve}=require('@hono/node-server');
const {fetch:undiciFetch,Agent:UndiciAgent}=require('undici');
const {Server}=await import(require.resolve('@modelcontextprotocol/sdk/server/index.js'));
const {Client}=await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const {StreamableHTTPClientTransport}=await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const {ListToolsRequestSchema,CallToolRequestSchema}=await import(require.resolve('@modelcontextprotocol/sdk/types.js'));
const {WebStandardStreamableHTTPServerTransport}=await import(require.resolve('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'));
const {isBlockedAddress,classifyAddress,checkUrl,createGuardedFetch,closeSsrfAgents,SsrfBlockedError,guardedLookup,ssrfReason}=await load('mcp/ssrf-fetch');
const {openDb}=await load('db/index'),{createMcpManager}=await load('mcp');
const parent=mkdtempSync(join(tmpdir(),'openag-ssrf-'));
let groups=0;const group=name=>{groups++;console.log('PASS '+name);};

// Fixtures: a loopback MCP server with redirect routes, and a second origin that must never be reached through a redirect.
let otherHits=0;
const other=serve({hostname:'127.0.0.1',port:0,fetch:async()=>{otherHits++;return new Response('other');}});
if(!other.listening)await new Promise(resolve=>other.once('listening',resolve));
const otherPort=other.address().port;
const mcp=serve({hostname:'127.0.0.1',port:0,fetch:async req=>{
 const url=new URL(req.url);
 if(url.pathname==='/redirect')return new Response('',{status:302,headers:{location:'http://169.254.169.254/latest/meta-data'}});
 if(url.pathname==='/redirect-cross')return new Response('',{status:307,headers:{location:`http://127.0.0.1:${otherPort}/hit`}});
 if(url.pathname==='/redirect-same')return new Response('',{status:307,headers:{location:'/mcp'}});
 if(url.pathname==='/plain')return new Response('ok');
 if(req.method!=='POST')return new Response('',{status:405});
 const server=new Server({name:'ssrf-fixture',version:'1'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'PING',description:'fixture',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}}]}));
 server.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:'text',text:'pong'}]}));
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 await server.connect(transport);return transport.handleRequest(req);
}});
if(!mcp.listening)await new Promise(resolve=>mcp.once('listening',resolve));
const port=mcp.address().port;

try{
 // 1. Address classification: reserved ranges, IPv6 wrappers of IPv4 (mapped, compatible, SIIT, NAT64, 6to4), fail closed on junk.
 const blockedAlways=['0.0.0.0','10.1.2.3','100.64.0.1','100.127.255.254','127.0.0.1','127.255.255.254','169.254.169.254','172.16.0.1','172.31.255.255','192.0.0.1','192.88.99.1','192.168.1.1','198.18.0.1','198.19.255.255','224.0.0.1','240.0.0.1','255.255.255.255','::','::1','fc00::1','fd12:3456::1','fec0::1','fe80::1','ff02::1','100::1','2001:db8::1','2001:0:4136:e378:8000:63bf:3fff:fdd2','::ffff:127.0.0.1','::ffff:7f00:1','::ffff:10.0.0.1','::ffff:a9fe:a9fe','::ffff:0:7f00:1','::ffff:0:a9fe:a9fe','::127.0.0.1','64:ff9b::7f00:1','64:ff9b::a9fe:a9fe','64:ff9b:1::1','2002:7f00:1::','2002:a9fe:a9fe::','fe80::1%eth0','not-an-ip',''];
 for(const ip of blockedAlways)assert.equal(isBlockedAddress(ip),true,`blocked ${ip}`);
 for(const ip of ['8.8.8.8','93.184.216.34','1.1.1.1','172.15.255.255','172.32.0.1','100.63.255.255','100.128.0.1','2606:4700:4700::1111','2a00:1450:4001::1','::ffff:8.8.8.8','::ffff:0:808:808','64:ff9b::808:808','2002:808:808::'])assert.equal(isBlockedAddress(ip),false,`public ${ip}`);
 // Owner opt-in: loopback, LAN and CGNAT/Tailscale open up; link-local, metadata, unspecified, multicast and reserved never do.
 for(const ip of ['127.0.0.1','10.0.0.1','172.16.5.5','192.168.1.1','100.64.0.1','100.100.100.100','::1','fd12:3456::1','fec0::1','::ffff:127.0.0.1','::ffff:0:7f00:1','64:ff9b::7f00:1','2002:7f00:1::'])assert.equal(isBlockedAddress(ip,true),false,`opt-in allows ${ip}`);
 for(const ip of ['169.254.169.254','169.254.0.1','100.100.100.200','192.0.0.192','192.0.0.1','192.0.2.1','192.88.99.1','198.18.0.1','198.51.100.7','203.0.113.9','0.0.0.0','224.0.0.1','240.0.0.1','fe80::1','fd00:ec2::254','ff02::1','100::1','2001:db8::1','2001:0:4136:e378:8000:63bf:3fff:fdd2','64:ff9b:1::a9fe:a9fe','::','::ffff:169.254.169.254','::ffff:100.100.100.200','::ffff:0:a9fe:a9fe','64:ff9b::a9fe:a9fe','2002:a9fe:a9fe::','not-an-ip'])assert.equal(isBlockedAddress(ip,true),true,`opt-in still refuses ${ip}`);
 assert.equal(classifyAddress('8.8.8.8'),'public');assert.equal(classifyAddress('10.0.0.1'),'private');assert.equal(classifyAddress('169.254.169.254'),'never');
 group('address classification');

 // 2. URL policy: https only, private literals in every encoding refused, plain http and private only with the owner flag.
 assert.equal(checkUrl('https://example.com/mcp'),null);
 assert.equal(checkUrl('https://93.184.216.34/mcp'),null);
 assert.equal(checkUrl('http://example.com/mcp'),'https required');
 assert.equal(checkUrl('ftp://example.com/mcp'),'https required');
 assert.equal(checkUrl('not a url'),'invalid url');
 assert.equal(checkUrl('https://user:pw@example.com/mcp'),'credentials in url not allowed');
 for(const url of ['https://127.0.0.1/','https://2130706433/','https://0x7f.1/','https://0x7f000001/','https://017700000001/','https://127.1/','https://[::1]/','https://[::ffff:7f00:1]/','https://[::ffff:127.0.0.1]/','https://[::ffff:0:7f00:1]/','https://[fe80::1]/','https://169.254.169.254/latest/meta-data','https://10.0.0.1/','https://192.168.0.1/','https://100.100.100.100/'])assert.equal(checkUrl(url),'blocked private address',url);
 assert.equal(checkUrl('http://127.0.0.1:8080/mcp',{allowPrivateNetwork:true}),null);
 assert.equal(checkUrl('https://192.168.1.5/mcp',{allowPrivateNetwork:true}),null);
 assert.equal(checkUrl('http://169.254.169.254/latest/meta-data',{allowPrivateNetwork:true}),'blocked private address','opt-in never reaches metadata');
 assert.equal(checkUrl('https://2852039166/',{allowPrivateNetwork:true}),'blocked private address','integer-encoded metadata address stays refused under opt-in');
 assert.equal(checkUrl('http://127.0.0.1/',{allowPrivateNetwork:false}),'https required');
 assert.equal(checkUrl('https://user:pw@127.0.0.1/',{allowPrivateNetwork:true}),'credentials in url not allowed','opt-in never allows credentials');
 group('URL policy and literal encodings');

 // 3. Connect-time resolver: every answer is checked on every call, only checked addresses are returned, always asked for all answers.
 const script=(...answers)=>{const asked=[];return {asked,resolve:(host,options,cb)=>{asked.push({host,...options});cb(null,answers[Math.min(asked.length-1,answers.length-1)]);}};};
 const run=(lookup,options)=>new Promise(resolve=>lookup('fixture.test',options,(...args)=>resolve(args)));
 let fake=script([{address:'8.8.8.8',family:4}]);
 let [err,address,family]=await run(guardedLookup(false,fake.resolve),{});
 assert.equal(err,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);
 assert.equal(fake.asked.length,1);assert.equal(fake.asked[0].all,true,'resolver is always asked for every answer');
 [err,address]=await run(guardedLookup(false,fake.resolve),{all:true});assert.equal(err,null);assert.deepEqual(address,[{address:'8.8.8.8',family:4}],'all:true gets the checked list (autoSelectFamily)');assert.equal(fake.asked.at(-1).all,true);
 [err]=await run(guardedLookup(false,fake.resolve),{family:'IPv6'});assert.equal(fake.asked.at(-1).family,6,'string family option is normalised');
 // Rebinding: the same name answers public, then private. Each lookup is judged on its own answer; nothing is cached or trusted.
 const rebind=script([{address:'8.8.8.8',family:4}],[{address:'127.0.0.1',family:4}]);const rebinding=guardedLookup(false,rebind.resolve);
 [err]=await run(rebinding,{});assert.equal(err,null,'first answer is public');
 [err]=await run(rebinding,{});assert.ok(err instanceof SsrfBlockedError,'second answer is private and refused');assert.equal(rebind.asked.length,2,'every connection resolves again; no verdict is reused');
 fake=script([{address:'127.0.0.1',family:4}]);
 [err]=await run(guardedLookup(false,fake.resolve),{});assert.ok(err instanceof SsrfBlockedError);assert.equal(err.message,'blocked private address');
 fake=script([{address:'8.8.8.8',family:4},{address:'169.254.169.254',family:4}]);
 [err]=await run(guardedLookup(false,fake.resolve),{all:true});assert.ok(err instanceof SsrfBlockedError,'one private answer among public ones refuses the connection');
 fake=script([{address:'::ffff:7f00:1',family:6}]);
 [err]=await run(guardedLookup(false,fake.resolve),{});assert.ok(err instanceof SsrfBlockedError,'mapped IPv6 answer refused');
 fake=script([]);[err]=await run(guardedLookup(false,fake.resolve),{});assert.ok(err instanceof SsrfBlockedError,'empty answer refused');
 fake=script([{address:'127.0.0.1',family:4}]);
 [err,address]=await run(guardedLookup(true,fake.resolve),{});assert.equal(err,null,'owner opt-in allows a private answer');assert.equal(address,'127.0.0.1');
 fake=script([{address:'169.254.169.254',family:4}]);
 [err]=await run(guardedLookup(true,fake.resolve),{});assert.ok(err instanceof SsrfBlockedError,'opt-in never allows a metadata answer');
 [err]=await new Promise(resolve=>guardedLookup(false,(host,options,cb)=>cb(Object.assign(Error('x'),{code:'ENOTFOUND'}),[]))('x.test',{},(...a)=>resolve(a)));assert.equal(err.code,'ENOTFOUND','resolver errors pass through');
 group('connect-time resolution and rebinding');

 // 4. Real undici path: fake-DNS hostnames, redirects and the loopback fixture.
 const rebinder=createGuardedFetch({lookup:(host,options,cb)=>cb(null,[{address:'127.0.0.1',family:4}])});
 await assert.rejects(()=>rebinder(`https://rebind.test:${port}/plain`),error=>error instanceof SsrfBlockedError&&error.message==='blocked private address','public-looking name resolving private is refused at connect');
 const opened=createGuardedFetch({allowPrivateNetwork:true});
 let response=await opened(`http://127.0.0.1:${port}/plain`);assert.equal(await response.text(),'ok','loopback reachable only with the owner flag');
 await assert.rejects(()=>createGuardedFetch({allowPrivateNetwork:false})(`http://127.0.0.1:${port}/plain`),error=>error instanceof SsrfBlockedError&&error.message==='https required');
 await assert.rejects(()=>createGuardedFetch({allowPrivateNetwork:false})(`https://127.0.0.1:${port}/plain`),error=>error instanceof SsrfBlockedError&&error.message==='blocked private address');
 await assert.rejects(()=>opened(new Request(`http://127.0.0.1:${port}/plain`)),TypeError,'only a URL or string is accepted');
 response=await opened(`http://127.0.0.1:${port}/redirect`,{redirect:'follow'});
 assert.equal(response.status,302,'guard never follows redirects, even when the caller asks');
 assert.equal(response.headers.get('location'),'http://169.254.169.254/latest/meta-data');
 await assert.rejects(()=>opened(response.headers.get('location')),error=>error instanceof SsrfBlockedError&&error.message==='blocked private address','a redirect hop to metadata is refused when it re-enters the guard, even with the owner flag');
 const seen=[];const spy=createGuardedFetch({allowPrivateNetwork:true,fetchImpl:(url,init)=>{seen.push(init.redirect);return undiciFetch(url,init);}});
 await spy(`http://127.0.0.1:${port}/plain`,{redirect:'follow'});await spy(`http://127.0.0.1:${port}/plain`);assert.deepEqual(seen,['manual','manual'],'redirect is forced to manual whatever the caller passes');
 // undici itself decides how it calls connect.lookup. Record the options undici passes (not the ones guardedLookup passes on),
 // then let the guarded lookup answer: localhost must connect, and undici must have asked for every address (autoSelectFamily).
 const undiciCalls=[];
 const recording=new UndiciAgent({connect:{lookup:(host,options,callback)=>{undiciCalls.push({host,all:options.all,family:options.family});return guardedLookup(true,dnsLookup)(host,options,callback);}}});
 response=await undiciFetch(`http://localhost:${port}/plain`,{dispatcher:recording,redirect:'manual'});
 assert.equal(await response.text(),'ok','real node:dns lookup with autoSelectFamily connects through the guarded lookup');
 assert.ok(undiciCalls.length>=1&&undiciCalls.every(call=>call.host==='localhost'),'undici resolves hostnames through connect.lookup');
 assert.ok(undiciCalls.some(call=>call.all===true),'undici asks connect.lookup for every address (options.all), which the guard answers with the checked list');
 await recording.close();
 // The production factory resolves through the same guarded lookup: a counting resolver is hit for a hostname request.
 const asked=[];
 const viaLocalhost=createGuardedFetch({allowPrivateNetwork:true,lookup:(host,options,cb)=>{asked.push(host);dnsLookup(host,options,cb);}});
 assert.equal(await (await viaLocalhost(`http://localhost:${port}/plain`)).text(),'ok');assert.ok(asked.includes('localhost'),'createGuardedFetch routes hostname resolution through the guarded lookup');
 // A test resolver's pool is recreated after closeSsrfAgents, like the shared pools.
 await closeSsrfAgents();
 assert.equal(await (await viaLocalhost(`http://localhost:${port}/plain`)).text(),'ok','guarded fetch with its own resolver survives closeSsrfAgents');
 // fetchImpl can observe a request but cannot drop the pinned dispatcher.
 let dispatcherSeen;const observing=createGuardedFetch({allowPrivateNetwork:true,fetchImpl:(url,init)=>{dispatcherSeen=init.dispatcher;return undiciFetch(url,init);}});
 await observing(`http://127.0.0.1:${port}/plain`);assert.ok(dispatcherSeen,'a fetchImpl always receives the guarded dispatcher');
 group('undici guard, redirects and rebinding');

 // 5. SDK transport behaviour pinned: same-origin redirect hops re-enter the guard, cross-origin redirects are never followed.
 const hops=[];const guarded=createGuardedFetch({allowPrivateNetwork:true,fetchImpl:(url,init)=>{hops.push(new URL(String(url)).pathname);return undiciFetch(url,init);}});
 const connectVia=async path=>{const client=new Client({name:'ssrf-verify',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${path}`),{fetch:guarded}));return client;};
 const same=await connectVia('/redirect-same');
 assert.ok(hops.includes('/redirect-same')&&hops.includes('/mcp'),'a same-origin redirect hop re-enters the guard');
 assert.equal((await same.listTools()).tools.length,1);await same.close();
 hops.length=0;
 await assert.rejects(()=>connectVia('/redirect-cross'));
 assert.equal(otherHits,0,'a cross-origin redirect is never followed, so the other origin is never reached');
 assert.deepEqual([...new Set(hops)],['/redirect-cross'],'the guard only ever saw the original request');
 for(const file of ['apps/daemon/src/mcp.ts','apps/daemon/src/mcp/client.ts','apps/daemon/src/mcp/ssrf-fetch.ts','apps/daemon/src/composio-connect.ts'])assert.doesNotMatch(readFileSync(root+file,'utf8'),/redirectPolicy|redirect:\s*["']follow["']/,`${file} never configures redirect following`);
 group('SDK redirect behaviour pinned (same-origin re-enters guard, cross-origin refused, follow never configured)');

 // 6. Manager integration: static refusal, fixed status reasons that never echo the target, and a flagged loopback server that connects.
 const manage=async(entry)=>{
  const dir=mkdtempSync(join(parent,'m-'));openDb(dir).close();
  writeFileSync(join(dir,'mcp.json'),JSON.stringify({servers:[{id:'remote',transport:'http',timeoutMs:3000,...entry}]}),{mode:0o600});
  const manager=createMcpManager({dataDir:dir});
  try{await manager.load();return manager.status().find(server=>server.id==='remote');}finally{await manager.close();}
 };
 let status=await manage({url:`http://127.0.0.1:${port}/mcp`});
 assert.equal(status.state,'invalid');assert.match(status.detail,/http requires allowPrivateNetwork/,'plain http without the flag is invalid');
 status=await manage({url:'https://10.77.88.99:4443/mcp'});
 assert.equal(status.state,'down');assert.equal(status.detail,'blocked private address','private https target reports the fixed reason');
 assert.doesNotMatch(JSON.stringify(status),/10\.77\.88\.99|4443/,'status never echoes the target');
 status=await manage({url:'http://169.254.169.254/mcp',allowPrivateNetwork:true});
 assert.equal(status.state,'down');assert.equal(status.detail,'blocked private address','the owner flag does not reach metadata');
 status=await manage({url:`http://127.0.0.1:${port}/mcp`,allowPrivateNetwork:true});
 assert.equal(status.state,'connected',`flagged loopback server connects: ${status.detail}`);assert.equal(status.tools?.length,1);
 assert.equal(ssrfReason(new Error('x',{cause:new SsrfBlockedError('blocked private address')})),'blocked private address','reason survives SDK wrapping');
 // After the shared pool is closed (manager close), a guarded fetch built earlier still works: pools are recreated per request.
 response=await opened(`http://127.0.0.1:${port}/plain`);assert.equal(await response.text(),'ok','guarded fetch survives closeSsrfAgents');
 group('manager integration and pool lifecycle');
}finally{
 await closeSsrfAgents();for(const server of [mcp,other]){server.closeAllConnections?.();server.close();}rmSync(parent,{recursive:true,force:true});
}
console.log(`SSRF guard verification passed (${groups} groups).`);
