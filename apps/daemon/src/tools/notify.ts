import { z } from "zod";
import type { Pusher } from "../push.js";
import type { ToolDef, ToolAvailability } from "./registry.js";

/** Lets a bot ask the daemon to push a short text to the user's phone. Execution follows the current mode and independent turn ceilings. */
export function createNotifyTool(pusher: Pusher): ToolDef<{ text: string }> {
  const availability = (): ToolAvailability => {
    const st = pusher.status();
    if (!st.enabled) return { offered: false, code: "disabled", nextStep: "Ask the owner to enable push notifications in Settings." };
    if (!st.configured) return { offered: false, code: "missing_configuration", nextStep: "Ask the owner to configure a push topic in Settings. Do not paste the topic into chat." };
    return { offered: true, code: "configured", nextStep: "Execution follows current permissions. Configuration does not prove device delivery." };
  };

  return {
    name: "notify_user", permission:()=>({approval:"allow"}),
    class: "act-external",
    description:
      "Send a short notification (max 200 characters) to the user's phone. Execution follows current permissions; service acceptance does not prove device delivery.",
    input: z.object({ text: z.string().min(1).max(200) }),
    enabled: () => availability().offered,
    capability: { family: "notification", availability },
    confirm: result => ({outcome:(result as {sent?:boolean})?.sent===true?"completed":"unknown",detail:(result as {sent?:boolean})?.sent===true?"The notification service accepted the request. Device delivery is not confirmed.":"No notification acceptance was confirmed. Inspect the service before repeating."}),
    async execute(_ctx, args) {
      const res = await pusher.notifyUser(args.text);
      return res.ok ? { sent: true } : { sent: false, reason: res.reason };
    },
  };
}
