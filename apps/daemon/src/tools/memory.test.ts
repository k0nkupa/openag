import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type Db, openDb } from "../db/index.js";
import { MCP_TOOL_NAMES } from "../mcpserver.js";
import { classify } from "../policy.js";
import { memoryPath } from "../memory.js";
import { createFirstPartyTools } from "./firstparty.js";
import { memoryAppendTool } from "./memory.js";
import type { Computer } from "../computer.js";
import type { Pusher } from "../push.js";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-memtool-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("memory_append tool", () => {
  test("requires an unconfined managed-writer boundary", () => {
    expect(memoryAppendTool.class).toBe("act-local");
    expect(classify("memory_append")).toBe("act-local");
    expect(memoryAppendTool.permission?.({botId:"boss",dataDir:dir},{}).approval).toBe("deny");
  });

  test("reflection proposal names are act-local too (approvals carry an honest class)", () => {
    expect(classify("reflection_memory")).toBe("act-local");
    expect(classify("reflection_skill")).toBe("act-local");
  });

  test("is wired into the first-party tools and the bot-facing MCP list", () => {
    const { defs, executors } = createFirstPartyTools({
      computer: {} as Computer,
      pusher: { status: () => ({ configured: false, enabled: false }) } as unknown as Pusher,
    });
    expect(defs.some((d) => d.name === "memory_append")).toBe(true);
    expect(Object.hasOwn(executors, "memory_append")).toBe(true);
    expect((MCP_TOOL_NAMES as readonly string[]).includes("memory_append")).toBe(true);
  });

  test("writes a redacted, single-line note to the bot's MEMORY.md", async () => {
    const secret = "sk-" + "a".repeat(30);
    await memoryAppendTool.execute({ botId: "boss", dataDir: dir }, { text: `prefers tea\nkey ${secret}` });
    const text = readFileSync(memoryPath(dir, "boss"), "utf8");
    expect(text).toContain("prefers tea key");
    expect(text).not.toContain(secret);
    expect(text).toContain("[REDACTED");
  });

  test("rejects empty and over-long text through the executor", async () => {
    const { executors } = createFirstPartyTools({
      computer: {} as Computer,
      pusher: { status: () => ({ configured: false, enabled: false }) } as unknown as Pusher,
    });
    await expect(executors.memory_append!({ botId: "boss", dataDir: dir }, { text: "" })).rejects.toThrow(/invalid arguments/);
    await expect(executors.memory_append!({ botId: "boss", dataDir: dir }, { text: "x".repeat(301) })).rejects.toThrow(/invalid arguments/);
  });
});
