import {afterEach,beforeEach,expect,test} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDb,type Db} from '../db/index.js';
import {createLedger,type Ledger} from '../ledger.js';
import {createBot,createRoom,addMember} from '../rooms.js';
import {createAuth} from '../auth.js';
import {createApprovals} from '../approvals.js';
import {createGateway} from '../gateway.js';
import {createMcpInteractions,type McpInteractions,type InteractionScope} from './interactions.js';
let dir:string,db:Db,ledger:Ledger,broker:McpInteractions,scope:InteractionScope,controller:AbortController;
const form={mode:'form' as const,message:'Allow this synthetic request?',requestedSchema:{type:'object' as const,properties:{allow:{type:'boolean' as const}},required:['allow']}};
beforeEach(()=>{
 dir=mkdtempSync(join(tmpdir(),'mcp-input-'));db=openDb(dir);ledger=createLedger(db);createBot(db,{id:'bot',runtime:'acp'});createRoom(db,{id:'main',leadBotId:'bot'});addMember(db,'main','bot');
 db.prepare("INSERT INTO turns(id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES('turn','main','bot','running','{}',1,1)").run();
 broker=createMcpInteractions(db,ledger);controller=new AbortController();scope={serverId:'fixture',toolName:'QUERY',context:{dataDir:dir,botId:'bot',roomId:'main',turnId:'turn',toolCallId:'call',signal:controller.signal},valid:()=>true};
});
afterEach(()=>{broker.close();db.close();rmSync(dir,{recursive:true,force:true});});
function opened(){const event=ledger.list('main').find(e=>e.type==='mcp_interaction_updated'&&(e.payload as {status:string}).status==='open')!;return broker.get((event.payload as {interactionId:string}).interactionId)!;}
test('a provider response is bound, validated and recorded once without pausing the parent or creating an action',async()=>{
 const response=broker.request(scope,form,controller.signal),r=opened();
 expect(broker.get(r.id)?.status).toBe('open');expect(broker.hasOpen('turn')).toBe(true);
 expect(()=>broker.respond(r.id,'stale','accept',{allow:true})).toThrow();expect(()=>broker.respond(r.id,r.revision,'accept',{allow:'yes'})).toThrow();
 expect(broker.get(r.id)?.status).toBe('open');broker.respond(r.id,r.revision,'accept',{allow:true});expect(await response).toEqual({action:'accept',content:{allow:true}});
 expect(()=>broker.respond(r.id,r.revision,'accept',{allow:true})).toThrow();expect(broker.get(r.id)?.response).toEqual({action:'accept',content:{allow:true}});
 expect(db.prepare('SELECT status FROM turns').get()).toEqual({status:'running'});expect(db.prepare('SELECT count(*) n FROM approvals').get()).toEqual({n:0});expect(db.prepare('SELECT count(*) n FROM work_questions').get()).toEqual({n:0});
 expect(broker.get(r.id)?.status).toBe('accepted');
});
test.each(['decline','cancel'] as const)('explicit %s never supplies approval content',async action=>{const pending=broker.request(scope,form,controller.signal),r=opened();broker.respond(r.id,r.revision,action,{allow:true});expect(await pending).toEqual({action});});
test('parent cancellation and expiry settle the existing request without a continuation',async()=>{
 const pending=broker.request(scope,form,controller.signal),r=opened();controller.abort();expect(await pending).toEqual({action:'cancel'});expect(broker.get(r.id)?.status).toBe('cancelled');expect(()=>broker.respond(r.id,r.revision,'accept',{allow:true})).toThrow();
 broker=createMcpInteractions(db,ledger,{waitMs:10});controller=new AbortController();const expired=broker.request(scope,form,controller.signal);expect(await expired).toEqual({action:'cancel'});expect(db.prepare("SELECT count(*) n FROM mcp_interactions WHERE status='expired'").get()).toEqual({n:1});
});
test('restart interrupts pending requests without saving or replaying provider URLs',async()=>{
 const secretUrl='https://provider.example/approve?private=synthetic-url-secret';const pending=broker.request(scope,{mode:'url',message:'Review at provider',url:secretUrl,elicitationId:'external-id'},controller.signal),r=opened();
 expect(r.url).toBe(secretUrl);expect(JSON.stringify(db.prepare('SELECT * FROM mcp_interactions').all())).not.toContain('synthetic-url-secret');expect(JSON.stringify(ledger.list('main'))).not.toContain('synthetic-url-secret');
 broker.close();expect(await pending).toEqual({action:'cancel'});broker=createMcpInteractions(db,ledger);broker.recover();expect(broker.get(r.id)?.status).toBe('interrupted');expect(broker.get(r.id)?.url).toBeUndefined();
});
test('URL consent responds once and grants no new tool permission',async()=>{const pending=broker.request(scope,{mode:'url',message:'Review at provider',url:'https://provider.example/review',elicitationId:'url-id'},controller.signal),r=opened();broker.respond(r.id,r.revision,'accept');expect(await pending).toEqual({action:'accept'});expect(db.prepare('SELECT count(*) n FROM permission_sessions').get()).toEqual({n:0});});
test('unsafe URLs, credential forms and unattended requests fail closed',async()=>{
 for(const url of ['javascript:alert(1)','http://provider.example','https://user:pass@provider.example'])expect(await broker.request(scope,{mode:'url',message:'Bad URL',url,elicitationId:'bad'},controller.signal)).toEqual({action:'cancel'});
 expect(await broker.request(scope,{...form,requestedSchema:{type:'object',properties:{value:{type:'string',title:'API key'}}}},controller.signal)).toEqual({action:'cancel'});
 db.prepare("UPDATE turns SET state_json='{\"unattended\":true}'").run();expect(await broker.request(scope,form,controller.signal)).toEqual({action:'cancel'});expect(broker.hasOpen('turn')).toBe(false);
});
test('stale and foreign invocation scopes cannot receive a user response',async()=>{
 expect(await broker.request({...scope,context:{...scope.context,botId:'other'}},form,controller.signal)).toEqual({action:'cancel'});
 let valid=true;const pending=broker.request({...scope,valid:()=>valid},form,controller.signal),r=opened();valid=false;expect(()=>broker.respond(r.id,r.revision,'accept',{allow:true})).toThrow();expect(await pending).toEqual({action:'cancel'});
});
test('interaction routes require current owner/Full authority including after device revocation',async()=>{
 const auth=createAuth({db,ownerToken:'fixture-owner'}),full=auth.createDevice('full','owner','full'),limited=auth.createDevice('limited');
 const app=createGateway({db,ledger,approvals:createApprovals(db,ledger),auth,dispatch:()=>{},mcpInteractions:broker});
 const pending=broker.request(scope,form,controller.signal),r=opened(),path='/mcp/interactions/'+r.id;
 expect((await app.request(path,{headers:{authorization:'Bearer '+limited.token}})).status).toBe(403);
 expect((await app.request(path,{headers:{authorization:'Bearer '+full.token}})).status).toBe(200);
 auth.revokeDevice(full.device.id);
 expect((await app.request(path+'/response',{method:'POST',headers:{authorization:'Bearer '+full.token,'content-type':'application/json'},body:JSON.stringify({revision:r.revision,action:'accept',content:{allow:true}})})).status).toBe(401);
 expect(broker.get(r.id)?.status).toBe('open');broker.close();await pending;
});

test('hidden provider defaults never become an implicit user answer',async()=>{const pending=broker.request(scope,{...form,requestedSchema:{...form.requestedSchema,properties:{allow:{type:'boolean',default:true}}}},controller.signal),r=opened();expect(()=>broker.respond(r.id,r.revision,'accept',{})).toThrow();expect(broker.get(r.id)?.status).toBe('open');broker.respond(r.id,r.revision,'decline');await pending;});
test('a stopped parent rejects a late response',async()=>{const pending=broker.request(scope,form,controller.signal),r=opened();db.prepare("UPDATE turns SET status='interrupted'").run();expect(()=>broker.respond(r.id,r.revision,'accept',{allow:true})).toThrow();expect(await pending).toEqual({action:'cancel'});});
