import {ActionFailure} from '../action-receipts.js';
import { resultInput,ResultError, type Results } from "../results.js";
import type { ToolDef } from "./registry.js";

export function createResultTool(results?: Results): ToolDef {
  return {
    name: "save_result", permission:()=>({approval:'allow'}), offlineSafe:true,
    class: "act-local",
    description:
      "Save a proposed comparison, draft, code/diff or note for this conversation or Work. Text only, maximum 256 KiB. Returns ID and version; update with that ID and baseVersion. Saving content does not prove an external action ran.",
    input: resultInput,
    enabled: () => !!results,
    async execute(ctx, args) {
      if (
        !results ||
        !ctx.roomId ||
        !ctx.turnId ||
        !ctx.toolCallId
      )
        throw new Error("saved results require an active conversation tool call");
      try{return results.save(
        {
          botId: ctx.botId,
          roomId: ctx.roomId,
          workId: ctx.workId,
          turnId: ctx.turnId,
          toolCallId: ctx.toolCallId,
        },
        args,
      );}catch(error){if(error instanceof ResultError)throw new ActionFailure(error.message,'not-run');throw error;}
    },
  };
}
