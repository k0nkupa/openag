import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals } from "../approvals.js";
import { type Db, openDb } from "../db/index.js";
import { createLedger } from "../ledger.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "../rooms.js";
import { createVectorMemory, type Embedder } from "../vectors.js";
import { createRunner } from "./runner.js";
import { defaultTools } from "./tools.js";
import type { BotRuntime } from "./types.js";

let dir: string;
let db: Db;
const prompts: string[] = [];

const fake: BotRuntime = {
  async runTurn(ctx) {
    prompts.push(ctx.prompt);
    ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text: `answer about ${ctx.prompt.includes("kettle") ? "kettle" : "other"}` });
  },
};

const bow: Embedder = {
  model: "bow",
  async embed(texts) {
    return texts.map((t) => {
      const v = new Array<number>(16).fill(0);
      for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let h = 0;
        for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 1000003;
        v[h % 16] += 1;
      }
      if (v.every((x): boolean => x === 0)) v[0] = 1; // explicit boolean: no inferred `x is 0` predicate narrowing `v` to 0[]
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      return v.map((x) => x / n);
    });
  },
};

const failing: Embedder = {
  model: "bow",
  async embed() {
    throw new Error("embedding failed: unreachable");
  },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-runner-vectors-"));
  db = openDb(dir);
  prompts.length = 0;
  // Prompt recall is injected for ACP bots (API bots load it through ctx.loadHostedRecall).
  createBot(db, { id: "boss", runtime: "acp" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function setup(embedder: Embedder) {
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  const vectors = createVectorMemory({ db, embedder });
  const runner = createRunner({
    db,
    ledger,
    approvals,
    dataDir: dir,
    runtimes: { api: fake, acp: fake },
    tools: defaultTools,
    vectors,
  });
  const say = (text: string) => {
    const message = ledger.append("main", "user", "message", { text });
    return runner.run(getRoom(db, "main")!, getBot(db, "boss")!, message);
  };
  return { runner, say };
}

describe("runner vector memory", () => {
  test("a finished turn is indexed and embedded, and the next prompt recalls it", async () => {
    const { runner, say } = setup(bow);
    await say("how do I descale the kettle");
    await runner.idle();

    const chunks = db.prepare("SELECT source, embedding_model FROM memory_chunks").all() as { source: string; embedding_model: string | null }[];
    expect(chunks.some((c) => c.source === "thread" && c.embedding_model === "bow")).toBe(true);

    await say("kettle descale steps again");
    await runner.idle();
    expect(prompts[1]).toContain("Possibly relevant notes recalled from earlier");
    expect(prompts[1]).toContain("descale the kettle");
  });

  test("an always-failing embedder: turns succeed and prompts have no recall section", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runner, say } = setup(failing);
    await say("how do I descale the kettle");
    await say("kettle again");
    await runner.idle();
    const statuses = db.prepare("SELECT status FROM turns ORDER BY created_at, rowid").all() as { status: string }[];
    expect(statuses.map((s) => s.status)).toEqual(["finished", "finished"]);
    expect(prompts.every((p) => !p.includes("recalled from earlier"))).toBe(true);
  });
});
