import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db/index.js";
import { getDefaultRedactor } from "./redact.js";
import { modelIdentity, ModelError, type ModelChoices } from "./hostedmodels.js";

import { capabilitySchema, type ModelTask, type ModelCapabilities } from "./model-capabilities.js";

// Ollama's omitted tag means :latest; never rewrite the saved target itself.
const modelKey = (id: string) => id.startsWith("ollama/") && !id.includes("@") && id.lastIndexOf(":") < id.lastIndexOf("/") ? `${id}:latest` : id;
const sameModel = (a: string, b: string) => modelKey(a) === modelKey(b);

const DAY = 24 * 60 * 60 * 1000;
const control = z.object({ id: z.string().max(80), name: z.string().max(200), values: z.array(z.object({ value: z.union([z.string().max(80), z.boolean()]), name: z.string().max(200) })).max(100).optional(), min: z.number().int().optional(), max: z.number().int().optional() });
const modelRows = z.array(z.object({ id: modelIdentity, name: z.string().max(200) })).max(2000);
const catalogueSchema = z.object({ capabilityVersion: z.literal(1).optional(), models: modelRows, choices: z.array(z.object({ target: modelIdentity, model: modelIdentity, capabilities: capabilitySchema.optional(), controls: z.array(control).max(30), reason: z.string().max(2000).nullable(), source: z.string().max(500), outputLimit: z.number().int().positive().optional() })).max(2000) });
interface Row { target: string; source_key: string; generation: string; choices_json: string; refreshed_at: number; attempted_at: number; error: string | null }
export interface CatalogueTarget { id: string; name: string; configured?: boolean }

/** Only refresh calls external discovery. All reads and save validation use persisted metadata. */
export function createModelCatalogue(deps: { db: Db; targets(): CatalogueTarget[]; sourceKey(target: string): string; load(target: string, signal: AbortSignal): Promise<ModelChoices[]>; now?: () => number; prepare?(): void }) {
  const clock = deps.now ?? Date.now;
  const pending = new Map<string, Promise<void>>();
  const errors = new Map<string, string>();
  const attempted = new Map<string, number>();
  let closed = false;
  let refreshing: Promise<void> | undefined;
  const rowOf = (target: string) => deps.db.prepare("SELECT * FROM model_catalogue WHERE target=? AND source_key=?").get(target, deps.sourceKey(target)) as Row | undefined;
  const token = (row: Row, model: string) => createHash("sha256").update(JSON.stringify([row.target, row.generation, model])).digest("hex");
  function read(target: string, model?: string, task: ModelTask = "chat") {
    if (!deps.targets().some(t => t.id === target && t.configured !== false)) throw new ModelError("Model source is not configured", 503);
    const row = rowOf(target);
    if (!row?.refreshed_at) throw new ModelError("No cached models for this source. Use Refresh models in Settings.", 503);
    const data = catalogueSchema.parse(JSON.parse(row.choices_json));
    const choices = data.choices.filter(c => c.capabilities ? c.capabilities[task] === true : task === "chat");
    const found = model ? choices.find(c => sameModel(c.model, model)) : choices[0];
    if (!found) throw new ModelError("The selected model is absent from the cached catalogue. Refresh models and review your selection.", 409);
    return { ...found, models: data.models.filter(m => choices.some(c => c.model === m.id)), snapshotId: token(row, found.model), refreshedAt: row.refreshed_at, refreshError: row.error };
  }
  async function refresh(target: string) {
    if (closed) return;
    const active = pending.get(target);
    if (active) return active;
    const job = (async () => {
      const sourceKey = deps.sourceKey(target);
      attempted.set(target, clock());
      try {
        const found = await deps.load(target, AbortSignal.timeout(90_000));
        const data = catalogueSchema.parse(getDefaultRedactor().redact({ capabilityVersion: 1, models: found[0]?.models ?? [], choices: found.map(({ models, ...c }) => c) }));
        if (data.choices.some(c => c.target !== target || !data.models.some(m => m.id === c.model))) throw new Error("Invalid catalogue");
        const encoded = JSON.stringify(data);
        if (Buffer.byteLength(encoded) > 16_000_000) throw new Error("Catalogue too large");
        if (closed || deps.sourceKey(target) !== sourceKey) return;
        deps.db.prepare("INSERT INTO model_catalogue VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(target) DO UPDATE SET source_key=excluded.source_key, generation=excluded.generation, choices_json=excluded.choices_json, refreshed_at=excluded.refreshed_at, attempted_at=excluded.attempted_at, error=NULL").run(target, sourceKey, randomUUID(), encoded, clock(), clock());
        errors.delete(target);
      } catch (error) {
        if (closed) return;
        const reason = error instanceof ModelError ? error.message : error instanceof z.ZodError ? `Invalid catalogue metadata (${error.issues.slice(0, 3).map(i => i.path.join(".")).join(", ")})` : "Source discovery failed";
        const message = getDefaultRedactor().redactString(`${reason}. Last successful models are retained; check source setup and try Refresh models.`);
        errors.set(target, message);
        try { deps.db.prepare("INSERT INTO model_catalogue VALUES(?,?,?,?,0,?,?) ON CONFLICT(target) DO UPDATE SET choices_json=CASE WHEN source_key=excluded.source_key THEN choices_json ELSE excluded.choices_json END, refreshed_at=CASE WHEN source_key=excluded.source_key THEN refreshed_at ELSE 0 END, source_key=excluded.source_key, attempted_at=excluded.attempted_at,error=excluded.error").run(target, sourceKey, randomUUID(), "[]", clock(), message); }
        catch { console.error("model catalogue refresh status could not be persisted; last successful metadata retained"); }
      }
    })().finally(() => pending.delete(target));
    pending.set(target, job);
    return job;
  }
  return {
    read,
    contains(model: string): boolean | undefined {
      const row = rowOf(model.slice(0, model.indexOf("/")));
      if (!row?.refreshed_at) return undefined;
      const data = catalogueSchema.parse(JSON.parse(row.choices_json));
      if (!data.capabilityVersion) return undefined;
      return data.choices.some(c => sameModel(c.model, model));
    },
    capabilities(model: string): ModelCapabilities | undefined {
      const target = model.slice(0, model.indexOf("/"));
      const row = rowOf(target);
      if (!row?.refreshed_at) return undefined;
      return catalogueSchema.parse(JSON.parse(row.choices_json)).choices.find(c => sameModel(c.model, model))?.capabilities;
    },
    resolve(snapshotId: string, model: string, task: ModelTask = "chat") {
      for (const target of deps.targets().filter(t => t.configured !== false)) {
        try {
          const choice = read(target.id, model, task);
          if (choice.snapshotId === snapshotId) return choice;
        } catch (error) { if (!(error instanceof ModelError)) throw error; }
      }
      throw new ModelError("Cached model choices changed. Review your selection before saving.", 409);
    },
    status() { return { sources: deps.targets().map(t => { const row = rowOf(t.id); return { ...t, generation: row?.generation ?? null, refreshedAt: row?.refreshed_at || null, attemptedAt: row?.attempted_at || null, error: errors.get(t.id) ?? row?.error ?? null, refreshing: pending.has(t.id) }; }) }; },
    async refresh(dueOnly = false) {
      if (!refreshing) refreshing = (async () => {
        deps.prepare?.();
        for (const target of deps.targets().filter(t => t.configured !== false)) {
          if (closed) break;
          const last = Math.max(rowOf(target.id)?.attempted_at ?? 0, attempted.get(target.id) ?? 0);
          const row = rowOf(target.id);
          const upgrade = row?.refreshed_at && !catalogueSchema.parse(JSON.parse(row.choices_json)).capabilityVersion;
          if (!dueOnly || upgrade || !last || clock() - last >= DAY) await refresh(target.id);
        }
      })();
      const job = refreshing;
      try { await job; } finally { if (refreshing === job) refreshing = undefined; }
      return this.status();
    },
    async close() { closed = true; await Promise.allSettled(pending.values()); },
  };
}
export type ModelCatalogue = ReturnType<typeof createModelCatalogue>;
