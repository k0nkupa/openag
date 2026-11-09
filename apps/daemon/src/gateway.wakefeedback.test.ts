import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";

const TOKEN = "t";
const h = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
let dir: string;
let db: Db;
let app: ReturnType<typeof createGateway>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-wakefb-"));
  db = openDb(dir);
  const ledger = createLedger(db);
  app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth: createAuth({ db, ownerToken: TOKEN }), dispatch: () => undefined, deskDir: join(dir, "x"), dataDir: dir });
  db.prepare("INSERT INTO wake_decisions (ts, source, bot_id, verdict, urgency, dedupe_key, reason, decision, suppressed_by, created_at) VALUES (1,'heartbeat','boss','ping','high','k','r','suppressed','budget',1)").run();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const fb = (id: string, body: unknown, headers: Record<string, string> = h) => app.request(`/wake/decisions/${id}/feedback`, { method: "POST", headers, body: JSON.stringify(body) });

describe("wake feedback", () => {
  test("records should_have_pinged and lists it", async () => {
    expect((await fb("1", { verdict: "should_have_pinged" })).status).toBe(200);
    const list = (await (await app.request("/wake/decisions", { headers: h })).json()) as { decisions: { id: number; feedback: string | null }[] };
    expect(list.decisions[0]).toMatchObject({ id: 1, feedback: "should_have_pinged" });
  });
  test("rejects unknown ids, bad verdicts and missing auth", async () => {
    expect((await fb("99", { verdict: "should_have_pinged" })).status).toBe(404);
    expect((await fb("abc", { verdict: "should_have_pinged" })).status).toBe(404);
    expect((await fb("1", { verdict: "nope" })).status).toBe(400);
    expect((await fb("1", { verdict: "should_have_pinged" }, { "content-type": "application/json" })).status).toBe(401);
  });
});
