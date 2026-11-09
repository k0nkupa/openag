import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createHookHandler, hashHookSecret, HOOK_MAX_BODY_BYTES, type HookFire, type HookTarget } from "./hooks.js";

const NOW = Date.parse("2026-10-28T10:00:00Z");
const SECRET = "s3cret-signing-value-123456";
let clock = NOW;

const targets: Record<string, HookTarget> = {
  "plain-hook": { id: "a1", kind: "webhook", secretHash: hashHookSecret("shared-secret-abcdef123456"), secret: null, events: [], enabled: true },
  "gh-hook": { id: "a2", kind: "github", secretHash: null, secret: SECRET, events: ["issues", "push"], enabled: true },
  "slack-hook": { id: "a3", kind: "slack", secretHash: null, secret: SECRET, events: ["app_mention"], enabled: true },
  "off-hook": { id: "a4", kind: "webhook", secretHash: hashHookSecret("shared-secret-abcdef123456"), secret: null, events: [], enabled: false },
};

function make(overrides: { fire?: (t: HookTarget, i: HookFire) => { accepted: boolean; reason?: string } } = {}) {
  clock = NOW;
  const fired: Array<{ target: HookTarget; input: HookFire }> = [];
  const rejected: Array<[string, string]> = [];
  const handler = createHookHandler({
    lookup: (slug) => (Object.hasOwn(targets, slug) ? targets[slug] : undefined),
    fire: (target, input) => {
      fired.push({ target, input });
      return overrides.fire ? overrides.fire(target, input) : { accepted: true };
    },
    now: () => clock,
    onRejected: (reason, client) => rejected.push([reason, client]),
  });
  return { handler, fired, rejected };
}

const post = (body: string | Buffer, headers: Record<string, string> = {}) =>
  new Request("http://x/hooks/s", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
const ghSig = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const slackSig = (body: string, ts: string, secret = SECRET) => `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
const tsNow = () => String(Math.floor(clock / 1000));

describe("generic webhook", () => {
  test("a valid shared secret fires exactly one run with the parsed payload", async () => {
    const { handler, fired } = make();
    const res = await handler.handle(post('{"a":1}', { "x-openag-secret": "shared-secret-abcdef123456" }), "plain-hook", "1.1.1.1");
    expect(res.status).toBe(202);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.input).toMatchObject({ event: "webhook", payload: { a: 1 } });
  });

  test("Bearer form works too", async () => {
    const { handler, fired } = make();
    expect((await handler.handle(post("{}", { authorization: "Bearer shared-secret-abcdef123456" }), "plain-hook", "c")).status).toBe(202);
    expect(fired).toHaveLength(1);
  });

  test.each([
    ["missing", {}],
    ["wrong", { "x-openag-secret": "nope-nope-nope-nope" }],
    ["empty", { "x-openag-secret": "" }],
    ["oversized", { "x-openag-secret": "x".repeat(600) }],
  ])("%s secret -> 401 and nothing fires", async (_n, headers) => {
    const { handler, fired } = make();
    expect((await handler.handle(post("{}", headers), "plain-hook", "c")).status).toBe(401);
    expect(fired).toHaveLength(0);
  });

  test("unknown slug, disabled hook, malformed slug and prototype names are all the same 401", async () => {
    const { handler, fired } = make();
    const ok = { "x-openag-secret": "shared-secret-abcdef123456" };
    const bodies: string[] = [];
    for (const slug of ["nope-nope", "off-hook", "../x", "constructor", "__proto__", "A"]) {
      const res = await handler.handle(post("{}", ok), slug, `c-${slug}`);
      expect(res.status).toBe(401);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(fired).toHaveLength(0);
  });

  test("non-JSON body after a valid secret -> 415", async () => {
    const { handler, fired } = make();
    expect((await handler.handle(post("not json", { "x-openag-secret": "shared-secret-abcdef123456" }), "plain-hook", "c")).status).toBe(415);
    expect(fired).toHaveLength(0);
  });

  test("rejections report a short reason and never the secret or body", async () => {
    const { handler, rejected } = make();
    await handler.handle(post('{"password":"hunter2hunter2"}', { "x-openag-secret": "wrong-secret-value-1234" }), "plain-hook", "9.9.9.9");
    expect(rejected).toEqual([["bad secret", "9.9.9.9"]]);
    expect(JSON.stringify(rejected)).not.toContain("hunter2");
    expect(JSON.stringify(rejected)).not.toContain("wrong-secret");
  });
});

describe("body cap", () => {
  test("declared and streamed bodies over the cap -> 413, nothing fires", async () => {
    const { handler, fired } = make();
    const big = "x".repeat(HOOK_MAX_BODY_BYTES + 1);
    expect((await handler.handle(post(big, { "x-openag-secret": "shared-secret-abcdef123456" }), "plain-hook", "c")).status).toBe(413);
    // No content-length: a stream.
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const req = new Request("http://x/hooks/s", { method: "POST", body: stream, headers: { "x-openag-secret": "shared-secret-abcdef123456" }, duplex: "half" } as RequestInit);
    expect((await handler.handle(req, "plain-hook", "c")).status).toBe(413);
    expect(fired).toHaveLength(0);
  });
});

describe("github", () => {
  const body = '{"action":"opened","issue":{"number":1}}';
  const headers = (over: Record<string, string> = {}) => ({ "x-hub-signature-256": ghSig(body), "x-github-event": "issues", "x-github-delivery": "d-1", ...over });

  test("valid signature + allowed event fires", async () => {
    const { handler, fired } = make();
    expect((await handler.handle(post(body, headers()), "gh-hook", "c")).status).toBe(202);
    expect(fired[0]!.input).toMatchObject({ event: "issues", deliveryId: "d-1" });
  });

  test("wrong secret, tampered body, missing header, wrong scheme -> 401", async () => {
    const { handler, fired } = make();
    for (const h of [
      headers({ "x-hub-signature-256": ghSig(body, "other-secret-value-xxxxxx") }),
      headers({ "x-hub-signature-256": ghSig(body.replace("1", "2")) }),
      { "x-github-event": "issues" },
      headers({ "x-hub-signature-256": ghSig(body).replace("sha256=", "sha1=") }),
    ]) {
      expect((await handler.handle(post(body, h), "gh-hook", `c${Math.random()}`)).status).toBe(401);
    }
    expect(fired).toHaveLength(0);
  });

  test("a disallowed event is verified but ignored (202), a ping is answered without a run", async () => {
    const { handler, fired } = make();
    const r = await handler.handle(post(body, headers({ "x-github-event": "fork" })), "gh-hook", "c");
    expect(r.status).toBe(202);
    expect(await r.json()).toMatchObject({ status: "ignored" });
    const ping = await handler.handle(post(body, headers({ "x-github-event": "ping", "x-github-delivery": "d-2" })), "gh-hook", "c");
    expect(await ping.json()).toEqual({ status: "pong" });
    expect(fired).toHaveLength(0);
  });

  test("the same delivery id twice runs once", async () => {
    const { handler, fired } = make();
    await handler.handle(post(body, headers()), "gh-hook", "c");
    const again = await handler.handle(post(body, headers()), "gh-hook", "c");
    expect(await again.json()).toEqual({ status: "duplicate" });
    expect(fired).toHaveLength(1);
  });
});

describe("slack", () => {
  const body = JSON.stringify({ type: "event_callback", event_id: "Ev1", event: { type: "app_mention", text: "hi" } });
  const headers = (over: Record<string, string> = {}, b = body, ts = tsNow()) => ({ "x-slack-request-timestamp": ts, "x-slack-signature": slackSig(b, ts), ...over });

  test("valid signature + allowed event fires", async () => {
    const { handler, fired } = make();
    expect((await handler.handle(post(body, headers()), "slack-hook", "c")).status).toBe(202);
    expect(fired[0]!.input).toMatchObject({ event: "app_mention", deliveryId: "Ev1" });
  });

  test("a timestamp outside the 5 minute window is rejected even with a correct signature", async () => {
    const { handler, fired } = make();
    const old = String(Math.floor(clock / 1000) - 301);
    expect((await handler.handle(post(body, headers({}, body, old)), "slack-hook", "c")).status).toBe(401);
    const future = String(Math.floor(clock / 1000) + 301);
    expect((await handler.handle(post(body, headers({}, body, future)), "slack-hook", "c2")).status).toBe(401);
    const edge = String(Math.floor(clock / 1000) - 299);
    expect((await handler.handle(post(body, headers({}, body, edge)), "slack-hook", "c3")).status).toBe(202);
    expect(fired).toHaveLength(1);
  });

  test("wrong secret or tampered body -> 401", async () => {
    const { handler, fired } = make();
    const ts = tsNow();
    expect((await handler.handle(post(body, { "x-slack-request-timestamp": ts, "x-slack-signature": slackSig(body, ts, "other-secret-xxxxxxxxxx") }), "slack-hook", "c")).status).toBe(401);
    expect((await handler.handle(post(body + " ", headers()), "slack-hook", "c2")).status).toBe(401);
    expect(fired).toHaveLength(0);
  });

  test("url_verification echoes the challenge only after a valid signature", async () => {
    const { handler, fired } = make();
    const v = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const ok = await handler.handle(post(v, headers({}, v)), "slack-hook", "c");
    expect(await ok.json()).toEqual({ challenge: "abc123" });
    expect((await handler.handle(post(v), "slack-hook", "c2")).status).toBe(401);
    expect(fired).toHaveLength(0);
  });

  test("a Slack retry of an ACCEPTED event is a duplicate; a disallowed event starts nothing", async () => {
    const { handler, fired } = make();
    await handler.handle(post(body, headers()), "slack-hook", "c");
    expect(await (await handler.handle(post(body, headers({ "x-slack-retry-num": "1" })), "slack-hook", "c")).json()).toEqual({ status: "duplicate" });
    expect(fired).toHaveLength(1);
    const other = JSON.stringify({ type: "event_callback", event_id: "Ev2", event: { type: "reaction_added" } });
    expect(await (await handler.handle(post(other, headers({}, other)), "slack-hook", "c")).json()).toMatchObject({ status: "ignored" });
    expect(fired).toHaveLength(1);
  });

  test("a Slack retry of an event that was NOT accepted (busy) is processed, not thrown away", async () => {
    let busy = true;
    const { handler, fired } = make({ fire: () => (busy ? { accepted: false, reason: "busy" } : { accepted: true }) });
    expect(await (await handler.handle(post(body, headers()), "slack-hook", "c")).json()).toMatchObject({ status: "skipped" });
    busy = false;
    expect(await (await handler.handle(post(body, headers({ "x-slack-retry-num": "1" })), "slack-hook", "c")).json()).toEqual({ status: "accepted" });
    expect(fired).toHaveLength(2);
  });
});

describe("rate limits", () => {
  test("failures are charged per client: after 20 the client gets 429 even with the right secret; others are unaffected", async () => {
    const { handler, fired } = make();
    for (let i = 0; i < 20; i++) await handler.handle(post("{}", { "x-openag-secret": "bad-bad-bad-bad-bad" }), "plain-hook", "attacker");
    const blocked = await handler.handle(post("{}", { "x-openag-secret": "shared-secret-abcdef123456" }), "plain-hook", "attacker");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await handler.handle(post("{}", { "x-openag-secret": "shared-secret-abcdef123456" }), "plain-hook", "friend")).status).toBe(202);
    expect(fired).toHaveLength(1);
    clock += 61_000;
    expect((await handler.handle(post("{}", { "x-openag-secret": "shared-secret-abcdef123456" }), "plain-hook", "attacker")).status).toBe(202);
  });

  test("successful deliveries are limited per hook (30/min) and recover", async () => {
    const { handler, fired } = make();
    const ok = { "x-openag-secret": "shared-secret-abcdef123456" };
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await handler.handle(post("{}", ok), "plain-hook", "c")).status);
    expect(statuses.filter((s) => s === 202)).toHaveLength(30);
    expect(statuses.slice(30)).toEqual([429, 429]);
    expect(fired).toHaveLength(30);
    clock += 61_000;
    expect((await handler.handle(post("{}", ok), "plain-hook", "c")).status).toBe(202);
  });

  test("a hook that is busy answers 202 skipped, not an error", async () => {
    const { handler } = make({ fire: () => ({ accepted: false, reason: "busy" }) });
    const res = await handler.handle(post("{}", { "x-openag-secret": "shared-secret-abcdef123456" }), "plain-hook", "c");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "skipped", reason: "busy" });
  });

  test("only POST", async () => {
    const { handler } = make();
    expect((await handler.handle(new Request("http://x/hooks/s", { method: "GET" }), "plain-hook", "c")).status).toBe(405);
  });
});

describe("review fixes", () => {
  test("spraying unknown slugs from many clients cannot lock out a real hook", async () => {
    const { handler, fired } = make();
    for (let i = 0; i < 300; i++) await handler.handle(post("{}"), `nope-${i % 7}-slug`, `attacker-${i % 40}`);
    const res = await handler.handle(post("{}", { "x-openag-secret": "shared-secret-abcdef123456" }), "plain-hook", "github");
    expect(res.status).toBe(202);
    expect(fired).toHaveLength(1);
  });

  test("unknown-slug probes ARE throttled among themselves", async () => {
    const { handler } = make();
    const statuses: number[] = [];
    for (let i = 0; i < 130; i++) statuses.push((await handler.handle(post("{}"), "nope-nope", `c-${i}`)).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  test("a GitHub delivery that was rate limited is processed when redelivered with the same id", async () => {
    const { handler, fired } = make();
    const body = '{"x":1}';
    const h = (id: string) => ({ "x-hub-signature-256": ghSig(body), "x-github-event": "issues", "x-github-delivery": id });
    for (let i = 0; i < 30; i++) await handler.handle(post(body, h(`d${i}`)), "gh-hook", "c");
    expect((await handler.handle(post(body, h("late")), "gh-hook", "c")).status).toBe(429);
    clock += 61_000;
    expect(await (await handler.handle(post(body, h("late")), "gh-hook", "c")).json()).toEqual({ status: "accepted" });
    expect(fired).toHaveLength(31);
  });

  test("oversized bodies are charged as failures", async () => {
    const { handler } = make();
    const big = "x".repeat(HOOK_MAX_BODY_BYTES + 1);
    for (let i = 0; i < 20; i++) await handler.handle(post(big, { "content-length": String(big.length) }), "plain-hook", "flooder");
    expect((await handler.handle(post("{}", { "x-openag-secret": "shared-secret-abcdef123456" }), "plain-hook", "flooder")).status).toBe(429);
  });

  test("a fire() that throws is answered as skipped, never a 500", async () => {
    const { handler } = make({ fire: () => { throw new Error("db busy"); } });
    const res = await handler.handle(post("{}", { "x-openag-secret": "shared-secret-abcdef123456" }), "plain-hook", "c");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "skipped", reason: "error" });
  });
});
