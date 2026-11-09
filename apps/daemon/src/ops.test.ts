import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { openDb, type Db } from "./db/index.js";
import { createRedactor } from "./redact.js";
import { createOps, parseHealthcheckUrl, registerOps, rotateFile } from "./ops.js";
import { createScheduler } from "./scheduler.js";

const URL_OK = "https://hc-ping.example/abcd-1234-secret-slug";
let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-ops-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("healthcheck ping", () => {
  test("only https URLs without credentials are accepted", () => {
    expect(parseHealthcheckUrl(URL_OK)).toEqual({ url: URL_OK, secret: "abcd-1234-secret-slug" });
    for (const bad of [undefined, "", "http://x.example/a", "ftp://x", "https://user:pw@x.example/a", "https://x.example/short", "not a url", `https://x.example/${"a".repeat(600)}`]) expect(parseHealthcheckUrl(bad)).toBeNull();
  });

  test("a ping is one GET with redirect refused; the URL never appears in the status; the status shows ok / fixed errors", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let status = 200;
    const f = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(u), init: init ?? {} });
      return new Response("ok", { status });
    });
    const redactor = createRedactor({ env: {} });
    const ops = createOps({ db, dataDir: dir, env: { OPENAG_HEALTHCHECK_URL: URL_OK }, fetch: f as unknown as typeof fetch, now: () => 1000, redactor });
    expect(await ops.ping()).toBe(true);
    expect(calls[0]).toMatchObject({ url: URL_OK });
    expect((calls[0]!.init as { redirect?: string }).redirect).toBe("error");
    expect(ops.status().healthcheck).toEqual({ configured: true, lastOkAt: 1000, lastError: null });
    expect(JSON.stringify(ops.status())).not.toContain("secret-slug");
    expect(redactor.redactString(`oops ${URL_OK}`)).not.toContain("secret-slug");
    status = 503;
    expect(await ops.ping()).toBe(false);
    expect(ops.status().healthcheck.lastError).toBe("monitor answered 503");
  });

  test("no ping without a URL, none when the self-check fails, and network errors are a fixed string", async () => {
    const f = vi.fn(async () => new Response("ok"));
    expect(await createOps({ db, dataDir: dir, env: {}, fetch: f as unknown as typeof fetch }).ping()).toBe(false);
    expect(f).not.toHaveBeenCalled();
    const bad = createOps({ db, dataDir: dir, env: { OPENAG_HEALTHCHECK_URL: "http://insecure.example/x" }, fetch: f as unknown as typeof fetch });
    expect(bad.status().healthcheck).toMatchObject({ configured: false, lastError: "OPENAG_HEALTHCHECK_URL must be an https URL with a path of 12+ characters" });
    const failing = createOps({ db, dataDir: dir, env: { OPENAG_HEALTHCHECK_URL: URL_OK }, fetch: (async () => { throw new Error("ECONNREFUSED " + URL_OK); }) as unknown as typeof fetch });
    expect(await failing.ping()).toBe(false);
    expect(failing.status().healthcheck.lastError).toBe("could not reach the monitor");
    const closed = createOps({ db, dataDir: dir, env: { OPENAG_HEALTHCHECK_URL: URL_OK }, fetch: f as unknown as typeof fetch });
    db.close();
    expect(await closed.ping()).toBe(false);
    expect(closed.status().healthcheck.lastError).toBe("self-check failed");
    db = openDb(dir); // for afterEach
    expect(f).not.toHaveBeenCalled();
  });

  test("the scheduler pings every 5 minutes", async () => {
    const f = vi.fn(async () => new Response("ok"));
    const ops = createOps({ db, dataDir: dir, env: { OPENAG_HEALTHCHECK_URL: URL_OK }, fetch: f as unknown as typeof fetch });
    let t = new Date(2026, 9, 29, 10, 0, 0);
    const scheduler = createScheduler({ now: () => t });
    registerOps({ scheduler, ops });
    for (let i = 0; i < 4; i++) {
      t = new Date(t.getTime() + 5 * 60_000 + 1000);
      await scheduler.tick(t);
    }
    expect(f.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe("service log rotation", () => {
  test("a big log keeps its newest bytes in .1 and is truncated in place; small and missing files are left alone", () => {
    const logs = join(dir, "logs");
    mkdirSync(logs, { recursive: true });
    const big = join(logs, "openagd.out.log");
    writeFileSync(big, "a".repeat(1000));
    appendFileSync(big, "TAIL-MARKER".repeat(10));
    const small = join(logs, "openagd.err.log");
    writeFileSync(small, "tiny");
    const ops = createOps({ db, dataDir: dir, env: {}, maxBytes: 500, keepBytes: 110, now: () => 7 });
    expect(ops.rotateLogs()).toBe(1);
    expect(statSync(big).size).toBe(0);
    expect(readFileSync(`${big}.1`, "utf8")).toBe("TAIL-MARKER".repeat(10));
    expect(readFileSync(small, "utf8")).toBe("tiny");
    expect(existsSync(`${small}.1`)).toBe(false);
    expect(ops.status().logs).toEqual({ lastRotatedAt: 7, rotated: 1 });
    // a file launchd keeps appending to still works after truncation
    appendFileSync(big, "after");
    expect(readFileSync(big, "utf8")).toBe("after");
    expect(createOps({ db, dataDir: join(dir, "nope"), env: {} }).rotateLogs()).toBe(0);
    expect(rotateFile(join(dir, "missing.log"), 1, 1)).toBe(false);
  });
});
