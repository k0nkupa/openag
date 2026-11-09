import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type Db, openDb } from "./db/index.js";
import {
  getSetting,
  isWithinActiveHours,
  listSettings,
  resolveTimezone,
  SettingsError,
  setSetting,
  type ActiveHours,
} from "./settings.js";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-settings-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const DEFAULT_HOURS: ActiveHours = { start: "07:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] };
const hours = (start: string, end: string, days: number[] = [0, 1, 2, 3, 4, 5, 6]): ActiveHours => ({ start, end, days });

describe("getSetting / setSetting", () => {
  test("missing keys return the defaults", () => {
    expect(getSetting(db, "heartbeat")).toEqual({ enabled: false, everyMinutes: 60, botId: null, prompt: null });
    expect(getSetting(db, "activeHours")).toEqual(DEFAULT_HOURS);
    expect(listSettings(db)).toEqual({
      defaultBot: { botId: null },
      deliveryRoom: { roomId: null },
      backup: { enabled: true, time: "04:00", keep: 7 },
      limits: { maxTurnsPerBotPerDay: 0, maxUnattendedPerDay: 0 },
      rtc: { enabled: false, server: "https://ntfy.sh", topic: null, stun: ["stun:stun.l.google.com:19302"] },
      slack: { enabled: false, roomId: null, channelId: null, allowedUsers: [] },
      apps: { enabled: {}, paused: {} },
      computer: { backend: "cua" },
      reflection: { enabled: false, time: "03:30", botId: null, lookbackHours: 24, maxMemoryProposals: 5, maxSkillProposals: 3 },
      heartbeat: { enabled: false, everyMinutes: 60, botId: null, prompt: null },
      activeHours: DEFAULT_HOURS,
      wake: { dailyPingBudget: 3, dedupeHours: 24, urgencyThreshold: "normal" },
      brief: { enabled: true, time: "07:30", days: [0, 1, 2, 3, 4, 5, 6] },
      push: { enabled: false, server: "https://ntfy.sh", topic: null, publicUrl: null, includeDetail: false, maxPerHour: 20 },
      connectorSignIn: { callbackOrigin: null, deskOrigins: [] },
      dictation: { enabled: false, model: "", provider: "openai" },
      profile: { avatar: null, name: "You" },
      skillLibrary: { assignments: {}, enabled: false },
    });
    expect(getSetting(db, "wake")).toEqual({ dailyPingBudget: 3, dedupeHours: 24, urgencyThreshold: "normal" });
  });

  test("computer.backend accepts only known backends", () => {
    expect(setSetting(db, "computer", { backend: "browserbase" })).toEqual({ backend: "browserbase" });
    for (const bad of [{ backend: "vps" }, { backend: "" }, { backend: 5 }, {}]) {
      if (Object.keys(bad).length === 0) continue; // an empty object is the default
      expect(() => setSetting(db, "computer", bad)).toThrow();
    }
  });

  test("a valid value is stored and read back", () => {
    setSetting(db, "heartbeat", { enabled: true, everyMinutes: 15, botId: "boss", prompt: "check" });
    expect(getSetting(db, "heartbeat")).toEqual({ enabled: true, everyMinutes: 15, botId: "boss", prompt: "check" });
  });

  test("invalid values throw SettingsError with the issue text and store nothing", () => {
    expect(() => setSetting(db, "heartbeat", { enabled: true, everyMinutes: 4 })).toThrow(SettingsError);
    expect(() => setSetting(db, "heartbeat", { enabled: true, everyMinutes: 4 })).toThrow(/everyMinutes/);
    expect(() => setSetting(db, "heartbeat", { everyMinutes: 1441 })).toThrow(SettingsError);
    expect(() => setSetting(db, "heartbeat", { everyMinutes: 5.5 })).toThrow(SettingsError);
    expect(() => setSetting(db, "heartbeat", { prompt: "x".repeat(2001) })).toThrow(SettingsError);
    expect(() => setSetting(db, "heartbeat", "not an object")).toThrow(SettingsError);
    expect(() => setSetting(db, "activeHours", { start: "7:00", end: "22:00", days: [0] })).toThrow(/start/);
    expect(() => setSetting(db, "activeHours", { start: "24:00", end: "22:00", days: [0] })).toThrow(SettingsError);
    expect(() => setSetting(db, "activeHours", { start: "07:00", end: "22:00", days: [7] })).toThrow(SettingsError);
    expect(() => setSetting(db, "activeHours", { start: "07:00", end: "22:00", days: [] })).toThrow(SettingsError);
    expect(() => setSetting(db, "activeHours", { start: "07:00", end: "22:00", days: [1, 1] })).toThrow(/unique/);
    expect(() => setSetting(db, "nope" as never, {})).toThrow(/unknown setting/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM settings").get()).toEqual({ n: 0 });
  });

  test("stores the parsed value, never the raw input", () => {
    setSetting(db, "heartbeat", { everyMinutes: 30, extra: "dropped" });
    const row = db.prepare("SELECT value_json FROM settings WHERE key = 'heartbeat'").get() as { value_json: string };
    expect(JSON.parse(row.value_json)).toEqual({ enabled: false, everyMinutes: 30, botId: null, prompt: null });
  });

  test("corrupt JSON falls back to the defaults without throwing", () => {
    db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('heartbeat', '{not json', 0)").run();
    expect(getSetting(db, "heartbeat").everyMinutes).toBe(60);
  });

  test("a stored value that no longer validates falls back to the defaults", () => {
    db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('heartbeat', '{\"everyMinutes\":2}', 0)").run();
    expect(getSetting(db, "heartbeat")).toEqual({ enabled: false, everyMinutes: 60, botId: null, prompt: null });
    db.prepare("UPDATE settings SET value_json = '[1,2]' WHERE key = 'heartbeat'").run();
    expect(getSetting(db, "heartbeat").everyMinutes).toBe(60);
  });

  test("a partial stored object is merged over the defaults", () => {
    db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('heartbeat', '{\"enabled\":true}', 0)").run();
    expect(getSetting(db, "heartbeat")).toEqual({ enabled: true, everyMinutes: 60, botId: null, prompt: null });
  });
});

describe("resolveTimezone", () => {
  const saved = process.env.OPENAG_TZ;
  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAG_TZ;
    else process.env.OPENAG_TZ = saved;
  });

  test("uses OPENAG_TZ when it is a valid IANA zone", () => {
    process.env.OPENAG_TZ = "Pacific/Auckland";
    expect(resolveTimezone()).toBe("Pacific/Auckland");
  });

  test("falls back to the system zone for an invalid OPENAG_TZ", () => {
    process.env.OPENAG_TZ = "Not/AZone";
    expect(resolveTimezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("isWithinActiveHours", () => {
  test("daytime window is start-inclusive and end-exclusive (UTC)", () => {
    const h = hours("07:00", "22:00");
    expect(isWithinActiveHours(new Date("2026-10-27T07:00:00Z"), h, "UTC")).toBe(true);
    expect(isWithinActiveHours(new Date("2026-10-27T06:59:00Z"), h, "UTC")).toBe(false);
    expect(isWithinActiveHours(new Date("2026-10-27T21:59:00Z"), h, "UTC")).toBe(true);
    expect(isWithinActiveHours(new Date("2026-10-27T22:00:00Z"), h, "UTC")).toBe(false);
  });

  test("uses the zone, not UTC (Pacific/Auckland is +13 in late October)", () => {
    // 2026-10-26T20:00Z is Tuesday 09:00 in Auckland (inside), 2026-10-26T10:00Z is 23:00 (outside).
    expect(isWithinActiveHours(new Date("2026-10-26T20:00:00Z"), DEFAULT_HOURS, "Pacific/Auckland")).toBe(true);
    expect(isWithinActiveHours(new Date("2026-10-26T10:00:00Z"), DEFAULT_HOURS, "Pacific/Auckland")).toBe(false);
  });

  test("a different zone: New York 09:00 EDT is inside the default window", () => {
    expect(isWithinActiveHours(new Date("2026-10-27T13:00:00Z"), DEFAULT_HOURS, "America/New_York")).toBe(true);
    expect(isWithinActiveHours(new Date("2026-10-27T13:00:00Z"), DEFAULT_HOURS, "UTC")).toBe(true);
    expect(isWithinActiveHours(new Date("2026-10-27T03:00:00Z"), DEFAULT_HOURS, "America/New_York")).toBe(false);
  });

  test("overnight window 22:00-06:00 is active at 23:00 and 05:00, not at noon or 06:00", () => {
    const h = hours("22:00", "06:00");
    expect(isWithinActiveHours(new Date("2026-10-27T23:00:00Z"), h, "UTC")).toBe(true);
    expect(isWithinActiveHours(new Date("2026-10-27T05:00:00Z"), h, "UTC")).toBe(true);
    expect(isWithinActiveHours(new Date("2026-10-27T12:00:00Z"), h, "UTC")).toBe(false);
    expect(isWithinActiveHours(new Date("2026-10-27T06:00:00Z"), h, "UTC")).toBe(false);
    expect(isWithinActiveHours(new Date("2026-10-27T22:00:00Z"), h, "UTC")).toBe(true);
  });

  test("the day check uses the local weekday of the evaluated instant", () => {
    // Monday only. Monday 23:00 is active; Tuesday 05:00 (inside the overnight window) is not, by design.
    const h = hours("22:00", "06:00", [1]);
    expect(isWithinActiveHours(new Date("2026-10-26T23:00:00Z"), h, "UTC")).toBe(true); // Mon
    expect(isWithinActiveHours(new Date("2026-10-27T05:00:00Z"), h, "UTC")).toBe(false); // Tue
  });

  test("wrong weekday is never active", () => {
    const h = hours("07:00", "22:00", [0]); // Sunday only
    expect(isWithinActiveHours(new Date("2026-10-27T10:00:00Z"), h, "UTC")).toBe(false); // Tuesday
    expect(isWithinActiveHours(new Date("2026-10-25T10:00:00Z"), h, "UTC")).toBe(true); // Sunday
  });

  test("start == end means always active, on the allowed days", () => {
    const h = hours("00:00", "00:00", [2]);
    expect(isWithinActiveHours(new Date("2026-10-27T03:00:00Z"), h, "UTC")).toBe(true); // Tuesday
    expect(isWithinActiveHours(new Date("2026-10-27T15:00:00Z"), h, "UTC")).toBe(true);
    expect(isWithinActiveHours(new Date("2026-10-28T03:00:00Z"), h, "UTC")).toBe(false); // Wednesday
  });

  test("DST day in Pacific/Auckland (2026-09-27 02:00 jumps to 03:00) is evaluated on local clock time", () => {
    const h = hours("02:00", "04:00", [0]); // Sunday 02:00-04:00
    expect(isWithinActiveHours(new Date("2026-09-26T13:30:00Z"), h, "Pacific/Auckland")).toBe(false); // 01:30 NZST
    expect(isWithinActiveHours(new Date("2026-09-26T14:10:00Z"), h, "Pacific/Auckland")).toBe(true); // 03:10 NZDT
    expect(isWithinActiveHours(new Date("2026-09-26T15:10:00Z"), h, "Pacific/Auckland")).toBe(false); // 04:10 NZDT
  });
});

describe("reflection setting", () => {
  test("defaults: off, 03:30, lead bot, 24h lookback, 5 memory / 3 skill proposals", () => {
    expect(getSetting(db, "reflection")).toEqual({
      enabled: false,
      time: "03:30",
      botId: null,
      lookbackHours: 24,
      maxMemoryProposals: 5,
      maxSkillProposals: 3,
    });
  });

  test("rejects out-of-range values and bad time strings", () => {
    expect(() => setSetting(db, "reflection", { time: "3:30" })).toThrow(/time/);
    expect(() => setSetting(db, "reflection", { time: "24:00" })).toThrow(SettingsError);
    expect(() => setSetting(db, "reflection", { lookbackHours: 0 })).toThrow(/lookbackHours/);
    expect(() => setSetting(db, "reflection", { lookbackHours: 73 })).toThrow(SettingsError);
    expect(() => setSetting(db, "reflection", { maxMemoryProposals: 11 })).toThrow(SettingsError);
    expect(() => setSetting(db, "reflection", { maxSkillProposals: 6 })).toThrow(SettingsError);
    expect(() => setSetting(db, "reflection", { enabled: "yes" })).toThrow(SettingsError);
  });

  test("valid values round-trip and unknown keys are dropped", () => {
    setSetting(db, "reflection", { enabled: true, time: "23:15", botId: "boss", lookbackHours: 72, extra: 1 });
    expect(getSetting(db, "reflection")).toEqual({
      enabled: true,
      time: "23:15",
      botId: "boss",
      lookbackHours: 72,
      maxMemoryProposals: 5,
      maxSkillProposals: 3,
    });
  });
});
