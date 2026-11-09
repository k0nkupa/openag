import { useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { BotId } from "./data";
import { BotAvatar, defaultAvatars, useAvatars } from "./bot-avatar";
import { DemoContext } from "./demo-context";

export function Face({ bot, size = 30 }: { bot: BotId | "owner"; size?: number }) {
  const { avatars } = useAvatars();
  const demo = useContext(DemoContext);
  if (bot === "owner") return <span className="human-face" style={{ width: size, height: size }}>TL</span>;
  const config = avatars[bot];
  const mood = demo?.work.some(w => w.bot === bot && w.status === "working") ? "thinking" : demo?.work.some(w => w.bot === bot && ["approval", "input"].includes(w.status)) ? "waiting" : "idle";
  return <BotAvatar config={{ ...config, color: config.color ?? defaultAvatars[bot].color }} size={size} mood={mood} />;
}
export function Status({ kind = "online", children }: { kind?: "online" | "attention" | "muted" | "info"; children: ReactNode }) {
  return <span className={cn("status", `status-${kind}`)}><span />{children}</span>;
}
