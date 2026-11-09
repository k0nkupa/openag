import type { BotInfo } from "../types";

/** Label of the empty option in a bot select: the empty value means "use the default bot". */
export function defaultLabel(bots: BotInfo[]): string {
  const bot = bots.find((b) => b.isDefault);
  return bot ? `Default bot (${bot.name})` : "Default bot";
}
