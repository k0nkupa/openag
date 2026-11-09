import { createModelCatalogue } from "./model-catalogue.js";
import { createRequire } from "node:module";
import { adapterInstalled, adapterPackage } from "./models.js";
import { canonical } from "./action-receipts.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createModelDiscovery, modelIdentity, ModelError, reasoningOptions, validateReasoning, type ModelChoices, type ModelTarget, type Reasoning } from "./hostedmodels.js";
import { modelProviders, registeredProvider, registerProviderSecrets, providerCredential } from "./providers.js";
export { ModelError } from "./hostedmodels.js";
export type { ModelChoices, ModelTarget, Reasoning, ModelControl } from "./hostedmodels.js";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import { getDefaultRedactor } from "./redact.js";
import { getBot, updateBot, type Bot } from "./rooms.js";
import type { TurnContext } from "./runtimes/types.js";

const identity = modelIdentity;
const targetSchema = z.string().refine(id => ["claude", "codex", "ollama"].includes(id) || !!registeredProvider(id));
export interface AcpModels { discover(bot: Bot, target: "claude" | "codex", model?: string, temporary?: boolean): Promise<ModelChoices>; discoverAll?(bot: Bot, target: "claude" | "codex"): Promise<ModelChoices[]>; stopBot(id: string): Promise<void> }
export function modelConfig(bot: Bot): { model?: string; reasoning?: Reasoning; outputLimit?: number } { return (bot.config as { modelConfig?: { model?: string; reasoning?: Reasoning; outputLimit?: number } } | null)?.modelConfig ?? {}; }
export const INVALID_MODEL_OVERRIDE = "Invalid administrator model override. Ask the server administrator.";
function rawModelOverride(bot: Bot, env: NodeJS.ProcessEnv): string | null { return bot.runtime === "api" ? env[`OPENAG_${bot.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_MODEL`] ?? null : null; }
export function modelRevision(bot: Bot, env = process.env): string { return createHash("sha256").update(canonical([bot.runtime, bot.model, (bot.config as { adapter?: string } | null)?.adapter ?? null, modelConfig(bot), rawModelOverride(bot, env)])).digest("hex"); }
export function modelOverride(bot: Bot, env = process.env): string | null {
  const raw = rawModelOverride(bot, env);
  if (raw === null) return null;
  const slash = raw.indexOf("/");
  const provider = targetSchema.safeParse(raw.slice(0, slash));
  return identity.safeParse(raw).success && slash > 0 && slash < raw.length - 1 && provider.success && !["claude", "codex"].includes(provider.data) && getDefaultRedactor().redactString(raw) === raw ? raw : INVALID_MODEL_OVERRIDE;
}
export function modelTarget(bot: Bot, env = process.env): ModelTarget | null { const raw = bot.runtime === "acp" ? (bot.config as { adapter?: string })?.adapter ?? "claude" : (modelOverride(bot, env) ?? bot.model ?? "").split("/")[0]; return targetSchema.safeParse(raw).success ? raw as ModelTarget : null; }
export function recordModel(ctx: TurnContext, data: { model?: string; modelName?: string; effort?: string; warnings?: string[]; provider?: string; source: "response" | "session"; sessionId?: string }, env = process.env): void {
  ctx.ledger.append(ctx.room.id, ctx.bot.id, "model_report", { turnId: ctx.turnId, revision: modelRevision(ctx.bot, env), ...data, model: data.model?.slice(0, 200), modelName: data.modelName?.slice(0, 200), effort: data.effort?.slice(0, 80) });
}
export function providerOptions(bot: Bot): Record<string, Record<string, unknown>> {
  return reasoningOptions(modelTarget(bot) ?? "", modelConfig(bot).reasoning ?? {}, modelOverride(bot) ?? bot.model ?? "");
}
export function createBotModels(deps: { db: Db; ledger: Ledger; acp: AcpModels; withIdleBot<T>(id: string, fn: () => Promise<T>): Promise<T>; env?: NodeJS.ProcessEnv; fetch?: typeof fetch; now?: () => number }) {
  const env = deps.env ?? process.env, doFetch = deps.fetch ?? fetch;
  registerProviderSecrets(env);
  const botOf = (id: string) => { const bot = getBot(deps.db, id); if (!bot) throw new ModelError("bot not found", 404); return bot; };
  const hosted = createModelDiscovery(env, doFetch);
  const creationTargets = () => [{ id: "claude", name: "Claude Code", configured: adapterInstalled("claude-code") }, { id: "codex", name: "Codex", configured: adapterInstalled("codex") }, ...modelProviders().filter(p => p.chat).map(p => ({ id: p.id, name: p.name, configured: !!providerCredential(p.id, env) })), { id: "ollama", name: "Ollama", configured: true }];
  const packageVersion = (name: string): string => { try { return String(createRequire(import.meta.url)(`${name}/package.json`).version); } catch { return "unknown"; } };
  const catalogue = createModelCatalogue({ db: deps.db, targets: () => [...creationTargets(), ...modelProviders().filter(p => !p.chat && p.decisions).map(p => ({ id: p.id, name: p.name, configured: !!providerCredential(p.id, env) }))], prepare: hosted.invalidateMetadata, sourceKey: target => createHash("sha256").update(canonical([target, target === "ollama" ? env.OPENAG_OLLAMA_URL ?? "http://127.0.0.1:11434" : providerCredential(target, env) ?? null, target === "claude" || target === "codex" ? packageVersion(adapterPackage(target === "claude" ? "claude-code" : "codex")) : packageVersion("@mastra/core")])).digest("hex"), now: deps.now, async load(target, signal) {
    if (target !== "claude" && target !== "codex") return hosted.discoverAll(target, signal);
    const bot: Bot = { id: `catalogue-${target}`, name: "Model refresh", runtime: "acp", model: null, config: {} };
    if (deps.acp.discoverAll) return deps.acp.discoverAll(bot, target);
    const first = await deps.acp.discover(bot, target, undefined, true);
    return Promise.all(first.models.map(m => m.id === first.model ? first : deps.acp.discover(bot, target, m.id, true)));
  } });
  return {
    catalogue,
    creationTargets,
    async discoverCreation(input: unknown) {
      const parsed = z.object({ requestId: z.string().uuid(), target: targetSchema, model: identity.optional() }).strict().safeParse(input);
      if (!parsed.success) throw new ModelError("Expected a creation request id, supported target and optional model");
      const { requestId, target, model } = parsed.data;
      const choice = catalogue.read(target, model);
      return { ...choice, snapshotId: createHash("sha256").update(canonical([choice.snapshotId, requestId])).digest("hex"), revision: requestId };
    },
    creationConfig(input: { requestId: string; target: string; model: string; snapshotId: string; reasoning: Reasoning }) {
      if (!targetSchema.safeParse(input.target).success) throw new ModelError("Unsupported model source");
      const choice = catalogue.read(input.target, input.model);
      if (createHash("sha256").update(canonical([choice.snapshotId, input.requestId])).digest("hex") !== input.snapshotId) throw new ModelError("Cached choices changed. Review this creation request before saving.", 409);
      if (choice.target !== input.target) throw new ModelError("Model source changed", 409);
      validateReasoning(choice, input.reasoning);
      const acp = ["claude", "codex"].includes(input.target);
      return { runtime: acp ? "acp" as const : "api" as const, model: acp ? input.target === "claude" ? "claude-code" : "codex" : input.model,
        config: { ...(acp ? { adapter: input.target } : {}), modelConfig: { ...(acp ? { model: input.model } : {}), reasoning: input.reasoning, ...(input.reasoning.budget_tokens !== undefined ? { outputLimit: choice.outputLimit } : {}) } } };
    },
    read(id: string) {
      const bot = botOf(id), config = modelConfig(bot), override = modelOverride(bot, env);
      const events = deps.db.prepare("SELECT id,room_id,ts,payload_json FROM events WHERE id IN (SELECT max(id) FROM events WHERE actor=? AND type='model_report' GROUP BY room_id,json_extract(payload_json,'$.source')) ORDER BY id DESC LIMIT 101").all(id) as Array<{ id: number; room_id: string; ts: number; payload_json: string }>;
      const reports = events.slice(0, 100).map(e => { const payload = JSON.parse(e.payload_json); return { roomId: e.room_id, at: e.ts, ...payload, freshness: payload.revision === modelRevision(bot, env) ? "last-reported" : "previous-configuration" }; });
      return { providers: modelProviders().filter(p => p.chat), revision: modelRevision(bot, env), runtime: bot.runtime, target: modelTarget(bot, env), model: bot.runtime === "api" ? bot.model : config.model ?? null, reasoning: config.reasoning ?? {}, override, effectiveModel: override === INVALID_MODEL_OVERRIDE ? null : override ?? (bot.runtime === "api" ? bot.model : config.model ?? null), reports, reportsTruncated: events.length > 100 };
    },
    async discover(id: string, input: unknown) {
      const body = z.object({ target: targetSchema, model: identity.optional() }).strict().safeParse(input);
      if (!body.success) throw new ModelError("Expected a supported target and optional model");
      const bot = botOf(id), { target, model } = body.data;
      // Browsing cached metadata is safe even while this bot is busy.
      return { ...catalogue.read(target, model), revision: modelRevision(bot, env) };
    },
    async save(id: string, input: unknown) {
      const parsed = z.object({ revision: z.string(), snapshotId: z.string(), model: identity, reasoning: z.record(z.string(), z.union([z.string().max(80), z.boolean(), z.number().int()])) }).strict().safeParse(input);
      if (!parsed.success) throw new ModelError("Invalid model configuration");
      return deps.withIdleBot(id, async () => {
        const bot = botOf(id), b = parsed.data, choice = catalogue.resolve(b.snapshotId, b.model);
        const existing = modelConfig(bot), currentModel = bot.runtime === "api" ? bot.model : existing.model;
        if (choice.target === modelTarget(bot, env) && currentModel === b.model && canonical(existing.reasoning ?? {}) === canonical(b.reasoning)) return this.read(id);
        if (modelRevision(bot, env) !== b.revision) throw new ModelError("Configuration changed. Reload before saving.", 409);
        if (modelOverride(bot, env)) throw new ModelError("An administrator environment override controls this bot's model", 409);
        validateReasoning(choice, b.reasoning);
        if (getDefaultRedactor().redact(b.model) !== b.model || canonical(getDefaultRedactor().redact(b.reasoning)) !== canonical(b.reasoning)) throw new ModelError("Model configuration contains a secret");
        const acp = ["claude", "codex"].includes(choice.target);
        const nextRuntime = acp ? "acp" : "api";
        if (nextRuntime === "api" && modelOverride({ ...bot, runtime: "api" }, env)) throw new ModelError("An administrator environment override controls this bot's model", 409);
        if (bot.runtime === "acp") await deps.acp.stopBot(id);
        deps.ledger.atomic(() => {
          updateBot(deps.db, id, { runtime: nextRuntime, model: acp ? choice.target === "claude" ? "claude-code" : "codex" : b.model, config: { adapter: acp ? choice.target : undefined, modelConfig: getDefaultRedactor().redact({ sessionEpoch: randomUUID(), ...(acp ? { model: b.model } : {}), reasoning: b.reasoning, ...(b.reasoning.budget_tokens !== undefined ? { outputLimit: choice.outputLimit } : {}) }) } });
          deps.ledger.append("_system", "user", "config", { action: "bot_model", botId: id, fields: ["runtime", "model", "reasoning", "adapter"] });
        });
        return this.read(id);
      });
    },
  };
}
export type BotModels = ReturnType<typeof createBotModels>;
