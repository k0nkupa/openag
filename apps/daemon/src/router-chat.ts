import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { Agent, type AgentExecutionOptionsBase } from "@mastra/core/agent";
import { reasoningOptions, reasoningSettings } from "./hostedmodels.js";
import { modelProviders, registeredProvider } from "./providers.js";
import type { RoutingConfig } from "./router.js";

const DEADLINE_MS = 6_000;
const MAX_BYTES = 64 * 1024;
// Native adapters supply these URLs internally; other endpoints come from Mastra's catalogue.
const NATIVE_ORIGINS: Record<string, string> = {
  openai: "https://api.openai.com", anthropic: "https://api.anthropic.com", google: "https://generativelanguage.googleapis.com",
  xai: "https://api.x.ai", perplexity: "https://api.perplexity.ai", cerebras: "https://api.cerebras.ai", deepinfra: "https://api.deepinfra.com", togetherai: "https://api.together.xyz", vercel: "https://ai-gateway.vercel.sh", netlify: "https://api.netlify.com",
};

function tenantValue(name: string, value: string | undefined): string {
  if (!value) throw new Error("routing endpoint configuration is missing");
  if (name === "DATABRICKS_HOST" && /^[a-z0-9.-]+\.(?:databricks\.com|azuredatabricks\.net|databricks\.azure\.us)$/i.test(value)) return value;
  if (name === "NEON_AI_GATEWAY_BASE_URL") {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname.endsWith(".neon.tech") && !url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash) return value.replace(/\/$/, "");
  }
  if (name === "SNOWFLAKE_ACCOUNT" && /^[a-z0-9][a-z0-9.-]{0,200}$/i.test(value)) return value;
  if (["INFOMANIAK_PRODUCT_ID", "CLOUDFLARE_ACCOUNT_ID"].includes(name) && /^[a-z0-9_-]{1,100}$/i.test(value)) return value;
  throw new Error("routing endpoint configuration is invalid");
}

export function routingOrigin(config: Pick<RoutingConfig, "provider" | "model">, env: NodeJS.ProcessEnv): string {
  const provider = registeredProvider(config.provider);
  if (!provider) throw new Error("routing provider unavailable");
  const model = config.model.slice(config.provider.length + 1);
  const template = provider.modelOverrides?.[model]?.api ?? provider.url;
  const endpoint = template?.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
    return tenantValue(name, env[name]);
  }) ?? NATIVE_ORIGINS[config.provider];
  if (!endpoint) throw new Error("routing endpoint unavailable");
  const expected = new URL(endpoint);
  if (expected.username || expected.password) throw new Error("routing endpoint unavailable");
  const override = env[config.provider.toUpperCase().replace(/-/g, "_") + "_BASE_URL"];
  const selected = override ? new URL(override) : expected;
  const loopback = ["127.0.0.1", "localhost"].includes(expected.hostname);
  if (selected.username || selected.password || selected.protocol !== expected.protocol || selected.hostname !== expected.hostname || !loopback && selected.port !== expected.port) throw new Error("routing endpoint unavailable");
  const origin = selected.origin;
  if (!(selected.protocol === "https:" || selected.protocol === "http:" && loopback)) throw new Error("routing endpoint unavailable");
  return origin;
}

/** The SDK fetch override is local to this worker, never shared with bot turns or the daemon. */
export function routeWithChat(config: RoutingConfig, prompt: string, env: NodeJS.ProcessEnv): Promise<string> {
  const provider = registeredProvider(config.provider);
  if (!provider) return Promise.reject(new Error("routing provider unavailable"));
  const childEnv: NodeJS.ProcessEnv = { MASTRA_OFFLINE: "1" };
  const endpointNames = [config.provider.toUpperCase().replace(/-/g, "_") + "_BASE_URL", ...[provider.url, ...Object.values(provider.modelOverrides ?? {}).map(o => o.api)].flatMap(url => [...(url ?? "").matchAll(/\$\{([A-Z0-9_]+)\}/g)].map(m => m[1]!))];
  for (const name of ["PATH", "HOME", "LANG", "TMPDIR", ...endpointNames, ...(modelProviders().find(p => p.id === config.provider)?.envVars ?? [])]) if (env[name] !== undefined) childEnv[name] = env[name];
  const origin = routingOrigin(config, childEnv);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./router-chat.js", import.meta.url), { workerData: { config, prompt, origin }, env: childEnv, stdout: true, stderr: true });
    worker.stdout.resume(); worker.stderr.resume();
    const timer = setTimeout(() => finish(new Error("routing request timed out")), DEADLINE_MS);
    let settled = false;
    function finish(error?: Error, text?: string) {
      if (settled) return;
      settled = true; clearTimeout(timer); void worker.terminate().catch(() => undefined);
      if (error) reject(error); else resolve(text!);
    }
    worker.once("error", () => finish(new Error("routing request failed")));
    worker.once("exit", () => finish(new Error("routing worker stopped")));
    worker.once("message", (result: unknown) => typeof result === "string" && result.length <= 1024 ? finish(undefined, result) : finish(new Error("routing request failed")));
  });
}

if (!isMainThread && parentPort) {
  const { config, prompt, origin } = workerData as { config: RoutingConfig; prompt: string; origin: string };
  const originalFetch = globalThis.fetch;
  let gatewayOrigin: string | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const bootstrap = config.provider === "netlify" && url.origin === "https://api.netlify.com";
    if (bootstrap && (url.pathname !== `/api/v1/sites/${process.env.NETLIFY_SITE_ID}/ai-gateway/token` || init?.method && init.method !== "GET")) throw new Error("routing endpoint refused");
    if (url.origin !== origin && url.origin !== gatewayOrigin) throw new Error("routing endpoint refused");
    const response = await originalFetch(input, { ...init, redirect: "error" });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) throw new Error("routing response too large");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = Buffer.concat(chunks);
    if (bootstrap && response.ok) {
      const endpoint = new URL(JSON.parse(bytes.toString("utf8")).url);
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hostname !== "ai-gateway.netlify.com") throw new Error("routing gateway refused");
      gatewayOrigin = endpoint.origin;
    }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  void (async () => {
    try {
      const budget = config.reasoning.budget_tokens;
      const output = typeof budget === "number" ? Math.min(config.outputLimit ?? budget + 1024, budget + 1024) : 1024;
      const maxOutputTokens = typeof budget === "number" && config.provider === "anthropic" ? Math.min(1024, output - budget) : output;
      const agent = new Agent({ id: "room-router", name: "Room router", instructions: "Choose a room member. You have no tools.", model: config.model as ConstructorParameters<typeof Agent>[0]["model"] });
      const answer = await agent.generate(prompt, { maxSteps: 1, abortSignal: AbortSignal.timeout(DEADLINE_MS), modelSettings: { ...reasoningSettings(config.provider, config.reasoning, config.model), maxOutputTokens, maxRetries: 0 }, providerOptions: reasoningOptions(config.provider, config.reasoning, config.model) as AgentExecutionOptionsBase<unknown>["providerOptions"] });
      parentPort!.postMessage(answer.text.length <= 1024 ? answer.text : null);
    } catch { parentPort!.postMessage(null); }
  })();
}
