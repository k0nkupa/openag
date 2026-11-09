import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { ensureHeartbeatRoom } from "./heartbeat.js";
import { createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";
import { addMember, createBot, createRoom } from "./rooms.js";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };
const json = { ...auth, "content-type": "application/json" };

let dir: string;
let db: Db;
let ledger: Ledger;
let app: ReturnType<typeof createGateway>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-settings-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  ledger = createLedger(db);
  app = createGateway({
    db,
    ledger,
    approvals: createApprovals(db, ledger),
    auth: createAuth({ db, ownerToken: TOKEN }),
    dispatch: () => undefined,
    deskDir: join(dir, "no-desk"),
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const put = (key: string, body: unknown) =>
  app.request(`/settings/${key}`, { method: "PUT", headers: json, body: JSON.stringify(body) });

describe("settings API", () => {
  test("requires the bearer token", async () => {
    expect((await app.request("/settings")).status).toBe(401);
    expect((await app.request("/settings/heartbeat", { method: "PUT" })).status).toBe(401);
  });

  test("GET /settings returns the defaults when nothing is stored", async () => {
    const res = await app.request("/settings", { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: {
        defaultBot: { botId: null },
        deliveryRoom: { roomId: null },
        backup: { enabled: true, time: "04:00", keep: 7 },
      limits: { maxTurnsPerBotPerDay: 0, maxUnattendedPerDay: 0 },
      rtc: { enabled: false, server: "https://ntfy.sh", topic: null, stun: ["stun:stun.l.google.com:19302"] },
      slack: { enabled: false, roomId: null, channelId: null, allowedUsers: [] },
        apps: { enabled: {}, paused: {} },
      computer: { backend: "cua" },
        reflection: { enabled: false, time: "03:30", botId: null, lookbackHours: 24, maxMemoryProposals: 5, maxSkillProposals: 3 },
        heartbeat: { enabled: false, everyMinutes: 60, botId: null, prompt: null },
        activeHours: { start: "07:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] },
        wake: { dailyPingBudget: 3, dedupeHours: 24, urgencyThreshold: "normal" },
        brief: { enabled: true, time: "07:30", days: [0, 1, 2, 3, 4, 5, 6] },
        push: { enabled: false, server: "https://ntfy.sh", topic: null, publicUrl: null, includeDetail: false, maxPerHour: 20 },
        connectorSignIn: { callbackOrigin: null, deskOrigins: [] },
        dictation: { enabled: false, model: "", provider: "openai" },
        profile: { avatar: null, name: "You" },
        skillLibrary: { assignments: {}, enabled: false },
      },
    });
  });

  test("PUT stores a valid value, returns it, and audits the change", async () => {
    const value = { enabled: true, everyMinutes: 30, botId: "boss", prompt: null };
    const res = await put("heartbeat", value);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: "heartbeat", value });

    const again = (await (await app.request("/settings", { headers: auth })).json()) as { settings: { heartbeat: unknown } };
    expect(again.settings.heartbeat).toEqual(value);

    const audit = ledger.list("_system").find((e) => (e.payload as { action?: string }).action === "setting_changed");
    expect(audit?.payload).toEqual({
      action: "setting_changed",
      key: "heartbeat",
      from: { enabled: false, everyMinutes: 60, botId: null, prompt: null },
      to: value,
    });
  });

  test("PUT with an invalid value is a 400 with the issue text, and nothing is stored", async () => {
    const res = await put("heartbeat", { everyMinutes: 2 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("everyMinutes");
    expect(ledger.list("_system").some((e) => (e.payload as { action?: string }).action === "setting_changed")).toBe(false);
  });

  test("PUT with a non-JSON body is a 400", async () => {
    const res = await app.request("/settings/activeHours", { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: "{" });
    expect(res.status).toBe(400);
  });

  test("PUT an unknown key is a 404", async () => {
    expect((await put("nope", {})).status).toBe(404);
  });

  test("activeHours round-trips", async () => {
    const value = { start: "22:00", end: "06:00", days: [1, 5] };
    expect((await put("activeHours", value)).status).toBe(200);
    const body = (await (await app.request("/settings", { headers: auth })).json()) as { settings: { activeHours: unknown } };
    expect(body.settings.activeHours).toEqual(value);
  });
});

describe("hidden rooms", () => {
  test("rooms whose id starts with _ are not listed, but the room still exists", async () => {
    ensureHeartbeatRoom(db, "boss");
    const list = (await (await app.request("/rooms", { headers: auth })).json()) as { rooms: { id: string }[] };
    expect(list.rooms.map((r) => r.id)).toEqual(["main"]);
    expect((await app.request("/rooms/_heartbeat", { headers: auth })).status).toBe(200);
  });
});
