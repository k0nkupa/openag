// Replay a retained chat receipt through the real gateway and model guard; no provider calls.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {startFixture} from './bot-models-fixture.mjs';
import {createApprovals} from '../apps/daemon/dist/approvals.js';
import {createRoom,addMember} from '../apps/daemon/dist/rooms.js';

const dir=mkdtempSync(join(tmpdir(),'openag-bot-models-')),token=randomBytes(32).toString('hex');
const f=await startFixture(dir,token),approvals=createApprovals(f.db,f.ledger);
const request=(path,method='GET',body,auth=token)=>fetch(f.url+path,{method,headers:{authorization:'Bearer '+auth,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
async function json(path){const response=await request(path);assert.equal(response.status,200);return response.json();}
function returnedReceipt(roomId='main'){
 const {approvalId}=approvals.request({roomId,botId:'boss',toolName:'mcp.composio-connect.COMPOSIO_MULTI_EXECUTE_TOOL',toolClass:'act-external',payload:{tools:[{tool_slug:'OUTLOOK_QUERY_EMAILS',arguments:{top:3}}]}});
 const approval=approvals.get(approvalId);
 approvals.resolve(approvalId,{kind:'accept'},approval.reviewVersion);
 approvals.receipts.start(approvalId,null,'controlled-query');
 approvals.receipts.finish(approvalId,{outcome:'unknown',detail:'The remote invocation returned; this does not establish an external effect.',result:{untrusted:true,content:[{type:'text',text:'Synthetic mailbox sample returned'}]}});
 return approval;
}

try{
 assert.equal((await request('/bots/boss/model/discover','POST',{target:'openai'})).status,200);
 const approval=returnedReceipt(),receipt=approvals.receipts.get(approval.id);
 assert.equal(receipt.workId,null);
 assert.equal((await json('/work')).work.length,0);
 assert.equal((await request('/bots/boss/model/discover','POST',{target:'openai'})).status,200,'Cached metadata discovery remains passive');
 await f.runner.withIdleBot('boss',async()=>{});
 assert.equal((await json('/approvals')).approvals.length,0);
 assert.equal((await request('/attention/summary')).status,404);
 const removed=await request('/approvals/'+approval.id+'/inspection','POST',{reviewVersion:approval.reviewVersion,note:'No inspection workflow',reference:'fixture'});
 assert.equal(removed.status,404,'The inspection mutation is removed');
 assert.equal(approvals.receipts.get(approval.id).outcome,'unknown','History preserves uncertainty');
 assert.equal(approvals.receipts.get(approval.id).evidence.result.content[0].text,'Synthetic mailbox sample returned');
 assert.equal((await json('/work')).work.length,0,'Recovery must not invent Work');
 createRoom(f.db,{id:'_receipt-hidden',leadBotId:'boss'});addMember(f.db,'_receipt-hidden','boss');
 returnedReceipt('_receipt-hidden');
 console.log('PASS: Unknown chat history creates no recovery item or model lock; inspection API removed.');
}finally{await f.close();rmSync(dir,{recursive:true,force:true});}
