// Owned disposable built-desk preview; controlled adapter/model transports only.
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startFixture} from './bot-models-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),load=p=>import(root+'apps/daemon/dist/'+p+'.js');
const {createPermissions,permissionReference}=await load('permissions'),{createApprovals}=await load('approvals'),{ensureDirectChat}=await load('roomcreation'),{updateBot}=await load('rooms');
const directory=mkdtempSync(join(tmpdir(),'openag-bot-models-agent-requests-'));
const f=await startFixture(directory,'fixture-owner',0);
const permissions=createPermissions(f.db,f.ledger,directory,createApprovals(f.db,f.ledger));if(!permissions.active())permissions.adopt('read-only',permissions.adoption().reviewVersion,'owner');
updateBot(f.db,'coder',{name:'Researcher'});updateBot(f.db,'other',{name:'Writer'});
const room=ensureDirectChat(f.db,f.ledger,'boss');
const message=f.ledger.append(room.id,'user','message',{text:'Pending Writer consultation (controlled cancellation fixture).'});
f.runner.agentRequests.admit({agentId:'other',question:'Prepare a note',context:''},{room,message,botId:'boss',key:'preview-cancel',parents:[permissionReference(permissions.ensure('boss',room.id))]},'consultation');
writeFileSync('/tmp/openag-agent-requests-preview.json',JSON.stringify({url:f.url,roomId:room.id,directory}),{mode:0o600});
console.log('Preview: '+f.url+'/#/room/'+room.id);
process.once('SIGTERM',async()=>{await f.close();process.exit(0);});
