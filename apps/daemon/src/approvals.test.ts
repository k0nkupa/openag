import { resolveReviewed } from "./approvals.testkit.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { createApprovals } from "./approvals.js";
import { type Db, openDb } from "./db/index.js";
import { createLedger } from "./ledger.js";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-approvals-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const req = { roomId: "main", botId: "coder", turnId: "t1", toolName: "write_file", toolClass: "act-local" as const, payload: { path: "a.txt" } };

test("request then resolve settles wait() and writes ledger events", async () => {
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  approvals.setEditValidator(name => name === "write_file" ? value => z.object({ path: z.string() }).strict().parse(value) : undefined);
  const { approvalId, wait } = approvals.request(req);
  expect(approvals.listPending().map((a) => a.id)).toEqual([approvalId]);
  resolveReviewed(approvals, approvalId, { kind: "edit", payload: { path: "b.txt" } });
  await expect(wait()).resolves.toEqual({ kind: "edit", payload: { path: "b.txt" } });
  expect(approvals.get(approvalId)).toMatchObject({ status: "edited", edit: { path: "b.txt" } });
  expect(approvals.listPending()).toHaveLength(0);
  expect(ledger.list("main").map((e) => e.type)).toEqual(["approval_requested", "receipt_updated", "approval_decided"]);
});

test.each([
  [{ kind: "accept" as const }, "accepted"],
  [{ kind: "respond" as const, text: "use a different name" }, "responded"],
  [{ kind: "ignore" as const }, "ignored"],
])("decision %j maps to status %s", async (decision, status) => {
  const approvals = createApprovals(db, createLedger(db));
  const { approvalId, wait } = approvals.request(req);
  resolveReviewed(approvals, approvalId, decision);
  await expect(wait()).resolves.toEqual(decision);
  expect(approvals.get(approvalId)!.status).toBe(status);
});

test("resolving twice fails and does not append another event", () => {
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  const { approvalId } = approvals.request(req);
  resolveReviewed(approvals, approvalId, { kind: "accept" });
  expect(() => resolveReviewed(approvals, approvalId, { kind: "ignore" })).toThrow(/already resolved/);
  expect(ledger.list("main").filter((e) => e.type === "approval_decided")).toHaveLength(1);
  expect(approvals.get(approvalId)!.status).toBe("accepted");
});

test("resolving an unknown id fails", () => {
  expect(() => createApprovals(db, createLedger(db)).resolve("nope", { kind: "accept" }, "unknown-version")).toThrow(/not found/);
});

test("pending approvals remain after the DB is closed and reopened", async () => {
  const first = createApprovals(db, createLedger(db));
  const { approvalId } = first.request(req);
  db.close();
  db = openDb(dir);
  const second = createApprovals(db, createLedger(db));
  expect(second.listPending().map((a) => a.id)).toEqual([approvalId]);
  const waiting = second.waitFor(approvalId);
  resolveReviewed(second, approvalId, { kind: "accept" });
  await expect(waiting).resolves.toEqual({ kind: "accept" });
});

test("a ledger subscriber can decide before request returns", async () => {
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  ledger.subscribe("main", event => {
    if (event.type === "approval_requested") {
      resolveReviewed(approvals, (event.payload as { approvalId: string }).approvalId, { kind: "accept" });
    }
  });
  const request = approvals.request(req);
  await expect(request.wait()).resolves.toEqual({ kind: "accept" });
});

test("missing or stale review versions do not authorize a proposal", () => {
  const approvals = createApprovals(db, createLedger(db));
  const { approvalId } = approvals.request(req);
  for (const version of ["", "stale"]) {
    expect(() => approvals.resolve(approvalId, { kind: "accept" }, version)).toThrow(/Reload and review/);
    expect(approvals.get(approvalId)?.status).toBe("pending");
    expect(approvals.receipts.get(approvalId)).toBeUndefined();
  }
});
