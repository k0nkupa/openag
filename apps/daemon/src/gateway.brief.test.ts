import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { setSetting } from "./settings.js";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };
const json = { ...auth, "content-type": "application/json" };
const NOW = Date.parse("2026-10-27T09:00:00Z");

let dir: string;
let db: Db;
let ledger: Ledger;
let app: ReturnType<typeof createGateway>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-brief-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  setSetting(db, "deliveryRoom", { roomId: "main" });
  addMember(db, "main", "boss");
  ledger = createLedger(db);
  app = createGateway({
    db,
    ledger,
    approvals: createApprovals(db, ledger),
    auth: createAuth({ db, ownerToken: TOKEN }),
    dispatch: () => undefined,
    deskDir: join(dir, "no-desk"),
    now: () => NOW,
    tz: "UTC",
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function addDigest(text: string, ts: number) {
  db.prepare("INSERT INTO digest_items (ts, bot_id, text, dedupe_key, decision_id) VALUES (?, 'boss', ?, ?, 0)").run(
    ts,
    text,
    `k-${ts}`,
  );
}

describe("GET /digest", () => {
  test("requires the bearer token", async () => {
    expect((await app.request("/digest")).status).toBe(401);
    expect((await app.request("/brief", { method: "POST" })).status).toBe(401);
  });

  test("returns only undelivered items, oldest first, in the documented shape", async () => {
    addDigest("newer", NOW - 1000);
    addDigest("older", NOW - 5000);
    addDigest("done", NOW - 9000);
    db.prepare("UPDATE digest_items SET delivered_at = ? WHERE text = 'done'").run(NOW);

    const res = await app.request("/digest", { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items.map((i) => i.text)).toEqual(["older", "newer"]);
    expect(Object.keys(body.items[0]!).sort()).toEqual(["botId", "dedupeKey", "id", "text", "ts"]);
    expect(body.items[0]).toMatchObject({ botId: "boss", ts: NOW - 5000 });
  });
});

describe("POST /brief", () => {
  test("sends now, ignoring the schedule and settings", async () => {
    addDigest("waiting", NOW - 1000);
    db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('brief', ?, 0)").run(
      JSON.stringify({ enabled: false, time: "23:59", days: [0] }),
    );
    const res = await app.request("/brief", { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(ledger.list("main").some((e) => e.type === "message" && (e.payload as { brief?: boolean }).brief === true)).toBe(
      true,
    );
  });

  test("an empty queue returns sent false with reason empty", async () => {
    const res = await app.request("/brief", { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: false, reason: "empty" });
  });
});

describe("PUT /settings/brief", () => {
  const put = (key: string, body: unknown) =>
    app.request(`/settings/${key}`, { method: "PUT", headers: json, body: JSON.stringify(body) });

  test("validates the value and stores the parsed result", async () => {
    expect((await put("brief", { enabled: true, time: "25:00", days: [0] })).status).toBe(400);
    expect((await put("brief", { enabled: true, time: "07:30", days: [] })).status).toBe(400);
    expect((await put("brief", { enabled: true, time: "07:30", days: [0, 0] })).status).toBe(400);
    expect((await put("brief", { enabled: true, time: "07:30", days: [7] })).status).toBe(400);

    const res = await put("brief", { enabled: false, time: "08:15", days: [1, 2] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: "brief", value: { enabled: false, time: "08:15", days: [1, 2] } });
  });

  test("briefState is not a setting and cannot be written", async () => {
    expect((await put("briefState", { lastSentDate: "2026-10-27" })).status).toBe(404);
  });
});
