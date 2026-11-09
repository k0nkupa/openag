import { resolveReviewed } from "./approvals.testkit.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals, type Approvals } from "./approvals.js";
import { ensureDataRepo } from "./datagit.js";
import { openDb, type Db } from "./db/index.js";
import { createLedger, type Ledger } from "./ledger.js";
import { ensureMemoryFile, memoryPath } from "./memory.js";
import { createReflectionApplier } from "./reflection-apply.js";
import type { SkillPayload } from "./reflection-schema.js";
import { addMember, createBot, createRoom } from "./rooms.js";

let dir: string;
let db: Db;
let ledger: Ledger;
let approvals: Approvals;
const saved = { ...process.env };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "openag-refl-"));
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "acp" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  ledger = createLedger(db);
  approvals = createApprovals(db, ledger);
  await ensureDataRepo(dir);
  ensureMemoryFile(dir, { id: "boss", name: "boss" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const memory = () => readFileSync(memoryPath(dir, "boss"), "utf8");
const commits = () => execFileSync("git", ["log", "--format=%an %s"], { cwd: dir, encoding: "utf8" }).trim().split("\n");
const propose = (toolName: string, payload: unknown) =>
  approvals.request({ roomId: "main", botId: "boss", turnId: null, toolName, toolClass: "act-local", payload }).approvalId;

describe("reflection applier", () => {
  test("nothing is written when the approval is only pending", async () => {
    const applier = createReflectionApplier({ ledger, approvals, dataDir: dir });
    const before = memory();
    propose("reflection_memory", { text: "likes tea" });
    await applier.idle();
    expect(memory()).toBe(before);
    applier.dispose();
  });

  test("accept appends the (redacted) note and makes one commit by openagd", async () => {
    const applier = createReflectionApplier({ ledger, approvals, dataDir: dir });
    const id = propose("reflection_memory", { text: "deploy key is sk-abcdefghijklmnopqrstuvwxyz0123, likes tea" });
    resolveReviewed(approvals, id, { kind: "accept" });
    await applier.idle();
    expect(memory()).toContain("likes tea");
    expect(memory()).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(commits()[0]).toBe("openagd memory: reflection apply (boss)");
    applier.dispose();
  });

  test("edit applies the edited text, not the proposed one, and re-validates it", async () => {
    const applier = createReflectionApplier({ ledger, approvals, dataDir: dir });
    const id = propose("reflection_memory", { text: "original idea" });
    resolveReviewed(approvals, id, { kind: "edit", payload: { text: "edited idea" } });
    await applier.idle();
    expect(memory()).toContain("edited idea");
    expect(memory()).not.toContain("original idea");

    const beforeInvalidEdit = commits().length;
    const bad = propose("reflection_memory", { text: "fine" });
    expect(() => resolveReviewed(approvals, bad, { kind: "edit", payload: { text: "x".repeat(5000) } })).toThrow();
    expect(approvals.get(bad)?.status).toBe("pending");
    await applier.idle();
    expect(memory()).not.toContain("xxxxxxxxxx");
    expect(commits()).toHaveLength(beforeInvalidEdit);
    applier.dispose();
  });

  test.each([
    ["ignore", { kind: "ignore" } as const],
    ["respond", { kind: "respond", text: "no" } as const],
  ])("%s leaves MEMORY.md byte-identical and makes no commit", async (_n, decision) => {
    const applier = createReflectionApplier({ ledger, approvals, dataDir: dir });
    const before = memory();
    const n = commits().length;
    resolveReviewed(approvals, propose("reflection_memory", { text: "nope" }), decision);
    await applier.idle();
    expect(memory()).toBe(before);
    expect(commits()).toHaveLength(n);
    applier.dispose();
  });

  test("an expired approval never applies", async () => {
    const applier = createReflectionApplier({ ledger, approvals, dataDir: dir });
    const before = memory();
    approvals.expire(propose("reflection_memory", { text: "late" }), "test");
    await applier.idle();
    expect(memory()).toBe(before);
    applier.dispose();
  });

  test("unrelated approvals are ignored", async () => {
    const applier = createReflectionApplier({ ledger, approvals, dataDir: dir });
    const before = memory();
    resolveReviewed(approvals, propose("write_file", { text: "x" }), { kind: "accept" });
    await applier.idle();
    expect(memory()).toBe(before);
    applier.dispose();
  });

  test("a skill proposal calls saveSkill with validated data, and is refused when skills are unavailable", async () => {
    const saved: Array<[string, SkillPayload]> = [];
    const applier = createReflectionApplier({ ledger, approvals, dataDir: dir, saveSkill: (b, s) => void saved.push([b, s]) });
    const skill = { slug: "weekly-report", name: "Weekly report", description: "How to compile it", body: "1. do x" };
    resolveReviewed(approvals, propose("reflection_skill", skill), { kind: "accept" });
    resolveReviewed(approvals, propose("reflection_skill", { ...skill, slug: "../evil" }), { kind: "accept" });
    await applier.idle();
    expect(saved).toEqual([["boss", skill]]);
    applier.dispose();

    const none = createReflectionApplier({ ledger, approvals, dataDir: dir });
    const errorsBefore = ledger.list("main").filter((e) => e.type === "error").length;
    resolveReviewed(approvals, propose("reflection_skill", skill), { kind: "accept" });
    await none.idle();
    const errors = ledger.list("main").filter((e) => e.type === "error");
    expect(errors.length).toBe(errorsBefore + 1);
    expect(JSON.stringify(errors.at(-1)!.payload)).toContain("skills are not available");
    none.dispose();
  });
});
