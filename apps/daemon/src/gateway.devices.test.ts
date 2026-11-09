import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { type Auth, createAuth } from "./auth.js";
import { createApprovals } from "./approvals.js";
import { type Db, openDb } from "./db/index.js";
import { attachStream, clientKey, createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";

const OWNER = "owner-test-token";
const owner = { authorization: `Bearer ${OWNER}` };
const jsonHeaders = { "content-type": "application/json" };

let dir: string;
let db: Db;
let ledger: Ledger;
let auth: Auth;
let app: ReturnType<typeof createGateway>;
let clock: number;

function build() {
  ledger = createLedger(db);
  auth = createAuth({ db, ownerToken: OWNER, now: () => clock });
  app = createGateway({
    db,
    ledger,
    approvals: createApprovals(db, ledger),
    auth,
    dispatch: () => {},
    deskDir: join(dir, "empty-desk"),
    now: () => clock,
  });
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { ...jsonHeaders, ...headers }, body: JSON.stringify(body) });
const systemEvents = () => ledger.list("_system", { limit: 500 });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-dev-"));
  db = openDb(dir);
  clock = 5_000_000;
  build();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("auth middleware", () => {
  test("missing, wrong and revoked tokens get 401 on ordinary routes", async () => {
    expect((await app.request("/rooms")).status).toBe(401);
    expect((await app.request("/rooms", { headers: bearer("nope") })).status).toBe(401);
    const created = await post("/devices", { name: "p" }, owner);
    const { token, device } = (await created.json()) as { token: string; device: { id: string } };
    expect((await app.request("/rooms", { headers: bearer(token) })).status).toBe(200);
    await app.request(`/devices/${device.id}`, { method: "DELETE", headers: bearer(token) });
    expect((await app.request("/rooms", { headers: bearer(token) })).status).toBe(401);
  });

  test("the owner token works on normal routes", async () => {
    expect((await app.request("/rooms", { headers: owner })).status).toBe(200);
  });
});

describe("POST /pair", () => {
  test("works without any token and returns a device token", async () => {
    const { code } = auth.createPairingCode("owner");
    const res = await post("/pair", { code, name: "phone" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deviceId: string; token: string };
    expect(body.deviceId).toMatch(/^[0-9a-f]{16}$/);
    expect(body.token).toMatch(/^oag_/);
    expect((await app.request("/whoami", { headers: bearer(body.token) })).status).toBe(200);
  });

  test("wrong, expired, used and malformed codes all return the same 400", async () => {
    const used = auth.createPairingCode("owner").code;
    await post("/pair", { code: used, name: "x" });
    const expired = auth.createPairingCode("owner").code;
    clock += 5 * 60_000;
    const bodies = [{ code: "ZZZZ-ZZZZ" }, { code: expired }, { code: used }, { code: 5 }, {}, null];
    for (const body of bodies) {
      build(); // fresh rate-limit bucket per attempt; the limiter has its own test
      const res = await post("/pair", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid or expired code" });
    }
  });

  test("a non-JSON body is a 400, not a 500", async () => {
    const res = await app.request("/pair", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
  });

  test("rate limit: 5 attempts per minute, then 429 with Retry-After", async () => {
    for (let i = 0; i < 5; i++) expect((await post("/pair", { code: "ZZZZ-ZZZZ" })).status).toBe(400);
    const limited = await post("/pair", { code: "ZZZZ-ZZZZ" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too many attempts" });
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  test("a successful redemption is audited without the code or token", async () => {
    const { code } = auth.createPairingCode("owner");
    const body = (await (await post("/pair", { code, name: "phone" })).json()) as { token: string; deviceId: string };
    const redeemed = systemEvents().find((e) => (e.payload as { action?: string }).action === "pairing_redeemed");
    expect(redeemed?.payload).toEqual({
      action: "pairing_redeemed",
      deviceId: body.deviceId,
      name: "phone",
      by: "owner", // who created the code, not the redeeming device
    });
    expect(JSON.stringify(systemEvents())).not.toContain(body.token);
    expect(JSON.stringify(systemEvents())).not.toContain(code.replace("-", ""));
  });

  test("failed attempts are audited at most once per minute", async () => {
    const countFailed = () =>
      systemEvents().filter((e) => (e.payload as { action?: string }).action === "pairing_failed").length;
    await post("/pair", { code: "ZZZZ-ZZZZ" });
    await post("/pair", { code: "ZZZZ-ZZZZ" });
    expect(countFailed()).toBe(1);
    clock += 60_000;
    await post("/pair", { code: "ZZZZ-ZZZZ" });
    expect(countFailed()).toBe(2);
  });
});

describe("devices routes", () => {
  test("GET /whoami reports owner and device principals", async () => {
    expect(await (await app.request("/whoami", { headers: owner })).json()).toEqual({ kind: "owner" });
    const { token, device } = (await (await post("/devices", { name: "lap" }, owner)).json()) as {
      token: string;
      device: { id: string };
    };
    expect(await (await app.request("/whoami", { headers: bearer(token) })).json()).toEqual({
      kind: "device",
      deviceId: device.id,
      name: "lap",
      access: "limited",
    });
  });

  test("POST /devices is owner-only: 403 for a device, 201 for the owner", async () => {
    const { token } = (await (await post("/devices", { name: "a" }, owner)).json()) as { token: string };
    const denied = await post("/devices", { name: "b" }, bearer(token));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "owner token required" });
    const created = await post("/devices", { name: "  c  " }, owner);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { device: { name: string }; token: string };
    expect(body.device.name).toBe("c");
    expect(body.token).toMatch(/^oag_/);
  });

  test("POST /devices is audited without the token", async () => {
    const { token, device } = (await (await post("/devices", { name: "x" }, owner)).json()) as {
      token: string;
      device: { id: string };
    };
    const ev = systemEvents().find((e) => (e.payload as { action?: string }).action === "device_created");
    expect(ev?.payload).toEqual({ action: "device_created", deviceId: device.id, name: "x", access: "limited", by: "owner" });
    expect(JSON.stringify(systemEvents())).not.toContain(token);
  });

  test("GET /devices lists devices with current flag and never hashes or tokens", async () => {
    const { token, device } = (await (await post("/devices", { name: "x" }, owner)).json()) as {
      token: string;
      device: { id: string };
    };
    const raw = await (await app.request("/devices", { headers: bearer(token) })).text();
    const body = JSON.parse(raw) as { devices: Array<{ id: string; current: boolean }> };
    expect(body.devices.find((d) => d.id === device.id)?.current).toBe(true);
    expect(raw).not.toContain(token);
    expect(raw).not.toMatch(/token_hash|tokenHash|[0-9a-f]{64}/);
    const ownerView = (await (await app.request("/devices", { headers: owner })).json()) as {
      devices: Array<{ current: boolean }>;
    };
    expect(ownerView.devices.every((d) => d.current === false)).toBe(true);
  });

  test("POST /devices/pairing-codes works for owner and device, then 429 at the cap", async () => {
    const res = await app.request("/devices/pairing-codes", { method: "POST", headers: owner });
    expect(res.status).toBe(201);
    const { code, expiresAt } = (await res.json()) as { code: string; expiresAt: number };
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(expiresAt).toBe(clock + 300_000);
    const { token } = (await (await post("/devices", { name: "d" }, owner)).json()) as { token: string };
    expect((await app.request("/devices/pairing-codes", { method: "POST", headers: bearer(token) })).status).toBe(201);
    for (let i = 0; i < 3; i++) await app.request("/devices/pairing-codes", { method: "POST", headers: owner });
    const capped = await app.request("/devices/pairing-codes", { method: "POST", headers: owner });
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: "too many active pairing codes" });
    const created = systemEvents().filter((e) => (e.payload as { action?: string }).action === "pairing_code_created");
    expect(created).toHaveLength(5);
    expect(JSON.stringify(systemEvents())).not.toContain(code.replace("-", ""));
  });

  test("DELETE /devices/:id: 204, then 404 for unknown and already revoked", async () => {
    const { device } = (await (await post("/devices", { name: "x" }, owner)).json()) as { device: { id: string } };
    expect((await app.request(`/devices/${device.id}`, { method: "DELETE", headers: owner })).status).toBe(204);
    expect((await app.request(`/devices/${device.id}`, { method: "DELETE", headers: owner })).status).toBe(404);
    expect((await app.request("/devices/nope", { method: "DELETE", headers: owner })).status).toBe(404);
    const revoked = systemEvents().filter((e) => (e.payload as { action?: string }).action === "device_revoked");
    expect(revoked).toHaveLength(1);
    expect(revoked[0]?.payload).toEqual({ action: "device_revoked", deviceId: device.id, by: "owner" });
  });

  test("a device can revoke itself and others", async () => {
    const a = (await (await post("/devices", { name: "a" }, owner)).json()) as { token: string; device: { id: string } };
    const b = (await (await post("/devices", { name: "b" }, owner)).json()) as { token: string; device: { id: string } };
    expect((await app.request(`/devices/${b.device.id}`, { method: "DELETE", headers: bearer(a.token) })).status).toBe(204);
    expect((await app.request(`/devices/${a.device.id}`, { method: "DELETE", headers: bearer(a.token) })).status).toBe(204);
    expect((await app.request("/whoami", { headers: bearer(a.token) })).status).toBe(401);
  });
});

describe("clientKey", () => {
  test("ignores X-Forwarded-For when the peer is not loopback", () => {
    expect(clientKey("203.0.113.9", "1.2.3.4")).toBe("203.0.113.9");
    expect(clientKey("10.0.0.5", undefined)).toBe("10.0.0.5");
  });

  test("trusts only the LAST X-Forwarded-For entry (the one the loopback proxy appended), from loopback peers only", () => {
    for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      // A client-supplied first entry must never choose its own rate-limit bucket.
      expect(clientKey(peer, "9.9.9.9, 198.51.100.7")).toBe("198.51.100.7");
      expect(clientKey(peer, "198.51.100.7")).toBe("198.51.100.7");
      expect(clientKey(peer, undefined)).toBe(peer);
    }
    expect(clientKey("127.0.0.2", "198.51.100.7")).toBe("127.0.0.2");
  });

  test("falls back to unknown without a peer and clips oversized forwarded keys", () => {
    expect(clientKey(undefined, "1.2.3.4")).toBe("unknown");
    expect(clientKey("127.0.0.1", "x".repeat(500))).toHaveLength(64);
  });

  test("a spoofed X-Forwarded-For from a remote peer does not bypass the pairing limit (via app.request)", async () => {
    // app.request has no socket, so the key is "unknown" regardless of the header: the header never widens the bucket.
    for (let i = 0; i < 5; i++) {
      await post("/pair", { code: "ZZZZ-ZZZZ" }, { "x-forwarded-for": `10.0.0.${i}` });
    }
    expect((await post("/pair", { code: "ZZZZ-ZZZZ" }, { "x-forwarded-for": "10.9.9.9" })).status).toBe(429);
  });
});

describe("/stream with devices", () => {
  let server: Server;
  let port: number;
  let detach: () => void;

  beforeEach(async () => {
    server = await new Promise<Server>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s as Server));
    });
    port = (server.address() as { port: number }).port;
    detach = attachStream(server, ledger, auth);
  });
  afterEach(() => {
    detach();
    server.close();
  });

  const open = (token: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/stream?token=${encodeURIComponent(token)}`);
      ws.on("open", () => resolve(ws));
      ws.on("unexpected-response", (_req, res) => reject(new Error(`status ${res.statusCode}`)));
      ws.on("error", reject);
    });

  test("a device token streams events; a revoked device token is refused on upgrade", async () => {
    const { token, device } = (await (await post("/devices", { name: "s" }, owner)).json()) as {
      token: string;
      device: { id: string };
    };
    const ws = await open(token);
    const got = new Promise<{ type: string }>((resolve) => ws.on("message", (d) => resolve(JSON.parse(String(d)))));
    ledger.append("main", "user", "message", { text: "hi" });
    expect((await got).type).toBe("message");
    ws.close();
    await app.request(`/devices/${device.id}`, { method: "DELETE", headers: owner });
    await expect(open(token)).rejects.toThrow("status 401");
  });

  test("a revoked device's open socket is closed with 4001 'revoked'", async () => {
    const { token, device } = (await (await post("/devices", { name: "s" }, owner)).json()) as {
      token: string;
      device: { id: string };
    };
    const ws = await open(token);
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })),
    );
    await app.request(`/devices/${device.id}`, { method: "DELETE", headers: owner });
    expect(await closed).toEqual({ code: 4001, reason: "revoked" });
  });

  test("owner sockets are not closed by device revocations", async () => {
    const { device } = (await (await post("/devices", { name: "s" }, owner)).json()) as { device: { id: string } };
    const ws = await open(OWNER);
    let closed = false;
    ws.on("close", () => {
      closed = true;
    });
    await app.request(`/devices/${device.id}`, { method: "DELETE", headers: owner });
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(false);
    ws.close();
  });
});

describe("hardening additions", () => {
  test("an owner token longer than the device-token cap still authenticates", () => {
    const long = "L".repeat(700);
    const a = createAuth({ db, ownerToken: long });
    expect(a.authenticate(long)).toEqual({ kind: "owner" });
    expect(a.authenticate("L".repeat(699))).toBeNull();
    expect(a.authenticate("x".repeat(600))).toBeNull(); // oversized non-owner tokens are rejected without hashing
  });

  test("code creator is reported on redemption and attributed to a device when a device made the code", () => {
    const { device } = auth.createDevice("laptop");
    const { code } = auth.createPairingCode(device.id);
    const redeemed = auth.redeemPairingCode(code, "phone");
    expect(redeemed?.createdBy).toBe(device.id);
  });

  test("the global /pair backstop holds even when X-Forwarded-For varies per request (loopback proxy)", async () => {
    const server = await new Promise<Server>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s as Server));
    });
    const port = (server.address() as { port: number }).port;
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 40; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/pair`, {
          method: "POST",
          headers: { ...jsonHeaders, "x-forwarded-for": `10.0.${Math.floor(i / 250)}.${i % 250}` },
          body: JSON.stringify({ code: "ZZZZ-ZZZZ", name: "x" }),
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
      expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe("review fixes", () => {
  async function loopbackServer() {
    const server = await new Promise<Server>((resolve) => {
      const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s as Server));
    });
    return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
  }

  test("/pair rejects an oversized body before parsing it (413), and the rest of the API caps bodies too", async () => {
    const { server, base } = await loopbackServer();
    try {
      const big = JSON.stringify({ code: "ZZZZ-ZZZZ", name: "x".repeat(20_000) });
      const res = await fetch(`${base}/pair`, { method: "POST", headers: jsonHeaders, body: big });
      expect(res.status).toBe(413);
      const huge = await fetch(`${base}/rooms/main/messages`, {
        method: "POST",
        headers: { ...jsonHeaders, ...owner },
        body: JSON.stringify({ text: "y".repeat(2 * 1024 * 1024) }),
      });
      expect(huge.status).toBe(413);
      // A normal /pair body still works.
      const ok = await fetch(`${base}/pair`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ code: "ZZZZ-ZZZZ", name: "x" }) });
      expect(ok.status).toBe(400);
    } finally {
      server.close();
    }
  });

  test("a streamed body with no Content-Length is cut off at the cap too", async () => {
    const { server, base } = await loopbackServer();
    try {
      const chunk = new Uint8Array(100 * 1024).fill(97);
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= 50) return controller.close(); // would be 5 MB if fully read
          sent++;
          controller.enqueue(chunk);
        },
      });
      const res = await fetch(`${base}/pair`, { method: "POST", headers: jsonHeaders, body, duplex: "half" } as RequestInit & { duplex: "half" });
      expect(res.status).toBe(413);
      expect(sent).toBeLessThan(50); // the server stopped reading long before the end
    } finally {
      server.close();
    }
  });

  test("one client exhausting its own /pair budget cannot lock out a correct code from another client", async () => {
    const { server, base } = await loopbackServer();
    try {
      const attacker = { ...jsonHeaders, "x-forwarded-for": "203.0.113.9" };
      const statuses: number[] = [];
      for (let i = 0; i < 20; i++) {
        statuses.push((await fetch(`${base}/pair`, { method: "POST", headers: attacker, body: JSON.stringify({ code: "ZZZZ-ZZZZ" }) })).status);
      }
      expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
      expect(statuses.slice(5).every((s) => s === 429)).toBe(true); // refused without charging the shared budget
      const { code } = auth.createPairingCode("owner");
      const real = await fetch(`${base}/pair`, {
        method: "POST",
        headers: { ...jsonHeaders, "x-forwarded-for": "100.64.0.9" },
        body: JSON.stringify({ code, name: "phone" }),
      });
      expect(real.status).toBe(200);
    } finally {
      server.close();
    }
  });

  test("a successful redemption is never charged against the limits", async () => {
    const { server, base } = await loopbackServer();
    try {
      for (let i = 0; i < 8; i++) {
        const { code } = auth.createPairingCode("owner");
        const res = await fetch(`${base}/pair`, { method: "POST", headers: { ...jsonHeaders, "x-forwarded-for": "198.51.100.1" }, body: JSON.stringify({ code, name: `d${i}` }) });
        expect(res.status).toBe(200);
      }
    } finally {
      server.close();
    }
  });
});

describe("devices created by a device, and cascade revoke", () => {
  const del = (id: string, cascade = false, who = owner) =>
    app.request(`/devices/${id}${cascade ? "?cascade=1" : ""}`, { method: "DELETE", headers: who });

  test("created_by is recorded: owner for minted devices, the code creator for redeemed ones, and listed", async () => {
    const a = auth.createDevice("laptop");
    const { code } = auth.createPairingCode(a.device.id);
    const b = auth.redeemPairingCode(code, "phone")!;
    expect(a.device.createdBy).toBe("owner");
    expect(b.device.createdBy).toBe(a.device.id);
    const listed = (await (await app.request("/devices", { headers: owner })).json()) as { devices: { id: string; createdBy: string }[] };
    expect(listed.devices.find((d) => d.id === b.device.id)?.createdBy).toBe(a.device.id);
  });

  test("revoking a device without cascade leaves the devices it created working", async () => {
    const d = auth.createDevice("stolen");
    const e = auth.redeemPairingCode(auth.createPairingCode(d.device.id).code, "child")!;
    expect((await del(d.device.id)).status).toBe(204);
    expect(auth.authenticate(d.token)).toBeNull();
    expect(auth.authenticate(e.token)).not.toBeNull();
  });

  test("cascade revokes the whole tree, including through an already-revoked intermediate, and audits each", async () => {
    const d = auth.createDevice("stolen");
    const e = auth.redeemPairingCode(auth.createPairingCode(d.device.id).code, "child")!;
    const f = auth.redeemPairingCode(auth.createPairingCode(e.device.id).code, "grandchild")!;
    const unrelated = auth.createDevice("mine");
    expect((await del(e.device.id)).status).toBe(204); // revoke the middle one first, no cascade
    expect(auth.authenticate(f.token)).not.toBeNull();
    expect((await del(d.device.id, true)).status).toBe(204);
    expect(auth.authenticate(f.token)).toBeNull(); // grandchild reached through the revoked intermediate
    expect(auth.authenticate(unrelated.token)).not.toBeNull();
    const events = systemEvents().map((x) => x.payload as { action?: string; deviceId?: string; cascadeFrom?: string });
    const cascaded = events.filter((x) => x.action === "device_revoked" && x.cascadeFrom === d.device.id).map((x) => x.deviceId);
    expect(cascaded).toEqual([f.device.id]); // e was already revoked
  });

  test("cascade closes open sockets of the descendants too", () => {
    const closed: string[] = [];
    auth.onRevoke((id) => closed.push(id));
    const d = auth.createDevice("stolen");
    const e = auth.redeemPairingCode(auth.createPairingCode(d.device.id).code, "child")!;
    auth.revokeDeviceTree(d.device.id, true);
    expect(closed.sort()).toEqual([d.device.id, e.device.id].sort());
  });

  test("DELETE returns 404 for an unknown device even with cascade", async () => {
    expect((await del("nope", true)).status).toBe(404);
  });
});

describe("bot processes do not inherit the owner secret", () => {
  test("withoutOwnerSecrets strips OPENAG_TOKEN and nothing else", async () => {
    const { withoutOwnerSecrets } = await import("./runtimes/acp.js");
    const out = withoutOwnerSecrets({ OPENAG_TOKEN: "owner", PATH: "/bin", HOME: "/h" });
    expect(out).toEqual({ PATH: "/bin", HOME: "/h" });
  });
});
