import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createBotModels, providerOptions, modelOverride } from "./botmodels.js";
import { openDb, type Db } from "./db/index.js";
import { createLedger } from "./ledger.js";
import { PROVIDER_REGISTRY } from "@mastra/core/llm";
import { createBot, getBot } from "./rooms.js";
const chat = { type: "chat", modalities: { input: ["text"], output: ["text"] }, api: { "chat-completions": {}, "generate-content": {}, responses: {}, messages: {} } };
const feed = Object.fromEntries(Object.entries(PROVIDER_REGISTRY).map(([id, provider]) => [id, { models: Object.fromEntries(provider.models.map(model => [model, chat])) }]));
const metadata = async () => Response.json(feed);
let dir: string, db: Db;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "openag-model-provider-")); db = openDb(dir); createBot(db, { id: "bot", runtime: "api", model: "openai/gpt-5" }); });
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
test("choose Google, save catalogue-supported thinking, and map it to the transport", async () => {
  const models = createBotModels({ db, ledger: createLedger(db), env: { GOOGLE_API_KEY: "synthetic-google-key" }, withIdleBot: async (_id, fn) => fn(), acp: { discover: async () => { throw Error("not ACP"); }, stopBot: async () => {} }, fetch: metadata });
  await models.catalogue.refresh();
  const choices = await models.discover("bot", { target: "google", model: "google/gemini-2.5-pro" });
  expect(choices.controls.find(c => c.id === "budget_tokens")).toMatchObject({ min: 128, max: 32768 });
  await expect(models.save("bot", { revision: choices.revision, snapshotId: choices.snapshotId, model: choices.model, reasoning: { budget_tokens: 32769 } })).rejects.toThrow("Unsupported reasoning");
  await models.save("bot", { revision: choices.revision, snapshotId: choices.snapshotId, model: choices.model, reasoning: { budget_tokens: 2048 } });
  expect(models.read("bot")).toMatchObject({ target: "google", model: "google/gemini-2.5-pro", reasoning: { budget_tokens: 2048 } });
  expect(providerOptions(getBot(db, "bot")!)).toEqual({ google: { thinkingConfig: { thinkingBudget: 2048 } } });
  expect(modelOverride(getBot(db, "bot")!, { OPENAG_BOT_MODEL: "google/gemini-2.5-pro" })).toBe("google/gemini-2.5-pro");
});
test("reject unknown and prototype provider names", async () => {
  const models = createBotModels({ db, ledger: createLedger(db), env: {}, withIdleBot: async (_id, fn) => fn(), acp: { discover: async () => { throw Error(); }, stopBot: async () => {} } });
  for (const target of ["constructor", "__proto__", "not-a-provider"]) await expect(models.discover("bot", { target })).rejects.toThrow("supported target");
});

test("every Mastra provider can be selected without an application allow-list", async () => {
  const { PROVIDER_REGISTRY } = await import("@mastra/core/llm");
  for (const [id, provider] of Object.entries(PROVIDER_REGISTRY)) {
    if (["openai", "anthropic", "openrouter"].includes(id)) continue;
    const env = Object.fromEntries((Array.isArray(provider.apiKeyEnvVar) ? provider.apiKeyEnvVar : [provider.apiKeyEnvVar]).map(name => [name, "synthetic-catalogue-key"]));
    const models = createBotModels({ db, ledger: createLedger(db), env, withIdleBot: async (_id, fn) => fn(), acp: { discover: async () => { throw Error(); }, stopBot: async () => {} }, fetch: metadata });
    if (!provider.models.length) continue;
    await models.catalogue.refresh();
    const choice = await models.discover("bot", { target: id });
    await models.save("bot", { revision: choice.revision, snapshotId: choice.snapshotId, model: choice.model, reasoning: {} });
    expect(models.read("bot").target, id).toBe(id);
    expect(modelOverride(getBot(db, "bot")!, { OPENAG_BOT_MODEL: choice.model }), id).toBe(choice.model);
    expect(choice.source).toContain("account access and inference not checked");
  }
  // One full catalogue refresh per provider (~16s alone), so it needs headroom when the desk suite runs in parallel.
}, 120_000);

test("chat discovery follows reported capability and protocol rather than names", async () => {
  const reported = { google: { models: { "voice-in-the-name": chat, "ordinary-name": { type: "video", api: { video: {} } } } } };
  const models = createBotModels({ db, ledger: createLedger(db), env: { GOOGLE_API_KEY: "synthetic-google-key" }, withIdleBot: async (_id, fn) => fn(), acp: { discover: async () => { throw Error(); }, stopBot: async () => {} }, fetch: async () => Response.json(reported) });
  await models.catalogue.refresh();
  const choices = await models.discover("bot", { target: "google" });
  expect(choices.models.map(m => m.id)).toEqual(["google/voice-in-the-name"]);
});
