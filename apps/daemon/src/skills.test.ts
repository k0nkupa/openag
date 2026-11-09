import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { commitMemory, ensureDataRepo } from "./datagit.js";
import { ensureMemoryFile } from "./memory.js";
import { INDEX_MAX_CHARS, listSkills, loadSkill, parseSkill, saveSkill, skillsIndex, SkillError } from "./skills.js";

let dir: string;
let outside: string;
const saved = { ...process.env };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-skills-"));
  outside = mkdtempSync(join(tmpdir(), "openag-outside-"));
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const input = { slug: "weekly-report", name: "Weekly report", description: "How to compile the weekly report", body: "1. Gather\n2. Write" };

describe("save and load", () => {
  test("round-trips, bumps the version, and leaves no temp files", () => {
    expect(saveSkill(dir, "boss", input)).toEqual({ slug: "weekly-report", version: 1, created: true });
    expect(saveSkill(dir, "boss", { ...input, body: "v2 body" })).toEqual({ slug: "weekly-report", version: 2, created: false });
    const s = loadSkill(dir, "boss", "weekly-report")!;
    expect(s).toMatchObject({ name: "Weekly report", version: 2, body: "v2 body\n" });
    expect(readdirSync(join(dir, "bots", "boss", "skills", "weekly-report"))).toEqual(["SKILL.md"]);
  });

  test("redacts secrets in name, description and body", () => {
    saveSkill(dir, "boss", { ...input, description: "uses sk-abcdefghijklmnopqrstuvwxyz0123", body: "key sk-abcdefghijklmnopqrstuvwxyz0123" });
    const raw = readFileSync(join(dir, "bots", "boss", "skills", "weekly-report", "SKILL.md"), "utf8");
    expect(raw).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
  });

  test("multi-line name/description collapse to one line so they cannot forge frontmatter", () => {
    saveSkill(dir, "boss", { ...input, name: "A\nversion: 99\n---", description: "d\nname: evil" });
    const s = loadSkill(dir, "boss", "weekly-report")!;
    expect(s.version).toBe(1);
    expect(s.name).not.toContain("\n");
  });

  test("unknown or malformed slug fails soft on load", () => {
    expect(loadSkill(dir, "boss", "nope")).toBeNull();
    for (const slug of ["../x", "a/b", "A", "", "x".repeat(65), ".hidden", "a b"]) expect(loadSkill(dir, "boss", slug)).toBeNull();
  });

  test("body cap and empty body are refused", () => {
    expect(() => saveSkill(dir, "boss", { ...input, body: "x".repeat(16_001) })).toThrow(SkillError);
    expect(() => saveSkill(dir, "boss", { ...input, body: "" })).toThrow(SkillError);
  });

  test.each(["../evil", "a/b", "..", "/abs", "Up", "x".repeat(65), ""])("slug %j is rejected before touching the disk", (slug) => {
    expect(() => saveSkill(dir, "boss", { ...input, slug })).toThrow(SkillError);
    expect(existsSync(join(dir, "bots"))).toBe(false);
  });

  test("a bad bot id is rejected", () => {
    expect(() => saveSkill(dir, "../x", input)).toThrow(SkillError);
    expect(listSkills(dir, "../x")).toEqual([]);
  });
});

describe("symlinks", () => {
  test("a symlinked skills/ directory is refused and nothing is created outside", () => {
    mkdirSync(join(dir, "bots", "boss"), { recursive: true });
    symlinkSync(outside, join(dir, "bots", "boss", "skills"));
    expect(() => saveSkill(dir, "boss", input)).toThrow(SkillError);
    expect(readdirSync(outside)).toEqual([]);
    expect(listSkills(dir, "boss")).toEqual([]);
  });

  test("a symlinked slug directory and a symlinked SKILL.md are refused for save and load", () => {
    const skills = join(dir, "bots", "boss", "skills");
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(outside, "SKILL.md"), "---\nname: x\ndescription: y\nversion: 1\n---\nsecret body\n");
    symlinkSync(outside, join(skills, "linked-dir"));
    mkdirSync(join(skills, "linked-file"));
    symlinkSync(join(outside, "SKILL.md"), join(skills, "linked-file", "SKILL.md"));
    expect(loadSkill(dir, "boss", "linked-dir")).toBeNull();
    expect(loadSkill(dir, "boss", "linked-file")).toBeNull();
    expect(() => saveSkill(dir, "boss", { ...input, slug: "linked-dir" })).toThrow(SkillError);
    expect(() => saveSkill(dir, "boss", { ...input, slug: "linked-file" })).toThrow(SkillError);
    expect(readFileSync(join(outside, "SKILL.md"), "utf8")).toContain("secret body");
    expect(listSkills(dir, "boss")).toEqual([]);
  });
});

describe("review fixes", () => {
  test("a symlinked bots/<id> directory is refused for load and list (not only for save)", () => {
    mkdirSync(join(dir, "bots"), { recursive: true });
    mkdirSync(join(outside, "skills", "leak"), { recursive: true });
    writeFileSync(join(outside, "skills", "leak", "SKILL.md"), "---\nname: leak\ndescription: d\nversion: 1\n---\nsecret\n");
    symlinkSync(outside, join(dir, "bots", "boss"));
    expect(loadSkill(dir, "boss", "leak")).toBeNull();
    expect(listSkills(dir, "boss")).toEqual([]);
  });

  test("name, description and triggers are redacted on load, including a hand-edited file", () => {
    mkdirSync(join(dir, "bots", "boss", "skills", "hand"), { recursive: true });
    writeFileSync(
      join(dir, "bots", "boss", "skills", "hand", "SKILL.md"),
      "---\nname: key sk-abcdefghijklmnopqrstuvwxyz0123\ndescription: also sk-abcdefghijklmnopqrstuvwxyz0123\nversion: 1\ntriggers: sk-abcdefghijklmnopqrstuvwxyz0123\n---\nbody\n",
    );
    const s = loadSkill(dir, "boss", "hand")!;
    expect(JSON.stringify(s)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
  });
});

describe("parse, list and index", () => {
  test("parseSkill is strict about frontmatter", () => {
    expect(parseSkill("a", "no frontmatter")).toBeNull();
    expect(parseSkill("a", "---\nname: x\n---\nbody")).toBeNull(); // no description/version
    expect(parseSkill("a", "---\nname: x\ndescription: y\nversion: 0\n---\nb")).toBeNull();
    expect(parseSkill("a", "---\nname: x\ndescription: y\nversion: 2\ntriggers: a, b\n---\nb")).toMatchObject({ version: 2, triggers: ["a", "b"] });
  });

  test("list is sorted, skips junk, and the index is capped", () => {
    for (let i = 0; i < 60; i++) saveSkill(dir, "boss", { ...input, slug: `skill-${String(i).padStart(2, "0")}`, name: `Skill ${i}`, description: "d".repeat(150) });
    mkdirSync(join(dir, "bots", "boss", "skills", "junk-no-file"));
    const list = listSkills(dir, "boss");
    expect(list).toHaveLength(60);
    expect(list[0]!.slug).toBe("skill-00");
    const idx = skillsIndex(list);
    expect(idx.length).toBeLessThanOrEqual(INDEX_MAX_CHARS + 60);
    expect(idx.split("\n").filter((l) => l.startsWith("- ")).length).toBeLessThanOrEqual(40);
    expect(idx).toContain("more skills not listed");
  });
});

describe("datagit", () => {
  test("a commit includes skill files and MEMORY but nothing else", async () => {
    await ensureDataRepo(dir);
    ensureMemoryFile(dir, { id: "boss", name: "boss" });
    saveSkill(dir, "boss", input);
    writeFileSync(join(dir, "bots", "boss", "notes.txt"), "stray");
    writeFileSync(join(dir, "bots", "boss", "skills", "weekly-report", "extra.md"), "stray");
    expect(await commitMemory(dir, "skills: test")).toBe(true);
    const files = execFileSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" }).trim().split("\n").sort();
    expect(files).toEqual([".gitignore", "bots/boss/MEMORY.md", "bots/boss/skills/weekly-report/SKILL.md"]);
  });
});
