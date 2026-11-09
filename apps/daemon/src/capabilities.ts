import type { Db } from "./db/index.js";
import { getBot, getRoom } from "./rooms.js";
import { classify, turnToolRestriction, sessionToolMode,sessionRequirement,operationClass } from "./policy.js";
import { getDefaultRedactor } from "./redact.js";
import { toolAvailability, type CapabilityFamily, type ToolDef, type ToolExecContext } from "./tools/registry.js";

/** Only these first-party families are described. Discovery never grants execution authority. */
export function createCapabilityCatalogue(db: Db | undefined, definitions: () => ToolDef[]) {
  const entries = () => definitions().filter(def => def.capability);
  return {
    guidance() {
      const names = entries().map(def => def.name).join(", ");
      return `Tool capability catalogue: ${names}. Subject to this turn's read permissions, use openag_capabilities to check current configuration, availability reasons and permission modes. Offered/configured does not guarantee execution. Do not work around unavailable tools using another channel.`;
    },
    describe(ctx: ToolExecContext, family?: CapabilityFamily) {
      if (!db || !ctx.turnPolicy || !getBot(db, ctx.botId) || !ctx.roomId || !getRoom(db, ctx.roomId)?.members.includes(ctx.botId)) {
        return { unavailable: true, reason: "Trusted bot, room and turn context required" };
      }
      const tools = entries().filter(def => !family || def.capability!.family === family).map(def => {
        let cls = classify(def.name);
        let requirement=ctx.permission?def.permission?.(ctx,{})??{approval:'review' as const}:undefined;
        if(requirement){cls=operationClass(def.name,requirement);requirement=sessionRequirement(requirement,cls,ctx.turnPolicy!);}
        const resolved=requirement?sessionToolMode(ctx.permissionApproval??'never',requirement):undefined;
        const mode=resolved?.mode??'deny';
        return {
          name: def.name,
          description: def.description,
          family: def.capability!.family,
          class: cls,
          availability: toolAvailability(def),
          permission: { mode,reason:resolved?.reason??null,turnRestriction:turnToolRestriction(cls,mode,ctx.turnPolicy!,ctx.permission?def.offlineSafe===true:undefined) },
        };
      });
      return getDefaultRedactor().redact({ observedAt: Date.now(), scope: "Current bot and room; selected first-party families only", executionStillGated: true, tools });
    },
  };
}

export type CapabilityCatalogue = ReturnType<typeof createCapabilityCatalogue>;
