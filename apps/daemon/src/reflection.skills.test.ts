import { resolveReviewed } from "./approvals.testkit.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals, type Approvals } from "./approvals.js";
import { commitMemory, ensureDataRepo } from "./datagit.js";
import { type Db, openDb } from "./db/index.js";
import { createLedger, type Ledger } from "./ledger.js";
import { ensureMemoryFile } from "./memory.js";
import { createReflectionApplier } from "./reflection-apply.js";
import { REFLECTION_SKILL_TOOL } from "./reflection-schema.js";
import { registerReflection, type Reflection } from "./reflection.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { createScheduler } from "./scheduler.js";
import { saveSkill } from "./skills.js";
import { setSetting } from "./settings.js";
import type { BotRuntime, TurnContext } from "./runtimes/types.js";
import { createRunner } from "./runtimes/runner.js";
import { defaultTools } from "./runtimes/tools.js";

let dir: string;
let db: Db;
let ledger: Ledger;
let approvals: Approvals;
let turnHook: (ctx: TurnContext) => void;
const saved = { ...process.env };

const payload = { slug: "weekly-review", name: "Weekly review", description: "Review the week", body: "1. List wins" };
const skillFile = (slug = "weekly-review") => join(dir, "bots", "boss", "skills", slug, "SKILL.md");
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const commitCount = () => Number(git("rev-list", "--count", "HEAD"));
const errorEvents = () =>
  db.prepare("SELECT payload_json FROM events WHERE type = 'error'").all() as { payload_json: string }[];
const propose = (toolName: string, body: unknown) =>
  approvals.request({ roomId: "main", botId: "boss", turnId: null, toolName, toolClass: "act-local", payload: body }).approvalId;

/** The applier wired exactly as main.ts does it. */
function applier() {
  return createReflectionApplier({
    ledger,
    approvals,
    dataDir: dir,
    saveSkill: async (botId, skill) => {
      saveSkill(dir, botId, skill);
      await commitMemory(dir, `skills: reflection apply ${skill.slug} (${botId})`);
    },
  });
}

const fake: BotRuntime = {
  async runTurn(ctx) {
    turnHook(ctx);
  },
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "openag-refl-skills-"));
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  ledger = createLedger(db);
  approvals = createApprovals(db, ledger);
  await ensureDataRepo(dir);
  // MEMORY.md committed first so the skill commits hold only the skill file.
  ensureMemoryFile(dir, { id: "boss", name: "boss" });
  await commitMemory(dir, "init memory");
  turnHook = () => undefined;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("reflection_skill apply", () => {
  test("accepted proposal creates SKILL.md with exactly one openagd commit", async () => {
    const a = applier();
    const before = commitCount();
    const id = propose(REFLECTION_SKILL_TOOL, payload);
    resolveReviewed(approvals, id, { kind: "accept" });
    await a.idle();
    a.dispose();
    expect(readFileSync(skillFile(), "utf8")).toContain("name: Weekly review");
    expect(commitCount()).toBe(before + 1);
    const sha = git("rev-parse", "HEAD");
    expect(git("show", "--name-only", "--format=%an %s", sha).split("\n").filter(Boolean)).toEqual([
      "openagd skills: reflection apply weekly-review (boss)",
      "bots/boss/skills/weekly-review/SKILL.md",
    ]);
  });

  test("ignored proposal creates nothing", async () => {
    const a = applier();
    const before = commitCount();
    resolveReviewed(approvals, propose(REFLECTION_SKILL_TOOL, payload), { kind: "ignore" });
    await a.idle();
    a.dispose();
    expect(existsSync(skillFile())).toBe(false);
    expect(commitCount()).toBe(before);
  });

  test("an edited payload with a bad slug is refused before applying and writes nothing", async () => {
    const a = applier();
    const before = commitCount();
    const id = propose(REFLECTION_SKILL_TOOL, payload);
    expect(() => resolveReviewed(approvals, id, { kind: "edit", payload: { ...payload, slug: "../../escape" } })).toThrow();
    expect(approvals.get(id)?.status).toBe("pending");
    await a.idle();
    a.dispose();
    expect(existsSync(join(dir, "bots", "boss", "escape"))).toBe(false);
    expect(existsSync(skillFile())).toBe(false);
    expect(commitCount()).toBe(before);
    expect(errorEvents()).toHaveLength(0);
  });

  test("a SkillError from the writer is recorded as an error event, not half-applied", async () => {
    const a = createReflectionApplier({
      ledger,
      approvals,
      dataDir: dir,
      saveSkill: async (botId, skill) => {
        saveSkill(dir, botId, { ...skill, body: "" });
      },
    });
    resolveReviewed(approvals, propose(REFLECTION_SKILL_TOOL, payload), { kind: "accept" });
    await a.idle();
    a.dispose();
    expect(existsSync(skillFile())).toBe(false);
    expect(errorEvents().length).toBeGreaterThan(0);
  });
});

describe("reflection run proposes skills only when skillsEnabled", () => {
  function register(skillsEnabled: boolean): Reflection {
    const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools });
    setSetting(db, "reflection", { enabled: true, time: "03:30", botId: "boss", lookbackHours: 24, maxMemoryProposals: 5, maxSkillProposals: 3 });
    return registerReflection({
      db,
      ledger,
      approvals,
      runner,
      scheduler: createScheduler({ now: () => new Date("2026-10-28T03:30:00Z") }),
      tz: "UTC",
      dataDir: dir,
      skillsEnabled,
    });
  }
  const reply = (ctx: TurnContext) =>
    ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", {
      turnId: ctx.turnId, text: JSON.stringify({ proposals: [{ kind: "skill", ...payload }] }),
    });
  const pendingSkills = () =>
    db.prepare("SELECT tool_name, status FROM approvals WHERE tool_name = ?").all(REFLECTION_SKILL_TOOL) as { tool_name: string; status: string }[];

  test("a skill proposal becomes a pending reflection_skill approval when enabled", async () => {
    turnHook = reply;
    const reflection = register(true);
    await reflection.runNow(true);
    await reflection.idle();
    expect(pendingSkills()).toEqual([{ tool_name: REFLECTION_SKILL_TOOL, status: "pending" }]);
    expect(existsSync(skillFile())).toBe(false);
  });

  test("with skillsEnabled off, the same reply creates no approval", async () => {
    turnHook = reply;
    const reflection = register(false);
    await reflection.runNow(true);
    await reflection.idle();
    expect(pendingSkills()).toEqual([]);
  });
});
