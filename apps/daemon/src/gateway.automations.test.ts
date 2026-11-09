import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { createAutomationManager, type AutomationManager } from "./automations.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { createScheduler } from "./scheduler.js";
import { createRunner } from "./runtimes/runner.js";
import { defaultTools } from "./runtimes/tools.js";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };
const json = { ...auth, "content-type": "application/json" };
const SECRET = "SECRET-PROMPT-TEXT";

let dir: string;
let db: Db;
let ledger: Ledger;
let manager: AutomationManager;
let app: ReturnType<typeof createGateway>;
let turns = 0;

const valid = {
  name: "Digest",
  scheduleCron: "0 10 * * *",
  botId: "boss",
  roomId: "main",
  prompt: SECRET,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-auto-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  turns = 0;
  const runner = createRunner({
    db,
    ledger,
    approvals,
    dataDir: dir,
    runtimes: {
      api: {
        async runTurn() {
          turns++;
        },
      },
      acp: { async runTurn() {} },
    },
    tools: defaultTools,
  });
  manager = createAutomationManager({ db, ledger, runner, scheduler: createScheduler(), tz: "UTC" });
  app = createGateway({
    db,
    ledger,
    approvals,
    auth: createAuth({ db, ownerToken: TOKEN }),
    dispatch: () => undefined,
    deskDir: join(dir, "no-desk"),
    tz: "UTC",
    automations: manager,
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: json, body: JSON.stringify(body) });
const put = (path: string, body: unknown) => app.request(path, { method: "PUT", headers: json, body: JSON.stringify(body) });

describe("/automations auth", () => {
  test("every route requires the bearer token", async () => {
    expect((await app.request("/automations")).status).toBe(401);
    expect((await app.request("/automations", { method: "POST", body: JSON.stringify(valid) })).status).toBe(401);
    expect((await app.request("/automations/auto_x", { method: "DELETE" })).status).toBe(401);
    expect((await app.request("/automations/auto_x/run", { method: "POST" })).status).toBe(401);
  });
});

describe("/automations CRUD", () => {
  test("POST creates (201), GET lists and fetches, PUT patches (200), DELETE removes (204)", async () => {
    const created = await post("/automations", valid);
    expect(created.status).toBe(201);
    const { automation } = (await created.json()) as { automation: { id: string; prompt: string; enabled: boolean } };
    expect(automation).toMatchObject({ prompt: SECRET, enabled: true });

    const list = (await (await app.request("/automations", { headers: auth })).json()) as { automations: unknown[] };
    expect(list.automations).toHaveLength(1);

    const one = await app.request(`/automations/${automation.id}`, { headers: auth });
    expect(one.status).toBe(200);

    const patched = await put(`/automations/${automation.id}`, { enabled: false });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { automation: { enabled: boolean } }).automation.enabled).toBe(false);

    const removed = await app.request(`/automations/${automation.id}`, { method: "DELETE", headers: auth });
    expect(removed.status).toBe(204);
    expect((await app.request(`/automations/${automation.id}`, { headers: auth })).status).toBe(404);
  });

  test("bad input returns 400 with the validation message", async () => {
    const res = await post("/automations", { ...valid, scheduleCron: "* * * * *" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "schedule runs more often than every 5 minutes" });

    const notObject = await app.request("/automations", { method: "POST", headers: json, body: "[]" });
    expect(notObject.status).toBe(400);

    const badRoom = await post("/automations", { ...valid, roomId: "ghost" });
    expect(await badRoom.json()).toEqual({ error: "room not found" });
  });

  test("PUT with bad input returns 400; unknown ids return 404 on every id route", async () => {
    const { automation } = (await (await post("/automations", valid)).json()) as { automation: { id: string } };
    const bad = await put(`/automations/${automation.id}`, { prompt: "" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "prompt: prompt is required" });

    expect((await app.request("/automations/nope", { headers: auth })).status).toBe(404);
    expect((await put("/automations/nope", { enabled: false })).status).toBe(404);
    expect((await app.request("/automations/nope", { method: "DELETE", headers: auth })).status).toBe(404);
    expect((await app.request("/automations/nope/run", { method: "POST", headers: auth })).status).toBe(404);
  });

  test("the audit event carries no prompt text", async () => {
    await post("/automations", valid);
    const events = ledger.list("_system").filter((e) => e.type === "config");
    expect(events.map((e) => (e.payload as { action: string }).action)).toEqual(["automation_created"]);
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});

describe("POST /automations/:id/run", () => {
  test("returns 202 and runs in the background", async () => {
    const { automation } = (await (await post("/automations", valid)).json()) as { automation: { id: string } };
    const res = await app.request(`/automations/${automation.id}/run`, { method: "POST", headers: auth });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({started:true,runId:expect.any(String)});
    await vi.waitFor(() => expect(manager.get(automation.id)?.lastStatus).toBe("completed"), { timeout: 10_000, interval: 25 });
    expect(turns).toBe(1);
    const actions = ledger.list("_system").map((e) => (e.payload as { action?: string }).action);
    expect(actions).toContain("automation_run_now");
  });
});
