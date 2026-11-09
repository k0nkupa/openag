import { createHash } from 'node:crypto';
import type { Db } from '../db/index.js';
import { ActionFailure } from '../action-receipts.js';
import { workCreation, WorkError } from '../work.js';
import { canonical } from '../action-receipts.js';
import type { ToolDef } from './registry.js';

export function createWorkTool(db?:Db):ToolDef {
  return {
    name:'create_work',permission:()=>({approval:'review'}),offlineSafe:true,class:'act-local',input:workCreation,enabled:()=>!!db,
    description:'Propose explicit Work with a title, description and optional assignee in this conversation. Requires explicit operation review before creation; Full access/Never refuses that request. Accept creates one ready-to-start Work item; it does not start execution or approve later actions. Repeating the same original proposal returns the existing reviewed fields; later edits do not modify that Work.',
    review(ctx,args){
      if(!db||!ctx.roomId||!ctx.turnId||ctx.messageId===undefined)throw Error('Work creation requires an active conversation.');
      if(ctx.roomId.startsWith('_'))throw Error('Hidden conversations cannot create Work.');
      const assignee=args.assignee??ctx.botId;
      if(!db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND bot_id=?').get(ctx.roomId,assignee))throw Error('Assignee must be a member of this conversation.');
      return {creationKey:createHash('sha256').update(canonical([ctx.roomId,ctx.botId,ctx.messageId,args])).digest('hex'),originMessageId:ctx.messageId,originTurnId:ctx.turnId,assignee};
    },
    async execute(ctx,args){
      const key=ctx.review?.creationKey;
      if(!ctx.createWork||typeof key!=='string')throw Error('Work creation requires a reviewed proposal.');
      try {
        const work=ctx.createWork(args,key);
        return {workId:work.id,title:work.title,description:work.request,assignee:work.botId,alreadyCreated:work.alreadyCreated===true,status:work.status,nextStep:work.nextStep,originMessageId:work.originMessageId};
      } catch(error) {
        if(error instanceof WorkError)throw new ActionFailure(error.message,'not-run');
        throw error;
      }
    },
    confirm:result=>({outcome:'completed',detail:(result as {alreadyCreated?:boolean}).alreadyCreated?'The existing reviewed Work was returned. No new item or field changes were made.':'The daemon persisted the reviewed Work item. Execution and subsequent actions are not authorized by creation.'}),
  };
}
