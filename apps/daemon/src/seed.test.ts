import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { type Db, openDb } from "./db/index.js";
import { seed } from "./seed.js";
import { createBot, getBot, mergeBotConfig } from "./rooms.js";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-seed-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const denied = () =>
  (db.prepare("SELECT tool_class, mode FROM legacy_tool_modes WHERE bot_id = 'researcher' ORDER BY tool_class").all() as {
    tool_class: string;
    mode: string;
  }[]);

test("seed creates the bots, room and session default, and is idempotent", () => {
  seed(db);
  const first = {
    bots: db.prepare("SELECT * FROM bots ORDER BY id").all(),
    members: db.prepare("SELECT * FROM room_members ORDER BY bot_id").all(),
  };
  seed(db);
  expect({ bots: db.prepare("SELECT * FROM bots ORDER BY id").all(), members: db.prepare("SELECT * FROM room_members ORDER BY bot_id").all() }).toEqual(first);
  expect((db.prepare("SELECT bot_id FROM room_members WHERE room_id = 'main' ORDER BY bot_id").all() as { bot_id: string }[]).map((r) => r.bot_id)).toEqual(["boss", "coder", "codex", "researcher"]);
  expect(getBot(db, "codex")).toMatchObject({ runtime: "acp", model: "codex", config: { adapter: "codex", description: expect.any(String) } });
  expect(getBot(db, "researcher")).toMatchObject({ runtime: "acp", model: "codex", config: { adapter: "codex" } });
  expect(denied()).toEqual([]);
  expect(db.prepare("SELECT preset FROM permission_defaults").get()).toEqual({preset:"workspace-write"});
  expect(getBot(db, "boss")?.config).toMatchObject({ description: expect.any(String), instructions: expect.stringContaining("Boss") });
});

test("seed never overwrites existing runtime, model, config or session default", () => {
  createBot(db, { id: "boss", runtime: "acp", model: "custom", config: { instructions: "mine" } });
  createBot(db, { id: "researcher", runtime: "api", model: "keep" });
  db.prepare("UPDATE permission_defaults SET preset='read-only'").run();
  seed(db);
  expect(getBot(db, "boss")).toMatchObject({ runtime: "acp", model: "custom", config: { instructions: "mine", description: expect.any(String) } });
  expect(getBot(db, "researcher")).toMatchObject({ runtime: "api", model: "keep" });
  expect(denied()).toEqual([]);
  expect(db.prepare("SELECT preset FROM permission_defaults").get()).toEqual({preset:"read-only"});
});

test("seed never overwrites an existing codex adapter or config", () => {
  createBot(db, { id: "codex", runtime: "acp", model: "custom", config: { adapter: "claude", instructions: "mine" } });
  seed(db);
  expect(getBot(db, "codex")).toMatchObject({ runtime: "acp", model: "custom", config: { adapter: "claude", instructions: "mine", description: expect.any(String) } });
});

test("mergeBotConfig sets only missing keys and never overwrites", () => {
  createBot(db, { id: "x", runtime: "api", config: { a: "old" } });
  mergeBotConfig(db, "x", { a: "new", b: "added" });
  expect(getBot(db, "x")?.config).toEqual({ a: "old", b: "added" });
  mergeBotConfig(db, "x", { b: "again" });
  expect(getBot(db, "x")?.config).toEqual({ a: "old", b: "added" });
  mergeBotConfig(db, "missing", { a: "1" });
  expect(getBot(db, "missing")).toBeUndefined();
});
