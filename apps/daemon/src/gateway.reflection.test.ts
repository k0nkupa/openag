import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import type { Reflection, ReflectionStatus } from "./reflection.js";
import { createBot, createRoom } from "./rooms.js";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

let dir: string;
let db: Db;
let app: ReturnType<typeof createGateway>;
let runNow: ReturnType<typeof vi.fn>;

const status: ReflectionStatus = {
  setting: { enabled: false, time: "03:30", botId: null, lookbackHours: 24, maxMemoryProposals: 5, maxSkillProposals: 3 },
  running: false,
  runs: [],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-reflection-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  const ledger = createLedger(db);
  runNow = vi.fn(async () => ({ started: true }));
  const reflection: Reflection = { runNow: runNow as Reflection["runNow"], status: () => status, idle: async () => undefined };
  app = createGateway({
    db,
    ledger,
    approvals: createApprovals(db, ledger),
    auth: createAuth({ db, ownerToken: TOKEN }),
    dispatch: () => undefined,
    deskDir: join(dir, "no-desk"),
    reflection,
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /reflection", () => {
  test("requires the bearer token", async () => {
    expect((await app.request("/reflection")).status).toBe(401);
    expect((await app.request("/reflection/run", { method: "POST" })).status).toBe(401);
    expect(runNow).not.toHaveBeenCalled();
  });

  test("returns the setting, running flag and runs", async () => {
    const res = await app.request("/reflection", { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(status);
  });
});

describe("POST /reflection/run", () => {
  test("202 with started true when the run is accepted (forced, ignores enabled)", async () => {
    const res = await app.request("/reflection/run", { method: "POST", headers: auth });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: true });
    expect(runNow).toHaveBeenCalledWith(true);
  });

  test("409 with an error when a run is already in flight", async () => {
    runNow.mockResolvedValueOnce({ started: false, reason: "already running" });
    const res = await app.request("/reflection/run", { method: "POST", headers: auth });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already running" });
  });
});

describe("without a reflection dep", () => {
  test("the routes are not registered", async () => {
    const bare = createGateway({
      db,
      ledger: createLedger(db),
      approvals: createApprovals(db, createLedger(db)),
      auth: createAuth({ db, ownerToken: TOKEN }),
      dispatch: () => undefined,
      deskDir: join(dir, "no-desk"),
    });
    expect((await bare.request("/reflection", { headers: auth })).status).toBe(404);
  });
});
