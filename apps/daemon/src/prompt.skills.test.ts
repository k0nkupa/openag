import { describe, expect, test } from "vitest";
import type { Bot, Room } from "./rooms.js";
import { buildPrompt } from "./prompt.js";
import { INDEX_MAX_CHARS, skillsIndex } from "./skills.js";

const bot = (id: string): Bot => ({ id, name: id, runtime: "api", model: null, config: {} });
const room: Room = { id: "main", name: "Main", leadBotId: "boss", members: ["boss"] };
const boss = bot("boss");

describe("buildPrompt skills", () => {
  test("adds the skills index with the facts-vs-workflows line when non-empty", () => {
    const index = "- weekly-review: Weekly review - Review the week";
    const out = buildPrompt({ bot: boss, room, roster: [boss], body: "x", skills: index });
    expect(out).toContain(
      [
        "Skills (repeatable workflows; load a source-qualified id with skill_load when it applies; skill_list finds assigned entries omitted here):",
        index,
        "Facts about the user go to MEMORY (memory_append); repeatable step-by-step workflows go to skills (skill_save).",
      ].join("\n"),
    );
  });

  test("absent when the bot has no skills (empty or blank index)", () => {
    expect(buildPrompt({ bot: boss, room, roster: [boss], body: "x" })).not.toContain("Skills (repeatable");
    expect(buildPrompt({ bot: boss, room, roster: [boss], body: "x", skills: "" })).not.toContain("Skills (repeatable");
    expect(buildPrompt({ bot: boss, room, roster: [boss], body: "x", skills: " \n" })).not.toContain("Skills (repeatable");
  });

  test("the index it receives is capped by skillsIndex", () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      slug: `skill-${i}`,
      name: `Name ${i}`,
      description: "d".repeat(120),
      version: 1,
    }));
    const index = skillsIndex(entries);
    expect(index.length).toBeLessThanOrEqual(INDEX_MAX_CHARS + 40);
    expect(index).toMatch(/\(\+\d+ more skills not listed\)$/);
    const out = buildPrompt({ bot: boss, room, roster: [boss], body: "x", skills: index });
    expect(out).toContain("(+");
    expect(out.split("\n").filter((l) => l.startsWith("- skill-")).length).toBeLessThan(100);
  });
});
