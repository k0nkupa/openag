import { resolveReviewed } from "./approvals.testkit.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { type Db, openDb } from "./db/index.js";
import { createLedger } from "./ledger.js";
import { createRedactor, getDefaultRedactor, resetDefaultRedactor } from "./redact.js";
import { createBot, createRoom, addMember, getBot, getRoom } from "./rooms.js";
import { createRunner } from "./runtimes/runner.js";
import type { BotRuntime } from "./runtimes/types.js";

const KEY = "sk-" + "f".repeat(30);
const req = { roomId: "main", botId: "coder", turnId: "t1", toolName: "write_file", toolClass: "act-local" as const };

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-redact-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createBot(db, { id: "coder", runtime: "acp" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  addMember(db, "main", "coder");
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("ledger.append redacts nested payload strings and key-named fields before storage and emit", () => {
  const ledger = createLedger(db, createRedactor({ env: {} }));
  const seen: unknown[] = [];
  ledger.subscribe("main", (e) => seen.push(e.payload));
  const appended = ledger.append("main", "boss", "message", {
    text: `use ${KEY}`,
    nested: { list: [{ note: `Bearer abcdEFGH1234ijkl5678` }] },
    token: "abcdefghijklmnop",
  });
  const expected = {
    text: "use [REDACTED:api-key]",
    nested: { list: [{ note: "Bearer [REDACTED:bearer]" }] },
    token: "[REDACTED:key]",
  };
  expect(appended.payload).toEqual(expected);
  expect(ledger.list("main")[0]!.payload).toEqual(expected);
  expect(seen).toEqual([expected]);
  const raw = db.prepare("SELECT payload_json FROM events").get() as { payload_json: string };
  expect(raw.payload_json).not.toContain(KEY);
});

test("approvals.request stores and emits a redacted payload; respond text is redacted", () => {
  const ledger = createLedger(db, createRedactor({ env: {} }));
  const approvals = createApprovals(db, ledger, createRedactor({ env: {} }));
  const { approvalId } = approvals.request({ ...req, payload: { content: `key=${KEY}` } });
  const row = db.prepare("SELECT payload_json FROM approvals WHERE id = ?").get(approvalId) as { payload_json: string };
  expect(row.payload_json).not.toContain(KEY);
  const requested = ledger.list("main").find((e) => e.type === "approval_requested")!;
  expect(JSON.stringify(requested)).not.toContain(KEY);

  resolveReviewed(approvals, approvalId, { kind: "respond", text: `try with ${KEY}` });
  const resp = db.prepare("SELECT response_text FROM approvals WHERE id = ?").get(approvalId) as { response_text: string };
  expect(resp.response_text).toBe("try with [REDACTED:api-key]");
  expect(JSON.stringify(ledger.list("main"))).not.toContain(KEY);
});

test("turn state_json is redacted while ctx.state keeps the original", async () => {
  const ledger = createLedger(db, createRedactor({ env: {} }));
  const redactor = createRedactor({ env: {} });
  const approvals = createApprovals(db, ledger, redactor);
  let inMemory: unknown;
  const runtime: BotRuntime = {
    async runTurn(ctx) {
      ctx.saveState({ scratch: `value ${KEY}` });
      inMemory = ctx.state.scratch;
    },
  };
  const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { acp: runtime }, tools: {}, redactor });
  const msg = ledger.append("main", "user", "message", { text: "hi" });
  await runner.run(getRoom(db, "main")!, getBot(db, "coder")!, msg);
  expect(inMemory).toBe(`value ${KEY}`);
  const row = db.prepare("SELECT state_json FROM turns").get() as { state_json: string };
  expect(row.state_json).not.toContain(KEY);
  expect(row.state_json).toContain("[REDACTED:api-key]");
});

test("default redactor picks up a secret env var set before resetDefaultRedactor and first use", () => {
  const name = "OA106_INTEGRATION_SECRET";
  const value = "integration-secret-value-1";
  const prev = process.env[name];
  process.env[name] = value;
  try {
    resetDefaultRedactor();
    const ledger = createLedger(db);
    ledger.append("main", "user", "message", { text: `leak ${value}` });
    expect(ledger.list("main")[0]!.payload).toEqual({ text: "leak [REDACTED:secret]" });
    expect(getDefaultRedactor().redactString(value)).toBe("[REDACTED:secret]");
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
    resetDefaultRedactor();
  }
});
