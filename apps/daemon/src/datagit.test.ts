import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { commitMemory, ensureDataRepo } from "./datagit.js";
import { appendMemoryNote, ensureMemoryFile } from "./memory.js";

let dir: string;
let home: string;
const savedEnv = { ...process.env };

const git = (args: string[], cwd = dir) => execFileSync("git", args, { cwd, encoding: "utf8" });
const log = () => git(["log", "--format=%an %s"]).trim().split("\n");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-datagit-"));
  home = mkdtempSync(join(tmpdir(), "openag-home-"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("ensureDataRepo", () => {
  test("creates .git and .gitignore with all patterns, idempotently", async () => {
    await ensureDataRepo(dir);
    await ensureDataRepo(dir);
    const ignore = readFileSync(join(dir, ".gitignore"), "utf8").split("\n");
    for (const pattern of ["*.db", "*.db-*", "*.db*", "logs/", "bots/*/work/"]) {
      expect(ignore.filter((l) => l === pattern)).toHaveLength(1);
    }
    expect(log()).toEqual(["openagd openagd: init"]);
  });
});

describe("commitMemory", () => {
  test("commits a changed MEMORY.md as openagd and returns false when unchanged", async () => {
    await ensureDataRepo(dir);
    ensureMemoryFile(dir, { id: "boss", name: "Boss" });
    expect(await commitMemory(dir, "memory: one")).toBe(true);
    expect(await commitMemory(dir, "memory: two")).toBe(false);
    appendMemoryNote(dir, "boss", "likes tea");
    expect(await commitMemory(dir, "memory: three")).toBe(true);
    expect(log()).toEqual(["openagd memory: three", "openagd memory: one", "openagd openagd: init"]);
  });

  test("never commits ignored files or non-MEMORY files", async () => {
    await ensureDataRepo(dir);
    ensureMemoryFile(dir, { id: "boss", name: "Boss" });
    for (const [p, body] of [
      ["openag.db", "x"],
      ["openag.db-wal", "x"],
      ["logs/x.log", "x"],
      ["bots/boss/work/a.txt", "x"],
      ["bots/boss/notes.txt", "x"],
    ] as const) {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), body);
    }
    expect(await commitMemory(dir, "memory: x")).toBe(true);
    const tracked = git(["ls-files"]).trim().split("\n").sort();
    expect(tracked).toEqual([".gitignore", "bots/boss/MEMORY.md"]);
  });

  test("ignores hostile global config and author env", async () => {
    writeFileSync(join(home, ".gitconfig"), "[commit]\n\tgpgsign = true\n[core]\n\thooksPath = /nonexistent\n");
    process.env.HOME = home;
    process.env.GIT_AUTHOR_NAME = "evil";
    process.env.GIT_COMMITTER_NAME = "evil";
    process.env.GIT_CONFIG_GLOBAL = join(home, ".gitconfig");
    await ensureDataRepo(dir);
    ensureMemoryFile(dir, { id: "boss", name: "Boss" });
    expect(await commitMemory(dir, "memory: hostile")).toBe(true);
    expect(log()[0]).toBe("openagd memory: hostile");
  });

  test("concurrent calls do not fail", async () => {
    await ensureDataRepo(dir);
    ensureMemoryFile(dir, { id: "boss", name: "Boss" });
    appendMemoryNote(dir, "boss", "a");
    const results = await Promise.all([1, 2, 3, 4].map((i) => commitMemory(dir, `memory: ${i}`)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  test("returns false and does not throw when git fails", async () => {
    expect(await commitMemory(join(dir, "missing"), "memory: x")).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("commitMemory index hygiene", () => {
  test("a file staged by hand is never committed with a memory commit", async () => {
    await ensureDataRepo(dir);
    ensureMemoryFile(dir, { id: "boss", name: "Boss" });
    writeFileSync(join(dir, "stray.txt"), "do not commit me");
    git(["add", "stray.txt"]);
    expect(await commitMemory(dir, "memory: test")).toBe(true);
    const files = git(["show", "--name-only", "--format=", "HEAD"]).trim().split("\n");
    expect(files).toEqual(["bots/boss/MEMORY.md"]);
    expect(git(["ls-files"])).not.toContain("stray.txt");
  });
});
