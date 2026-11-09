import { z } from "zod";
import { commitMemory } from "../datagit.js";
import { appendMemoryNote } from "../memory.js";
import { unconfinedPermission, type ToolDef } from "./registry.js";

/**
 * Lets a bot append one fact to its own MEMORY.md. act-local: every call asks for approval by default.
 * The note is redacted by appendMemoryNote; the commit goes through datagit (memory paths only).
 */
export const memoryAppendTool: ToolDef<{ text: string }> = {
  name: "memory_append",
  permission:ctx=>unconfinedPermission(ctx,"Managed memory file writes"),
  class: "act-local",
  description: "Save one short fact (max 300 characters) to your MEMORY.md. Managed memory file writes are unavailable in confined filesystem modes.",
  input: z.object({ text: z.string().min(1).max(300) }),
  async execute(ctx, args) {
    ctx.assertPermission?.();
    appendMemoryNote(ctx.dataDir, ctx.botId, args.text);
    await commitMemory(ctx.dataDir, `memory: note by ${ctx.botId}`);
    return { saved: true };
  },
};
