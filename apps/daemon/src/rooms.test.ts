import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { type Db, openDb } from "./db/index.js";
import { addMember, createBot, createRoom, getRoom, listBots } from "./rooms.js";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-rooms-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("rooms and bots round-trip", () => {
  createBot(db, { id: "boss", runtime: "api" });
  createBot(db, { id: "coder", runtime: "acp" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  addMember(db, "main", "coder");
  addMember(db, "main", "coder");
  expect(getRoom(db, "main")).toMatchObject({ leadBotId: "boss", members: ["boss", "coder"] });
  expect(listBots(db).map((b) => b.id).sort()).toEqual(["boss", "coder"]);
});

test("invalid runtime is rejected by the schema", () => {
  expect(() => createBot(db, { id: "x", runtime: "bogus" as never })).toThrow();
});
