import { getModelReasoningOptions, PROVIDER_REGISTRY } from "@mastra/core/llm";
import { z } from "zod";
import { localTranscriptionOrigin } from "./transcription.js";
import { providerCredential, registeredProvider, registerProviderSecrets } from "./providers.js";
export const modelIdentity = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.~:/@\[\]-]+$/);
export type ModelTarget = string;
export type Reasoning = Record<string, string | boolean | number>;
export interface ModelControl { id: string; name: string; values?: Array<{ value: string | boolean; name: string }>; min?: number; max?: number }
import { catalogueCapabilities, providerCapabilities, fetchCapabilityFeed, type CapabilityFeed, type ModelCapabilities, type ModelDefinition } from "./model-capabilities.js";
export interface ModelChoices { capabilities?: ModelCapabilities; target: ModelTarget; models: Array<{ id: string; name: string }>; model: string; controls: ModelControl[]; reason: string | null; source: string; outputLimit?: number }
export class ModelError extends Error { constructor(message: string, public status: 400 | 404 | 409 | 503 = 400) { super(message); } }
const identity = modelIdentity;
export function createModelDiscovery(env: NodeJS.ProcessEnv = process.env, doFetch: typeof fetch = fetch) {
  registerProviderSecrets(env);
  let metadata: Promise<CapabilityFeed> | undefined;
  const capabilities = async (signal?: AbortSignal) => {
    try { return await (metadata ??= fetchCapabilityFeed(doFetch, signal)); }
    catch { throw new ModelError("Model capability discovery unavailable. Last successful choices are retained; try Refresh models.", 503); }
  };
  async function json(url: string, init?: RequestInit): Promise<any> {
    try {
      const response = await doFetch(url, { ...init, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]) });
      if (!response.ok) throw new Error();
      const reader = response.body?.getReader(); if (!reader) throw new Error();
      let size = 0; const chunks: Uint8Array[] = [];
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw new Error(); chunks.push(value); } } finally { await reader.cancel().catch(() => {}); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { throw new ModelError("Model discovery unavailable. Check the server, credentials and provider access, then try again.", 503); }
  }
  function evidence(target: string, model: string, definition: ModelDefinition | undefined, raw?: unknown): ModelCapabilities {
    const result = providerCapabilities(raw, catalogueCapabilities(definition, Date.now()), "Provider model metadata");
    if (result.chat === true) {
      const protocol = runtimeChatProtocol(target, model);
      if (!definition?.api) result.chat = "unknown";
      else if (protocol !== "gateway" && !Object.hasOwn(definition.api, protocol)) result.chat = false;
    }
    return result;
  }
  async function discover(target: ModelTarget, requested?: string, collect?: (choices: ModelChoices[]) => void, signal?: AbortSignal, all = false): Promise<ModelChoices> {
    let rows: Array<{ id: string; name: string }> = [];
    const details = new Map<string, { max_tokens?: number; capabilities?: { thinking?: { types?: { adaptive?: { supported?: boolean }; enabled?: { supported?: boolean }; disabled?: { supported?: boolean } } } }; top_provider?: { max_completion_tokens?: number } }>();
    let source = "Provider model list + maintained capabilities and installed reasoning metadata (not inference acceptance)";
    if (target === "ollama") {
      let base: URL; try { base = new URL(env.OPENAG_OLLAMA_URL || "http://127.0.0.1:11434"); } catch { throw new ModelError("Invalid Ollama chat URL", 503); }
      if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new ModelError("Invalid Ollama chat URL", 503);
      const body = await json(`${base.origin}/api/tags`, { signal });
      if (!Array.isArray(body.models) || body.models.length > 500) throw new ModelError("Ollama returned an invalid or oversized model list", 503);
      rows = body.models.filter((m: any) => identity.safeParse(m.name).success).map((m: any) => ({ id: `ollama/${m.name}`, name: m.name }));
      const found: ModelChoices[] = [];
      for (const row of rows) {
        const info = await json(`${base.origin}/api/show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: row.name }), signal });
        if (info.capabilities !== undefined && (!Array.isArray(info.capabilities) || !info.capabilities.every((c: unknown) => typeof c === "string" && c.length <= 100))) throw new ModelError("Ollama returned invalid capability metadata", 503);
        const localCapabilities = providerCapabilities(info, catalogueCapabilities(undefined, Date.now()), "Ollama tags/show");
        try { localTranscriptionOrigin(base.href); } catch { localCapabilities.transcription = false; }
        const values = info.thinking?.values;
        const controls: ModelControl[] = Array.isArray(values) && values.length <= 30 && values.every(v => typeof v === "boolean" || typeof v === "string" && v.length <= 80) ? [{ id: "think", name: "Thinking", values: values.map((v: string | boolean) => ({ value: v, name: String(v) })) }] : [];
        found.push({ target, models: [], model: row.id, capabilities: localCapabilities, controls, reason: !Array.isArray(values) ? "This server did not report thinking controls." : null, source: "Ollama tags/show (not inference acceptance)" });
      }
      const visible = all ? found : found.filter(c => c.capabilities?.chat === true);
      const models = rows.filter(row => visible.some(c => c.model === row.id));
      for (const choice of found) choice.models = models;
      if (!visible.length) throw new ModelError("No installed Ollama completion models were reported. Refresh after installing a chat model.", 409);
      collect?.(visible);
      return visible.find(c => c.model === requested) ?? { ...visible[0]!, ...(requested ? { reason: "The previously selected model is unavailable. Review and save an available replacement." } : {}) };
    }
    const key = providerCredential(target, env);
    if (!key) throw new ModelError(`${target} credentials are not configured. Ask the server administrator.`, 503);
    if (target === "typesafe") {
      const body = await json("https://api.typesafe.ai/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal });
      const entries = body.data ?? body.models;
      if (!Array.isArray(entries) || entries.length > 2000) throw new ModelError("Invalid decision model list", 503);
      const models = entries.map((m: any) => typeof m === "string" ? m : m.id ?? m.name).filter((id: unknown): id is string => identity.safeParse(id).success).map(id => ({ id: `${target}/${id}`, name: id }));
      const found: ModelChoices[] = models.map(row => ({ target, models, model: row.id, controls: [], reason: null, source: "Typesafe decision model list", capabilities: { ...catalogueCapabilities(undefined, Date.now()), decision: true, source: "Typesafe decision model list" } }));
      if (!all || !found.length) throw new ModelError("No compatible models reported", 409);
      collect?.(found); return found[0]!;
    }
    const feed = await capabilities(signal);
    const registered = registeredProvider(target);
    if (!registered) throw new ModelError("Unsupported provider");
    if (!Object.hasOwn(feed, target)) throw new ModelError("The capability source has no metadata for this provider; cached choices are retained", 503);
    if (!["openai", "anthropic", "openrouter"].includes(target)) {
      rows = Object.entries(feed[target]?.models ?? {}).filter(([id, m]) => all || evidence(target, `${target}/${id}`, m).chat === true).map(([id, m]) => ({ id: `${target}/${id}`, name: m.name ?? id }));
      const missing = !!requested && !rows.some(m => m.id === requested);
      const model = missing ? rows[0]?.id ?? "" : requested ?? rows[0]?.id ?? "";
      if (!rows.some(m => m.id === model)) throw new ModelError("No chat models are listed for this provider", 409);
      const choices = rows.map(row => ({ target, models: rows, model: row.id, controls: catalogueControls(target, row.id), capabilities: evidence(target, row.id, feed[target]?.models[row.id.slice(target.length + 1)]), source: "Maintained capability catalogue; account access and inference not checked", reason: "Catalogue choices do not establish access on your provider account." }));
      collect?.(choices);
      return { ...choices.find(c => c.model === model)!, reason: missing ? "The previously selected model is unavailable. Review and save a replacement." : choices[0]!.reason };
    }
    const headers: Record<string, string> = target === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${key}` };
    const endpoint = target === "openai" ? "https://api.openai.com/v1/models" : target === "anthropic" ? "https://api.anthropic.com/v1/models" : "https://openrouter.ai/api/v1/models/user";
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const body = await json(endpoint + (cursor ? `?after_id=${encodeURIComponent(cursor)}` : ""), { headers, signal });
      if (!Array.isArray(body.data)) throw new ModelError("Provider returned an invalid model list", 503);
      for (const entry of body.data) if (identity.safeParse(entry.id).success) details.set(`${target}/${entry.id}`, entry);
      rows.push(...body.data.filter((m: any) => identity.safeParse(m.id).success).map((m: any) => ({ id: `${target}/${m.id}`, name: String(m.display_name ?? m.name ?? m.id).slice(0, 200) })));
      if (rows.length > 2000) throw new ModelError("Model list exceeds the supported limit", 503);
      if (!body.has_more) break;
      if (typeof body.last_id !== "string" || cursor === body.last_id || page === 9) throw new ModelError("Provider model list is incomplete", 503);
      cursor = body.last_id;
    }
    const modelEvidence = (model: string) => evidence(target, model, feed[target]?.models[model.slice(target.length + 1)], details.get(model));
    rows = rows.filter((m, i) => rows.findIndex(n => n.id === m.id) === i && (all || modelEvidence(m.id).chat === true));
    const missing = !!requested && !rows.some(m => m.id === requested);
    const model = missing ? rows[0]?.id ?? "" : requested ?? rows[0]?.id ?? "";
    if (!rows.some(m => m.id === model)) throw new ModelError("Selected model is not in the provider's available list", 409);
    const forModel = (model: string): ModelChoices => {
      const capabilities = getModelReasoningOptions(model);
      const detail = details.get(model);
      const outputLimit = target === "anthropic" ? detail?.max_tokens : detail?.top_provider?.max_completion_tokens;
      const canBudget = Number.isSafeInteger(outputLimit) && outputLimit! > 1 && (target !== "anthropic" || detail?.capabilities?.thinking?.types?.enabled?.supported === true);
      const availableControls = (capabilities ?? []).filter(c => (c.type !== "budget_tokens" || c.min !== undefined && canBudget && c.min < outputLimit!) && (target === "openai" ? c.type === "effort" : target === "anthropic" ? c.type !== "toggle" : true));
      const controls: ModelControl[] = availableControls.map(c => c.type === "effort" ? { id: "effort", name: "Effort", values: c.values.map(value => ({ value, name: value })) } : c.type === "toggle" ? { id: "toggle", name: "Thinking", values: [{ value: true, name: "On" }, { value: false, name: "Off" }] } : { id: "budget_tokens", name: "Thinking token budget", min: c.min!, max: Math.min(c.max ?? outputLimit! - 1, outputLimit! - 1) });
      if (target === "anthropic") {
        const thinking = detail?.capabilities?.thinking?.types;
        const modes = [...(thinking?.adaptive?.supported ? [{ value: "adaptive", name: "Adaptive" }] : []), ...(canBudget && controls.some(c => c.id === "budget_tokens") ? [{ value: "enabled", name: "Enabled with token budget" }] : [])];
        if (modes.length) controls.push({ id: "thinking", name: "Thinking mode", values: [...modes, ...(thinking?.disabled?.supported ? [{ value: "disabled", name: "Off" }] : [])] });
      }
      return { target, models: rows, model, capabilities: modelEvidence(model), controls, source, outputLimit: canBudget ? outputLimit : undefined, reason: missing ? "The previously selected model is unavailable. Review and save an available replacement." : capabilities?.some(c => c.type === "budget_tokens") && !controls.some(c => c.id === "budget_tokens") ? "Thinking budget unavailable: the provider/catalogue does not report compatible thinking support and safe model-specific output limits. Use other reported controls or ask the administrator to update capability data." : target === "anthropic" && capabilities?.some(c => c.type === "toggle") && !controls.some(c => c.id === "thinking") ? "Thinking toggle unavailable: this catalogue does not identify the model-compatible thinking mode. Use reported effort/budget controls where available." : capabilities === undefined ? "Reasoning capabilities are not reported by the installed catalogue." : null };
    };
    collect?.(rows.map(row => forModel(row.id)));
    return forModel(model);
  }
  async function discoverDecision(strategy: string, target: string, requested?: string): Promise<ModelChoices> {
    if (!(strategy === "jev" ? ["typesafe", "openrouter"] : strategy === "openai-decision" ? ["openai", "openrouter"] : []).includes(target)) throw new ModelError("This provider does not serve the selected decision model");
    const choices = await discoverAll(target);
    const eligible = choices.filter(c => c.capabilities?.decision === true);
    const models = eligible.map(c => ({ id: c.model, name: c.models.find(m => m.id === c.model)?.name ?? c.model }));
    const found = eligible.find(c => c.model === requested) ?? eligible[0];
    if (!found) throw new ModelError("This provider did not list a compatible decision model", 409);
    return { ...found, models, controls: [], reason: requested && requested !== found.model ? "The selected model is unavailable. Review its replacement." : null };
  }
  async function discoverAll(target: ModelTarget, signal?: AbortSignal): Promise<ModelChoices[]> {
    let choices: ModelChoices[] = [];
    try { await discover(target, undefined, found => { choices = found; }, signal, true); }
    catch (error) { if (!(error instanceof ModelError) || error.status !== 409) throw error; }
    return choices;
  }
  return { discover, discoverDecision, discoverAll, invalidateMetadata() { metadata = undefined; } };
}

/** Protocols selected by the installed Mastra adapters, not downloaded endpoints. */
export function runtimeChatProtocol(target: string, model: string): string {
  const provider = registeredProvider(target), id = model.slice(target.length + 1);
  const override = provider?.modelOverrides && Object.hasOwn(provider.modelOverrides, id) ? provider.modelOverrides[id] : undefined;
  if (override?.shape === "responses") return "responses";
  if (target === "vercel") return "gateway";
  if (target === "netlify") {
    const nested = id.split("/")[0]!;
    return nested === "gemini" ? "generate-content" : nested === "netlify" ? "chat-completions" : runtimeChatProtocol(nested, id);
  }
  if (["openai", "xai", "perplexity"].includes(target)) return "responses";
  if (["anthropic", "moonshotai", "moonshotai-cn"].includes(target)) return "messages";
  if (target === "google" || target === "gemini") return "generate-content";
  const npm = override?.npm ?? provider?.npm;
  return npm === "@ai-sdk/anthropic" ? "messages" : npm === "@ai-sdk/google" ? "generate-content" : "chat-completions";
}

/** Match Mastra's transport selection, including per-model overrides. */
function transport(target: string, model: string) {
  if (["netlify", "vercel"].includes(target)) {
    const nested = model.slice(target.length + 1), vendor = nested.split("/")[0]!;
    if (vendor === "gemini") return "google";
    if (!["netlify", "vercel"].includes(vendor) && registeredProvider(vendor)) return transport(vendor, nested);
  }
  const p = registeredProvider(target), id = model.slice(target.length + 1);
  const override = p?.modelOverrides && Object.hasOwn(p.modelOverrides, id) ? p.modelOverrides[id] : undefined;
  if (override?.shape === "responses") return "openai";
  if (["openai", "google", "anthropic", "openrouter", "groq", "xai", "deepseek", "mistral", "cerebras", "perplexity"].includes(target)) return target;
  if (target.includes("alibaba")) return "alibaba";
  if (["moonshotai", "moonshotai-cn"].includes(target)) return "anthropic";
  const npm = override?.npm ?? p?.npm;
  return ["@ai-sdk/anthropic", "@ai-sdk/openai", "@ai-sdk/google", "@ai-sdk/mistral"].includes(npm ?? "") ? npm!.slice(8) : "compatible";
}
function catalogueControls(target: string, model: string): ModelControl[] {
  const kind = transport(target, model);
  return (getModelReasoningOptions(model) ?? []).flatMap((c): ModelControl[] => {
    if (c.type === "effort") {
      const values = c.values.filter(v => kind !== "mistral" || ["none", "high"].includes(v));
      return values.length ? [{ id: "effort", name: "Effort", values: values.map(value => ({ value, name: value })) }] : [];
    }
    if (c.type === "budget_tokens" && ["google", "alibaba", "openrouter"].includes(kind) && c.min !== undefined && c.max !== undefined) return [{ id: "budget_tokens", name: "Thinking token budget", min: kind === "alibaba" ? Math.max(1, c.min) : c.min, max: c.max }];
    if (c.type === "toggle" && ["google", "alibaba", "deepseek", "openrouter"].includes(kind)) return [{ id: "toggle", name: "Thinking", values: [{ value: true, name: "On" }, { value: false, name: "Off" }] }];
    return [];
  });
}
export function reasoningOptions(target: string, r: Reasoning, model = ""): Record<string, Record<string, unknown>> {
  const kind = transport(target, model);
  if (kind === "anthropic") return { anthropic: { ...(r.effort !== undefined ? { effort: r.effort } : {}), ...(r.budget_tokens !== undefined ? { thinking: { type: "enabled", budgetTokens: r.budget_tokens } } : r.thinking === "adaptive" ? { thinking: { type: "adaptive" } } : r.thinking === "disabled" ? { thinking: { type: "disabled" } } : {}) } };
  if (kind === "google") return { google: { thinkingConfig: { ...(r.effort !== undefined ? { thinkingLevel: r.effort } : {}), ...(r.budget_tokens !== undefined ? { thinkingBudget: r.budget_tokens } : r.toggle !== undefined ? { thinkingBudget: r.toggle ? -1 : 0 } : {}) } } };
  if (kind === "alibaba") return { alibaba: { ...(r.toggle !== undefined && r.effort === undefined ? { enableThinking: r.toggle } : {}), ...(r.budget_tokens !== undefined ? { thinkingBudget: r.budget_tokens } : {}) } };
  if (kind === "openrouter") return { openrouter: { reasoning: { ...(r.effort !== undefined ? { effort: r.effort } : {}), ...(r.budget_tokens !== undefined ? { max_tokens: r.budget_tokens } : {}), ...(r.toggle !== undefined ? { enabled: r.toggle } : {}) } } };
  if (kind === "perplexity") return { perplexity: { ...(r.effort !== undefined ? { reasoning: { effort: r.effort } } : {}) } };
  if (kind === "deepseek") return { deepseek: { ...(r.effort !== undefined ? { reasoningEffort: r.effort } : {}), ...(r.toggle !== undefined ? { thinking: { type: r.toggle ? "enabled" : "disabled" } } : {}) } };
  return { [kind === "compatible" ? target : kind]: { ...(r.effort !== undefined ? { reasoningEffort: r.effort } : {}) } };
}

export function validateReasoning(choices: ModelChoices, reasoning: Reasoning): void {
  for (const [key, value] of Object.entries(reasoning)) {
    const control = choices.controls.find(c => c.id === key);
    if (!control || (control.values ? !control.values.some(v => v.value === value) : typeof value !== "number" || !Number.isSafeInteger(value) || value < control.min! || value > control.max!)) throw new ModelError("Unsupported reasoning configuration");
  }
  const kind = transport(choices.target, choices.model);
  if (["openrouter", "google", "alibaba"].includes(kind) && reasoning.effort !== undefined && reasoning.budget_tokens !== undefined) throw new ModelError("Choose either effort or a thinking token budget, not both");
  if (reasoning.toggle === false && (reasoning.budget_tokens !== undefined || reasoning.effort !== undefined)) throw new ModelError("Thinking Off cannot be combined with effort or a token budget");
  if (kind === "anthropic" && ((reasoning.budget_tokens !== undefined && reasoning.thinking !== "enabled") || (reasoning.thinking === "enabled" && reasoning.budget_tokens === undefined))) throw new ModelError("Enabled Anthropic thinking requires a supported token budget; other thinking modes cannot use a budget");
  if (kind === "anthropic" && reasoning.thinking === "disabled" && ["max", "xhigh"].includes(String(reasoning.effort))) throw new ModelError("Use active thinking for max/xhigh effort; this integration can lower that effort when thinking is Off");
}

export function reasoningSettings(target: string, r: Reasoning, model: string): { reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" } {
  const effort = r.effort;
  if (transport(target, model) === "alibaba" && typeof effort === "string" && ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort)) return { reasoning: effort as "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" };
  return {};
}
