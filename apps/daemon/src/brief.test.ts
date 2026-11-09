import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildBrief, deliverBrief, registerBrief } from "./brief.js";
import { type Db, openDb } from "./db/index.js";
import { createRoom } from "./rooms.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createScheduler } from "./scheduler.js";
import { setSetting } from "./settings.js";

// 2026-10-27 is a Tuesday (weekday 2). All instants below are UTC unless the zone is named.
const iso = (s: string) => new Date(s);

let dir: string;
let db: Db;
let ledger: Ledger;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-brief-"));
  db = openDb(dir);
  ledger = createLedger(db);
  createRoom(db, { id: "main", name: "main" });
  setSetting(db, "deliveryRoom", { roomId: "main" }); // an existing install: proactive messages keep going to main
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let approvalSeq = 0;
function addDigest(text: string, ts = Date.parse("2026-10-26T20:00:00Z"), botId = "boss") {
  db.prepare("INSERT INTO digest_items (ts, bot_id, text, dedupe_key, decision_id) VALUES (?, ?, ?, ?, 0)").run(
    ts,
    botId,
    text,
    `k-${ts}-${text.length}-${Math.random()}`,
  );
}
function addApproval(botId = "boss", toolName = "send_email", toolClass = "act-external", status = "pending") {
  approvalSeq++;
  db.prepare(
    "INSERT INTO approvals (id, room_id, bot_id, tool_name, tool_class, status, created_at) VALUES (?, 'main', ?, ?, ?, ?, ?)",
  ).run(`ap-${approvalSeq}`, botId, toolName, toolClass, status, Date.now());
}
const brief = (over: Record<string, unknown> = {}) =>
  setSetting(db, "brief", { enabled: true, time: "07:30", days: [0, 1, 2, 3, 4, 5, 6], ...over });
const mainMessages = () => ledger.list("main").filter((e) => e.type === "message");
const wakeEvents = () => ledger.list("_system").filter((e) => e.type === "wake");
const deliver = (now: Date, tz = "UTC", extra: Partial<Parameters<typeof deliverBrief>[0]> = {}) =>
  deliverBrief({ db, ledger, now, tz, ...extra });

describe("buildBrief", () => {
  test("neither digest items nor approvals gives null", () => {
    expect(buildBrief({ db })).toBeNull();
  });

  test("digest only", () => {
    addDigest("Deploy finished");
    const b = buildBrief({ db })!;
    expect(b.text).toBe("Good morning. Here is what is waiting:\n\nOvernight notes (1):\n- [boss] Deploy finished");
    expect(b.approvals).toBe(0);
    expect(b.digestIds).toHaveLength(1);
  });

  test("approvals only", () => {
    addApproval("coder", "shell", "act-local");
    const b = buildBrief({ db })!;
    expect(b.text).toBe("Good morning. Here is what is waiting:\n\n1 approval waiting for you\n- coder wants shell (act-local) — [Open conversation](#/room/main)");
    expect(b.approvals).toBe(1);
    expect(b.digestIds).toEqual([]);
  });

  test("both sections, approvals first, exact format", () => {
    addApproval("boss", "send_email", "act-external");
    addApproval("coder", "shell", "act-local");
    addDigest("first note", Date.parse("2026-10-26T20:00:00Z"), "boss");
    addDigest("second note", Date.parse("2026-10-26T21:00:00Z"), "coder");
    const b = buildBrief({ db })!;
    expect(b.text).toBe(
      [
        "Good morning. Here is what is waiting:",
        "",
        "2 approvals waiting for you",
        "- boss wants send_email (act-external) — [Open conversation](#/room/main)",
        "- coder wants shell (act-local) — [Open conversation](#/room/main)",
        "",
        "Overnight notes (2):",
        "- [boss] first note",
        "- [coder] second note",
      ].join("\n"),
    );
    expect(b.approvals).toBe(2);
  });

  test("at most 5 approval lines and 15 note lines, then the remainder count", () => {
    for (let i = 0; i < 7; i++) addApproval("boss", `tool${i}`);
    for (let i = 0; i < 18; i++) addDigest(`note ${i}`, Date.parse("2026-10-26T20:00:00Z") + i);
    const b = buildBrief({ db })!;
    expect(b.text).toContain("7 approvals waiting for you");
    expect(b.text.split("\n").filter((l) => l.includes(" wants "))).toHaveLength(5);
    expect(b.text).toContain("Overnight notes (18):");
    expect(b.text.split("\n").filter((l) => l.startsWith("- [boss] note "))).toHaveLength(15);
    expect(b.text.endsWith("...and 3 more")).toBe(true);
    expect(b.digestIds).toHaveLength(15);
  });

  test("long and multi-line text is flattened and clipped to 300 characters", () => {
    addDigest(`line one\nline two\r\n${"x".repeat(400)}`);
    const line = buildBrief({ db })!.text.split("\n").find((l) => l.startsWith("- [boss]"))!;
    expect(line).toBe(`- [boss] line one line two ${"x".repeat(300 - "line one line two ".length)}`);
    expect(line.length).toBe("- [boss] ".length + 300);
  });

  test("stored secrets are redacted in the final text even if a row was written unredacted", () => {
    const key = "sk-" + "a".repeat(30);
    addDigest(`token ${key}`);
    const b = buildBrief({ db })!;
    expect(b.text).not.toContain(key);
  });

  test("delivered items are excluded", () => {
    addDigest("done", Date.parse("2026-10-26T20:00:00Z"));
    db.prepare("UPDATE digest_items SET delivered_at = 1").run();
    expect(buildBrief({ db })).toBeNull();
  });
});

describe("deliverBrief", () => {
  test("before the time is not_due", () => {
    addDigest("note");
    expect(deliver(iso("2026-10-27T07:29:00Z"))).toEqual({ sent: false, reason: "not_due" });
    expect(mainMessages()).toHaveLength(0);
  });

  test("at the time sends once: message, delivered items, audit event, second call already_sent", () => {
    addDigest("overnight");
    const at = iso("2026-10-27T07:30:00Z");
    expect(deliver(at)).toEqual({ sent: true });

    const msgs = mainMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.actor).toBe("primary");
    expect(msgs[0]!.payload).toMatchObject({ brief: true });
    expect((msgs[0]!.payload as { text: string }).text).toContain("- [boss] overnight");

    const audit = wakeEvents();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload).toEqual({ action: "brief_sent", items: 1, approvals: 0 });

    const row = db.prepare("SELECT delivered_at FROM digest_items").get() as { delivered_at: number };
    expect(row.delivered_at).toBe(at.getTime());

    expect(deliver(iso("2026-10-27T07:40:00Z"))).toEqual({ sent: false, reason: "already_sent" });
    expect(mainMessages()).toHaveLength(1);
  });

  test("the next local day sends again", () => {
    addDigest("day one");
    deliver(iso("2026-10-27T07:31:00Z"));
    addDigest("day two");
    expect(deliver(iso("2026-10-28T07:31:00Z"))).toEqual({ sent: true });
    expect(mainMessages()).toHaveLength(2);
  });

  test("the window ends three hours after the time: 10:29 sends, 10:30 is not_due", () => {
    addDigest("late");
    expect(deliver(iso("2026-10-27T10:30:00Z"))).toEqual({ sent: false, reason: "not_due" });
    expect(deliver(iso("2026-10-27T10:29:00Z"))).toEqual({ sent: true });
  });

  test("disabled", () => {
    addDigest("note");
    brief({ enabled: false });
    expect(deliver(iso("2026-10-27T07:31:00Z"))).toEqual({ sent: false, reason: "disabled" });
  });

  test("days excluding today is off_day", () => {
    addDigest("note");
    brief({ days: [0] });
    expect(deliver(iso("2026-10-27T07:31:00Z"))).toEqual({ sent: false, reason: "off_day" });
  });

  test("empty brief sends nothing and does not set lastSentDate, so an item arriving later in the window is sent", () => {
    expect(deliver(iso("2026-10-27T07:31:00Z"))).toEqual({ sent: false, reason: "empty" });
    expect(db.prepare("SELECT 1 FROM settings WHERE key = 'briefState'").get()).toBeUndefined();

    addDigest("arrived late");
    expect(deliver(iso("2026-10-27T08:00:00Z"))).toEqual({ sent: true });
  });

  test("force ignores enabled, days, window and lastSentDate, but still skips an empty brief", () => {
    brief({ enabled: false, days: [0], time: "23:00" });
    expect(deliver(iso("2026-10-27T07:31:00Z"), "UTC", { force: true })).toEqual({ sent: false, reason: "empty" });

    addDigest("forced");
    expect(deliver(iso("2026-10-27T07:31:00Z"), "UTC", { force: true })).toEqual({ sent: true });
    addDigest("forced again");
    expect(deliver(iso("2026-10-27T07:32:00Z"), "UTC", { force: true })).toEqual({ sent: true });
    expect(mainMessages()).toHaveLength(2);
  });

  test("a window crossing midnight is keyed to the day it started", () => {
    brief({ time: "22:30" });
    addDigest("evening");
    // 00:45 on Oct 27 is inside the window that started on Oct 26 at 22:30.
    expect(deliver(iso("2026-10-27T00:45:00Z"))).toEqual({ sent: true });
    addDigest("still same window");
    expect(deliver(iso("2026-10-27T01:00:00Z"))).toEqual({ sent: false, reason: "already_sent" });
    expect(deliver(iso("2026-10-27T01:31:00Z"))).toEqual({ sent: false, reason: "not_due" });
    // Oct 27 22:31 starts a new window keyed to Oct 27.
    expect(deliver(iso("2026-10-27T22:31:00Z"))).toEqual({ sent: true });
  });

  test("a midnight-crossing window respects the day the window started on", () => {
    brief({ time: "22:30", days: [0, 2, 3, 4, 5, 6] }); // Monday (1) excluded
    addDigest("monday night");
    // The window started Monday 22:30, which is excluded, so 00:45 Tuesday must not send.
    expect(deliver(iso("2026-10-27T00:45:00Z"))).toEqual({ sent: false, reason: "off_day" });
  });

  test("Pacific/Auckland on the DST start day (2026-09-27) sends at 07:45 local", () => {
    addDigest("nz");
    const tz = "Pacific/Auckland";
    // 07:29 NZDT (+13) is 18:29Z on Sep 26.
    expect(deliver(iso("2026-09-26T18:29:00Z"), tz)).toEqual({ sent: false, reason: "not_due" });
    expect(deliver(iso("2026-09-26T18:45:00Z"), tz)).toEqual({ sent: true });
    expect(deliver(iso("2026-09-26T18:50:00Z"), tz)).toEqual({ sent: false, reason: "already_sent" });
  });

  test("a non-UTC zone uses its local clock (America/New_York, 07:30 EDT = 11:30Z)", () => {
    addDigest("ny");
    const tz = "America/New_York";
    expect(deliver(iso("2026-10-27T11:29:00Z"), tz)).toEqual({ sent: false, reason: "not_due" });
    expect(deliver(iso("2026-10-27T11:30:00Z"), tz)).toEqual({ sent: true });
  });

  test("onBrief is called once with counts; a throwing onBrief is ignored", () => {
    addDigest("n");
    addApproval();
    const onBrief = vi.fn();
    expect(deliver(iso("2026-10-27T07:31:00Z"), "UTC", { onBrief })).toEqual({ sent: true });
    expect(onBrief).toHaveBeenCalledTimes(1);
    expect(onBrief).toHaveBeenCalledWith({ items: 1, approvals: 1 });

    addDigest("n2");
    const boom = vi.fn(() => {
      throw new Error("listener down");
    });
    expect(deliver(iso("2026-10-27T07:31:00Z"), "UTC", { force: true, onBrief: boom })).toEqual({ sent: true });
    expect(boom).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });

  test("delivered items never reappear in the next brief", () => {
    addDigest("once");
    deliver(iso("2026-10-27T07:31:00Z"));
    expect(buildBrief({ db })).toBeNull();
    expect(deliver(iso("2026-10-28T07:31:00Z"))).toEqual({ sent: false, reason: "empty" });
  });

  test("more than 15 items: only the 15 shown are delivered, the rest wait for the next brief", () => {
    for (let i = 0; i < 16; i++) addDigest(`n${i}`, Date.parse("2026-10-26T20:00:00Z") + i);
    deliver(iso("2026-10-27T07:31:00Z"));
    const left = db.prepare("SELECT COUNT(*) AS n FROM digest_items WHERE delivered_at IS NULL").get() as { n: number };
    expect(left.n).toBe(1);
  });
});

describe("registerBrief scheduler wiring", () => {
  test("07:29 sends nothing, 07:31 sends, 07:32 does not resend", async () => {
    addDigest("tick");
    let clock = iso("2026-10-27T07:00:00Z");
    const scheduler = createScheduler({ now: () => clock });
    registerBrief({ db, ledger, scheduler, tz: "UTC" });

    clock = iso("2026-10-27T07:29:00Z");
    await scheduler.tick(clock);
    expect(mainMessages()).toHaveLength(0);

    clock = iso("2026-10-27T07:31:00Z");
    await scheduler.tick(clock);
    expect(mainMessages()).toHaveLength(1);

    clock = iso("2026-10-27T07:32:00Z");
    await scheduler.tick(clock);
    expect(mainMessages()).toHaveLength(1);
  });
});
