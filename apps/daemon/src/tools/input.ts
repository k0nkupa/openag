import { z } from "zod";
import type { ToolDef } from "./registry.js";
/** Internal control: store a question and yield. It never grants permission or executes an external action. */
export const requestInputTool:ToolDef<{prompt:string}>={
 name:'request_input', permission:()=>({approval:'allow'}), offlineSafe:true,effectScope:()=>({kind:'read'}),class:'read',description:'Ask the user for missing information and pause this request. The question appears in its originating chat; the owner answers with the normal composer. Finish your turn after this call; it ends normally awaiting an answer. An answer is not action permission.',
 input:z.object({prompt:z.string().trim().min(1).max(2000)}).strict(),
 async execute(ctx,args){if(!ctx.requestInput)throw Error('Input requests are unavailable in this context.');return ctx.requestInput(args.prompt);},
};
