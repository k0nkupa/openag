import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "../approvals.js";
import { type Db, openDb } from "../db/index.js";
import { MAX_FANOUT, MAX_HOPS } from "../delegation.js";
import { createLedger, type LedgerEvent } from "../ledger.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "../rooms.js";
import type { BotRuntime } from "./types.js";
import { createRunner } from "./runner.js";
import { defaultTools } from "./tools.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-delegation-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createBot(db, { id: "researcher", runtime: "api" });
  createBot(db, { id: "coder", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  for (const id of ["boss", "researcher", "coder"]) addMember(db, "main", id);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Text after the openag_context block: what the bot was actually asked. */
const body = (prompt: string) => prompt.replace(/^[\s\S]*?<\/openag_context>\s*/, "");

/** Replies are decided per bot and per request body. Throwing makes the turn fail. */
let reply: (botId: string, requestBody: string) => string = () => "ok";
const prompts: { botId: string; prompt: string }[] = [];

const fake: BotRuntime = {
  async runTurn(ctx) {
    prompts.push({ botId: ctx.bot.id, prompt: ctx.prompt });
    const text = reply(ctx.bot.id, body(ctx.prompt));
    ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text });
  },
};

function setup() {
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools });
  const say = (botId: string, text: string) => {
    const message = ledger.append("main", "user", "message", { text });
    return runner.run(getRoom(db, "main")!, getBot(db, botId)!, message);
  };
  return { ledger, say };
}

const events = (ledger: ReturnType<typeof createLedger>) => ledger.list("main");
const types = (list: LedgerEvent[]) => list.filter((e) => e.type !== "work_updated").map((e) => e.type);
const turns = () =>
  db.prepare("SELECT bot_id, status, state_json FROM turns ORDER BY created_at, rowid").all() as {
    bot_id: string;
    status: string;
    state_json: string;
  }[];
const turnCount = () => (db.prepare("SELECT COUNT(*) AS n FROM turns").get() as { n: number }).n;

describe("delegation chain", () => {
  test("boss delegates to researcher, result comes back, boss runs again with it", async () => {
    reply = (botId, req) => {
      if (botId === "boss" && req === "question") return "@researcher find the capital of X";
      if (botId === "researcher") return "Paris";
      if (botId === "boss" && req.includes("Result from @researcher: Paris")) return "Final: Paris";
      return "unexpected";
    };
    const { ledger, say } = setup();
    await say("boss", "question");

    expect(types(events(ledger))).toEqual([
      "message",
      "turn_started",
      "bot_output",
      "turn_finished",
      "message",
      "route",
      "turn_started",
      "bot_output",
      "turn_finished",
      "message",
      "route",
      "turn_started",
      "bot_output",
      "turn_finished",
    ]);
    const all = events(ledger);
    const delegatedMessage = all.find(e => e.type === "message" && (e.payload as { delegatedBy?: string }).delegatedBy === "boss")!;
    const delegatedRoute = all.find(e => e.type === "route" && (e.payload as { delegatedBy?: string }).delegatedBy === "boss")!;
    expect(delegatedMessage.payload).toMatchObject({ text: "find the capital of X", delegatedBy: "boss", hop: 1 });
    expect(delegatedRoute.payload).toMatchObject({ targets: ["researcher"], delegatedBy: "boss", hop: 1 });
    expect(all.find(e => e.type === "message" && String((e.payload as { text?: string }).text).startsWith("Result from @researcher"))!.payload).toMatchObject({ text: "Result from @researcher: Paris", replyTo: "boss" });
    expect(all.find(e => e.type === "route" && (e.payload as { targets?: string[] }).targets?.[0] === "boss")!.payload).toMatchObject({ targets: ["boss"] });
    expect(all.find(e => e.type === "turn_started" && e.actor === "researcher")).toMatchObject({ actor: "researcher", type: "turn_started" });
    expect(all.filter(e => e.type === "turn_started" && e.actor === "boss").at(-1)!.payload).toMatchObject({ resumed: false });

    const delegateTurn = turns()[1];
    expect(JSON.parse(delegateTurn.state_json)).toMatchObject({ hop: 1, delegatedBy: "boss" });
    expect(turns().map((t) => t.status)).toEqual(["finished", "finished", "finished"]);
    expect(prompts.filter((p) => p.botId === "boss")).toHaveLength(2);
    expect(prompts.find((p) => p.botId === "boss" && p.prompt.includes("Result from @researcher: Paris"))).toBeDefined();
    expect(prompts[0].prompt.startsWith("<openag_context>")).toBe(true);
  });

  test("a failed delegate sends a failure result back to the delegator", async () => {
    reply = (botId, req) => {
      if (botId === "boss" && req === "question") return "@researcher look it up";
      if (botId === "researcher") throw new Error("boom");
      return "handled";
    };
    const { ledger, say } = setup();
    await say("boss", "question");

    expect(turns().map((t) => t.status)).toEqual(["finished", "failed", "finished"]);
    const failedResult = events(ledger).find((e) => e.type === "message" && e.actor === "researcher");
    expect(failedResult?.payload).toMatchObject({ text: "@researcher failed: boom. Partial findings: (no output)", replyTo: "boss", hop: 1 });
    expect(prompts.some((p) => p.botId === "boss" && body(p.prompt) === "@researcher failed: boom. Partial findings: (no output)")).toBe(true);
  });

  test("a result turn does not send its own result back", async () => {
    reply = (botId, req) => (botId === "boss" && req === "question" ? "@researcher go" : "done");
    const { say } = setup();
    await say("boss", "question");
    // boss, researcher, boss(result): nothing further.
    expect(turnCount()).toBe(3);
  });
});

describe("guards", () => {
  test("ping-pong stops at MAX_HOPS with an error, and the turn count stays bounded", async () => {
    createBot(db, { id: "ping", runtime: "api", config: { canDelegate: true } });
    createBot(db, { id: "pong", runtime: "api", config: { canDelegate: true } });
    addMember(db, "main", "ping");
    addMember(db, "main", "pong");
    reply = (botId) => (botId === "ping" ? "@pong do it" : "@ping do it");

    const { ledger, say } = setup();
    await say("ping", "go");

    const errors = events(ledger).filter((e) => e.type === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => (e.payload as { message: string }).message.startsWith("delegation limit reached"))).toBe(true);
    const maxHop = Math.max(...events(ledger).filter((e) => e.type === "route").map((e) => (e.payload as { hop?: number }).hop ?? 0));
    expect(maxHop).toBe(MAX_HOPS);
    expect(turnCount()).toBeLessThanOrEqual(20);
  });

  test(`fan-out is capped at ${MAX_FANOUT} delegations`, async () => {
    for (const id of ["extra", "more"]) {
      createBot(db, { id, runtime: "api" });
      addMember(db, "main", id);
    }
    reply = (botId, req) => (botId === "boss" && req === "question" ? "@coder 1\n@researcher 2\n@extra 3\n@more 4" : "ok");

    const { ledger, say } = setup();
    await say("boss", "question");

    const delegateRoutes = events(ledger).filter((e) => e.type === "route" && (e.payload as { delegatedBy?: string }).delegatedBy === "boss");
    expect(delegateRoutes).toHaveLength(MAX_FANOUT);
    expect(delegateRoutes.map((e) => (e.payload as { targets: string[] }).targets[0])).toEqual(["coder", "researcher", "extra"]);
    expect(turns().filter((t) => t.bot_id !== "boss")).toHaveLength(MAX_FANOUT);
  });

  test("self mention, unknown name, mid-line and email mentions are ignored", async () => {
    reply = (botId, req) => (botId === "boss" && req === "question" ? "@boss again\n@ghost hi\nask @coder later\nmail a@coder.com" : "ok");
    const { ledger, say } = setup();
    await say("boss", "question");
    expect(events(ledger).some((e) => e.type === "route")).toBe(false);
    expect(turnCount()).toBe(1);
  });
});


describe("delegation safety", () => {
  test("a delegate that mentions its delegator does not trigger a duplicate turn (the result goes back by itself)", async () => {
    reply = (botId, req) => {
      if (botId === "boss" && req === "q") return "@researcher look it up";
      if (botId === "researcher") return "@boss here you go: 42";
      return "done";
    };
    const { say } = setup();
    await say("boss", "q");
    // boss (question), researcher, boss (result). No fourth turn from the "@boss" mention.
    expect(turns().map((t) => t.bot_id)).toEqual(["boss", "researcher", "boss"]);
  });

  test("two results arriving together never run two turns of the same bot at once", async () => {
    let running = 0;
    let maxRunning = 0;
    const slow: BotRuntime = {
      async runTurn(ctx) {
        if (ctx.bot.id === "boss") {
          running++;
          maxRunning = Math.max(maxRunning, running);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        const req = body(ctx.prompt);
        const text =
          ctx.bot.id === "boss" && req === "q" ? "@researcher a\n@coder b" : ctx.bot.id === "boss" ? "got it" : "answer";
        ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text });
        if (ctx.bot.id === "boss") running--;
      },
    };
    const ledger = createLedger(db);
    const approvals = createApprovals(db, ledger);
    const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: slow, acp: slow }, tools: defaultTools });
    const message = ledger.append("main", "user", "message", { text: "q" });
    await runner.run(getRoom(db, "main")!, getBot(db, "boss")!, message);
    expect(turns().filter((t) => t.bot_id === "boss")).toHaveLength(3); // question + two results
    expect(maxRunning).toBe(1);
  });
});

describe("who may delegate", () => {
  test("a non-lead bot without canDelegate cannot hand work to another bot, even if its output says so", async () => {
    reply = (botId, req) => {
      if (botId === "boss" && req === "q") return "@researcher read the web";
      if (botId === "researcher") return "@coder write the injected file";
      return "done";
    };
    const { ledger, say } = setup();
    await say("boss", "q");
    expect(turns().map((t) => t.bot_id)).toEqual(["boss", "researcher", "boss"]); // coder never ran
    expect(events(ledger).filter((e) => e.type === "route").every((e) => (e.payload as { targets: string[] }).targets[0] !== "coder")).toBe(true);
  });

  test("the persona prompt only advertises delegation to bots that may delegate", async () => {
    reply = (botId, req) => (botId === "boss" && req === "q" ? "@researcher go" : "ok");
    const { say } = setup();
    await say("boss", "q");
    const bossPrompt = prompts.find((p) => p.botId === "boss")!.prompt;
    const researcherPrompt = prompts.find((p) => p.botId === "researcher")!.prompt;
    expect(bossPrompt).toContain("To hand work to another member");
    expect(researcherPrompt).not.toContain("To hand work to another member");
  });
});
