import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { appendMemoryNote, ensureMemoryFile, memoryPath, readMemoryHead } from "./memory.js";

const FAKE_KEY = `sk-${"a".repeat(30)}`;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-memory-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ensureMemoryFile", () => {
  test("creates the template once and never overwrites", () => {
    ensureMemoryFile(dir, { id: "boss", name: "Boss" });
    const path = memoryPath(dir, "boss");
    expect(readFileSync(path, "utf8")).toBe(
      "# Memory: Boss\n\nStanding notes for this bot. Edit by hand any time; the first ~1500 tokens are sent to the bot every turn, so keep it short.\n\n## Facts\n\n## Preferences\n",
    );
    writeFileSync(path, "mine");
    ensureMemoryFile(dir, { id: "boss", name: "Boss" });
    expect(readFileSync(path, "utf8")).toBe("mine");
  });
});

describe("readMemoryHead", () => {
  test("missing file returns empty string", () => {
    expect(readMemoryHead(dir, "boss")).toBe("");
  });

  test("hand edits show up on the next read", () => {
    ensureMemoryFile(dir, { id: "boss", name: "Boss" });
    writeFileSync(memoryPath(dir, "boss"), "- prefers metric units\n");
    expect(readMemoryHead(dir, "boss")).toBe("- prefers metric units\n");
  });

  test("caps at maxTokens, cutting at a newline, with a truncation marker", () => {
    mkdirSync(join(dir, "bots", "boss"), { recursive: true });
    const line = "x".repeat(19) + "\n"; // 20 chars per line
    writeFileSync(memoryPath(dir, "boss"), line.repeat(10)); // 200 chars, 50 tokens
    const out = readMemoryHead(dir, "boss", 5); // cap 20 chars
    const [head, marker] = [out.slice(0, out.indexOf("\n[...")), out.slice(out.indexOf("\n[..."))];
    expect(head).toBe(line.slice(0, 19));
    expect(marker).toMatch(/^\n\[\.\.\. MEMORY\.md truncated: \d+ more characters\. Shorten the file to include them \.\.\.\]$/);
    expect(marker).toContain("truncated: 181 more characters");
  });

  test("redacts secrets so they never reach the output", () => {
    mkdirSync(join(dir, "bots", "boss"), { recursive: true });
    writeFileSync(memoryPath(dir, "boss"), `key is ${FAKE_KEY}\n`);
    const out = readMemoryHead(dir, "boss");
    expect(out).not.toContain(FAKE_KEY);
    expect(out).toContain("[REDACTED:");
  });
});

describe("appendMemoryNote", () => {
  test("creates the file, writes a dated single-line redacted note", () => {
    appendMemoryNote(dir, "boss", `line one\nline two ${FAKE_KEY}`);
    const text = readFileSync(memoryPath(dir, "boss"), "utf8");
    expect(text).toMatch(/^- \d{4}-\d{2}-\d{2} line one line two \[REDACTED:/);
    expect(text.split("\n").filter(Boolean)).toHaveLength(1);
    expect(text).not.toContain(FAKE_KEY);
  });

  test("appends to an existing file", () => {
    ensureMemoryFile(dir, { id: "boss", name: "Boss" });
    appendMemoryNote(dir, "boss", "likes tea");
    expect(readFileSync(memoryPath(dir, "boss"), "utf8").endsWith("likes tea\n")).toBe(true);
  });
});
