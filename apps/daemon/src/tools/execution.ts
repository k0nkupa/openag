import { z } from 'zod';
import { ActionFailure } from '../action-receipts.js';
import { executeCommand,hostConfinementAvailable } from '../execution.js';
import type { ToolDef } from './registry.js';

const input=z.object({command:z.string().min(1).max(16_000).describe("A POSIX /bin/sh command. Bash/zsh process substitution and arrays are not supported by this shell. Use portable syntax or explicitly invoke the required interpreter."),timeoutMs:z.number().int().min(1).max(120_000).optional(),escalation:z.object({reason:z.string().trim().min(10).max(1000)}).strict().optional()}).strict();
export const commandTool:ToolDef<z.infer<typeof input>>={
  name:'run_shell',class:'act-external',input,editable:false,
  description:'Run one exact POSIX /bin/sh command (not a Bash/zsh command) through the effective OpenAg daemon filesystem boundary, independently of the disabled native Claude/Codex execution path. Ripgrep (rg) is bundled for local search; search the narrowest relevant paths, using file-name discovery before recursive content search. Read Only and Workspace Write do not limit network effects. A failed command may have partial effects: do not retry automatically. To propose a new, explicitly reviewed unconfined operation, supply escalation.reason. Full access uses Never and refuses explicit review requests.',  permission:(ctx,args)=>ctx.turnPolicy?.noNetwork?{approval:'deny',message:'Offline turns cannot run general shell commands; their network effects cannot be confined.'}:!ctx.permission?{approval:'deny',message:'Daemon command execution is unavailable without a permission session'}:!args.escalation&&ctx.permission.mode!=='danger-full-access'&&!hostConfinementAvailable()?{approval:'deny',message:'Host filesystem confinement is unavailable; this path cannot run confined commands.'}:args.escalation?{approval:'review',execution:{...ctx.permission,mode:'danger-full-access'}}:{approval:'allow'},
  execute:(ctx,args)=>{
    if(!ctx.permission)throw new ActionFailure('Permission boundary is unavailable','not-run');
    return executeCommand(ctx.permission,args.command,ctx.signal,args.timeoutMs,ctx.assertPermission);
  },
  confirm:result=>{
    const value=result as Awaited<ReturnType<typeof executeCommand>>;
    return {outcome:value.interrupted?'unknown':value.exitCode===0?'completed':'failed',detail:value.interrupted?'Command execution was interrupted. Partial effects or detached descendants may remain; inspect the target before any new operation.':value.exitCode===0?'The command invocation exited successfully. This is not independent confirmation of a downstream external effect.':'The command exited unsuccessfully; partial effects are possible. Do not repeat automatically.'};
  },
};
