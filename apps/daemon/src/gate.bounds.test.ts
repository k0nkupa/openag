import {createPermissions} from './permissions.js';
import { resolveReviewed } from "./approvals.testkit.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals, type Approvals } from "./approvals.js";
import { type Db, openDb } from "./db/index.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createToolGate, type ToolGate,type GateRequest } from "./runtimes/gate.js";
import { addMember, createBot, createRoom } from "./rooms.js";

let dir: string;
let db: Db;
let ledger: Ledger;
let approvals: Approvals;
let gate: ToolGate;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gate-bounds-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  ledger = createLedger(db);
  approvals = createApprovals(db, ledger);
  gate = createToolGate({ db, approvals });
  req.permission={session:createPermissions(db,ledger,dir,approvals).ensure('boss','main'),requirement:{approval:'review'}};
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const req:GateRequest = { roomId: "main", botId: "boss", turnId: "t1", toolName: "computer_click", args: { x: 1, y: 2 } };

describe("gate bounded approval wait", () => {
  test("without opts an accept is allowed, as before", async () => {
    const p = gate.authorize(req);
    const [pending] = approvals.listPending();
    resolveReviewed(approvals, pending!.id, { kind: "accept" });
    await expect(p).resolves.toEqual({ allowed: true, args: req.args, approvalId: pending!.id });
  });

  test("maxWaitMs expires the approval and refuses the call", async () => {
    const res = await gate.authorize(req, undefined, { maxWaitMs: 20 });
    expect(res).toEqual({ allowed: false, status: "ignored", message: "approval expired before the user decided" });
    expect(approvals.listPending()).toEqual([]);
    const [row] = (db.prepare("SELECT status, response_text FROM approvals").all() as Array<Record<string, string>>);
    expect(row).toEqual({ status: "ignored", response_text: "expired" });
  });

  test("an abort signal mid-wait expires the approval", async () => {
    const ac = new AbortController();
    const p = gate.authorize(req, undefined, { signal: ac.signal, maxWaitMs: 60_000 });
    setTimeout(() => ac.abort(), 10);
    await expect(p).resolves.toMatchObject({ allowed: false, status: "ignored" });
    expect(approvals.listPending()).toEqual([]);
  });

  test("keepPending leaves the approval pending when the bound fires (shutdown must not expire it)", async () => {
    const ac = new AbortController();
    const p = gate.authorize(req, undefined, { signal: ac.signal, keepPending: () => true });
    ac.abort();
    await expect(p).resolves.toMatchObject({ allowed: false, status: "ignored" });
    expect(approvals.listPending()).toHaveLength(1);
  });

  test("an expiry is recorded as a daemon action, not a user decision", async () => {
    await gate.authorize(req, undefined, { maxWaitMs: 10 });
    const events = ledger.list("main").filter((e) => e.type === "approval_decided");
    expect(events).toHaveLength(1);
    expect(events[0]!.actor).toBe("daemon");
  });

  test("an already aborted signal expires at once", async () => {
    const ac = new AbortController();
    ac.abort();
    const res = await gate.authorize(req, undefined, { signal: ac.signal, maxWaitMs: 60_000 });
    expect(res).toMatchObject({ allowed: false, status: "ignored" });
    expect(approvals.listPending()).toEqual([]);
  });

  test("a decision before the bound behaves exactly as today", async () => {
    const ac = new AbortController();
    const p = gate.authorize(req, undefined, { signal: ac.signal, maxWaitMs: 60_000 });
    const [pending] = approvals.listPending();
    resolveReviewed(approvals, pending!.id, { kind: "respond", text: "not now" });
    await expect(p).resolves.toEqual({ allowed: false, status: "responded", message: "not now" });
    ac.abort(); // after the decision: must not touch the (already decided) approval
    expect(approvals.get(pending!.id)?.status).toBe("responded");
  });
});
