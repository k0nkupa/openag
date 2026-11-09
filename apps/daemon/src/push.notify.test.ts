import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type Db, openDb } from "./db/index.js";
import { createPusher } from "./push.js";
import { createRedactor } from "./redact.js";
import { setSetting, type Push } from "./settings.js";
import { createNotifyTool } from "./tools/notify.js";
import { classify } from "./policy.js";
import { createLedger } from "./ledger.js";

const TOPIC = "openag-abcDEF123_-xyz789";
const SECRET_KEY = `sk-${"a".repeat(30)}`;
let dir: string;
let db: Db;
let fetchMock: ReturnType<typeof vi.fn>;

const ok = () => new Response("{}", { status: 200 });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-notify-"));
  db = openDb(dir);
  createLedger(db);
  fetchMock = vi.fn(async () => ok());
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const configure = (patch: Partial<Push> = {}) =>
  setSetting(db, "push", { enabled: true, server: "https://ntfy.sh", topic: TOPIC, publicUrl: null, includeDetail: false, maxPerHour: 20, ...patch });
const pusher = () => createPusher({ db, fetch: fetchMock as unknown as typeof fetch, redactor: createRedactor({ env: {} }) });
const sentBody = (i = 0) => JSON.parse(String((fetchMock.mock.calls[i] as [string, RequestInit])[1].body)) as Record<string, unknown>;

describe("pusher.notifyUser", () => {
  test("disabled or without a topic: no fetch, not ok", async () => {
    configure({ enabled: false });
    expect(await pusher().notifyUser("hi")).toMatchObject({ ok: false });
    configure({ enabled: true, topic: null });
    expect(await pusher().notifyUser("hi")).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("enabled: exact request shape (title, priority 4, message)", async () => {
    configure();
    expect(await pusher().notifyUser("Build is green")).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://ntfy.sh/");
    expect(sentBody()).toEqual({ topic: TOPIC, title: "OpenAg", message: "Build is green", priority: 4 });
  });

  test("click is set only when publicUrl is set", async () => {
    configure({ publicUrl: "https://openag.example/desk" });
    await pusher().notifyUser("x");
    expect(sentBody().click).toBe("https://openag.example/desk");
  });

  test("redacts secrets and clips to 200 characters", async () => {
    configure();
    await pusher().notifyUser(`key ${SECRET_KEY} ${"z".repeat(300)}`);
    const msg = String(sentBody().message);
    expect(msg).not.toContain(SECRET_KEY);
    expect(msg.length).toBeLessThanOrEqual(200);
  });

  test("shares the hourly cap with the other pushes", async () => {
    configure({ maxPerHour: 1 });
    const p = pusher();
    expect(await p.notifyUser("one")).toEqual({ ok: true });
    expect(await p.notifyUser("two")).toEqual({ ok: false, reason: "rate limit reached" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a network error is reported, never thrown", async () => {
    configure();
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("boom");
    });
    expect(await pusher().notifyUser("x")).toEqual({ ok: false, reason: "TypeError" });
  });
});

describe("notify_user tool", () => {
  test("has an explicit daemon-owned HTTP contract", () => {
    const tool = createNotifyTool(pusher());
    expect(tool.name).toBe("notify_user");
    expect(classify("notify_user")).toBe("act-external");
    expect(tool.permission?.({botId:"boss",dataDir:dir},{})).toEqual({approval:"allow"});
  });

  test("not enabled when push is disabled, enabled when configured", () => {
    configure({ enabled: false });
    expect(createNotifyTool(pusher()).enabled?.()).toBe(false);
    configure({ enabled: true });
    expect(createNotifyTool(pusher()).enabled?.()).toBe(true);
  });

  test("execute sends and reports the result", async () => {
    configure();
    const tool = createNotifyTool(pusher());
    await expect(tool.execute({ botId: "boss", dataDir: dir }, { text: "hello" })).resolves.toEqual({ sent: true });
    expect(sentBody().message).toBe("hello");
    configure({ maxPerHour: 1 });
    const again = createNotifyTool(pusher());
    await again.execute({ botId: "boss", dataDir: dir }, { text: "second" });
    await expect(again.execute({ botId: "boss", dataDir: dir }, { text: "third" })).resolves.toEqual({
      sent: false,
      reason: "rate limit reached",
    });
  });

  test("input is limited to 1..200 characters", () => {
    const tool = createNotifyTool(pusher());
    expect(tool.input.safeParse({ text: "" }).success).toBe(false);
    expect(tool.input.safeParse({ text: "a".repeat(201) }).success).toBe(false);
    expect(tool.input.safeParse({ text: "a".repeat(200) }).success).toBe(true);
  });
});
