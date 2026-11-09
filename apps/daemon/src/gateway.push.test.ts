import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createPusher } from "./push.js";
import { createRedactor, getDefaultRedactor, resetDefaultRedactor } from "./redact.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { setSetting } from "./settings.js";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };
const json = { ...auth, "content-type": "application/json" };
const TOPIC_RE = /^openag-[A-Za-z0-9_-]{22}$/;

let dir: string;
let db: Db;
let ledger: Ledger;
let fetchMock: ReturnType<typeof vi.fn>;
let app: ReturnType<typeof createGateway>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  resetDefaultRedactor();
  dir = mkdtempSync(join(tmpdir(), "openag-gw-push-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  ledger = createLedger(db);
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  const push = createPusher({ db, fetch: fetchMock as unknown as typeof fetch, redactor: createRedactor({ env: {} }) });
  app = createGateway({
    db,
    ledger,
    approvals: createApprovals(db, ledger),
    auth: createAuth({ db, ownerToken: TOKEN }),
    dispatch: () => undefined,
    deskDir: join(dir, "no-desk"),
    push,
  });
  consoleSpies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")].map((s) =>
    s.mockImplementation(() => undefined),
  );
});
afterEach(() => {
  for (const s of consoleSpies) s.mockRestore();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, headers: Record<string, string> = auth) => app.request(path, { method: "POST", headers });
const put = (key: string, body: unknown) =>
  app.request(`/settings/${key}`, { method: "PUT", headers: json, body: JSON.stringify(body) });
const pushValue = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  server: "https://ntfy.sh",
  topic: null,
  publicUrl: null,
  includeDetail: false,
  maxPerHour: 20,
  ...over,
});

describe("push routes", () => {
  test("all /push routes require the bearer token", async () => {
    expect((await post("/push/topic", {})).status).toBe(401);
    expect((await post("/push/test", {})).status).toBe(401);
    expect((await app.request("/push/status")).status).toBe(401);
  });

  test("POST /push/topic returns a fresh topic, stores it and registers it with the redactor", async () => {
    const res = await post("/push/topic");
    expect(res.status).toBe(200);
    const { topic } = (await res.json()) as { topic: string };
    expect(topic).toMatch(TOPIC_RE);

    const stored = await (await app.request("/settings", { headers: auth })).json() as { settings: { push: { topic: string } } };
    expect(stored.settings.push.topic).toBe(topic);
    expect(getDefaultRedactor().redactString(`x ${topic} y`)).not.toContain(topic);
  });

  test("40 generated topics are distinct and well formed", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const { topic } = (await (await post("/push/topic")).json()) as { topic: string };
      expect(topic).toMatch(TOPIC_RE);
      seen.add(topic);
    }
    expect(seen.size).toBe(40);
  });

  test("regenerating keeps the other fields and never writes the topic to the ledger or logs", async () => {
    await put("push", pushValue({ includeDetail: true, maxPerHour: 7 }));
    const { topic } = (await (await post("/push/topic")).json()) as { topic: string };
    const settings = (await (await app.request("/settings", { headers: auth })).json()) as {
      settings: { push: Record<string, unknown> };
    };
    expect(settings.settings.push).toMatchObject({ enabled: true, includeDetail: true, maxPerHour: 7, topic });

    const audit = JSON.stringify(ledger.list("_system"));
    expect(audit).toContain('"key":"push"');
    expect(audit).not.toContain(topic);
    const logged = JSON.stringify(consoleSpies.map((s) => s.mock.calls));
    expect(logged).not.toContain(topic);
  });

  test("POST /push/test is 409 when disabled or unconfigured", async () => {
    const res = await post("/push/test");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "push is not enabled or has no topic" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("POST /push/test sends when enabled with a topic", async () => {
    const { topic } = (await (await post("/push/topic")).json()) as { topic: string };
    await put("push", pushValue({ topic }));
    const res = await post("/push/test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("POST /push/test reports a failure with 200 and a short reason", async () => {
    const { topic } = (await (await post("/push/topic")).json()) as { topic: string };
    await put("push", pushValue({ topic }));
    fetchMock.mockImplementationOnce(async () => new Response("", { status: 503 }));
    const body = (await (await post("/push/test")).json()) as { ok: boolean; reason?: string };
    expect(body).toEqual({ ok: false, reason: "HTTP 503" });
  });

  test("GET /push/status returns the pusher status without the topic", async () => {
    const res = await app.request("/push/status", { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: false,
      configured: false,
      sentThisHour: 0,
      dropped: 0,
      lastSentAt: null,
      lastError: null,
    });
  });
});

describe("push settings", () => {
  test("PUT stores a valid topic and audits it masked", async () => {
    const topic = "openag-abcdefghijklmnop";
    expect((await put("push", pushValue({ topic }))).status).toBe(200);
    const audit = ledger.list("_system").find((e) => (e.payload as { key?: string }).key === "push");
    expect(audit?.payload).toEqual({
      action: "setting_changed",
      key: "push",
      from: { ...pushValue(), topic: null, enabled: false },
      to: { ...pushValue(), topic: "(set)" },
    });
    expect(JSON.stringify(ledger.list("_system"))).not.toContain(topic);
    expect(getDefaultRedactor().redactString(topic)).not.toBe(topic);
  });

  test.each([
    ["a non-URL server", { server: "not a url" }],
    ["credentials in the server URL", { server: "https://user:pass@ntfy.example.com" }],
    ["a non-http scheme", { server: "ftp://ntfy.example.com" }],
    ["credentials in the public URL", { publicUrl: "https://u:p@mini.ts.net" }],
    ["a topic that is too short", { topic: "short" }],
    ["a topic with a slash", { topic: "openag/abcdefghijklmnop" }],
    ["maxPerHour above 100", { maxPerHour: 101 }],
  ])("rejects %s", async (_label, patch) => {
    const res = await put("push", pushValue(patch));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  });
});
