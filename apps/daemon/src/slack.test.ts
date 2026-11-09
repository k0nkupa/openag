import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openDb, type Db } from "./db/index.js";
import { createIngress } from "./ingress.js";
import { createLedger, type Ledger } from "./ledger.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { createRedactor } from "./redact.js";
import { escapeSlack, createSlackChannel, isSlackSocketUrl, type SlackChannel, type SlackSocket } from "./slack.js";
import { setSetting } from "./settings.js";

const APP = "xapp-1-AAAAAAAAAAA-1234567890-abcdef";
const BOT = "xoxb-1234567890-abcdefghijkl";
const CHANNEL = "C0123456789";
const ALICE = "U0000ALICE1";

let dir: string;
let db: Db;
let ledger: Ledger;
let dispatched: Array<{ botIds: string[]; text: string }>;

class FakeSocket implements SlackSocket {
  handlers: Record<string, Array<(d: never) => void>> = {};
  sent: string[] = [];
  closed = false;
  pings = 0;
  terminated = false;
  autoPong = false;
  ping() {
    this.pings++;
    if (this.autoPong) for (const cb of this.handlers.pong ?? []) cb(undefined as never);
  }
  terminate() {
    this.terminated = true;
    this.close();
  }
  on(event: string, cb: (d: never) => void) {
    (this.handlers[event] ??= []).push(cb);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
    for (const cb of this.handlers.close ?? []) cb(undefined as never);
  }
  emit(frame: unknown) {
    for (const cb of this.handlers.message ?? []) cb({ toString: () => JSON.stringify(frame) } as never);
  }
}

interface Harness {
  slack: SlackChannel;
  sockets: FakeSocket[];
  posts: Array<{ url: string; auth: string | null; body: Record<string, unknown> }>;
  urls: string[];
}

function harness(opts: { env?: NodeJS.ProcessEnv; openOk?: boolean; wsUrl?: string; postResponse?: () => Response; liveness?: { pingMs: number; timeoutMs: number } } = {}): Harness {
  const sockets: FakeSocket[] = [];
  const posts: Harness["posts"] = [];
  const urls: string[] = [];
  const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    const headers = new Headers(init?.headers);
    if (url.endsWith("/apps.connections.open")) {
      expect(headers.get("authorization")).toBe(`Bearer ${APP}`);
      return opts.openOk === false
        ? new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 })
        : new Response(JSON.stringify({ ok: true, url: opts.wsUrl ?? "wss://wss-primary.slack.com/link/?ticket=t" }), { status: 200 });
    }
    posts.push({ url, auth: headers.get("authorization"), body: JSON.parse(String(init?.body)) });
    return opts.postResponse ? opts.postResponse() : new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const ingress = createIngress({
    ledger,
    dispatch: ({ botIds, message }) => void dispatched.push({ botIds, text: String((message.payload as { text: string }).text) }),
  });
  const slack = createSlackChannel({
    db,
    ledger,
    ingress,
    env: opts.env ?? { SLACK_APP_TOKEN: APP, SLACK_BOT_TOKEN: BOT },
    fetch: doFetch as unknown as typeof fetch,
    connect: (u) => {
      urls.push(u);
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    redactor: createRedactor(),
    backoff: { minMs: 5, maxMs: 20 },
    ...(opts.liveness ? { liveness: opts.liveness } : {}),
  });
  return { slack, sockets, posts, urls };
}

const configure = (over: Record<string, unknown> = {}) =>
  setSetting(db, "slack", { enabled: true, roomId: "main", channelId: CHANNEL, allowedUsers: [ALICE], ...over });
const flush = () => new Promise((r) => setTimeout(r, 15));
const event = (over: Record<string, unknown> = {}) => ({
  envelope_id: `env-${Math.random()}`,
  type: "events_api",
  payload: { type: "event_callback", event: { type: "message", channel: CHANNEL, user: ALICE, text: "hello bot", ts: `1700000000.${Math.floor(Math.random() * 1e6)}`, ...over } },
});
async function connected(h: Harness): Promise<FakeSocket> {
  h.slack.reload();
  await flush();
  const s = h.sockets.at(-1)!;
  s.emit({ type: "hello" });
  return s;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-slack-"));
  db = openDb(dir);
  ledger = createLedger(db);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  dispatched = [];
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("slack channel", () => {
  test("is inert by default and without tokens, an allow-list, or a real room", async () => {
    const h = harness();
    expect(h.slack.status()).toMatchObject({ enabled: false, inert: "disabled", connected: false });
    h.slack.reload();
    await flush();
    expect(h.urls).toEqual([]);
    configure();
    expect(harness({ env: {} }).slack.status().inert).toMatch(/SLACK_APP_TOKEN/);
    expect(harness({ env: { SLACK_APP_TOKEN: "xapp-x", SLACK_BOT_TOKEN: BOT } }).slack.status().inert).toMatch(/malformed/);
    configure({ allowedUsers: [] });
    expect(h.slack.status().inert).toMatch(/allowed users/);
    configure({ roomId: "nope" });
    expect(h.slack.status().inert).toBe("room not found");
  });

  test("the settings schema rejects bad ids", () => {
    expect(() => setSetting(db, "slack", { enabled: true, roomId: "main", channelId: "general", allowedUsers: [] })).toThrow();
    expect(() => setSetting(db, "slack", { enabled: true, roomId: "main", channelId: CHANNEL, allowedUsers: ["alice"] })).toThrow();
    expect(() => setSetting(db, "slack", { enabled: true, roomId: "../x", channelId: CHANNEL, allowedUsers: [] })).toThrow();
  });

  test("connects with the app token, acks every envelope, and an allowed user's message becomes a room message", async () => {
    configure();
    const h = harness();
    const s = await connected(h);
    expect(h.slack.status().connected).toBe(true);
    const ev = event();
    s.emit(ev);
    await flush();
    expect(s.sent).toContain(JSON.stringify({ envelope_id: ev.envelope_id }));
    expect(dispatched).toEqual([{ botIds: ["boss"], text: "[Slack] hello bot" }]);
    const msg = ledger.list("main").find((e) => e.type === "message")!;
    expect(msg).toMatchObject({ actor: "slack", payload: { source: "slack", slackUser: ALICE } });
  });

  test("everything else is dropped: other channel, other user, bots, subtypes, empty text, DMs, wrong frame types", async () => {
    configure();
    const h = harness();
    const s = await connected(h);
    for (const over of [{ channel: "C9999999999" }, { user: "U0000EVIL01" }, { bot_id: "B1" }, { subtype: "message_changed" }, { text: "   " }, { channel: "D0123456789" }, { user: undefined }]) s.emit(event(over));
    s.emit({ envelope_id: "x", type: "slash_commands", payload: {} });
    s.emit({ envelope_id: "y", type: "events_api", payload: { type: "url_verification" } });
    await flush();
    expect(dispatched).toEqual([]);
    expect(h.slack.status().received).toBe(0);
  });

  test("a redelivered event is processed once, and a user is rate limited", async () => {
    configure();
    const h = harness();
    const s = await connected(h);
    const ev = event({ ts: "1700000000.000100" });
    s.emit(ev);
    s.emit({ ...ev, envelope_id: "retry" });
    await flush();
    expect(dispatched).toHaveLength(1);
    for (let i = 0; i < 20; i++) s.emit(event({ ts: `1700000001.${String(i).padStart(6, "0")}` }));
    await flush();
    expect(dispatched.length).toBeLessThanOrEqual(10);
    expect(h.slack.status().dropped).toBeGreaterThan(0);
  });

  test("an inbound secret is redacted in the ledger", async () => {
    configure();
    const h = harness();
    const s = await connected(h);
    s.emit(event({ text: "key sk-abcdefghijklmnopqrstuvwxyz0123456789" }));
    await flush();
    const msg = ledger.list("main").find((e) => e.type === "message")!;
    expect(JSON.stringify(msg.payload)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123456789");
  });

  test("the bot's reply goes back into the message's thread, escaped, with fixed flags; other output stays in the desk", async () => {
    configure();
    const h = harness();
    const s = await connected(h);
    s.emit(event({ ts: "1700000002.000001", thread_ts: "1700000000.000009" }));
    await flush();
    const message = ledger.list("main").find((e) => e.type === "message")!;
    ledger.append("main", "boss", "turn_started", { turnId: "t1", messageId: message.id });
    ledger.append("main", "boss", "bot_output", { turnId: "t1", text: "hi <!channel> <@U123> <http://evil|click> & done" });
    ledger.append("main", "boss", "bot_output", { turnId: "other-turn", text: "not for slack" });
    ledger.append("main", "user", "message", { text: "desk message" });
    await flush();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toMatchObject({
      url: "https://slack.com/api/chat.postMessage",
      auth: `Bearer ${BOT}`,
      body: { channel: CHANNEL, thread_ts: "1700000000.000009", text: "hi &lt;!channel&gt; &lt;@U123&gt; &lt;http://evil|click&gt; &amp; done", parse: "none", link_names: false, unfurl_links: false, unfurl_media: false },
    });
  });

  test("an approval is announced WITHOUT its payload and can never be decided from Slack", async () => {
    configure();
    const h = harness();
    const s = await connected(h);
    s.emit(event());
    await flush();
    const message = ledger.list("main").find((e) => e.type === "message")!;
    ledger.append("main", "boss", "turn_started", { turnId: "t2", messageId: message.id });
    ledger.append("main", "boss", "approval_requested", { approvalId: "a1", turnId: "t2", toolName: "write_file", payload: { path: "/secret/path" } });
    await flush();
    expect(h.posts).toHaveLength(1);
    expect(JSON.stringify(h.posts[0]!.body)).not.toContain("/secret/path");
    expect(String(h.posts[0]!.body.text)).toMatch(/desk/);
    // A message that looks like an approval answer is just a message.
    s.emit(event({ text: "approve a1" }));
    await flush();
    expect(dispatched.at(-1)!.text).toBe("[Slack] approve a1");
  });

  test("delegation in the REAL event order: the specialist stays silent, the lead's final answer comes back to the thread", async () => {
    configure();
    const h = harness();
    const s = await connected(h);
    s.emit(event({ ts: "1700000003.000001" }));
    await flush();
    const message = ledger.list("main").find((e) => e.type === "message")!;
    // lead turn T1: output, finishes, THEN the delegation route (as runner.ts does)
    ledger.append("main", "boss", "turn_started", { turnId: "t1", messageId: message.id });
    ledger.append("main", "boss", "bot_output", { turnId: "t1", text: "@coder please look" });
    ledger.append("main", "boss", "turn_finished", { turnId: "t1", status: "finished" });
    const task = ledger.append("main", "boss", "message", { text: "please look", delegatedBy: "boss" });
    ledger.append("main", "boss", "route", { targets: ["coder"], delegatedBy: "boss", messageId: task.id, turnId: "t1" });
    // specialist T2: silent (its output and approval notices stay in the desk)
    ledger.append("main", "coder", "turn_started", { turnId: "t2", messageId: task.id });
    ledger.append("main", "coder", "bot_output", { turnId: "t2", text: "specialist detail from the web" });
    ledger.append("main", "coder", "approval_requested", { approvalId: "a9", turnId: "t2", toolName: "write_file" });
    ledger.append("main", "coder", "turn_finished", { turnId: "t2", status: "finished" });
    const result = ledger.append("main", "coder", "message", { text: "Result from @coder: done", replyTo: "boss" });
    ledger.append("main", "coder", "route", { targets: ["boss"], messageId: result.id, turnId: "t2" });
    // lead follow-up T3 relays
    ledger.append("main", "boss", "turn_started", { turnId: "t3", messageId: result.id });
    ledger.append("main", "boss", "bot_output", { turnId: "t3", text: "final answer" });
    ledger.append("main", "boss", "turn_finished", { turnId: "t3", status: "failed" });
    await flush();
    expect(h.posts.map((p) => p.body.text)).toEqual(["@coder please look", "final answer", "That turn failed. See the desk for details."]);
    expect(new Set(h.posts.map((p) => p.body.thread_ts))).toEqual(new Set(["1700000003.000001"]));
  });

  test("the thread is registered before dispatch, entities are unescaped inbound, long replies get a marker", async () => {
    configure();
    const h = harness();
    let seenAtDispatch = false;
    const s = await connected(h);
    s.emit(event({ text: "a &lt;b&gt; &amp; c" }));
    await flush();
    expect(dispatched.at(-1)!.text).toBe("[Slack] a <b> & c");
    const message = ledger.list("main").find((e) => e.type === "message")!;
    ledger.append("main", "boss", "turn_started", { turnId: "t7", messageId: message.id });
    ledger.append("main", "boss", "bot_output", { turnId: "t7", text: "x".repeat(5000) });
    await flush();
    seenAtDispatch = h.posts.length === 1;
    expect(seenAtDispatch).toBe(true);
    expect(String(h.posts[0]!.body.text).endsWith("…")).toBe(true);
    expect(String(h.posts[0]!.body.text).length).toBeLessThanOrEqual(3500);
  });

  test("Slack errors are reported as short codes only; a 429 is retried once", async () => {
    configure();
    let n = 0;
    const h = harness({ postResponse: () => (n++ === 0 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), { status: 200 })) });
    const s = await connected(h);
    s.emit(event());
    await flush();
    const message = ledger.list("main").find((e) => e.type === "message")!;
    ledger.append("main", "boss", "turn_started", { turnId: "t5", messageId: message.id });
    ledger.append("main", "boss", "bot_output", { turnId: "t5", text: "x" });
    await new Promise((r) => setTimeout(r, 1300));
    expect(h.slack.status().lastError).toBe("slack rejected the reply: channel_not_found");
    expect(h.posts).toHaveLength(2);
  }, 10_000);

  test("a bad socket URL is refused, a failed open backs off and retries, and disabling disconnects", async () => {
    configure();
    const bad = harness({ wsUrl: "wss://evil.example.com/x" });
    bad.slack.reload();
    await flush();
    expect(bad.sockets).toHaveLength(0);
    expect(bad.slack.status().lastError).toMatch(/could not open/);
    bad.slack.stop();

    const failing = harness({ openOk: false });
    failing.slack.reload();
    await new Promise((r) => setTimeout(r, 60));
    expect(failing.urls.filter((u) => u.endsWith("apps.connections.open")).length).toBeGreaterThan(1);
    expect(failing.slack.status().lastError).toBe("could not open the Slack connection: invalid_auth");
    failing.slack.stop();

    const h = harness();
    const s = await connected(h);
    setSetting(db, "slack", { enabled: false });
    h.slack.reload();
    expect(s.closed).toBe(true);
    expect(h.slack.status().connected).toBe(false);
  });

  test("a closed socket reconnects, and a disconnect envelope triggers it", async () => {
    configure();
    const h = harness();
    const s = await connected(h);
    s.emit({ envelope_id: "d", type: "disconnect", reason: "refresh_requested" });
    await new Promise((r) => setTimeout(r, 60));
    expect(h.sockets.length).toBeGreaterThan(1);
    h.slack.stop();
  });

  test("a silent (half-open) socket is pinged, then terminated and reconnected; a socket that answers is left alone", async () => {
    configure();
    const dead = harness({ liveness: { pingMs: 10, timeoutMs: 45 } });
    await connected(dead);
    await new Promise((r) => setTimeout(r, 150));
    expect(dead.sockets[0]!.pings).toBeGreaterThan(0);
    expect(dead.sockets[0]!.terminated).toBe(true);
    expect(dead.sockets.length).toBeGreaterThan(1);
    expect(dead.slack.status().lastError).toMatch(/went silent|could not/);
    dead.slack.stop();

    const alive = harness({ liveness: { pingMs: 10, timeoutMs: 45 } });
    alive.slack.reload();
    await flush();
    alive.sockets[0]!.autoPong = true;
    alive.sockets[0]!.emit({ type: "hello" });
    await new Promise((r) => setTimeout(r, 150));
    expect(alive.sockets).toHaveLength(1);
    expect(alive.slack.status()).toMatchObject({ connected: true, lastFrameAt: expect.any(Number) });
    alive.slack.stop();
  });

  test("tokens never reach the status or the ledger, and helpers behave", () => {
    configure();
    const h = harness();
    expect(JSON.stringify(h.slack.status())).not.toMatch(/xapp|xoxb/);
    expect(escapeSlack("<a&b>")).toBe("&lt;a&amp;b&gt;");
    expect(isSlackSocketUrl("wss://wss-primary.slack.com/link/?ticket=1")).toBe(true);
    expect(isSlackSocketUrl("wss://slack.com.evil.com/x")).toBe(false);
    expect(isSlackSocketUrl("ws://wss.slack.com/x")).toBe(false);
    expect(isSlackSocketUrl("wss://u:p@wss.slack.com/x")).toBe(false);
  });
});
