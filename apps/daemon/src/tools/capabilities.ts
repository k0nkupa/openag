import { z } from "zod";
import type { CapabilityCatalogue } from "../capabilities.js";
import type { ToolDef } from "./registry.js";

export function createCapabilitiesTool(catalogue: CapabilityCatalogue, enabled: () => boolean): ToolDef {
  return {
    name: "openag_capabilities", permission:()=>({approval:'allow'}), offlineSafe:true,
    effectScope:()=>({kind:'read'}),class: "read",
    description: "Read current search, computer and notification capability availability, safe next steps and this bot's permission modes. Does not probe services, start computers, send messages, grant access or create approvals. Configured/offered is not proof a call will succeed.",
    input: z.object({ family: z.enum(["search", "computer", "notification"]).optional() }).strict(),
    enabled,
    async execute(ctx, args) { return catalogue.describe(ctx, args.family); },
  };
}
