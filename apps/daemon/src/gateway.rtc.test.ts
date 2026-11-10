import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { openDb, type Db } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { createNtfySignaling } from "./rtc.js";
import { getSetting, setSetting } from "./settings.js";

const OWNER = "owner-rtc-gw-token";
let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-rtc-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const ledger = createLedger(db);
  const auth = createAuth({ db, ownerToken: OWNER });
  const rtc = { reload: vi.fn(), createInvite: vi.fn(() => ({ secret: "s3cr3t-join-secret", expiresAt: Date.now() + 1000 })), status: vi.fn(() => ({ enabled: true, turn: false, inert: null, subscribed: true, peers: 0, offers: 0, rejected: 0, lastError: null })) };
  const app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none"), rtc });
  const device = auth.createDevice("phone").token;
  return { app, ledger, rtc, owner: { authorization: `Bearer ${OWNER}`, "content-type": "application/json" }, dev: { authorization: `Bearer ${device}`, "content-type": "application/json" } };
}

describe("rtc routes", () => {
  test("only the owner enables WebRTC or creates the topic; the topic is never in the audit trail", async () => {
    const { app, rtc, owner, dev, ledger } = setup();
    expect((await app.request("/rtc/topic", { method: "POST", headers: dev })).status).toBe(403);
    expect((await app.request("/settings/rtc", { method: "PUT", headers: dev, body: JSON.stringify({ enabled: true }) })).status).toBe(403);
    const res = await app.request("/rtc/topic", { method: "POST", headers: owner });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("openag-rtc-");
    const topic = getSetting(db, "rtc").topic!;
    expect(topic).toMatch(/^openag-rtc-/);
    const put = await app.request("/settings/rtc", { method: "PUT", headers: owner, body: JSON.stringify({ ...getSetting(db, "rtc"), enabled: true }) });
    expect(put.status).toBe(200);
    expect(rtc.reload).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(ledger.list("_system"))).not.toContain(topic);
    expect((await app.request("/settings/rtc", { method: "PUT", headers: owner, body: JSON.stringify({ enabled: true, server: "ftp://x", topic: null }) })).status).toBe(400);
  });

  test("an invite (rendezvous + topic + single-use code) needs WebRTC enabled and auth", async () => {
    const { app, owner, dev } = setup();
    expect((await app.request("/rtc/invite", { method: "POST" })).status).toBe(401);
    expect((await app.request("/rtc/invite", { method: "POST", headers: dev })).status).toBe(409);
    setSetting(db, "rtc", { enabled: true, server: "https://ntfy.sh", topic: "openag-rtc-abcdefghijklmnopqrstuv", stun: [] });
    const res = await app.request("/rtc/invite", { method: "POST", headers: dev });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ server: "https://ntfy.sh", topic: "openag-rtc-abcdefghijklmnopqrstuv", code: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/), secret: "s3cr3t-join-secret" });
    expect((await app.request("/rtc", { headers: owner })).status).toBe(200);
    // the listing never shows the topic, and a round-tripped "(set)" keeps the stored one
    const listed = (await (await app.request("/settings", { headers: dev })).json()) as { settings: { rtc: { topic: string } } };
    expect(listed.settings.rtc.topic).toBe("(set)");
    const put = await app.request("/settings/rtc", { method: "PUT", headers: owner, body: JSON.stringify({ ...listed.settings.rtc, enabled: true }) });
    expect(put.status).toBe(200);
    expect(getSetting(db, "rtc").topic).toBe("openag-rtc-abcdefghijklmnopqrstuv");
    expect((await app.request("/settings/rtc", { method: "PUT", headers: owner, body: JSON.stringify({ enabled: true, server: "http://evil.example", topic: null }) })).status).toBe(400);
  });
});

describe("ntfy signaling", () => {
  test("publish goes to the server root as JSON to a sub-topic; subscribe parses message lines only", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode('{"event":"open"}\n{"event":"keepalive"}\n{"event":"message","message":"hello"}\nnot json\n{"event":"mess'));
        c.enqueue(enc.encode('age","message":"world"}\n'));
        c.close();
      },
    });
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return String(url).endsWith("/json") ? new Response(stream, { status: 200 }) : new Response("{}", { status: 200 });
    });
    const sig = createNtfySignaling({ server: "https://ntfy.example/", topic: "openag-rtc-T" }, f as unknown as typeof fetch);
    const got: string[] = [];
    const states: boolean[] = [];
    const stop = sig.subscribe((m) => got.push(m), (ok) => states.push(ok));
    await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(got).toEqual(["hello", "world"]);
    expect(states[0]).toBe(true);
    expect(calls[0]).toMatchObject({ url: "https://ntfy.example/openag-rtc-T/json" });
    expect((calls[0]!.init as { redirect?: string }).redirect).toBe("error");
    await sig.publish("abc12345", "payload");
    const pub = calls.at(-1)!;
    expect(pub.url).toBe("https://ntfy.example/");
    expect(JSON.parse(String(pub.init.body))).toMatchObject({ topic: "openag-rtc-T-abc12345", message: "payload" });
    expect((pub.init as { redirect?: string }).redirect).toBe("error");
  });
});
