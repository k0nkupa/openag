import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import { adapterInstalled, adapterPackage, detectAdapter, providerKeySet } from "./models.js";
import { modelTarget } from "./botmodels.js";
import { createBot, getBot, type Bot } from "./rooms.js";
import { getSetting, setSetting } from "./settings.js";

export const DEFAULT_BOT_NAME = "Bot";
const HANDLES = ["bot", ...Array.from({ length: 8 }, (_, i) => `bot-${i + 2}`)];

const DESCRIPTION = "The default bot. Unattended work (heartbeat, reflection) runs as this bot unless you pick another.";
const INSTRUCTIONS =
  "You are Bot, the default assistant of this OpenAg install. Answer simply yourself, or hand work to a specialist by @mention.";

export type DefaultBotStatus =
  | { state: "ok"; botId: string }
  | { state: "missing"; botId: string | null; reason: string }
  | { state: "not_configured"; botId: string; reason: string };

export function getDefaultBotId(db: Db): string | null {
  return getSetting(db, "defaultBot").botId;
}

/**
 * Creates the default bot once, on the first start with no `defaultBot` setting. One transaction: the bot, the setting and
 * the audit event. It adds no room and no membership and starts no turn. A setting that already names a bot (even a missing
 * one) is never touched: a deleted default is reported by `defaultBotStatus`, not silently recreated.
 */
export function ensureDefaultBot(db: Db, ledger: Ledger, isInstalled?: (pkg: string) => boolean): Bot | undefined {
  if (getDefaultBotId(db) !== null) return undefined;
  return db
    .transaction(() => {
      if (getDefaultBotId(db) !== null) return undefined;
      const id = HANDLES.find((h) => !getBot(db, h));
      if (!id) {
        ledger.append("_system", "daemon", "config", { action: "default_bot_skipped", reason: "no free handle" });
        return undefined;
      }
      // Detection reads module resolution only: nothing is launched and nothing contacts a provider.
      const adapter = detectAdapter(isInstalled) ?? "claude-code";
      const bot = createBot(db, {
        id,
        name: DEFAULT_BOT_NAME,
        runtime: "acp",
        model: adapter,
        config: { description: DESCRIPTION, instructions: INSTRUCTIONS, ...(adapter === "codex" ? { adapter: "codex" } : {}) },
      });
      setSetting(db, "defaultBot", { botId: bot.id });
      ledger.append("_system", "daemon", "config", { action: "default_bot_created", botId: bot.id, adapter });
      return bot;
    })
    .immediate();
}

/** Whether unattended features can use the default bot. Sign-in cannot be known without starting the adapter, so it is not claimed. */
export function defaultBotStatus(db: Db, env: NodeJS.ProcessEnv = process.env, isInstalled?: (pkg: string) => boolean): DefaultBotStatus {
  const botId = getDefaultBotId(db);
  if (botId === null) return { state: "missing", botId, reason: "No default bot has been created yet. Restart the service." };
  const bot = getBot(db, botId);
  if (!bot) return { state: "missing", botId, reason: `The default bot "${botId}" no longer exists.` };
  if (bot.runtime === "acp") {
    const id = (bot.config as { adapter?: unknown } | null)?.adapter === "codex" ? "codex" : "claude-code";
    if (!adapterInstalled(id, isInstalled)) {
      return { state: "not_configured", botId, reason: `${adapterPackage(id)} is not installed. Adapters are installed by the server administrator.` };
    }
    return { state: "ok", botId };
  }
  const target = modelTarget(bot, env);
  if (providerKeySet(target ?? "", env) === false) {
    return { state: "not_configured", botId, reason: `The ${target} key is not set in the service environment. Keys are managed by the server administrator.` };
  }
  return { state: "ok", botId };
}
