import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type Db, openDb } from "./db/index.js";
import { createRoom } from "./rooms.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createWakeFilter, listWakeDecisions, localDateKey, parseVerdict, type PingNotice, type WakeFilter } from "./wake.js";
import { setSetting } from "./settings.js";

// 2026-10-27T09:00Z is a Tuesday, inside the default 07:00-22:00 window in UTC.
const T0 = new Date("2026-10-27T09:00:00Z");
const HOUR = 3_600_000;

let dir: string;
let db: Db;
let ledger: Ledger;
let now: Date;
let onPing: ReturnType<typeof vi.fn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-wake-"));
  db = openDb(dir);
  ledger = createLedger(db);
  createRoom(db, { id: "main", name: "main" });
  setSetting(db, "deliveryRoom", { roomId: "main" }); // an existing install: proactive messages keep going to main
  now = new Date(T0);
  onPing = vi.fn();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const filter = (tz = "UTC", ping: unknown = onPing): WakeFilter =>
  createWakeFilter({ db, ledger, tz, now: () => now, onPing: ping as (n: PingNotice) => void });
const verdict = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ verdict: "ping", reason: "Build broke", urgency: "high", dedupe_key: "build", ...over });
const setWake = (patch: Partial<{ dailyPingBudget: number; dedupeHours: number; urgencyThreshold: string }>) =>
  setSetting(db, "wake", { dailyPingBudget: 3, dedupeHours: 24, urgencyThreshold: "normal", ...patch });
const setHours = (start: string, end: string) =>
  setSetting(db, "activeHours", { start, end, days: [0, 1, 2, 3, 4, 5, 6] });
const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
const mainMessages = () => ledger.list("main").filter((e) => e.type === "message");
const wakeEvents = () => ledger.list("_system").filter((e) => e.type === "wake");
const digests = () => db.prepare("SELECT * FROM digest_items").all() as { decision_id: number; text: string }[];
const decisions = () =>
  db.prepare("SELECT decision, suppressed_by FROM wake_decisions ORDER BY id").all() as {
    decision: string;
    suppressed_by: string | null;
  }[];
const run = (text: string | null, botId = "boss") => filter().process({ source: "heartbeat", botId, turnId: "t1", text });

describe("parseVerdict", () => {
  test("bare JSON", () => {
    expect(parseVerdict(verdict())).toEqual({ verdict: "ping", reason: "Build broke", urgency: "high", dedupe_key: "build" });
  });

  test("fenced json block and bare fence", () => {
    expect(parseVerdict("```json\n" + verdict() + "\n```")?.verdict).toBe("ping");
    expect(parseVerdict("```\n" + verdict({ verdict: "digest" }) + "\n```")?.verdict).toBe("digest");
  });

  test("surrounded by prose", () => {
    expect(parseVerdict(`Sure. Here it is: ${verdict({ verdict: "digest" })} Thanks.`)?.verdict).toBe("digest");
  });

  test("two objects: the last valid one wins", () => {
    const text = `${verdict({ verdict: "digest" })} then ${verdict({ verdict: "silent" })}`;
    expect(parseVerdict(text)?.verdict).toBe("silent");
  });

  test("a trailing invalid object falls back to the earlier valid one", () => {
    const text = `${verdict({ verdict: "digest" })} and {"verdict":"maybe"}`;
    expect(parseVerdict(text)?.verdict).toBe("digest");
  });

  test("braces and escaped quotes inside strings do not break the scan", () => {
    const text = `prefix ${JSON.stringify({ verdict: "digest", reason: 'use {x} and "}" then } here', urgency: "low", dedupe_key: "k" })} tail`;
    expect(parseVerdict(text)).toMatchObject({ verdict: "digest", reason: 'use {x} and "}" then } here' });
  });

  test("wrong enum values, missing fields and arrays are rejected", () => {
    expect(parseVerdict(verdict({ verdict: "loud" }))).toBeNull();
    expect(parseVerdict(verdict({ urgency: "extreme" }))).toBeNull();
    expect(parseVerdict(JSON.stringify({ verdict: "ping", urgency: "high" }))).toBeNull();
    expect(parseVerdict(JSON.stringify([JSON.parse(verdict())]))).toBeNull();
    expect(parseVerdict("NOTHING")).toBeNull();
    expect(parseVerdict("")).toBeNull();
  });

  test("reason is trimmed and clipped to 500, dedupe_key clipped to 120, extra keys ignored", () => {
    const v = parseVerdict(verdict({ reason: `  ${"r".repeat(600)}  `, dedupe_key: "k".repeat(200), extra: 1 }))!;
    expect(v.reason).toHaveLength(500);
    expect(v.dedupe_key).toHaveLength(120);
    expect(v).not.toHaveProperty("extra");
  });

  test("an empty dedupe_key becomes a stable hash of the reason", () => {
    const a = parseVerdict(verdict({ dedupe_key: "  ", reason: "same reason" }))!.dedupe_key;
    const b = parseVerdict(verdict({ dedupe_key: "", reason: "same reason" }))!.dedupe_key;
    const c = parseVerdict(verdict({ dedupe_key: "", reason: "other reason" }))!.dedupe_key;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^reason-[0-9a-f]{12}$/);
  });

  test("a 1 MB input returns quickly (only the last 20k chars are scanned)", () => {
    const big = "{".repeat(1_000_000);
    const started = Date.now();
    expect(parseVerdict(big)).toBeNull();
    expect(parseVerdict("x".repeat(1_000_000) + verdict())?.verdict).toBe("ping");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("localDateKey", () => {
  test("the same instant has different local days across a zone boundary", () => {
    const at = new Date("2026-10-27T23:30:00Z");
    expect(localDateKey(at, "UTC")).toBe("2026-10-27");
    expect(localDateKey(at, "Pacific/Auckland")).toBe("2026-10-28"); // UTC+13 (NZDT)
    expect(localDateKey(at, "America/Los_Angeles")).toBe("2026-10-27");
  });

  test("a DST day: New York switches from EDT to EST on 2026-11-01 at 06:00Z", () => {
    expect(localDateKey(new Date("2026-11-01T03:30:00Z"), "America/New_York")).toBe("2026-10-31");
    expect(localDateKey(new Date("2026-11-01T05:30:00Z"), "America/New_York")).toBe("2026-11-01");
    expect(localDateKey(new Date("2026-11-01T06:30:00Z"), "America/New_York")).toBe("2026-11-01");
  });
});

describe("wake filter rules", () => {
  test("ping inside hours, under budget, new key: delivered to main with a wake event and a row", () => {
    const d = run(verdict());
    expect(d).toMatchObject({ decision: "ping", suppressedBy: null, verdict: { verdict: "ping" } });
    expect(mainMessages()).toHaveLength(1);
    expect(mainMessages()[0]!.actor).toBe("primary");
    expect(mainMessages()[0]!.payload).toEqual({ text: "Heads-up from boss: Build broke", wake: true, decisionId: d.id });
    expect(wakeEvents()).toHaveLength(1);
    expect(wakeEvents()[0]!.payload).toMatchObject({ decisionId: d.id, decision: "ping", suppressedBy: null, botId: "boss" });
    expect(onPing).toHaveBeenCalledTimes(1);
    expect(onPing).toHaveBeenCalledWith({ decisionId: d.id, botId: "boss", reason: "Build broke", urgency: "high" });
    expect(decisions()).toEqual([{ decision: "ping", suppressed_by: null }]);
  });

  test("same key within the window is suppressed as a duplicate", () => {
    run(verdict());
    now = new Date(T0.getTime() + 23 * HOUR);
    const d = run(verdict());
    expect(d).toMatchObject({ decision: "suppressed", suppressedBy: "dedupe" });
    expect(mainMessages()).toHaveLength(1);
    expect(onPing).toHaveBeenCalledTimes(1);
  });

  test("same key after the window is delivered again", () => {
    run(verdict());
    now = new Date(T0.getTime() + 24 * HOUR + 1);
    expect(run(verdict()).decision).toBe("ping");
    expect(mainMessages()).toHaveLength(2);
  });

  test("dedupeHours setting changes the window", () => {
    setWake({ dedupeHours: 1 });
    run(verdict());
    now = new Date(T0.getTime() + 2 * HOUR);
    expect(run(verdict()).decision).toBe("ping");
  });

  test("outside active hours: downgraded to digest, and high urgency does not bypass it", () => {
    setHours("11:00", "12:00");
    const d = run(verdict({ urgency: "high" }));
    expect(d).toMatchObject({ decision: "digest", suppressedBy: "active_hours" });
    expect(mainMessages()).toHaveLength(0);
    expect(onPing).not.toHaveBeenCalled();
    expect(digests()).toEqual([expect.objectContaining({ decision_id: d.id, text: "Build broke" })]);
  });

  test("low urgency under the normal threshold: downgraded to digest", () => {
    const d = run(verdict({ urgency: "low" }));
    expect(d).toMatchObject({ decision: "digest", suppressedBy: "urgency" });
    expect(mainMessages()).toHaveLength(0);
  });

  test("normal urgency under a high threshold: downgraded; high meets a high threshold", () => {
    setWake({ urgencyThreshold: "high" });
    expect(run(verdict({ urgency: "normal", dedupe_key: "a" }))).toMatchObject({ decision: "digest", suppressedBy: "urgency" });
    expect(run(verdict({ urgency: "high", dedupe_key: "b" }))).toMatchObject({ decision: "ping", suppressedBy: null });
  });

  test("low threshold lets low urgency ping", () => {
    setWake({ urgencyThreshold: "low" });
    expect(run(verdict({ urgency: "low" })).decision).toBe("ping");
  });

  test("budget 3: the fourth ping of the day becomes a digest", () => {
    for (let i = 0; i < 3; i++) {
      now = new Date(T0.getTime() + i * 60_000);
      expect(run(verdict({ dedupe_key: `k${i}` })).decision).toBe("ping");
    }
    const fourth = run(verdict({ dedupe_key: "k3" }));
    expect(fourth).toMatchObject({ decision: "digest", suppressedBy: "budget" });
    expect(mainMessages()).toHaveLength(3);
  });

  test("budget resets on the next local day", () => {
    setSetting(db, "activeHours", { start: "00:00", end: "00:00", days: [0, 1, 2, 3, 4, 5, 6] });
    setWake({ dailyPingBudget: 1 });
    const auckland = (iso: string) => createWakeFilter({ db, ledger, tz: "Pacific/Auckland", now: () => now });
    now = new Date("2026-10-27T10:30:00Z"); // 23:30 on 2026-10-27 in Auckland
    expect(auckland("").process({ source: "heartbeat", botId: "boss", turnId: null, text: verdict({ dedupe_key: "x" }) }).decision).toBe("ping");
    now = new Date("2026-10-27T11:30:00Z"); // 00:30 on 2026-10-28 in Auckland, same UTC day
    expect(auckland("").process({ source: "heartbeat", botId: "boss", turnId: null, text: verdict({ dedupe_key: "y" }) }).decision).toBe("ping");
  });

  test("budget 0: every ping is a digest", () => {
    setWake({ dailyPingBudget: 0 });
    expect(run(verdict())).toMatchObject({ decision: "digest", suppressedBy: "budget" });
    expect(mainMessages()).toHaveLength(0);
  });

  test("a digest is queued and a repeat key is suppressed", () => {
    expect(run(verdict({ verdict: "digest", urgency: "low" }))).toMatchObject({ decision: "digest", suppressedBy: null });
    expect(run(verdict({ verdict: "digest", urgency: "low" }))).toMatchObject({ decision: "suppressed", suppressedBy: "dedupe" });
    expect(digests()).toHaveLength(1);
  });

  test("silent is only logged", () => {
    expect(run(verdict({ verdict: "silent" }))).toMatchObject({ decision: "silent", suppressedBy: null });
    expect(mainMessages()).toHaveLength(0);
    expect(digests()).toHaveLength(0);
    expect(wakeEvents()).toHaveLength(1);
  });

  test.each([["null", null], ["unparseable", "NOTHING"]] as const)("invalid text (%s) is silent+invalid and nothing is sent", (_label, text) => {
    const d = run(text);
    expect(d).toEqual({ id: expect.any(Number), decision: "silent", suppressedBy: "invalid", verdict: null, delivered: null });
    expect(decisions()).toEqual([{ decision: "silent", suppressed_by: "invalid" }]);
    expect(db.prepare("SELECT reason, dedupe_key, urgency, verdict FROM wake_decisions").get()).toEqual({
      reason: "no parseable verdict",
      dedupe_key: "invalid",
      urgency: "low",
      verdict: "silent",
    });
    expect(mainMessages()).toHaveLength(0);
    expect(digests()).toHaveLength(0);
    expect(onPing).not.toHaveBeenCalled();
  });

  test("onPing runs once per delivered ping, and its exception does not change the decision", () => {
    const boom = vi.fn(() => {
      throw new Error("push down");
    });
    const f = filter("UTC", boom);
    expect(f.process({ source: "heartbeat", botId: "boss", turnId: null, text: verdict() }).decision).toBe("ping");
    expect(boom).toHaveBeenCalledTimes(1);
    expect(decisions()).toEqual([{ decision: "ping", suppressed_by: null }]);
    expect(mainMessages()).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith("wake onPing failed");
  });

  test("onPing is called only for delivered pings, not digests, silent or suppressed decisions", () => {
    run(verdict({ urgency: "low" }));
    run(verdict({ verdict: "silent", dedupe_key: "s" }));
    expect(run(verdict({ dedupe_key: "z" })).decision).toBe("ping");
    expect(run(verdict({ dedupe_key: "z" })).decision).toBe("suppressed");
    expect(onPing).toHaveBeenCalledTimes(1);
  });

  test("exactly one wake_decisions row and one wake event per decision", () => {
    run(verdict());
    run(verdict());
    run(verdict({ verdict: "silent" }));
    run(null);
    run(verdict({ verdict: "digest", dedupe_key: "d" }));
    expect(count("SELECT COUNT(*) AS n FROM wake_decisions")).toBe(5);
    expect(wakeEvents()).toHaveLength(5);
    expect(count("SELECT COUNT(*) AS n FROM digest_items")).toBe(1);
  });

  test("a downgraded ping stores what was asked and what happened in one row", () => {
    setWake({ dailyPingBudget: 0 });
    run(verdict());
    expect(db.prepare("SELECT verdict, decision, suppressed_by FROM wake_decisions").get()).toEqual({
      verdict: "ping",
      decision: "digest",
      suppressed_by: "budget",
    });
  });

  test("the reason is redacted before it is stored", () => {
    const key = `sk-${"a".repeat(30)}`;
    run(verdict({ reason: `token ${key} leaked` }));
    const stored = db.prepare("SELECT reason FROM wake_decisions").get() as { reason: string };
    expect(stored.reason).not.toContain(key);
    expect(JSON.stringify(ledger.list("_system"))).not.toContain(key);
    expect(JSON.stringify(ledger.list("main"))).not.toContain(key);
  });

  test("listWakeDecisions returns newest first with the API shape", () => {
    run(verdict({ verdict: "silent" }));
    run(verdict({ dedupe_key: "later" }));
    const rows = listWakeDecisions(db, 10);
    expect(rows.map((r) => r.decision)).toEqual(["ping", "silent"]);
    expect(rows[0]).toEqual({
      id: expect.any(Number),
      ts: T0.getTime(),
      source: "heartbeat",
      botId: "boss",
      verdict: "ping",
      urgency: "high",
      dedupeKey: "later",
      reason: "Build broke",
      decision: "ping",
      suppressedBy: null,
      feedback: null,
    });
  });
});

describe("wake setting validation", () => {
  test("out-of-range values are rejected by setSetting", () => {
    expect(() => setWake({ dailyPingBudget: 51 })).toThrow();
    expect(() => setWake({ dedupeHours: 0 })).toThrow();
    expect(() => setWake({ urgencyThreshold: "urgent" })).toThrow();
  });
});
