import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { type Db, openDb } from "./db/index.js";
import { createLedger, type LedgerEvent } from "./ledger.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-ledger-"));
  db = openDb(dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("appended events come back in order", () => {
  const ledger = createLedger(db);
  ledger.append("r1", "user", "message", { text: "a" });
  ledger.append("r1", "boss", "bot_output", { text: "b" });
  ledger.append("r2", "user", "message", { text: "other room" });
  const events = ledger.list("r1");
  expect(events.map((e) => e.type)).toEqual(["message", "bot_output"]);
  expect(events[0]!.id).toBeLessThan(events[1]!.id);
  expect(ledger.list("r1", { afterId: events[0]!.id })).toHaveLength(1);
  expect(ledger.list("r1", { limit: 1 })).toHaveLength(1);
});

test("subscribers receive new events", () => {
  const ledger = createLedger(db);
  const room: LedgerEvent[] = [];
  const all: LedgerEvent[] = [];
  const offRoom = ledger.subscribe("r1", (e) => room.push(e));
  ledger.subscribe("*", (e) => all.push(e));
  ledger.append("r1", "user", "message", { text: "hi" });
  ledger.append("r2", "user", "message", { text: "yo" });
  expect(room).toHaveLength(1);
  expect(all).toHaveLength(2);
  offRoom();
  ledger.append("r1", "user", "message", {});
  expect(room).toHaveLength(1);
});

test("events persist after the DB is closed and reopened", () => {
  createLedger(db).append("r1", "user", "message", { text: "persist" });
  db.close();
  db = openDb(dir);
  const events = createLedger(db).list("r1");
  expect(events).toHaveLength(1);
  expect(events[0]!.payload).toEqual({ text: "persist" });
});
