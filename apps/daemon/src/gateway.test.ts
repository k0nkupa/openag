import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { createAuth } from "./auth.js";
import { createApprovals } from "./approvals.js";
import { type Db, openDb } from "./db/index.js";
import { attachStream, createGateway, type DispatchArgs } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { addMember, createBot, createRoom } from "./rooms.js";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };
const json = { ...auth, "content-type": "application/json" };

let dir: string;
let deskDir: string;
let db: Db;
let dispatched: DispatchArgs[];
let ctx: ReturnType<typeof setup>;

function setup() {
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  const app = createGateway({
    db,
    ledger,
    approvals,
    auth: createAuth({ db, ownerToken: TOKEN }),
    dispatch: (a) => void dispatched.push(a),
    deskDir,
  });
  return { ledger, approvals, app };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-"));
  deskDir = join(dir, "desk");
  mkdirSync(join(deskDir, "assets"), { recursive: true });
  writeFileSync(join(deskDir, "index.html"), "<html>OpenAg desk</html>");
  writeFileSync(join(deskDir, "assets", "app-abc.js"), "console.log(1)");
  writeFileSync(join(deskDir, "sw.js"), "self.x=1");
  writeFileSync(join(deskDir, "manifest.webmanifest"), "{}");
  db = openDb(dir);
  dispatched = [];
  createBot(db, { id: "boss", runtime: "api" });
  createBot(db, { id: "coder", runtime: "acp" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  addMember(db, "main", "coder");
  ctx = setup();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("GET /health is open and reports the sqlite-vec version", async () => {
  const res = await ctx.app.request("/health");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; vec_version: string };
  expect(body.ok).toBe(true);
  expect(body.vec_version).toBeTruthy();
});

test("GET / serves the built index.html without a token", async () => {
  const res = await ctx.app.request("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  const html = await res.text();
  expect(html).toContain("OpenAg desk");
  expect(html).not.toContain(TOKEN);
});

test("static asset headers, content types and HEAD", async () => {
  const { app } = ctx;
  const asset = await app.request("/assets/app-abc.js");
  expect(asset.status).toBe(200);
  expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(asset.headers.get("content-type")).toContain("text/javascript");
  expect(await asset.text()).toBe("console.log(1)");

  const sw = await app.request("/sw.js");
  expect(sw.headers.get("cache-control")).toBe("no-store");
  expect(sw.headers.get("content-type")).toContain("text/javascript");
  const manifest = await app.request("/manifest.webmanifest");
  expect(manifest.headers.get("cache-control")).toBe("no-store");
  expect(manifest.headers.get("content-type")).toBe("application/manifest+json");

  const head = await app.request("/", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-type")).toContain("text/html");
  expect(await head.text()).toBe("");

  expect((await app.request("/", { method: "POST" })).status).toBe(401);
});

test("unknown static path falls through to auth", async () => {
  const { app } = ctx;
  expect((await app.request("/nope.txt")).status).toBe(401);
  expect((await app.request("/nope.txt", { headers: auth })).status).toBe(404);
});

test("dotfiles in the desk dir are never served", async () => {
  writeFileSync(join(deskDir, ".env"), "DOTFILE-SECRET");
  const res = await ctx.app.request("/.env", { headers: auth });
  expect(res.status).toBe(404);
  expect(await res.text()).not.toContain("DOTFILE-SECRET");
});

test("path traversal and escaping symlinks never serve files outside deskDir", async () => {
  const secret = "TOP-SECRET-FILE-CONTENT";
  writeFileSync(join(dir, "secret"), secret);
  symlinkSync(join(dir, "secret"), join(deskDir, "link.txt"));
  const { app } = ctx;
  const paths = [
    "/../secret",
    "/%2e%2e/secret",
    "/assets/..%2f..%2fsecret",
    "/%00",
    "/..%5csecret",
    "/%E0%A4%A",
    "/link.txt",
  ];
  for (const path of paths) {
    for (const headers of [undefined, auth]) {
      const res = await app.request(path, { headers });
      expect(res.status, path).not.toBe(200);
      expect(await res.text(), path).not.toContain(secret);
    }
  }
});

test("a desk file named like an API route does not shadow the API", async () => {
  writeFileSync(join(deskDir, "rooms"), "STATIC-ROOMS");
  const { app } = ctx;
  expect((await app.request("/rooms")).status).toBe(401);
  const res = await app.request("/rooms", { headers: auth });
  expect(res.status).toBe(200);
  expect(await res.text()).not.toContain("STATIC-ROOMS");
});

test("PATCH /rooms/:id renames, describes and changes the lead (owner only, members only, audited)", async () => {
  const { app, ledger } = ctx;
  createBot(db, { id: "outsider", runtime: "api" });
  const patch = (body: unknown, headers: Record<string, string> = json) => app.request("/rooms/main", { method: "PATCH", headers, body: JSON.stringify(body) });
  expect((await patch({ name: "x" }, { "content-type": "application/json" })).status).toBe(401);
  expect((await patch({})).status).toBe(400);
  expect((await patch({ name: "  " })).status).toBe(400);
  expect((await patch({ name: "x".repeat(81) })).status).toBe(400);
  expect((await patch({ id: "other" })).status).toBe(400);
  expect((await patch({ leadBotId: "outsider" })).status).toBe(400);
  expect((await app.request("/rooms/_system", { method: "PATCH", headers: json, body: JSON.stringify({ name: "x" }) })).status).toBe(404);
  const res = await patch({ name: " Team room ", description: "Planning and review", leadBotId: "coder" });
  expect(res.status).toBe(200);
  const { room } = (await res.json()) as { room: Record<string, unknown> };
  expect(room).toMatchObject({ id: "main", name: "Team room", description: "Planning and review", leadBotId: "coder" });
  expect(((await (await app.request("/rooms", { headers: auth })).json()) as { rooms: Array<Record<string, unknown>> }).rooms[0]).toMatchObject({ name: "Team room", leadBotId: "coder" });
  const audit = ledger.list("_system").find((e) => (e.payload as { action?: string }).action === "room_updated");
  expect(audit?.payload).toMatchObject({ roomId: "main", changed: ["name", "description", "lead"], lead: { from: "boss", to: "coder" } });
  expect(ledger.list("main").find((e) => (e.payload as { action?: string }).action === "room_lead_changed")?.payload).toMatchObject({ from: "boss", to: "coder" });
  // Omitted fields are kept.
  expect(((await (await patch({ description: "" })).json()) as { room: Record<string, unknown> }).room).toMatchObject({ name: "Team room", leadBotId: "coder", description: "" });
});

test("missing index.html -> GET / is 503", async () => {
  const empty = join(dir, "empty-desk");
  mkdirSync(empty);
  const app = createGateway({ db, ledger: ctx.ledger, approvals: ctx.approvals, auth: createAuth({ db, ownerToken: TOKEN }), dispatch: () => {}, deskDir: empty });
  const res = await app.request("/");
  expect(res.status).toBe(503);
  expect(await res.text()).toBe("Desk not built. Run: pnpm -r build");
});

test("GET /rooms, /rooms/:id and /bots expose only safe bot fields", async () => {
  const { app } = ctx;
  createBot(db, {
    id: "reviewer",
    runtime: "api",
    model: "m1",
    config: { instructions: "SECRET-PERSONA", description: "d", adapter: "codex", canDelegate: true, other: 1 },
  });
  addMember(db, "main", "reviewer");

  for (const path of ["/rooms", "/rooms/main", "/bots"]) {
    expect((await app.request(path)).status, path).toBe(401);
  }

  const rooms = (await (await app.request("/rooms", { headers: auth })).json()) as { rooms: unknown[] };
  expect(rooms.rooms).toEqual([{ id: "main", name: "main", leadBotId: "boss", description: "", members: ["boss", "coder", "reviewer"], router: "lead", kind: "room", routerConfig: null }]);

  const room = await app.request("/rooms/main", { headers: auth });
  expect(room.status).toBe(200);
  const roomBody = (await room.json()) as { room: unknown; bots: Record<string, unknown>[] };
  expect(roomBody.room).toEqual({ id: "main", name: "main", leadBotId: "boss", description: "", members: ["boss", "coder", "reviewer"], router: "lead", kind: "room", routerConfig: null });
  expect(roomBody.bots.map((b) => b.id)).toEqual(["boss", "coder", "reviewer"]);
  expect(roomBody.bots[2]).toEqual({
    id: "reviewer",
    name: "reviewer",
    runtime: "api",
    model: "m1",
    modelRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
    description: "d",
    adapter: "codex",
    canDelegate: true,
  });
  expect(roomBody.bots[0]).toEqual({ id: "boss", name: "boss", runtime: "api", model: null, modelRevision: expect.stringMatching(/^[a-f0-9]{64}$/) });

  expect((await app.request("/rooms/nope", { headers: auth })).status).toBe(404);
  expect(await (await app.request("/rooms/nope", { headers: auth })).json()).toEqual({ error: "room not found" });

  const bots = await app.request("/bots", { headers: auth });
  const botsText = await bots.text();
  expect(botsText).not.toContain("SECRET-PERSONA");
  expect(botsText).not.toContain("instructions");
  expect(botsText).not.toContain('"config"');
  expect(botsText).not.toContain('"other"');
  expect(JSON.parse(botsText).bots).toHaveLength(3);
  const roomText = JSON.stringify(roomBody);
  expect(roomText).not.toContain("SECRET-PERSONA");
  expect(roomText).not.toContain("instructions");
});

test("missing or wrong token -> 401 on every route", async () => {
  const { app } = ctx;
  for (const [method, path] of [
    ["POST", "/rooms/main/messages"],
    ["GET", "/rooms/main/events"],
    ["GET", "/approvals"],
    ["POST", "/approvals/x"],
  ] as const) {
    expect((await app.request(path, { method })).status).toBe(401);
    expect((await app.request(path, { method, headers: { authorization: "Bearer nope" } })).status).toBe(401);
  }
});

test("POST message appends message + route and dispatches", async () => {
  const { app } = ctx;
  const res = await app.request("/rooms/main/messages", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ text: "@coder create hello.txt" }),
  });
  expect(res.status).toBe(202);
  const events = (await (await app.request("/rooms/main/events", { headers: auth })).json()) as {
    events: { type: string; payload: { targets?: string[] } }[];
  };
  expect(events.events.map((e) => e.type)).toEqual(["message", "route"]);
  expect(events.events[1]!.payload.targets).toEqual(["coder"]);
  expect(dispatched).toHaveLength(1);
  expect(dispatched[0]!.botIds).toEqual(["coder"]);
});

test("message validation and unknown room", async () => {
  const { app } = ctx;
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: json, body: JSON.stringify(body) });
  expect((await post("/rooms/main/messages", {})).status).toBe(400);
  expect((await post("/rooms/main/messages", { text: "  " })).status).toBe(400);
  expect((await post("/rooms/nope/messages", { text: "hi" })).status).toBe(404);
  expect((await app.request("/rooms/nope/events", { headers: auth })).status).toBe(404);
});

test("events ?after= filters", async () => {
  const { app, ledger } = ctx;
  const a = ledger.append("main", "user", "message", {});
  ledger.append("main", "user", "message", {});
  const body = (await (await app.request(`/rooms/main/events?after=${a.id}`, { headers: auth })).json()) as {
    events: unknown[];
  };
  expect(body.events).toHaveLength(1);
});

test("approvals list and decide", async () => {
  const { app, approvals } = ctx;
  const { approvalId, wait } = approvals.request({ roomId: "main", botId: "coder", toolName: "write_file", toolClass: "act-local" });
  const list = (await (await app.request("/approvals?status=pending", { headers: auth })).json()) as { approvals: { id: string }[] };
  expect(list.approvals.map((a) => a.id)).toEqual([approvalId]);
  expect((await app.request("/approvals?status=accepted", { headers: auth })).status).toBe(400);

  const post = (id: string, body: unknown) =>
    app.request(`/approvals/${id}`, { method: "POST", headers: json, body: JSON.stringify({ ...body as object, reviewVersion: approvals.get(id)?.reviewVersion }) });
  expect((await post(approvalId, { kind: "bogus" })).status).toBe(400);
  expect((await post(approvalId, { kind: "respond" })).status).toBe(400);
  expect((await post(approvalId, { kind: "accept" })).status).toBe(200);
  await expect(wait()).resolves.toEqual({ kind: "accept" });
  expect((await post(approvalId, { kind: "accept" })).status).toBe(409);
  expect((await post("missing", { kind: "accept" })).status).toBe(404);
});

test("/stream requires the token and pushes ledger events", async () => {
  const { ledger, app } = ctx;
  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s as Server));
  });
  const detach = attachStream(server, ledger, createAuth({ db, ownerToken: TOKEN }));
  const port = (server.address() as { port: number }).port;
  try {
    const bad = new WebSocket(`ws://127.0.0.1:${port}/stream?token=wrong`);
    await new Promise<void>((resolve) => {
      bad.on("unexpected-response", (_req, res) => {
        expect(res.statusCode).toBe(401);
        resolve();
      });
      bad.on("error", () => {});
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/stream?token=${TOKEN}`);
    const received = new Promise<{ type: string }>((resolve) => ws.on("message", (d) => resolve(JSON.parse(String(d)))));
    await new Promise((resolve) => ws.on("open", resolve));
    ledger.append("main", "user", "message", { text: "hi" });
    expect((await received).type).toBe("message");
    ws.close();
  } finally {
    detach();
    server.close();
  }
});

test("POST message stores redacted text for keys and bearer tokens", async () => {
  const { app, ledger } = ctx;
  const key = "sk-" + "g".repeat(30);
  const bearer = "Bearer " + "abcdEFGH1234ijkl5678";
  const res = await app.request("/rooms/main/messages", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ text: `@coder use ${key} with ${bearer}` }),
  });
  expect(res.status).toBe(202);
  const body = (await (await app.request("/rooms/main/events", { headers: auth })).json()) as {
    events: { type: string; payload: { text?: string } }[];
  };
  const message = body.events.find((e) => e.type === "message")!;
  expect(message.payload.text).toContain("[REDACTED:");
  const raw = JSON.stringify(body) + JSON.stringify(ledger.list("main"));
  expect(raw).not.toContain(key);
  expect(raw).not.toContain("abcdEFGH1234ijkl5678");
  const dbRows = db.prepare("SELECT payload_json FROM events").all() as { payload_json: string }[];
  expect(dbRows.map((r) => r.payload_json).join("\n")).not.toContain(key);
});
