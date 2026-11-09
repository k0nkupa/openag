import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import type { Computer } from "./computer.js";
import { createViewProxy, upstreamPath } from "./computerview.js";
import { openDb, type Db } from "./db/index.js";
import { attachStream, createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createTakeover, type Takeover } from "./takeover.js";

const OWNER = "owner-view-token";
const TICKET = "ticket=v1.SECRETTICKET";

let dir: string;
let db: Db | undefined;
let ledger: Ledger;
let takeover: Takeover;
let clock: { t: number };
const closers: Array<() => Promise<void> | void> = [];

interface Seen {
  headers: IncomingMessage["headers"];
  url: string;
}
let seen: Seen[];
let wsSeen: Seen[];

async function listen(s: Server): Promise<number> {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  closers.push(
    () =>
      new Promise<void>((r) => {
        s.closeAllConnections?.();
        s.close(() => r());
      }),
  );
  return (s.address() as AddressInfo).port;
}

async function setup(opts: { idleMs?: number; checkEveryMs?: number } = {}) {
  seen = [];
  wsSeen = [];
  // Stand-in for the sandbox's viewer server.
  const upstream = createServer((req, res) => {
    seen.push({ headers: req.headers, url: req.url ?? "" });
    if (req.url?.startsWith("/viewer/")) {
      res.setHeader("content-type", "text/html");
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("set-cookie", "upstream=1");
      return void res.end("<html>viewer</html>");
    }
    if (req.url === "/files/evil.html") {
      res.setHeader("content-type", "text/html");
      return void res.end("<script>1</script>");
    }
    if (req.url === "/stream") {
      res.write("one,");
      setTimeout(() => res.end("two"), 30);
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => res.end(`echo:${Buffer.concat(chunks).toString()}`));
  });
  const uwss = new WebSocketServer({ server: upstream, handleProtocols: (p) => (p.has("rcdp.v2") ? "rcdp.v2" : false) });
  uwss.on("connection", (ws, req) => {
    wsSeen.push({ headers: req.headers, url: req.url ?? "" });
    if (req.url?.startsWith("/chatty")) {
      const iv = setInterval(() => ws.readyState === ws.OPEN && ws.send("frame"), 10);
      ws.once("close", () => clearInterval(iv));
    }
    ws.on("message", (d, bin) => ws.send(d, { binary: bin }));
  });
  const upPort = await listen(upstream);

  const database = openDb(dir);
  db = database;
  ledger = createLedger(database);
  clock = { t: 1_000_000 };
  const computer = {
    name: "openag-main",
    setInputGuard() {},
    viewLink: async () => ({ origin: `http://127.0.0.1:${upPort}`, fragment: TICKET, expiresAt: Date.now() + 3_600_000 }),
  } as unknown as Computer;
  takeover = createTakeover({ computer, ledger, now: () => clock.t, idleMs: opts.idleMs, checkEveryMs: opts.checkEveryMs ?? 3_600_000 });
  closers.push(() => takeover.dispose());
  const auth = createAuth({ db: database, ownerToken: OWNER });
  const viewProxy = createViewProxy({ takeover });
  const app = createGateway({
    db: database,
    ledger,
    approvals: createApprovals(database, ledger),
    auth,
    dispatch: () => {},
    deskDir: join(dir, "none"),
    computer,
    dataDir: dir,
    takeover,
    viewProxy,
  });
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as unknown as Server;
  await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())));
  closers.push(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
  const detach = attachStream(server, ledger, auth);
  const detachView = viewProxy.attach(server);
  closers.push(() => { detach(); detachView(); });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const bearer = { authorization: `Bearer ${OWNER}` };
  const takeControl = async (headers: Record<string, string> = bearer) => {
    const res = await fetch(`${base}/computer/takeover`, { method: "POST", headers });
    const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
    return { res, cookie, body: res.ok ? ((await res.json()) as { viewPath: string }) : null };
  };
  return { base, port, auth, bearer, takeControl, takeover };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-view-"));
});
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

const openWs = (port: number, path: string, headers: Record<string, string>, protocols: string[] = ["rcdp.v2"]) =>
  new Promise<{ ws?: WebSocket; status?: number }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, protocols, { headers });
    ws.once("open", () => resolve({ ws }));
    ws.once("unexpected-response", (_req, res) => resolve({ status: res.statusCode }));
    ws.once("error", () => undefined);
  });

describe("upstreamPath", () => {
  test.each([
    ["/computer/view/viewer/", "/viewer/"],
    ["/computer/view/a.B/c", "/a.B/c"],
  ])("%s -> %s", (p, want) => expect(upstreamPath(p)).toBe(want));
  test.each(["/computer/view/../x", "/computer/view/a/%2e%2e/b", "/computer/view//x", "/computer/view/a%2fb", "/computer/view/a%5cb", "/computer/view/a\\b", "/computer/view/a%00", "/computer/view/./x", "/computer/viewx/", "/x"])(
    "%s is refused",
    (p) => expect(upstreamPath(p)).toBeNull(),
  );
});

describe("view proxy over HTTP", () => {
  test("no cookie, the Bearer owner token, or a forged cookie -> 401; a view session works", async () => {
    const h = await setup();
    expect((await fetch(`${h.base}/computer/view/viewer/`)).status).toBe(401);
    const { cookie, body } = await h.takeControl();
    expect(body!.viewPath).toBe(`/computer/view/viewer/#${TICKET}`);
    expect((await fetch(`${h.base}/computer/view/viewer/`, { headers: h.bearer })).status).toBe(401);
    expect((await fetch(`${h.base}/computer/view/viewer/`, { headers: { cookie: "oag_view=forged-forged-forged-forged" } })).status).toBe(401);
    const ok = await fetch(`${h.base}/computer/view/viewer/`, { headers: { cookie } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("viewer");
    // The view cookie is no API credential either.
    expect((await fetch(`${h.base}/computer`, { headers: { cookie } })).status).toBe(401);
  });

  test("the viewer's cookie-less RPC fetches authenticate with the current ticket, and only that", async () => {
    const h = await setup();
    const rpc = (authorization?: string) =>
      fetch(`${h.base}/computer/view/rpc`, { method: "POST", body: "x", headers: authorization ? { authorization } : {} });
    expect((await rpc(`Bearer ${TICKET.split("=")[1]}`)).status).toBe(401); // nobody holds control yet
    await h.takeControl();
    expect((await rpc(`Bearer ${TICKET.split("=")[1]}`)).status).toBe(200);
    expect((await rpc("Bearer wrong")).status).toBe(401);
    expect((await rpc(`Bearer ${OWNER}`)).status).toBe(401);
    expect((await rpc()).status).toBe(401);
    // The real viewer sends its ticket in x-cua-env-authorization, and it must reach the viewer server.
    const viaCua = await fetch(`${h.base}/computer/view/rpc`, { method: "POST", body: "x", headers: { "x-cua-env-authorization": `Bearer ${TICKET.split("=")[1]}` } });
    expect(viaCua.status).toBe(200);
    expect(seen.at(-1)!.headers["x-cua-env-authorization"]).toBe(`Bearer ${TICKET.split("=")[1]}`);
    await fetch(`${h.base}/computer/handback`, { method: "POST", headers: h.bearer });
    expect((await rpc(`Bearer ${TICKET.split("=")[1]}`)).status).toBe(401);
  });

  test("forwards the viewer's authorization but never the cookie or proxy headers; drops upstream cookies and CORS", async () => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    const res = await fetch(`${h.base}/computer/view/viewer/`, {
      headers: { cookie, authorization: "Bearer viewer-ticket", "x-forwarded-for": "1.2.3.4", "x-custom": "nope" },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const got = seen.at(-1)!.headers;
    expect(got.authorization).toBe("Bearer viewer-ticket");
    expect(got.cookie).toBeUndefined();
    expect(got["x-forwarded-for"]).toBeUndefined();
    expect(got["x-custom"]).toBeUndefined();
    expect(got.host).toBe(new URL(`http://${got.host}`).host);
  });

  test("HTML other than the viewer page is sandboxed, and nothing is sniffed", async () => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    const evil = await fetch(`${h.base}/computer/view/files/evil.html`, { headers: { cookie } });
    expect(evil.headers.get("content-security-policy")).toContain("sandbox");
    expect(evil.headers.get("x-content-type-options")).toBe("nosniff");
    const page = await fetch(`${h.base}/computer/view/viewer/`, { headers: { cookie } });
    expect(page.headers.get("content-security-policy")).toBeNull();
  });

  test("streams response bodies and forwards request bodies", async () => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    expect(await (await fetch(`${h.base}/computer/view/stream`, { headers: { cookie } })).text()).toBe("one,two");
    const post = await fetch(`${h.base}/computer/view/rpc`, { method: "POST", headers: { cookie }, body: "payload" });
    expect(await post.text()).toBe("echo:payload");
  });

  test.each(["/computer/view//x", "/computer/view/a%5cb", "/computer/view/a%2fb"])("path trick %s -> 400 and never reaches upstream", async (p) => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    // Raw request: fetch() would normalise dot segments before they reach us.
    const status = await new Promise<number>((resolve, reject) => {
      const r = httpRequest({ host: "127.0.0.1", port: h.port, path: p, headers: { cookie } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      r.on("error", reject);
      r.end();
    });
    expect(status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  test("dot segments are normalised by the server stack before routing, so they can never leave the viewer prefix", async () => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    const get = (path: string) =>
      new Promise<number>((resolve, reject) => {
        const r = httpRequest({ host: "127.0.0.1", port: h.port, path, headers: { cookie } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        r.on("error", reject);
        r.end();
      });
    await get("/computer/view/a/%2e%2e/b");
    expect(seen.map((x) => x.url)).toEqual(["/b"]);
    seen.length = 0;
    // Escapes the prefix: not proxied at all (the view cookie is no API credential).
    expect(await get("/computer/view/../whoami")).toBe(401);
    expect(await get("/computer/view/../rooms")).toBe(401);
    expect(seen).toHaveLength(0);
  });

  test("after hand-back the same cookie is refused", async () => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    expect((await fetch(`${h.base}/computer/handback`, { method: "POST", headers: h.bearer })).status).toBe(200);
    expect((await fetch(`${h.base}/computer/view/viewer/`, { headers: { cookie } })).status).toBe(401);
  });
});

describe("view proxy over WebSocket", () => {
  test("relays text and binary frames and the subprotocol; the cookie stays here", async () => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    const { ws } = await openWs(h.port, "/computer/view/ws?t=1", { cookie, authorization: "Bearer viewer-ticket" });
    expect(ws).toBeDefined();
    expect(ws!.protocol).toBe("rcdp.v2");
    const got: Array<{ data: string; bin: boolean }> = [];
    ws!.on("message", (d, bin) => got.push({ data: d.toString(), bin }));
    ws!.send("hello");
    ws!.send(Buffer.from([1, 2, 3]));
    await vWait(() => got.length === 2);
    expect(got[0]).toEqual({ data: "hello", bin: false });
    expect(got[1]!.bin).toBe(true);
    expect([...Buffer.from(got[1]!.data, "binary")]).toEqual([1, 2, 3]);
    expect(wsSeen[0]!.url).toBe("/ws?t=1");
    expect(wsSeen[0]!.headers.cookie).toBeUndefined();
    expect(wsSeen[0]!.headers.authorization).toBe("Bearer viewer-ticket");
    ws!.close();
  });

  test("no cookie -> 401; cross-site Origin -> 403; Bearer owner token is not a view credential", async () => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    expect((await openWs(h.port, "/computer/view/ws", {})).status).toBe(401);
    expect((await openWs(h.port, "/computer/view/ws", h.bearer)).status).toBe(401);
    expect((await openWs(h.port, "/computer/view/ws", { cookie, origin: "http://evil.example" })).status).toBe(403);
    const same = await openWs(h.port, "/computer/view/ws", { cookie, origin: `http://127.0.0.1:${h.port}` });
    expect(same.ws).toBeDefined();
    same.ws!.close();
    expect((await openWs(h.port, "/computer/view//ws", { cookie })).status).toBe(400);
  });

  test("a duplicated or malformed subprotocol is refused with 400 and does not take the daemon down", async () => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    const raw = await new Promise<string>((resolve) => {
      const r = httpRequest({ host: "127.0.0.1", port: h.port, path: "/computer/view/ws", headers: { cookie, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-protocol": "rcdp.v2, rcdp.v2" } });
      r.on("response", (res) => resolve(String(res.statusCode)));
      r.on("upgrade", () => resolve("upgraded"));
      r.on("error", () => resolve("error"));
      r.end();
    });
    expect(raw).toBe("400");
    expect((await fetch(`${h.base}/computer/takeover`, { headers: h.bearer })).status).toBe(200); // still alive
  });

  test("at most 8 view sockets; the 9th is refused", async () => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    const open: WebSocket[] = [];
    for (let i = 0; i < 8; i++) open.push((await openWs(h.port, "/computer/view/ws", { cookie })).ws!);
    expect((await openWs(h.port, "/computer/view/ws", { cookie })).status).toBe(503);
    for (const w of open) w.close();
  });

  test("frames the viewer streams by itself do not count as activity", async () => {
    const h = await setup({ idleMs: 60_000, checkEveryMs: 20 });
    const { cookie } = await h.takeControl();
    const { ws } = await openWs(h.port, "/computer/view/chatty", { cookie });
    ws!.on("error", () => undefined);
    let frames = 0;
    ws!.on("message", () => frames++);
    await vWait(() => frames > 3); // the upstream is streaming on its own
    clock.t += 61_000;
    await vWait(() => !h.takeover.state().active);
  });

  test("hand-back closes open view sockets", async () => {
    const h = await setup();
    const { cookie } = await h.takeControl();
    const { ws } = await openWs(h.port, "/computer/view/ws", { cookie });
    const closed = new Promise<number>((r) => ws!.once("close", (code) => r(code)));
    await fetch(`${h.base}/computer/handback`, { method: "POST", headers: h.bearer });
    expect(await closed).toBe(4002);
  });
});

describe("takeover lifecycle", () => {
  test("a second device cannot take while held; the holder can hand back; events carry no ticket or cookie", async () => {
    const h = await setup();
    const dev1 = { token: h.auth.createDevice("phone").token };
    const dev2 = { token: h.auth.createDevice("tablet").token };
    const t1 = await h.takeControl({ authorization: `Bearer ${dev1.token}` });
    expect(t1.res.status).toBe(200);
    const t2 = await h.takeControl({ authorization: `Bearer ${dev2.token}` });
    expect(t2.res.status).toBe(409);
    const state = (await (await fetch(`${h.base}/computer/takeover`, { headers: h.bearer })).json()) as Record<string, unknown>;
    expect(state).toMatchObject({ active: true, by: { kind: "device", name: "phone" } });
    expect(JSON.stringify(state)).not.toContain("TICKET");
    await fetch(`${h.base}/computer/handback`, { method: "POST", headers: h.bearer });
    expect((await h.takeControl({ authorization: `Bearer ${dev2.token}` })).res.status).toBe(200);
    const events = ledger.list("_system").filter((e) => e.type === "takeover");
    expect(events.map((e) => (e.payload as { action: string }).action)).toEqual(["take", "release", "take"]);
    const dump = JSON.stringify(events);
    expect(dump).not.toContain("SECRETTICKET");
    expect(dump).not.toContain(t1.cookie.split("=")[1]!);
  });

  test("idle for 30 min releases and invalidates the session; activity postpones it", async () => {
    const h = await setup({ idleMs: 30 * 60_000, checkEveryMs: 20 });
    const { cookie } = await h.takeControl();
    clock.t += 20 * 60_000;
    await fetch(`${h.base}/computer/view/viewer/`, { headers: { cookie } }); // activity resets the idle clock
    clock.t += 20 * 60_000;
    await new Promise((r) => setTimeout(r, 80));
    expect(h.takeover.state().active).toBe(true);
    clock.t += 11 * 60_000;
    await vWait(() => !h.takeover.state().active);
    expect((await fetch(`${h.base}/computer/view/viewer/`, { headers: { cookie } })).status).toBe(401);
    const last = ledger.list("_system").filter((e) => e.type === "takeover").at(-1)!;
    expect(last.payload).toMatchObject({ action: "release", reason: "idle" });
  });

  test("revoking the holding device releases control", async () => {
    const h = await setup();
    const dev = h.auth.createDevice("phone");
    await h.takeControl({ authorization: `Bearer ${dev.token}` });
    h.auth.onRevoke((id) => h.takeover.releaseIfHeldBy(id, "revoked"));
    h.auth.revokeDevice(dev.device.id);
    expect(h.takeover.state().active).toBe(false);
  });
});

async function vWait(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}
