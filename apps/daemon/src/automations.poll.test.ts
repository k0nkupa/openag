import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals, type Approvals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type AutomationManager, createAutomationManager, hookRoomId } from "./automations.js";
import { type Db, MIGRATIONS_DIR, openDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { setSetting } from "./settings.js";
import { createScheduler, type Scheduler } from "./scheduler.js";
import type { BotRuntime, TurnContext } from "./runtimes/types.js";
import { createRunner, type Runner } from "./runtimes/runner.js";
import { defaultTools } from "./runtimes/tools.js";
import { createWakeFilter, type WakeFilter } from "./wake.js";

const TOKEN = "github_pat_TESTTOKEN_0123456789";
const REPO = "owner/repo";
const MIN = 60_000;

let clock: number;
// A manual poll is refused within 30 s of the previous one, so each manual poll in a test moves the clock on first.
const pollNow = async (id: string) => {
  clock += 31_000;
  const result=manager.runNow(id,"o");await manager.idle();return result.started;
};
let dir: string;
let db: Db;
let ledger: Ledger;
let approvals: Approvals;
let runner: Runner;
let scheduler: Scheduler;
let wake: WakeFilter;
let manager: AutomationManager;
let turnHook: (ctx: TurnContext) => Promise<void> | void;
const contexts: TurnContext[] = [];
let replies: Response[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

const fake: BotRuntime = {
  async runTurn(ctx) {
    contexts.push(ctx);
    await turnHook(ctx);
  },
};

const emit = (ctx: TurnContext, text: string): void => {
  ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text });
};
const verdictJson = (verdict: string, key: string) =>
  JSON.stringify({ verdict, reason: `reason ${key}`, urgency: "high", dedupe_key: key });

const ev = (id: string, type: string, title: string) => ({
  id,
  type,
  actor: { login: "octo" },
  repo: { name: REPO },
  payload: { action: "opened", issue: { title, number: Number(id) % 1000, html_url: `https://github.com/${REPO}/issues/1` }, pull_request: { title, number: 1, html_url: "https://github.com/x" } },
  created_at: "2026-10-27T08:00:00Z",
});

const ok200 = (list: unknown[], etag = '"v1"') =>
  new Response(JSON.stringify(list), { status: 200, headers: { "content-type": "application/json", etag } });
/** Node's Response refuses status 304, so that one is a minimal stand-in (the poller reads only status and headers). */
const status = (code: number, headers: Record<string, string> = {}): Response =>
  code === 304
    ? ({ status: 304, headers: new Headers(headers), body: null } as unknown as Response)
    : new Response("{}", { status: code, headers });

/** Queues the next responses. Each poll takes one. */
const serve = (...rs: Response[]) => {
  replies.push(...rs);
};

const row = (id: string) =>
  db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as Record<string, unknown>;

const messagesIn = (roomId: string) =>
  ledger.list(roomId).filter((e) => e.type === "message").map((e) => JSON.stringify(e.payload));

const decisions = () =>
  db.prepare("SELECT source, decision FROM wake_decisions ORDER BY id").all() as { source: string; decision: string }[];

/** Everything a viewer or log can reach. The raw DB row is excluded on purpose: it holds the token by design. */
const allText = () =>
  JSON.stringify([
    manager.list(),
    ledger.list("_system"),
    ledger.list("main"),
    db.prepare("SELECT * FROM wake_decisions").all(),
    db.prepare("SELECT * FROM digest_items").all(),
  ]);

const pollSpec = (over: Record<string, unknown> = {}) => ({
  name: "Repo watch",
  triggerKind: "github_poll",
  botId: "boss",
  prompt: "Triage the repository events",
  pollRepo: REPO,
  hookEvents: ["issues", "pull_request"],
  pollToken: TOKEN,
  ...over,
});

const newManager = (sched: Scheduler, fetchFn: typeof fetch = fetchMock as unknown as typeof fetch) =>
  createAutomationManager({
    db,
    ledger,
    runner,
    scheduler: sched,
    wake,
    tz: "UTC",
    now: () => clock,
    fetch: fetchFn,
  });

beforeEach(() => {
  clock = Date.parse("2026-10-27T09:00:00Z");
  dir = mkdtempSync(join(tmpdir(), "openag-poll-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  setSetting(db, "deliveryRoom", { roomId: "main" });
  addMember(db, "main", "boss");
  ledger = createLedger(db);
  approvals = createApprovals(db, ledger);
  turnHook = () => undefined;
  contexts.length = 0;
  replies = [];
  fetchMock = vi.fn(async () => {
    const r = replies.shift();
    if (!r) throw new Error("no reply queued");
    return r;
  });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools });
  scheduler = createScheduler({ now: () => new Date(clock) });
  wake = createWakeFilter({ db, ledger, tz: "UTC", now: () => new Date(clock) });
  manager = newManager(scheduler);
});

afterEach(async () => {
  errorSpy.mockRestore();
  await runner.idle();
  db.close();
  // Background runs may still be committing (git) in the data dir: keep trying, and never fail a test over a temp dir.
  for (let i = 0; i < 100; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

describe("migration 009 keeps cron, webhook and github rows", () => {
  test("a DB with 001-008 rows migrates and keeps every row and column", () => {
    const stage = mkdtempSync(join(tmpdir(), "openag-stage-"));
    const raw = new Database(join(stage, "openag.db"));
    sqliteVec.load(raw);
    const old = join(stage, "migs");
    mkdirSync(old);
    for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => /^00[1-8]_/.test(n))) copyFileSync(join(MIGRATIONS_DIR, f), join(old, f));
    migrate(raw, old);
    raw.prepare(
      `INSERT INTO automations (id, name, schedule_cron, tz, bot_id, room_id, prompt, enabled, allow_approvals, created_at, updated_at, last_run_at, last_status, last_turn_id, trigger_kind, hook_slug, hook_secret_hash, hook_secret, hook_events_json, output_mode, allow_tools, last_verdict)
       VALUES ('auto_cron', 'Cron', '0 10 * * *', 'UTC', 'boss', 'main', 'c', 1, 0, 1, 2, 3, 'ok', 'turn_1', 'cron', NULL, NULL, NULL, NULL, 'room', 0, NULL),
              ('auto_hook', 'Hook', NULL, NULL, 'boss', NULL, 'h', 0, 0, 1, 2, NULL, NULL, NULL, 'webhook', 'h-hook1234', 'abc', NULL, NULL, 'wake', 1, 'silent'),
              ('auto_gh', 'GH', NULL, NULL, 'boss', NULL, 'g', 1, 0, 1, 2, NULL, NULL, NULL, 'github', 'h-gh12345', NULL, 'github-signing-secret-123', '["push"]', 'wake', 0, NULL)`,
    ).run();
    raw.close();

    const migrated = openDb(stage);
    try {
      expect((migrated.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }).v).toBeGreaterThanOrEqual(9);
      const rows = migrated.prepare("SELECT * FROM automations ORDER BY id").all() as Record<string, unknown>[];
      expect(rows.map((r) => r.id)).toEqual(["auto_cron", "auto_gh", "auto_hook"]);
      expect(rows[0]).toMatchObject({ schedule_cron: "0 10 * * *", room_id: "main", last_status: "ok", last_turn_id: "turn_1", trigger_kind: "cron", last_run_at: 3 });
      expect(rows[1]).toMatchObject({ trigger_kind: "github", hook_slug: "h-gh12345", hook_secret: "github-signing-secret-123", hook_events_json: '["push"]', output_mode: "wake" });
      expect(rows[2]).toMatchObject({ trigger_kind: "webhook", hook_slug: "h-hook1234", hook_secret_hash: "abc", allow_tools: 1, last_verdict: "silent", enabled: 0 });
      expect(rows[2]!.poll_token).toBeNull();
      // The new kind is accepted by the rebuilt CHECK.
      expect(() =>
        migrated
          .prepare("INSERT INTO automations (id, name, bot_id, prompt, created_at, updated_at, trigger_kind) VALUES ('x', 'x', 'boss', 'p', 1, 1, 'github_poll')")
          .run(),
      ).not.toThrow();
    } finally {
      migrated.close();
      rmSync(stage, { recursive: true, force: true });
    }
  });
});

describe("validation", () => {
  test.each(["../x", "a/b/c", "https://github.com/a/b", "a/b@c", "owner", "a b/c", ""])("repo %j is rejected", (repo) => {
    expect(() => manager.create(pollSpec({ pollRepo: repo }), "o")).toThrow(/pollRepo/);
  });

  test("unknown and duplicate event names are rejected", () => {
    expect(() => manager.create(pollSpec({ hookEvents: ["mention"] }), "o")).toThrow(/unknown event/);
    expect(() => manager.create(pollSpec({ hookEvents: ["constructor"] }), "o")).toThrow(/unknown event/);
    expect(() => manager.create(pollSpec({ hookEvents: ["issues", "issues"] }), "o")).toThrow(/unique/);
    expect(() => manager.create(pollSpec({ hookEvents: [] }), "o")).toThrow(/hookEvents is required/);
  });

  test("interval must be an integer from 5 to 1440; default is 15", () => {
    expect(() => manager.create(pollSpec({ pollEveryMinutes: 4 }), "o")).toThrow(/pollEveryMinutes/);
    expect(() => manager.create(pollSpec({ pollEveryMinutes: 1441 }), "o")).toThrow(/pollEveryMinutes/);
    expect(() => manager.create(pollSpec({ pollEveryMinutes: 7.5 }), "o")).toThrow(/pollEveryMinutes/);
    expect(manager.create(pollSpec({ pollEveryMinutes: 1440 }), "o").automation.pollEveryMinutes).toBe(1440);
    expect(manager.create(pollSpec({ name: "Default" }), "o").automation.pollEveryMinutes).toBe(15);
  });

  test("create needs a valid token; a bad one is refused without echoing it", () => {
    const { pollToken: _drop, ...noToken } = pollSpec();
    expect(() => manager.create(noToken, "o")).toThrow(/pollToken/);
    expect(() => manager.create(pollSpec({ pollToken: "short" }), "o")).toThrow(/pollToken/);
    expect(() => manager.create(pollSpec({ pollToken: "has space in it 1234" }), "o")).toThrow(/pollToken/);
  });

  test.each([
    ["a schedule", { scheduleCron: "0 10 * * *" }],
    ["a slug", { hookSlug: "poll-slug" }],
    ["a secret", { secret: "signing-secret-1234" }],
    ["allowApprovals", { allowApprovals: true }],
  ])("%s is rejected", (_label, extra) => {
    expect(() => manager.create(pollSpec(extra), "o")).toThrow();
  });

  test("a poll token on another kind is refused", () => {
    expect(() =>
      manager.create({ name: "Cron", scheduleCron: "0 10 * * *", botId: "boss", roomId: "main", prompt: "p", pollToken: TOKEN }, "o"),
    ).toThrow(/only applies to github_poll/);
  });

  test("the public shape never carries the token, etag or cursor", () => {
    const created = manager.create(pollSpec(), "o");
    expect(created.automation).toMatchObject({ triggerKind: "github_poll", pollRepo: REPO, pollEveryMinutes: 15, hasSecret: true, lastPolledAt: null, lastPollNew: null, hookSlug: null, outputMode: "wake" });
    expect(created.secret).toBeUndefined();
    expect(JSON.stringify(created)).not.toContain(TOKEN);
  });

  test("update: blank or absent token keeps the stored one; a new token replaces it", () => {
    const { automation } = manager.create(pollSpec(), "o");
    manager.update(automation.id, { pollToken: "" }, "o");
    manager.update(automation.id, { name: "Renamed" }, "o");
    expect(row(automation.id).poll_token).toBe(TOKEN);
    manager.update(automation.id, { pollToken: "github_pat_NEWTOKEN_0123456789" }, "o");
    expect(row(automation.id).poll_token).toBe("github_pat_NEWTOKEN_0123456789");
    expect(() => manager.update(automation.id, { pollToken: "short" }, "o")).toThrow(/pollToken/);
  });

  test("changing the repository resets the cursor and etag", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    await pollNow(automation.id);
    expect(row(automation.id).poll_cursor).toBe("10");
    manager.update(automation.id, { pollRepo: "other/repo" }, "o");
    expect(row(automation.id)).toMatchObject({ poll_cursor: null, poll_etag: null });
  });
});

describe("polling", () => {
  test("first poll fires nothing but records the cursor and etag", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old"), ev("9", "PushEvent", "older")]));
    expect(await pollNow(automation.id)).toBe(true);
    expect(contexts).toHaveLength(0);
    expect(manager.get(automation.id)).toMatchObject({ lastStatus: "quiet", lastPollNew: 0 });
    expect(row(automation.id)).toMatchObject({ poll_cursor: "10", poll_etag: '"v1"' });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url.startsWith("https://api.github.com/repos/owner/repo/events")).toBe(true);
  });

  test("second poll fires exactly one run with both new allowed events, and ignores the rest", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    await pollNow(automation.id);

    const seen: string[] = [];
    turnHook = (ctx) => {
      seen.push(ctx.room.id);
      emit(ctx, verdictJson("silent", "k1"));
    };
    serve(
      ok200([ev("14", "PushEvent", "ignored push"), ev("13", "PullRequestEvent", "Add feature"), ev("12", "IssuesEvent", "Fix bug"), ev("10", "IssuesEvent", "old")], '"v2"'),
    );
    await pollNow(automation.id);

    expect(contexts).toHaveLength(1);
    const msgs = messagesIn(hookRoomId({ id: automation.id, allowTools: false }));
    expect(msgs).toHaveLength(1);
    const text = msgs[0]!;
    expect(text).toContain("Fix bug");
    expect(text).toContain("Add feature");
    expect(text).not.toContain("ignored push");
    expect(text).toContain("untrusted data from github_poll");
    expect(manager.get(automation.id)).toMatchObject({ lastStatus: "quiet", lastPollNew: 2 });
    expect(row(automation.id)).toMatchObject({ poll_cursor: "14", poll_etag: '"v2"' });
    expect(ledger.list("_system").filter((e) => (e.payload as { action?: string }).action === "automation_poll_fired")).toHaveLength(1);
  });

  test.each([
    ["ping", "ping"],
    ["digest", "digest"],
    ["silent", "silent"],
  ])("the poll run output goes through the wake filter (%s)", async (verdict, decision) => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    await pollNow(automation.id);
    turnHook = (ctx) => emit(ctx, verdictJson(verdict, `k-${verdict}`));
    serve(ok200([ev("11", "IssuesEvent", "New issue")]));
    await pollNow(automation.id);
    const rows = decisions();
        expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe(decision);
  });

  test("304 fires nothing and keeps the cursor and etag", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    await pollNow(automation.id);
    serve(status(304));
    await pollNow(automation.id);
    expect(fetchMock.mock.calls[1]![1]!.headers).toMatchObject({ "if-none-match": '"v1"' });
    expect(contexts).toHaveLength(0);
    expect(manager.get(automation.id)).toMatchObject({ lastStatus: "quiet", lastPollNew: 0 });
    expect(row(automation.id)).toMatchObject({ poll_cursor: "10", poll_etag: '"v1"' });
  });

  test("a 429 with Retry-After sets poll_next_at; the scheduler does not poll before it", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    manager.sync();
    await pollNow(automation.id);
    serve(status(429, { "retry-after": "120" }));
    await pollNow(automation.id);
    expect(manager.get(automation.id)?.lastStatus).toBe("failed");
    const next = row(automation.id).poll_next_at as number;
    expect(next).toBe(clock + 120_000);

    const calls = () => fetchMock.mock.calls.length;
    const before = calls();
    clock += MIN;
    await scheduler.tick(new Date(clock));
    expect(calls()).toBe(before);
    clock = next + 1;
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    await scheduler.tick(new Date(clock));
    expect(calls()).toBe(before + 1);
  });

  test("a bad token sets the error status and waits an hour", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(status(401));
    await pollNow(automation.id);
    expect(manager.get(automation.id)?.lastStatus).toBe("failed");
    expect(row(automation.id).poll_next_at).toBe(clock + 60 * MIN);
  });

  test("a 404 sets the repository error status", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(status(404));
    await pollNow(automation.id);
    expect(manager.get(automation.id)?.lastStatus).toBe("failed");
  });

  test("a 5xx backs off and a network failure is a short error", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(status(503));
    await pollNow(automation.id);
    expect(manager.get(automation.id)?.lastStatus).toBe("failed");
    expect(row(automation.id).poll_next_at).toBe(clock + 300_000);
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("socket hang up with secret " + TOKEN);
    });
    clock += 301_000; // past the 5 minute back-off a manual poll must respect
    await pollNow(automation.id);
    expect(manager.get(automation.id)?.lastStatus).toBe("failed");
  });

  test("a thrown error anywhere is stored as an error status and the poll can run again", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    await pollNow(automation.id);
    expect(manager.get(automation.id)?.lastStatus).toBe("failed");
    serve(ok200([]));
    clock += 16 * 60_000; // errors back off at least the poll interval (15 min)
    await pollNow(automation.id);
    expect(manager.get(automation.id)?.lastStatus).toBe("quiet");
  });

  test("the poll run is isolated (no tools), and allowTools is refused for polls", async () => {
    const results: boolean[] = [];
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    await pollNow(automation.id);
    turnHook = async (ctx) => {
      results.push((await ctx.authorize("Bash", { command: "ls" })).allowed);
      emit(ctx, verdictJson("silent", "k"));
    };
    serve(ok200([ev("11", "IssuesEvent", "new")]));
    await pollNow(automation.id);
    expect(results).toEqual([false]);
    expect(contexts[0]!.state).toMatchObject({ isolated: true, unattended: true });

    // A poll run never gets tools at all: the poll token lives on this machine and issue text is attacker-controlled.
    expect(() => manager.create(pollSpec({ name: "Tools", allowTools: true }), "o")).toThrow(/cannot allow tools/);
  });

  test("the token never appears in list, get, status, audit events, hidden-room text or console output", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(status(401));
    await pollNow(automation.id);
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    await pollNow(automation.id);
    serve(ok200([ev("11", "IssuesEvent", "new issue")]));
    turnHook = (ctx) => emit(ctx, verdictJson("silent", "k"));
    await pollNow(automation.id);
    manager.update(automation.id, { name: "Renamed" }, "o");
    expect(allText()).not.toContain(TOKEN);
    expect(JSON.stringify(manager.get(automation.id))).not.toContain(TOKEN);
    expect(JSON.stringify(manager.list())).not.toContain("poll_token");
    expect(JSON.stringify(manager.list())).not.toContain("poll_etag");
    expect(JSON.stringify(manager.list())).not.toContain("poll_cursor");
    expect(JSON.stringify(messagesIn(hookRoomId({ id: automation.id, allowTools: false })))).not.toContain(TOKEN);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(TOKEN);
  });

  test("a disabled automation is never polled by the scheduler", async () => {
    const { automation } = manager.create(pollSpec({ enabled: false }), "o");
    manager.sync();
    clock += 5 * MIN;
    await scheduler.tick(new Date(clock));
    expect(fetchMock).not.toHaveBeenCalled();
    await pollNow(automation.id);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(manager.get(automation.id)?.runtime?.reason).toBe("paused");
  });

  test("the scheduler polls an enabled automation when due, and deleting stops it", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    clock += MIN;
    await scheduler.tick(new Date(clock));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(row(automation.id).poll_cursor).toBe("10");
    expect(row(automation.id).poll_next_at).toBe(clock + 15 * MIN);

    expect(manager.remove(automation.id, "o")).toBe(true);
    clock += 60 * MIN;
    await scheduler.tick(new Date(clock));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("cursor survives a restart: a new manager over the same DB fires nothing for old events", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    await pollNow(automation.id);

    const scheduler2 = createScheduler({ now: () => new Date(clock) });
    const restarted = newManager(scheduler2);
    restarted.sync();
    serve(ok200([ev("10", "IssuesEvent", "old")], '"v2"'));
    clock += 31_000;
    restarted.runNow(automation.id,"o");await restarted.idle();
    expect(contexts).toHaveLength(0);
    expect(row(automation.id).poll_cursor).toBe("10");
    expect(restarted.get(automation.id)?.lastStatus).toBe("quiet");
  });
});

describe("gateway routes", () => {
  const OWNER = "owner-secret-for-gateway-tests";
  const auth = () => createAuth({ db, ownerToken: OWNER });
  const app = () =>
    createGateway({ db, ledger, approvals, auth: auth(), dispatch: () => undefined, automations: manager, tz: "UTC" });
  const bearer = { authorization: `Bearer ${OWNER}`, "content-type": "application/json" };

  test("create, list, get and update never return the token; no hookPath for polling", async () => {
    const g = app();
    const created = await g.request("/automations", { method: "POST", headers: bearer, body: JSON.stringify(pollSpec()) });
    expect(created.status).toBe(201);
    const createdText = await created.text();
    const body = JSON.parse(createdText) as { automation: { id: string; hookPath?: string } };
    expect(body.automation.hookPath).toBeUndefined();
    const id = body.automation.id;
    const list = await g.request("/automations", { headers: bearer });
    const get = await g.request(`/automations/${id}`, { headers: bearer });
    const put = await g.request(`/automations/${id}`, {
      method: "PUT",
      headers: bearer,
      body: JSON.stringify({ pollEveryMinutes: 30, pollToken: "github_pat_ROTATED_0123456789" }),
    });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(JSON.parse(putText).automation.pollEveryMinutes).toBe(30);
    const texts = [createdText, await list.text(), await get.text(), putText];
    for (const text of texts) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("github_pat_ROTATED");
      expect(text).not.toContain("poll_token");
    }
    expect(JSON.stringify(ledger.list("_system"))).not.toContain(TOKEN);
    expect(JSON.stringify(ledger.list("_system"))).not.toContain("github_pat_ROTATED");
  });

  test("a bad create returns 400 with a short message and no token", async () => {
    const res = await app().request("/automations", {
      method: "POST",
      headers: bearer,
      body: JSON.stringify(pollSpec({ pollRepo: "https://github.com/a/b", pollToken: "short" })),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(TOKEN);
  });

  test("POST /automations/:id/run polls immediately and never needs an unauthenticated route", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    const g = app();
    const res = await g.request(`/automations/${automation.id}/run`, { method: "POST", headers: bearer });
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(manager.get(automation.id)?.lastPolledAt).not.toBeNull(), { timeout: 3000 });
    expect(row(automation.id).poll_cursor).toBe("10");
    // No unauthenticated route serves polling automations.
    expect((await g.request("/automations")).status).toBe(401);
    expect((await g.request(`/hooks/${automation.id}`, { method: "POST", body: "{}" })).status).not.toBe(202);
  });
});

describe("manual polls", () => {
  test("a manual poll right after a poll, or during a back-off, does not call GitHub and keeps the explanatory status", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    manager.runNow(automation.id,"o");await manager.idle();
    const calls = () => fetchMock.mock.calls.length;
    const afterFirst = calls();
    manager.runNow(automation.id,"o");await manager.idle(); // same instant: refused before any request
    expect(calls()).toBe(afterFirst);
    // A 429 sets a back-off; repeated manual polls inside it never reach GitHub and never hide the back-off status.
    serve(new Response("{}", { status: 429, headers: { "retry-after": "3600" } }));
    clock += 31_000;
    manager.runNow(automation.id,"o");await manager.idle();
    expect(manager.get(automation.id)!.lastStatus).toBe("failed");
    const afterBackoff = calls();
    for (let i = 0; i < 3; i++) {
      clock += 31_000;
      manager.runNow(automation.id,"o");await manager.idle();
    }
    expect(calls()).toBe(afterBackoff);
    expect(manager.get(automation.id)!.lastStatus).toBe("failed");
  });

  test("after an ERROR (e.g. a revoked token) manual polls also wait out the back-off", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(status(401));
    manager.runNow(automation.id,"o");await manager.idle();
    expect(manager.get(automation.id)!.lastStatus).toBe("failed");
    const before = fetchMock.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      clock += 31_000;
      manager.runNow(automation.id,"o");await manager.idle();
    }
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});

describe("review fixes", () => {
  test("changing pollRepo while a poll run is in flight does not let the new repo inherit the old cursor", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    await pollNow(automation.id);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    turnHook = async (ctx) => {
      await gate;
      emit(ctx, verdictJson("silent", "k"));
    };
    serve(ok200([ev("11", "IssuesEvent", "new")]));
    const running = pollNow(automation.id);
    await new Promise((r) => setTimeout(r, 30));
    manager.update(automation.id, { pollRepo: "other/repo" }, "o");
    release();
    await running;
    expect(row(automation.id).poll_repo).toBe("other/repo");
    expect(row(automation.id).poll_cursor).toBeNull(); // the next poll is a first poll again
  });

  test("a full page of long events reaches the prompt as WHOLE items with the omission stated, newest kept", async () => {
    const { automation } = manager.create(pollSpec({ hookEvents: ["issue_comment"] }), "o");
    serve(ok200([]));
    await pollNow(automation.id);
    const long = "word ".repeat(200);
    serve(ok200(Array.from({ length: 10 }, (_, i) => ({ ...ev(String(30 - i), "IssueCommentEvent", "t"), payload: { action: "created", issue: { number: 1, title: "T".repeat(300) }, comment: { body: long, html_url: "https://github.com/o/r/issues/1#c" } } }))));
    await pollNow(automation.id);
    const msg = JSON.parse(messagesIn(hookRoomId(automation)).filter((m) => m.includes("external event")).at(-1)!) as { text: string };
    const body = msg.text.slice(msg.text.indexOf("---\n") + 4, msg.text.indexOf("\n--- end ---"));
    const parsed = JSON.parse(body.slice(body.indexOf("\n") + 1)) as { events: Array<{ id: string }>; omittedOlderEvents: number };
    expect(parsed.events.at(-1)!.id).toBe("30"); // the newest is always there
    expect(parsed.events.length + parsed.omittedOlderEvents).toBe(10);
  });

  test("a failed hand-off keeps the cursor but still waits before polling again", async () => {
    const { automation } = manager.create(pollSpec(), "o");
    serve(ok200([ev("10", "IssuesEvent", "old")]));
    await pollNow(automation.id);
    // The bot is busy: the events are offered again, but not every minute.
    db.prepare("INSERT INTO turns (id, room_id, bot_id, status, state_json, created_at, updated_at) VALUES ('busy', ?, 'boss', 'running', '{}', 1, 1)").run(hookRoomId(automation));
    serve(ok200([ev("11", "IssuesEvent", "new")]));
    await pollNow(automation.id);
    expect(row(automation.id).poll_cursor).toBe("10");
  });
});
