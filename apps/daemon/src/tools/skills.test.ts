import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals, type Approvals } from "../approvals.js";
import { createPermissions, type PermissionPreset } from "../permissions.js";
import { commitMemory, ensureDataRepo } from "../datagit.js";
import { ensureMemoryFile } from "../memory.js";
import { type Db, openDb } from "../db/index.js";
import type { Computer } from "../computer.js";
import { createLedger, type Ledger } from "../ledger.js";
import { MCP_TOOL_NAMES } from "../mcpserver.js";
import { classify } from "../policy.js";
import type { Pusher } from "../push.js";
import { createBot, createRoom, addMember, getBot, getRoom } from "../rooms.js";
import { createRunner } from "../runtimes/runner.js";
import type { AuthorizeResult, BotRuntime, TurnContext, ToolOutcome } from "../runtimes/types.js";
import { defaultTools } from "../runtimes/tools.js";
import { skillsIndex, listSkills, saveSkill } from "../skills.js";
import { createFirstPartyTools } from "./firstparty.js";
import { skillLoadTool, skillSaveTool } from "./skills.js";

let dir: string;
let db: Db;
let ledger: Ledger;
let approvals: Approvals;
const saved = { ...process.env };

const pusher = { status: () => ({ configured: false, enabled: false }) } as unknown as Pusher;
const firstParty = () => createFirstPartyTools({ computer: {} as Computer, pusher });
const skillFile = (slug: string) => join(dir, "bots", "boss", "skills", slug, "SKILL.md");
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const WORKFLOW = { slug: "weekly-review", name: "Weekly review", description: "Review the week", body: "1. List wins\n2. List misses" };

// Runner script per bot; the callTool outcome is captured for assertions.
let script: (ctx: TurnContext) => Promise<void> | void = () => undefined;
const fake: BotRuntime = {
  async runTurn(ctx) {
    await script(ctx);
  },
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "openag-skilltool-"));
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  ledger = createLedger(db);
  approvals = createApprovals(db, ledger);
  await ensureDataRepo(dir);
  // Commit MEMORY.md first so the skill commit below holds only the skill file (the datagit pathspec includes MEMORY).
  ensureMemoryFile(dir, { id: "boss", name: "boss" });
  await commitMemory(dir, "init memory");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Fresh installs run Workspace Write; managed skill writes need Full access (or are refused). */
function setup(preset: PermissionPreset = "workspace-write") {
  const permissions = createPermissions(db, ledger, dir, approvals);
  const current = permissions.ensure("boss", "main");
  if (current.preset !== preset) permissions.select("boss", "main", preset, "fixture-owner", current.revision);
  const runner = createRunner({
    db,
    ledger,
    approvals,
    permissions,
    dataDir: dir,
    runtimes: { api: fake, acp: fake },
    tools: defaultTools,
    dynamicTools: () => firstParty().executors,
  });
  const run = (opts?: { unattended?: boolean }) => {
    const message = ledger.append("main", "scheduler", "message", { text: "go" });
    return runner.run(getRoom(db, "main")!, getBot(db, "boss")!, message, undefined, opts);
  };
  return { run };
}
const approvalRows = () => db.prepare("SELECT id, tool_name, tool_class, status FROM approvals").all() as { id: string; tool_name: string; tool_class: string; status: string }[];
describe("skill tools: classes and wiring", () => {
  test("skill_load has a read contract; skill_save requires an unconfined boundary", () => {
    expect(skillLoadTool.class).toBe("read");
    expect(skillSaveTool.class).toBe("act-local");
    expect(classify("skill_load")).toBe("read");
    expect(classify("skill_save")).toBe("act-local");
    expect(skillLoadTool.permission?.({botId:"boss",dataDir:dir},{}).approval).toBe("allow");
    expect(skillSaveTool.permission?.({botId:"boss",dataDir:dir},{}).approval).toBe("deny");
  });

  test("both are in the first-party executors and the bot-facing MCP tool list", () => {
    const { defs, executors } = firstParty();
    expect(defs.map((d) => d.name)).toEqual(expect.arrayContaining(["skill_load", "skill_save"]));
    expect(Object.hasOwn(executors, "skill_load")).toBe(true);
    expect(Object.hasOwn(executors, "skill_save")).toBe(true);
    expect((MCP_TOOL_NAMES as readonly string[]).includes("skill_load")).toBe(true);
    expect((MCP_TOOL_NAMES as readonly string[]).includes("skill_save")).toBe(true);
  });
});

describe("skill_load", () => {
  test("unknown and invalid slugs fail soft with found:false", async () => {
    const { executors } = firstParty();
    await expect(executors.skill_load!({ botId: "boss", dataDir: dir }, { slug: "nope" })).resolves.toEqual({ found: false });
    for (const slug of ["../boss", "a/b", "Upper", "", "x".repeat(300)]) {
      await expect(executors.skill_load!({ botId: "boss", dataDir: dir }, { slug })).resolves.toEqual({ found: false });
    }
  });

  test("loads a saved skill with the body marked untrusted", async () => {
    saveSkill(dir, "boss", WORKFLOW);
    const out = (await skillLoadTool.execute({ botId: "boss", dataDir: dir }, { slug: "weekly-review" })) as {
      found: boolean;
      untrusted: boolean;
      notice: string;
      skill: { slug: string; body: string; version: number };
    };
    expect(out).toMatchObject({ found: true, untrusted: true, skill: { slug: "weekly-review", version: 1 } });
    expect(out.notice).toMatch(/data/);
    expect(out.skill.body).toContain("List wins");
  });
});

describe("skill_save", () => {
  test("path-trick and malformed slugs are rejected by the schema, nothing written", async () => {
    const { executors } = firstParty();
    for (const slug of ["../escape", "a/b", "UPPER", "", "x".repeat(65), "dot.dir"]) {
      await expect(executors.skill_save!({ botId: "boss", dataDir: dir }, { ...WORKFLOW, slug })).rejects.toThrow(/invalid arguments/);
    }
    expect(listSkills(dir, "boss")).toEqual([]);
  });

  test("a secret in the body is redacted in the file", async () => {
    const secret = "sk-" + "b".repeat(30);
    await skillSaveTool.execute({ botId: "boss", dataDir: dir }, { ...WORKFLOW, body: `Use key ${secret} then review` });
    const text = readFileSync(skillFile("weekly-review"), "utf8");
    expect(text).not.toContain(secret);
    expect(text).toContain("[REDACTED");
  });

  test("a SkillError surfaces as a clean error message", async () => {
    await expect(skillSaveTool.execute({ botId: "boss", dataDir: dir }, { ...WORKFLOW, body: "x".repeat(16_001) })).rejects.toThrow(
      /too long/,
    );
  });

  test("in Full access skill_save runs without an approval and makes one openagd commit with only the skill path", async () => {
    script = async (ctx) => {
      seen.outcome = (await ctx.callTool("skill_save", { ...WORKFLOW, triggers: ["weekly"] }, undefined)) as ToolOutcome;
    };
    const seen: { outcome?: ToolOutcome } = {};
    const { run } = setup("full-access");
    await run();
    expect(approvalRows()).toEqual([]);
    expect(seen.outcome).toMatchObject({ ok: true, result: { saved: true, slug: "weekly-review", version: 1 } });
    expect(readFileSync(skillFile("weekly-review"), "utf8")).toContain("List misses");

    const subjects = git("log", "--format=%H %an %s").split("\n");
    const skillCommit = subjects.find((l) => l.includes("skills: save weekly-review (boss)"))!;
    expect(skillCommit).toContain(" openagd ");
    const sha = skillCommit.split(" ")[0]!;
    expect(git("show", "--name-only", "--format=", sha)).toBe("bots/boss/skills/weekly-review/SKILL.md");
  });

  test.each(["read-only", "workspace-write"] as const)("a confined %s session refuses skill_save: no approval, nothing written", async (preset) => {
    const seen: { outcome?: ToolOutcome } = {};
    script = async (ctx) => {
      seen.outcome = (await ctx.callTool("skill_save", WORKFLOW)) as ToolOutcome;
    };
    const { run } = setup(preset);
    await run();
    expect(seen.outcome).toMatchObject({ ok: false, status: "denied" });
    expect(approvalRows()).toEqual([]);
    expect(listSkills(dir, "boss")).toEqual([]);
  });

  test("an unattended turn cannot call skill_save (denied, no approval) but can call skill_load", async () => {
    const seen: { save?: ToolOutcome; load?: ToolOutcome } = {};
    script = async (ctx) => {
      seen.save = await ctx.callTool("skill_save", WORKFLOW);
      seen.load = await ctx.callTool("skill_load", { slug: "weekly-review" });
    };
    const { run } = setup();
    await run({ unattended: true });
    expect(seen.save).toMatchObject({ ok: false, status: "denied" });
    expect(seen.load).toMatchObject({ ok: true, result: { found: false } });
    expect(approvalRows()).toEqual([]);
    expect(listSkills(dir, "boss")).toEqual([]);
  });

  test("the runner feeds the skills index into the next turn's prompt", async () => {
    saveSkill(dir, "boss", WORKFLOW);
    let prompt = "";
    script = (ctx) => {
      prompt = ctx.prompt;
    };
    const { run } = setup();
    await run();
    expect(prompt).toContain("Skills (repeatable workflows; load a source-qualified id with skill_load when it applies; skill_list finds assigned entries omitted here):");
    expect(prompt).toContain("- agent:boss:weekly-review: Weekly review - [agent] Review the week");
    expect(skillsIndex(listSkills(dir, "boss"))).toContain("weekly-review");
  });
});
