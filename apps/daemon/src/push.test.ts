import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type Db, openDb } from "./db/index.js";
import { createRoom } from "./rooms.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createPusher, newPushTopic } from "./push.js";
import { createRedactor } from "./redact.js";
import { setSetting, type Push } from "./settings.js";
import { createWakeFilter, type PingNotice } from "./wake.js";

const TOPIC = "openag-abcDEF123_-xyz789";
const SECRET_KEY = `sk-${"a".repeat(30)}`;
const HOUR = 3_600_000;
const T0 = new Date("2026-10-27T09:00:00Z").getTime();

let dir: string;
let db: Db;
let ledger: Ledger;
let clock: number;
let fetchMock: ReturnType<typeof vi.fn>;

const ok = () => new Response("{}", { status: 200 });
const redactor = () => createRedactor({ env: {} });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-push-"));
  db = openDb(dir);
  ledger = createLedger(db);
  createRoom(db, { id: "main", name: "main" });
  setSetting(db, "deliveryRoom", { roomId: "main" }); // an existing install: proactive messages keep going to main
  clock = T0;
  fetchMock = vi.fn(async () => ok());
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const configure = (patch: Partial<Push> = {}) =>
  setSetting(db, "push", { enabled: true, server: "https://ntfy.sh", topic: TOPIC, publicUrl: null, includeDetail: false, maxPerHour: 20, ...patch });

const pusher = (r = redactor()) =>
  createPusher({ db, fetch: fetchMock as unknown as typeof fetch, now: () => clock, redactor: r });

const approval = (over: Partial<{ approvalId: string; toolName: string }> = {}, actor = "boss") => ({
  actor,
  payload: { approvalId: "ap-1", toolName: "shell_exec", ...over },
});

const sent = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
};

describe("push disabled or unconfigured", () => {
  test("disabled: no fetch for approvals, pings or test", async () => {
    configure({ enabled: false });
    const p = pusher();
    await p.notifyApproval(approval());
    await p.notifyPing({ botId: "boss", reason: "x", urgency: "high" });
    expect(await p.sendTest()).toEqual({ ok: false, reason: "push is not enabled or has no topic" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("enabled without a topic: no fetch", async () => {
    configure({ topic: null });
    const p = pusher();
    await p.notifyApproval(approval());
    await p.notifyPing({ botId: "boss", reason: "x", urgency: "normal" });
    expect((await p.sendTest()).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(p.status()).toMatchObject({ enabled: true, configured: false, sentThisHour: 0 });
  });
});

describe("approval source", () => {
  test("an approval raised from Slack says so in the push text (no user id)", async () => {
    configure();
    await pusher().notifyApproval({ actor: "boss", payload: { approvalId: "ap-s", toolName: "shell_exec", source: "slack:U0000ALICE1" } });
    const text = JSON.stringify(sent().body);
    expect(text).toContain("(from Slack)");
    expect(text).not.toContain("U0000ALICE1");
  });
});

describe("request shape", () => {
  test("approval: server root URL, JSON body, no payload leaked, no click without publicUrl", async () => {
    configure();
    await pusher().notifyApproval(
      approval({}, "boss"),
    );
    const { url, init, body } = sent();
    expect(url).toBe("https://ntfy.sh/");
    expect(url).not.toContain(TOPIC);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(body).toEqual({ topic: TOPIC, title: "OpenAg", message: "Approval needed: boss wants shell_exec. Open their conversation in OpenAg.", priority: 4 });
  });

  test("trailing slashes on the server are collapsed to one", async () => {
    configure({ server: "https://ntfy.example.com///" });
    await pusher().sendTest();
    expect(sent().url).toBe("https://ntfy.example.com/");
  });

  test("approval payload with paths and content never reaches the message", async () => {
    configure();
    // Extra fields beyond the declared shape are deliberate: they must never reach the message.
    const payload = { approvalId: "ap-9", toolName: "write_file", file_path: "/etc/passwd", content: "secret" };
    await pusher().notifyApproval({ actor: "boss", payload });
    const msg = String(sent().body.message);
    expect(msg).not.toContain("/etc/passwd");
    expect(msg).not.toContain("secret");
    expect(msg).not.toContain("file_path");
  });

  test("click is set only with publicUrl", async () => {
    configure({ publicUrl: "https://mini.tailnet.ts.net" });
    await pusher().sendTest();
    expect(sent().body.click).toBe("https://mini.tailnet.ts.net");
  });

  test("ping without details", async () => {
    configure();
    await pusher().notifyPing({ botId: "coder", reason: "Build broke", urgency: "high" });
    expect(sent().body).toEqual({ topic: TOPIC, title: "OpenAg", message: "Heads-up from coder. Open OpenAg to read it.", priority: 5 });
  });

  test("ping with details, priorities by urgency", async () => {
    configure({ includeDetail: true });
    const p = pusher();
    await p.notifyPing({ botId: "coder", reason: "Build broke", urgency: "normal" });
    await p.notifyPing({ botId: "coder", reason: "FYI", urgency: "low" });
    expect(sent(0).body).toMatchObject({ message: "Heads-up from coder: Build broke", priority: 4 });
    expect(sent(1).body.priority).toBe(3);
  });

  test("test notification", async () => {
    configure();
    expect(await pusher().sendTest()).toEqual({ ok: true });
    expect(sent().body).toMatchObject({ message: "Test notification from OpenAg", priority: 3 });
  });

  test("clips titles and messages", async () => {
    configure({ includeDetail: true });
    await pusher().notifyPing({ botId: "coder", reason: "x".repeat(900), urgency: "normal" });
    const msg = String(sent().body.message);
    expect(msg.length).toBeLessThanOrEqual(200);
    expect(msg.startsWith("Heads-up from coder: ")).toBe(true);
  });

  test("generic names when botId or toolName are missing or too long", async () => {
    configure();
    const p = pusher();
    await p.notifyApproval({ actor: "", payload: { approvalId: "a1" } });
    await p.notifyApproval({ actor: "b".repeat(81), payload: { approvalId: "a2", toolName: 7 } });
    expect(sent(0).body.message).toBe("Approval needed: an agent wants a tool. Open their conversation in OpenAg.");
    expect(sent(1).body.message).toBe("Approval needed: an agent wants a tool. Open their conversation in OpenAg.");
  });

  test("secrets in botId or reason never leave", async () => {
    configure({ includeDetail: true });
    const p = pusher();
    await p.notifyPing({ botId: `bot-${SECRET_KEY}`, reason: `key is ${SECRET_KEY}`, urgency: "high" });
    const raw = JSON.stringify(sent().body);
    expect(raw).not.toContain(SECRET_KEY);
    expect(raw).toContain("[REDACTED:api-key]");
  });
});

describe("dedupe and cap", () => {
  test("approvals are sent once per approvalId", async () => {
    configure();
    const p = pusher();
    await p.notifyApproval(approval({ approvalId: "same" }));
    await p.notifyApproval(approval({ approvalId: "same" }));
    await p.notifyApproval(approval({ approvalId: "other" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("cap of 3 per hour drops the 4th, sends resume after the hour", async () => {
    configure({ maxPerHour: 3 });
    const p = pusher();
    for (let i = 0; i < 4; i++) await p.notifyPing({ botId: "boss", reason: "r", urgency: "normal" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(p.status()).toMatchObject({ sentThisHour: 3, dropped: 1 });

    clock += HOUR + 1;
    await p.notifyPing({ botId: "boss", reason: "r", urgency: "normal" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(p.status().sentThisHour).toBe(1);
  });

  test("test sends pass the cap until it is exceeded three times over", async () => {
    configure({ maxPerHour: 1 });
    const p = pusher();
    expect((await p.sendTest()).ok).toBe(true);
    expect((await p.sendTest()).ok).toBe(true);
    expect((await p.sendTest()).ok).toBe(true);
    expect(await p.sendTest()).toEqual({ ok: false, reason: "rate limit reached" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("failures", () => {
  test("network error, 500 and 429 never throw, never retry, and leave no URL or topic in lastError", async () => {
    configure();
    const p = pusher();
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError(`fetch failed ${TOPIC}`);
    });
    await expect(p.notifyPing({ botId: "boss", reason: "r", urgency: "normal" })).resolves.toBeUndefined();
    expect(p.status().lastError).toBe("TypeError");

    fetchMock.mockImplementationOnce(async () => new Response("bad", { status: 500 }));
    expect((await p.sendTest()).ok).toBe(false);
    expect(p.status().lastError).toBe("HTTP 500");

    fetchMock.mockImplementationOnce(async () => new Response("slow down", { status: 429 }));
    await p.notifyApproval(approval({ approvalId: "x" }));
    expect(p.status().lastError).toBe("HTTP 429");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(p.status())).not.toContain(TOPIC);
    expect(JSON.stringify(p.status())).not.toContain("ntfy.sh");
  });
});

describe("wake integration", () => {
  test("only a delivered ping calls the pusher", async () => {
    configure();
    const notifyPing = vi.fn(async (_notice: PingNotice) => undefined);
    const wake = createWakeFilter({
      db,
      ledger,
      tz: "UTC",
      now: () => new Date(clock),
      onPing: (d: PingNotice) => void notifyPing(d),
    });
    const v = (verdict: string, key: string) =>
      JSON.stringify({ verdict, reason: "Build broke", urgency: "high", dedupe_key: key });
    wake.process({ source: "t", botId: "boss", turnId: null, text: v("ping", "a") });
    wake.process({ source: "t", botId: "boss", turnId: null, text: v("digest", "b") });
    wake.process({ source: "t", botId: "boss", turnId: null, text: v("silent", "c") });
    wake.process({ source: "t", botId: "boss", turnId: null, text: v("ping", "a") }); // suppressed: duplicate
    expect(notifyPing).toHaveBeenCalledTimes(1);
    expect(notifyPing.mock.calls[0]?.[0]).toMatchObject({ botId: "boss", urgency: "high" });
  });
});
