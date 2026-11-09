import { describe, expect, test } from "vitest";
import { createRedactingLineWriter, createRedactor, getDefaultRedactor, resetDefaultRedactor } from "./redact.js";

const r = createRedactor({ env: {} });
const fresh = () => createRedactor({ env: {} });
const sk = "sk-" + "a".repeat(30);
const ghp = "ghp_" + "B1".repeat(15);
const pat = "github_pat_" + "C".repeat(45);
const slack = "xoxb-" + "1234567890-abc";
const aws = "AKIA" + "ABCDEFGHIJKLMNOP";
const jwt = "eyJ" + "abcdefgh" + "." + "ijklmnop" + "." + "qrstuvwx";
const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj\n-----END RSA PRIVATE KEY-----";

describe("patterns", () => {
  test.each([
    ["api-key", sk],
    ["api-key", "sk-ant-" + "x".repeat(25)],
    ["api-key", "sk-proj-" + "y".repeat(25)],
    ["github-token", ghp],
    ["github-token", pat],
    ["slack-token", slack],
    ["aws-key", aws],
    ["jwt", jwt],
    ["device-token", "oag_" + "Q".repeat(43)],
    ["device-token", "oag_" + "a1-_".repeat(10) + "zz"],
    ["private-key", pem],
  ])("%s is redacted", (kind, secret) => {
    const out = r.redactString(`before ${secret} after`);
    expect(out).toBe(`before [REDACTED:${kind}] after`);
    expect(out).not.toContain(secret);
  });

  test("Bearer keeps the word and redacts the token", () => {
    const tok = "abcdEFGH1234ijkl5678";
    expect(r.redactString(`Authorization header Bearer ${tok}`)).toBe(
      "Authorization header Bearer [REDACTED:bearer]",
    );
  });

  test("generic name=value and name: value keep the name", () => {
    expect(r.redactString("api_key=supersecretvalue1")).toBe("api_key=[REDACTED:secret]");
    expect(r.redactString('password: "hunter2hunter2"')).toBe('password: "[REDACTED:secret]"');
    expect(r.redactString("X-Auth-Token=abcdefghijk;next=1")).toBe("X-Auth-Token=[REDACTED:secret];next=1");
  });
});

describe("env and extra secrets", () => {
  test("env vars with secret-like names are redacted; others are not", () => {
    const red = createRedactor({
      env: { MY_API_KEY: "envsecretvalue123", OPENAG_TOKEN: "tokenvalue123456", PLAIN: "plainvalue12345" },
    });
    expect(red.redactString("a envsecretvalue123 b tokenvalue123456 c plainvalue12345")).toBe(
      "a [REDACTED:secret] b [REDACTED:secret] c plainvalue12345",
    );
  });

  test("short values, whitespace values and path/URL values are ignored", () => {
    const red = createRedactor({
      env: {
        A_TOKEN: "short",
        B_SECRET: "has a space in it",
        C_KEY: "/Users/alice/some/key/path",
        D_TOKEN: "~/home/tokenfile",
        E_SECRET: "file:/secret/location",
        F_KEY: "https://example.com/abc",
        G_TOKEN: "http://example.com/abc",
      },
    });
    const text = "short has a space in it /Users/alice/some/key/path ~/home/tokenfile file:/secret/location https://example.com/abc http://example.com/abc";
    expect(red.redactString(text)).toBe(text);
  });

  test("extraSecrets and addSecret are redacted, longest first", () => {
    const red = createRedactor({ env: {}, extraSecrets: ["devicetoken-abcdef"] });
    red.addSecret("devicetoken-abcdef-long");
    expect(red.redactString("x devicetoken-abcdef-long y devicetoken-abcdef z")).toBe(
      "x [REDACTED:secret] y [REDACTED:secret] z",
    );
  });
});

describe("ordinary text is untouched", () => {
  test("UUIDs, git SHAs, paths and bare words", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const path = "/Users/alice/Projects/OpenAg/apps/daemon/src/redact.ts";
    const words = "the token is here, Bearer alone, a secret plan, password reset";
    const text = `${uuid} ${sha} ${path} ${words}`;
    expect(r.redactString(text)).toBe(text);
  });

  test("numbers, booleans and null pass through redact()", () => {
    expect(r.redact(42)).toBe(42);
    expect(r.redact(true)).toBe(true);
    expect(r.redact(null)).toBe(null);
  });
});

describe("deep walk", () => {
  test("object keys with secret names are redacted, empty and non-string values are walked", () => {
    const out = r.redact({
      token: "abcdefghijklmnop",
      nested: { api_key: "zzzzzzzzzzzzzz", apiKey: "x", password: "", count: 3 },
      authorization: { scheme: "Bearer" },
      note: `key ${sk}`,
    });
    expect(out).toEqual({
      token: "[REDACTED:key]",
      nested: { api_key: "[REDACTED:key]", apiKey: "[REDACTED:key]", password: "", count: 3 },
      authorization: { scheme: "Bearer" },
      note: "key [REDACTED:api-key]",
    });
  });

  test("arrays and deep nesting are walked", () => {
    expect(r.redact({ list: [{ msg: sk }, [sk]] })).toEqual({
      list: [{ msg: "[REDACTED:api-key]" }, ["[REDACTED:api-key]"]],
    });
    let deep: Record<string, unknown> = { leaf: sk };
    for (let i = 0; i < 10; i++) deep = { child: deep };
    let cur: any = r.redact(deep);
    for (let i = 0; i < 10; i++) cur = cur.child;
    expect(cur.leaf).toBe("[REDACTED:api-key]");
  });

  test("input is never mutated", () => {
    const input = { token: "abcdefghijklmnop", arr: [sk], s: `x ${sk}` };
    const snapshot = JSON.stringify(input);
    const out = r.redact(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).not.toBe(input);
    expect(out.arr).not.toBe(input.arr);
  });

  test("idempotent: redact(redact(x)) equals redact(x)", () => {
    const input = {
      a: `${sk} and ${ghp} and api_key=supersecretvalue1 and Bearer abcdEFGH1234ijkl5678`,
      token: "abcdefghijklmnop",
      pem,
    };
    const once = r.redact(input);
    expect(r.redact(once)).toEqual(once);
  });

  test("cycles return [Circular] and do not loop", () => {
    const obj: Record<string, unknown> = { name: sk };
    obj.self = obj;
    const shared = { v: "ok" };
    const out = r.redact({ obj, a: shared, b: shared }) as any;
    expect(out.obj.self).toBe("[Circular]");
    expect(out.obj.name).toBe("[REDACTED:api-key]");
    expect(out.a).toEqual({ v: "ok" });
    expect(out.b).toEqual({ v: "ok" });
  });
});

describe("default redactor", () => {
  test("picks up a secret env var set before first use, after reset", () => {
    const name = "OA106_TEST_TOKEN";
    const value = "defaultsecret-9876";
    const prev = process.env[name];
    process.env[name] = value;
    try {
      resetDefaultRedactor();
      expect(getDefaultRedactor().redactString(`v=${value}`)).toBe("v=[REDACTED:secret]");
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
      resetDefaultRedactor();
    }
  });
});

describe("review additions", () => {
  const r = createRedactor({ env: {} });

  test("objects nested deeper than the limit fail closed instead of passing through", () => {
    let deep: Record<string, unknown> = { leaf: "sk-" + "a".repeat(30) };
    for (let i = 0; i < 30; i++) deep = { child: deep };
    expect(JSON.stringify(r.redact(deep))).not.toContain("sk-aaaa");
  });

  test("JSON text inside a string is redacted (quoted names)", () => {
    const out = r.redactString('{"api_key": "abcd1234efgh", "name": "ok"}');
    expect(out).not.toContain("abcd1234efgh");
    expect(JSON.parse(out).name).toBe("ok");
    expect(r.redactString("{'password':'hunter2hunter2'}")).not.toContain("hunter2hunter2");
  });

  test("HTTP Basic credentials are redacted", () => {
    const out = r.redactString("Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1Ng==");
    expect(out).not.toContain("dXNlcjpwYXNz");
  });

  test("redaction stays idempotent with the new rules", () => {
    const once = r.redactString('{"token": "abcd1234efgh"} Basic dXNlcjpwYXNzd29yZDEyMzQ1Ng==');
    expect(r.redactString(once)).toBe(once);
  });

  test("line writer redacts a secret that arrives split across chunks, and flushes the tail", () => {
    const secret = "sk-" + "b".repeat(30);
    const lines: string[] = [];
    const w = createRedactingLineWriter((l) => lines.push(l), r);
    w.push("start key=" + secret.slice(0, 15));
    w.push(secret.slice(15) + " end\nsecond line no newline " + secret);
    w.flush();
    const all = lines.join("");
    expect(all).not.toContain("bbbbbbbb");
    expect(lines).toHaveLength(2);
    expect(all).toContain("start key=");
  });
});

test("a device token is redacted by pattern even when it was never registered (after restart)", () => {
  const fresh = createRedactor({ env: {} });
  const token = "oag_" + "Z9".repeat(22);
  expect(fresh.redactString(`header ${token}`)).toBe("header [REDACTED:device-token]");
  expect(fresh.redact({ nested: [{ msg: token }] })).toEqual({ nested: [{ msg: "[REDACTED:device-token]" }] });
});

test("oag_ strings shorter than the device token length are not matched by the device-token rule", () => {
  expect(fresh().redactString("oag_short")).toBe("oag_short");
});

