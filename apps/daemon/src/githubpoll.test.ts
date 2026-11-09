import { describe, expect, test } from "vitest";
import { GITHUB_API_ORIGIN, isValidRepo, isValidToken, MAX_ITEMS_PER_POLL, pollRepoEvents, summarizeEvent, type PollState } from "./githubpoll.js";

const TOKEN = "github_pat_FAKE_token_value_1234567890";
const NOW = Date.parse("2026-10-28T10:00:00Z");

const ev = (id: number, type: string, payload: Record<string, unknown> = {}) => ({
  id: String(id),
  type,
  actor: { login: "alice" },
  repo: { name: "owner/repo" },
  payload,
  created_at: "2026-10-28T09:59:00Z",
});
const issueEvent = (id: number, title = "Bug") => ev(id, "IssuesEvent", { action: "opened", issue: { number: id, title, html_url: `https://github.com/owner/repo/issues/${id}` } });

interface Call {
  url: string;
  init: RequestInit;
}
function fakeFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const first: PollState = { etag: null, cursor: null };
const poll = (f: typeof fetch, state: PollState = first, allow = ["issues", "push"], repo = "owner/repo") =>
  pollRepoEvents({ fetch: f, token: TOKEN, repo, allow, state }, () => NOW);

describe("first poll", () => {
  test("only records the cursor: no history is replayed", async () => {
    const { fn } = fakeFetch([json([issueEvent(30), issueEvent(20), issueEvent(10)], { etag: '"e1"' })]);
    const r = await poll(fn);
    expect(r).toMatchObject({ kind: "ok", items: [], newCount: 0, state: { cursor: "30", etag: '"e1"' } });
  });

  test("an EMPTY first poll still records a cursor, so later events are not mistaken for history", async () => {
    const { fn } = fakeFetch([json([]), json([issueEvent(5)])]);
    const r1 = await poll(fn);
    expect(r1).toMatchObject({ kind: "ok", state: { cursor: "0" } });
    const r2 = await poll(fn, (r1 as { state: PollState }).state);
    expect(r2).toMatchObject({ kind: "ok", newCount: 1 });
  });
});

describe("later polls", () => {
  const state: PollState = { etag: '"e1"', cursor: "100" };

  test("fire exactly the new ALLOWED events, oldest first, and advance the cursor past ignored ones too", async () => {
    const { fn } = fakeFetch([json([ev(130, "WatchEvent"), issueEvent(120), ev(115, "PushEvent", { ref: "refs/heads/main", commits: [{ message: "fix\nbody" }] }), issueEvent(100), issueEvent(90)], { etag: '"e2"' })]);
    const r = await poll(fn, state);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.items.map((i) => i.id)).toEqual(["115", "120"]);
    expect(r.items[0]).toMatchObject({ type: "PushEvent", ref: "refs/heads/main", commits: ["fix"] });
    expect(r.state).toEqual({ etag: '"e2"', cursor: "130" });
    // The next poll with that cursor finds nothing new.
    const again = await poll(fakeFetch([json([ev(130, "WatchEvent"), issueEvent(120)])]).fn, r.state);
    expect(again).toMatchObject({ kind: "ok", items: [], newCount: 0 });
  });

  test("compares ids numerically, not as strings (999 < 1000)", async () => {
    const { fn } = fakeFetch([json([issueEvent(1000)])]);
    const r = await poll(fn, { etag: null, cursor: "999" });
    expect(r).toMatchObject({ kind: "ok", newCount: 1 });
  });

  test("a per-poll cap keeps the NEWEST items and says so", async () => {
    const many = Array.from({ length: 25 }, (_, i) => issueEvent(200 - i));
    const { fn } = fakeFetch([json(many)]);
    const r = await poll(fn, state);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.items).toHaveLength(MAX_ITEMS_PER_POLL);
    expect(r.newCount).toBe(25);
    expect(r.truncated).toBe(true);
    expect(r.items.at(-1)!.id).toBe("200");
  });

  test("non-allowlisted event types are ignored", async () => {
    const { fn } = fakeFetch([json([ev(150, "ForkEvent"), ev(140, "WatchEvent")])]);
    expect(await poll(fn, state, ["issues"])).toMatchObject({ kind: "ok", items: [], newCount: 0 });
  });

  test("malformed events and bad ids are skipped, not fatal", async () => {
    const { fn } = fakeFetch([json([{ id: "abc", type: "IssuesEvent" }, null, 5, { type: "IssuesEvent" }, issueEvent(120)])]);
    expect(await poll(fn, state)).toMatchObject({ kind: "ok", newCount: 1 });
  });
});

describe("request shape (token and host safety)", () => {
  test("fixed host, validated repo in the path, token only in the Authorization header, redirects refused, ETag sent", async () => {
    const { fn, calls } = fakeFetch([json([])]);
    await poll(fn, { etag: '"abc"', cursor: "1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${GITHUB_API_ORIGIN}/repos/owner/repo/events?per_page=100`);
    expect(calls[0]!.url).not.toContain(TOKEN);
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Bearer ${TOKEN}`);
    expect(h["if-none-match"]).toBe('"abc"');
    expect(calls[0]!.init.redirect).toBe("error");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  test.each(["", "owner", "owner/", "/repo", "a/b/c", "../x", "owner/..", "./repo", "owner/re po", "https://evil.com/x", "owner@evil.com/x", "owner/repo?x=1", "owner/repo#f", "ow%2Fner/repo", "a".repeat(101) + "/b"])(
    "repo %j is rejected and nothing is fetched",
    async (repo) => {
      const { fn, calls } = fakeFetch([json([])]);
      expect(isValidRepo(repo)).toBe(false);
      expect(await poll(fn, first, ["issues"], repo)).toEqual({ kind: "error", message: "invalid repository" });
      expect(calls).toHaveLength(0);
    },
  );

  test.each(["short", "has space in it 12345", "x".repeat(300), ""])("token %j is rejected and nothing is fetched", async (token) => {
    const { fn, calls } = fakeFetch([json([])]);
    expect(isValidToken(token)).toBe(false);
    expect(await pollRepoEvents({ fetch: fn, token, repo: "owner/repo", allow: ["issues"], state: first })).toEqual({ kind: "error", message: "invalid token" });
    expect(calls).toHaveLength(0);
  });
});

describe("responses and errors", () => {
  test("304 fires nothing and honours X-Poll-Interval", async () => {
    const { fn } = fakeFetch([new Response(null, { status: 304, headers: { "x-poll-interval": "120" } })]);
    const state = { etag: '"e"', cursor: "5" };
    expect(await poll(fn, state)).toEqual({ kind: "not_modified", state, minDelaySec: 120 });
  });

  test("403/429 with Retry-After or an exhausted rate limit back off (bounded), a plain 403 is an error", async () => {
    const s: PollState = { etag: null, cursor: "5" };
    expect(await poll(fakeFetch([new Response("{}", { status: 429, headers: { "retry-after": "300" } })]).fn, s)).toEqual({ kind: "backoff", delaySec: 300, reason: "rate limited" });
    expect(await poll(fakeFetch([new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(NOW / 1000) + 600) } })]).fn, s)).toEqual({ kind: "backoff", delaySec: 600, reason: "rate limited" });
    expect(await poll(fakeFetch([new Response("{}", { status: 429, headers: { "retry-after": "999999" } })]).fn, s)).toMatchObject({ kind: "backoff", delaySec: 3600 });
    expect(await poll(fakeFetch([new Response("{}", { status: 403 })]).fn, s)).toEqual({ kind: "error", message: "forbidden" });
  });

  test("401, 404, 5xx and network failures map to short fixed messages that never contain the token or body", async () => {
    const s: PollState = { etag: null, cursor: "5" };
    const bodyWithSecret = JSON.stringify({ message: `Bad credentials ${TOKEN}` });
    const results = [
      await poll(fakeFetch([new Response(bodyWithSecret, { status: 401 })]).fn, s),
      await poll(fakeFetch([new Response(bodyWithSecret, { status: 404 })]).fn, s),
      await poll(fakeFetch([new Response(bodyWithSecret, { status: 502 })]).fn, s),
      await poll(fakeFetch([new Error(`connect failed ${TOKEN}`)]).fn, s),
      await poll(fakeFetch([new Response(bodyWithSecret, { status: 418 })]).fn, s),
    ];
    expect(results.map((r) => r.kind)).toEqual(["error", "error", "backoff", "error", "error"]);
    expect(JSON.stringify(results)).not.toContain(TOKEN);
    expect(JSON.stringify(results)).not.toContain("Bad credentials");
  });

  test("a non-JSON, non-array or oversized body is an error, not a crash", async () => {
    const s: PollState = { etag: null, cursor: "5" };
    expect(await poll(fakeFetch([new Response("<html>", { status: 200 })]).fn, s)).toEqual({ kind: "error", message: "unexpected response" });
    expect(await poll(fakeFetch([json({ not: "an array" })]).fn, s)).toEqual({ kind: "error", message: "unexpected response" });
    const big = new Response("x".repeat(10), { status: 200, headers: { "content-length": String(3 * 1024 * 1024) } });
    expect(await poll(fakeFetch([big]).fn, s)).toEqual({ kind: "error", message: "response too large" });
  });
});

describe("summarizeEvent", () => {
  test("keeps a few clipped fields and drops the rest of the payload", () => {
    const item = summarizeEvent(
      ev(7, "IssueCommentEvent", { action: "created", issue: { number: 3, title: "T".repeat(500) }, comment: { body: "c".repeat(2000), html_url: "https://github.com/o/r/issues/3#c" }, secretish: "dropped", sender: { token: "dropped" } }),
    )!;
    expect(item.title!.length).toBeLessThanOrEqual(301);
    expect(item.text!.length).toBeLessThanOrEqual(601);
    expect(item.number).toBe(3);
    expect(JSON.stringify(item)).not.toContain("dropped");
  });

  test("control characters are stripped from text fields", () => {
    const item = summarizeEvent(ev(8, "IssuesEvent", { action: "opened", issue: { title: "a\u0000b\u0007c" } }))!;
    expect(item.title).toBe("abc");
  });

  test("a push event keeps only the first line of up to 3 commit messages", () => {
    const item = summarizeEvent(ev(9, "PushEvent", { ref: "refs/heads/x", commits: [1, 2, 3, 4].map((n) => ({ message: `m${n}\nsecret body` })) }))!;
    expect(item.commits).toEqual(["m1", "m2", "m3"]);
  });
});

describe("review fixes", () => {
  test("fitItems keeps whole items within the budget, drops the OLDEST first and reports the omission", async () => {
    const { fitItems } = await import("./githubpoll.js");
    const item = (id: number) => summarizeEvent(ev(id, "IssueCommentEvent", { action: "created", issue: { number: 1, title: "T".repeat(300) }, comment: { body: "w ".repeat(400), html_url: "https://github.com/o/r/issues/1" } }))!;
    const items = Array.from({ length: 10 }, (_, i) => item(20 + i));
    const { items: fitted, omitted } = fitItems(items, 3000);
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(3000);
    expect(fitted.at(-1)!.id).toBe("29"); // newest kept
    expect(fitted.length + omitted).toBe(10);
    expect(fitItems(items.slice(0, 2), 100_000)).toEqual({ items: items.slice(0, 2), omitted: 0 });
  });

  test("tokens must look like GitHub tokens: no paths, URLs or odd characters (the redactor ignores those)", () => {
    for (const bad of ["https://abc.example/xxxxxx", "/etc/passwd-xxxxx", "~/secret-token-1234", "file:secret-12345", "tok en 1234567890", "tok\nen1234567890", "tok:en1234567890"]) expect(isValidToken(bad)).toBe(false);
    for (const good of ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz", "gho_1234567890abcdef"]) expect(isValidToken(good)).toBe(true);
  });

  test("invisible and bidi characters are stripped from event text", () => {
    const item = summarizeEvent(ev(8, "IssuesEvent", { action: "opened", issue: { title: "a‮b​c d" } }))!;
    expect(item.title).toBe("abcd");
  });
});
