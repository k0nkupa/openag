import {afterEach,expect,test} from 'vitest';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createMcpClient,invokeMcp} from './client.js';
import type {InteractionBroker,InteractionScope} from './interactions.js';
const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of closers.splice(0).reverse())await close();});
const form={mode:'form' as const,message:'Allow?',requestedSchema:{type:'object' as const,properties:{allow:{type:'boolean' as const}},required:['allow']}};
const scope=():InteractionScope=>({serverId:'fixture',toolName:'QUERY',context:{botId:'bot',dataDir:'/unused',turnId:'turn',roomId:'main',toolCallId:'call'},valid:()=>true});
async function pair(handler:Parameters<Server['setRequestHandler']>[1]){
 const server=new Server({name:'synthetic',version:'1'},{capabilities:{tools:{}}}),client=createMcpClient();server.setRequestHandler(CallToolRequestSchema,handler);
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);closers.push(()=>server.close(),()=>client.close());return {server,client};
}
test('overlapping human reviews pause the active timeout until both settle',async()=>{
 let server:Server,count=0;
 const connected=await pair(async()=>{const answers=await Promise.all([server.elicitInput(form),server.elicitInput(form)]);return {content:[{type:'text',text:JSON.stringify(answers)}]};});server=connected.server;
 const broker:InteractionBroker={async request(){const number=++count;await new Promise(resolve=>setTimeout(resolve,number===1?30:70));return {action:'accept',content:{allow:true}};}};
 const result=await invokeMcp(connected.client,scope(),broker,{},20);expect(count).toBe(2);expect(result.content[0]).toMatchObject({type:'text'});expect(JSON.stringify(result)).toContain('accept');
});
test('normal tool return closes an outstanding callback before another invocation',async()=>{
 let server:Server,start!:()=>void,mode='early',cancelled=false;const started=new Promise<void>(r=>{start=r;});
 const connected=await pair(async()=>{if(mode==='early'){void server.elicitInput(form).catch(()=>{});await started;}else await new Promise(r=>setTimeout(r,45));return {content:[{type:'text',text:'returned'}]};});server=connected.server;
 const broker:InteractionBroker={request:async(_scope,_params,signal)=>{start();return new Promise(resolve=>{const cancel=()=>{cancelled=true;resolve({action:'cancel'});};signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});}};
 await invokeMcp(connected.client,scope(),broker,{},20);expect(cancelled).toBe(true);mode='next';expect(await invokeMcp(connected.client,scope(),broker,{},100)).toMatchObject({content:[{text:'returned'}]});
});
test('unsolicited callbacks never reach user review',async()=>{
 const connected=await pair(async()=>({content:[]}));expect(await connected.server.elicitInput(form)).toEqual({action:'cancel'});
});
test('a queued cancellation cannot start a second remote call',async()=>{
 let calls=0;const connected=await pair(async()=>{calls++;await new Promise(r=>setTimeout(r,20));return {content:[]};});
 const first=invokeMcp(connected.client,scope(),undefined,{},100),abort=new AbortController(),next=invokeMcp(connected.client,{...scope(),context:{...scope().context,signal:abort.signal}},undefined,{},100);
 const cancelled=expect(next).rejects.toMatchObject({outcome:'not-run'});abort.abort();await cancelled;await first;expect(calls).toBe(1);
});

test('MCP header timeout does not abort an already-open human-review stream',async()=>{
 const {boundedMcpFetch}=await import('./client.js');const {vi}=await import('vitest');vi.useFakeTimers();let received:AbortSignal|undefined;
 try{const fetcher=(async(_url:unknown,init?:RequestInit)=>{received=init?.signal??undefined;return new Response('event: pending\n\n');}) as typeof fetch;
 const response=await boundedMcpFetch('https://fixture.example/mcp',{},fetcher);await vi.advanceTimersByTimeAsync(16_000);expect(received?.aborted).toBe(false);await response.body?.cancel();}finally{vi.useRealTimers();}
});
test('MCP stream size is bounded before parsing',async()=>{const {boundedMcpFetch}=await import('./client.js');const response=await boundedMcpFetch('https://fixture.example/mcp',{},(async()=>new Response(new Uint8Array(2*1024*1024+1))) as typeof fetch);await expect(response.arrayBuffer()).rejects.toThrow('MCP response too large');});

test('URL-required errors request user consent without repeating the tool',async()=>{
 const {UrlElicitationRequiredError}=await import('@modelcontextprotocol/sdk/types.js');let calls=0,responses=0;
 const connected=await pair(async()=>{calls++;throw new UrlElicitationRequiredError([{mode:'url',message:'Review provider',url:'https://provider.example/review',elicitationId:'one'}]);});
 const broker:InteractionBroker={async request(_scope,params){expect(params.mode).toBe('url');responses++;return {action:'accept'};}};
 const result=await invokeMcp(connected.client,scope(),broker,{},1000);expect(result.isError).toBe(true);expect(calls).toBe(1);expect(responses).toBe(1);expect(JSON.stringify(result)).not.toContain('https://provider.example');
});
