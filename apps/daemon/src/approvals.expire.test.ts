import { resolveReviewed } from "./approvals.testkit.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals, type Approvals } from "./approvals.js";
import { type Db, openDb } from "./db/index.js";
import { createLedger, type Ledger } from "./ledger.js";
import { addMember, createBot, createRoom } from "./rooms.js";

let dir: string;
let db: Db;
let ledger: Ledger;
let approvals: Approvals;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-expire-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  ledger = createLedger(db);
  approvals = createApprovals(db, ledger);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const request = (turnId = "t1") =>
  approvals.request({ roomId: "main", botId: "boss", turnId, toolName: "computer_click", toolClass: "act-local", payload: { x: 1 } });

describe("approvals.expire", () => {
  test("expires a pending approval: ignored, response_text expired, ledgered, waiter settled", async () => {
    const { approvalId, wait } = request();
    const row = approvals.expire(approvalId, "test");
    expect(row).toMatchObject({ id: approvalId, status: "ignored", responseText: "expired", turnId: "t1" });
    expect(row?.decidedAt).toBeTypeOf("number");
    await expect(wait()).resolves.toEqual({ kind: "ignore" });
    const decided = ledger.list("main").filter((e) => e.type === "approval_decided");
    expect(decided).toHaveLength(1);
    expect(decided[0]!.payload).toMatchObject({ approvalId, decision: { kind: "ignore", expired: true }, status: "ignored" });
    expect(approvals.listPending()).toEqual([]);
  });

  test("a later resolve throws the already-resolved error", () => {
    const { approvalId } = request();
    approvals.expire(approvalId);
    expect(() => resolveReviewed(approvals, approvalId, { kind: "accept" })).toThrow(/already resolved/);
    expect(approvals.get(approvalId)?.status).toBe("ignored");
  });

  test("does nothing for a decided or unknown approval", () => {
    const { approvalId } = request();
    resolveReviewed(approvals, approvalId, { kind: "accept" });
    expect(approvals.expire(approvalId)).toBeUndefined();
    expect(approvals.get(approvalId)?.status).toBe("accepted");
    expect(approvals.expire("nope")).toBeUndefined();
    expect(ledger.list("main").filter((e) => e.type === "approval_decided")).toHaveLength(1);
  });

  test("a decision racing the expiry: exactly one wins", () => {
    for (let i = 0; i < 20; i++) {
      const { approvalId } = request(`t${i}`);
      let resolved = false;
      let expired = false;
      try {
        resolveReviewed(approvals, approvalId, { kind: "accept" });
        resolved = true;
      } catch {
        resolved = false;
      }
      expired = approvals.expire(approvalId) !== undefined;
      expect(resolved !== expired).toBe(true);
    }
  });
});
