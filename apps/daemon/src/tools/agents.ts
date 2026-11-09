import { ActionFailure } from '../action-receipts.js';
import { AgentRequestError } from '../agent-requests.js';
import { z } from 'zod';
import { consultationInput } from '../agent-requests.js';
import type { ToolDef } from './registry.js';
// Admission/cancellation changes control state only; child actions retain their own receipt/permission checks.
export function createAgentTools(): ToolDef[] {
  return [
    {name:'agent_request_cancel',effectScope:()=>({kind:'read'}),class:'act-local',permission:()=>({approval:'allow'}),offlineSafe:true,editable:false,
      description:'Cancel your active agent requests in this conversation. Omit requestId to stop all of them. This does not undo actions or clear Unknown receipts.',input:z.object({requestId:z.string().uuid().optional()}).strict(),
      async execute(ctx,args){if(!ctx.cancelAgentRequests)throw new ActionFailure('Agent cancellation is unavailable.','not-run');return ctx.cancelAgentRequests(args.requestId);}},
    { name: 'agent_list', effectScope:()=>({kind:'read'}), class: 'read', permission: () => ({ approval: 'allow' }), offlineSafe: true,
      description: 'List existing OpenAg agents by stable handle, name and current runtime/busy state. Passive discovery grants no action permission.', input: z.object({}).strict(),
      async execute(ctx) { if (!ctx.agentList) throw Error('Agent discovery is unavailable in this context.'); return ctx.agentList(); } },
    { name: 'agent_consult', effectScope:()=>({kind:'read'}), class: 'act-local', permission: () => ({ approval: 'allow' }), offlineSafe: false, editable: false,
      description: 'Ask an existing OpenAg agent a bounded question. Returns admission only; findings return to you in this conversation after your turn ends. Finish with a brief progress update, not a claimed answer. Include selected context explicitly; private history and memory are not shared. No Work is created. One hop, at most three recipients; do not also delegate the same request in prose.', input: consultationInput,
      async execute(ctx, args) { if (!ctx.consultAgent) throw new ActionFailure('Consultation is unavailable in this context.','not-run'); try{return ctx.consultAgent(args);}catch(error){if(error instanceof AgentRequestError)throw new ActionFailure(error.message,'not-run');throw error;} } },
  ];
}
