import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { createBot, createRoom } from "./rooms.js";
import { createWakeFilter } from "./wake.js";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

let dir: string;
let db: Db;
let app: ReturnType<typeof createGateway>;
let decide: ReturnType<typeof createWakeFilter>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-wake-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  const ledger = createLedger(db);
  app = createGateway({
    db,
    ledger,
    approvals: createApprovals(db, ledger),
    auth: createAuth({ db, ownerToken: TOKEN }),
    dispatch: () => undefined,
    deskDir: join(dir, "no-desk"),
  });
  decide = createWakeFilter({ db, ledger, tz: "UTC", now: () => new Date("2026-10-27T09:00:00Z") });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const seed = (n: number) => {
  for (let i = 0; i < n; i++) {
    decide.process({ source: "heartbeat", botId: "boss", turnId: null, text: JSON.stringify({ verdict: "silent", reason: `r${i}`, urgency: "low", dedupe_key: `k${i}` }) });
  }
};

describe("GET /wake/decisions", () => {
  test("requires the bearer token", async () => {
    expect((await app.request("/wake/decisions")).status).toBe(401);
  });

  test("empty list when nothing was decided", async () => {
    const res = await app.request("/wake/decisions", { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decisions: [] });
  });

  test("newest first, with the documented shape", async () => {
    seed(2);
    const res = await app.request("/wake/decisions", { headers: auth });
    const { decisions } = (await res.json()) as { decisions: Record<string, unknown>[] };
    expect(decisions.map((d) => d.reason)).toEqual(["r1", "r0"]);
    expect(decisions[0]).toEqual({
      id: expect.any(Number),
      ts: expect.any(Number),
      source: "heartbeat",
      botId: "boss",
      verdict: "silent",
      urgency: "low",
      dedupeKey: "k1",
      reason: "r1",
      decision: "silent",
      suppressedBy: null,
      feedback: null,
    });
  });

  test("limit is clamped to 1..200 and defaults to 50", async () => {
    seed(3);
    const len = async (q: string) =>
      ((await (await app.request(`/wake/decisions${q}`, { headers: auth })).json()) as { decisions: unknown[] }).decisions.length;
    expect(await len("?limit=0")).toBe(1);
    expect(await len("?limit=-5")).toBe(1);
    expect(await len("?limit=2")).toBe(2);
    expect(await len("?limit=abc")).toBe(3);
    expect(await len("?limit=99999")).toBe(3);
    expect(await len("")).toBe(3);
  });

  test("limit above 200 is capped at 200", async () => {
    seed(201);
    const res = await app.request("/wake/decisions?limit=500", { headers: auth });
    expect(((await res.json()) as { decisions: unknown[] }).decisions).toHaveLength(200);
  });
});
