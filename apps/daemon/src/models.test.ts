import { describe, expect, test } from "vitest";
import { PROVIDER_REGISTRY } from "@mastra/core/llm";
import { modelsStatus } from "./models.js";
import type { Bot } from "./rooms.js";

const bot = (id: string, model: string, runtime: "api" | "acp" = "acp", config: unknown = null): Bot => ({ id, name: id, runtime, model, config });

describe("modelsStatus", () => {
  test("lists every installed Mastra provider and resolves alternate credential names", async () => {
    const status = await modelsStatus({ env: { GOOGLE_GENERATIVE_AI_API_KEY: "google-secret-1234" }, bots: [], fetch: async () => { throw new Error("offline"); } });
    for (const id of Object.keys(PROVIDER_REGISTRY)) expect(status.providers.some(p => p.id === id), id).toBe(true);
    expect(status.providers.find(p => p.id === "google")).toMatchObject({ set: true, last4: "1234" });
    expect(status.providers.find(p => p.id === "typesafe")).toBeDefined();
    expect(JSON.stringify(status)).not.toContain("google-secret");
  });
  test("reports keys as set with last 4 only, never the value", async () => {
    const key = "sk-ant-SECRETSECRET1234";
    const s = await modelsStatus({ env: { ANTHROPIC_API_KEY: key, OPENAI_API_KEY: "short" }, bots: [], fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
    expect(s.providers.find((p) => p.id === "anthropic")).toMatchObject({ set: true, last4: "1234" });
    expect(s.providers.find((p) => p.id === "openai")).toMatchObject({ set: true, last4: null });
    expect(s.providers.find((p) => p.id === "brave")).toMatchObject({ set: false, last4: null });
    expect(JSON.stringify(s)).not.toContain("SECRETSECRET");
  });

  test("assigns ACP bots to their adapter and detects the adapter package", async () => {
    const s = await modelsStatus({
      env: {},
      bots: [bot("boss", "claude-code"), bot("codex", "codex"), bot("researcher", "x", "acp", { adapter: "codex" }), bot("api1", "gpt", "api")],
      isInstalled: (p) => p.includes("claude"),
      fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch,
    });
    expect(s.clis.find((c) => c.id === "claude-code")).toMatchObject({ usedBy: ["boss"], adapterInstalled: true });
    expect(s.clis.find((c) => c.id === "codex")).toMatchObject({ usedBy: ["codex", "researcher"], adapterInstalled: false });
  });

  test("lists Ollama models when reachable and ignores credentialed URLs", async () => {
    let asked = "";
    const f = (async (u: string) => {
      asked = u;
      return new Response(JSON.stringify({ models: [{ name: "llama3" }, { name: 5 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const s = await modelsStatus({ env: { OPENAG_OLLAMA_URL: "http://user:pw@evil:1/" }, bots: [], fetch: f });
    expect(asked).toBe("http://127.0.0.1:11434/api/tags");
    expect(s.ollama).toMatchObject({ reachable: true, models: ["llama3"], embedModel: "nomic-embed-text", embedEnabled: true });
  });
});

test("provider credentials with nonstandard names never reach ACP children", async () => {
  const { withoutOwnerSecrets } = await import("./runtimes/acp.js");
  const env = { PATH: "/usr/bin", ABLIT_KEY: "synthetic-ablit-key", DIGITALOCEAN_ACCESS_TOKEN: "synthetic-do-token", GOOGLE_GENERATIVE_AI_API_KEY: "synthetic-google-key" };
  expect(withoutOwnerSecrets(env)).toEqual({ PATH: "/usr/bin" });
  expect(env.ABLIT_KEY).toBe("synthetic-ablit-key");
});

test("Netlify needs both its token and site id, rather than treating them as aliases", async () => {
  const fetch = async () => { throw new Error("offline"); };
  const incomplete = await modelsStatus({ env: { NETLIFY_SITE_ID: "synthetic-site-id" }, bots: [], fetch });
  expect(incomplete.providers.find(p => p.id === "netlify")).toMatchObject({ set: false, envMode: "all" });
  const complete = await modelsStatus({ env: { NETLIFY_TOKEN: "synthetic-netlify-token", NETLIFY_SITE_ID: "synthetic-site-id" }, bots: [], fetch });
  expect(complete.providers.find(p => p.id === "netlify")).toMatchObject({ set: true });
});
