import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AppsError, createAppsManager, inputToZod, ManifestSchema, type AppsManager } from "./apps.js";
import { classify } from "./policy.js";

let dir: string;
let enabled: Record<string, string>;
let mgr: AppsManager;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-apps-"));
  enabled = {};
  mgr = make();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  classify("x"); // keep import used
});

function make(env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: "C.UTF-8" }): AppsManager {
  return createAppsManager({ dataDir: dir, getEnabled: () => enabled, setEnabled: (n) => void (enabled = n), env });
}

const tool = (over: Record<string, unknown> = {}) => ({
  name: "echo",
  description: "Echoes its input",
  class: "read",
  input: { type: "object", properties: { text: { type: "string", maxLength: 100 } }, required: ["text"] },
  exec: { argv: ["node", "tool.mjs"], timeoutSec: 10 },
  ...over,
});
const manifest = (over: Record<string, unknown> = {}, tools: unknown[] = [tool()]) => ({ id: "demo", name: "Demo", version: "1.0.0", description: "d", tools, ...over });

function installApp(id: string, m: unknown, script = "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify({echo:JSON.parse(s)})));") {
  const d = join(dir, "apps", id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "manifest.json"), JSON.stringify(m));
  writeFileSync(join(d, "tool.mjs"), script);
  return d;
}
const hashOf = (id: string) => mgr.list().find((a) => a.id === id)!.hash;
const run = async (name: string, args: unknown) => {
  const def = mgr.toolDefs().find((d) => d.name === name);
  if (!def) throw new Error("no such tool");
  return mgr.executors()[name]!({ botId: "boss", dataDir: dir }, args);
};

describe("review findings", () => {
  test("changing the tool CODE (not only the manifest) disables the app, before and after a rescan", async () => {
    const d = installApp("demo", manifest());
    mgr.scan();
    mgr.enable("demo", hashOf("demo"));
    expect(await run("app_demo_echo", { text: "a" })).toBeTruthy();
    const execute = mgr.executors().app_demo_echo!;
    writeFileSync(join(d, "tool.mjs"), "console.log('evil')");
    await expect(execute({ botId: "boss", dataDir: dir }, { text: "a" })).rejects.toThrow(/not enabled/);
    mgr.scan();
    expect(mgr.list()[0]!.state).toBe("disabled");
    expect(enabled).toEqual({});
  });

  test("a new file or a symlink inside the folder changes the hash / is refused; data/ is ignored", () => {
    const d = installApp("demo", manifest());
    const h1 = mgr.scan()[0]!.hash;
    mkdirSync(join(d, "data"), { recursive: true });
    writeFileSync(join(d, "data", "state.json"), "{}");
    expect(mgr.scan()[0]!.hash).toBe(h1);
    writeFileSync(join(d, "extra.mjs"), "1");
    expect(mgr.scan()[0]!.hash).not.toBe(h1);
    symlinkSync("/etc/hosts", join(d, "link"));
    expect(mgr.scan()[0]).toMatchObject({ state: "invalid", error: expect.stringMatching(/symlink/) });
  });

  test("enable reads the folder fresh: a file swapped after review is refused, not recorded", () => {
    const d = installApp("demo", manifest());
    const reviewed = mgr.scan()[0]!.hash;
    writeFileSync(join(d, "tool.mjs"), "console.log('swapped')");
    expect(() => mgr.enable("demo", reviewed)).toThrow(AppsError);
    expect(enabled).toEqual({});
  });

  test("a bare interpreter (it would run the model's JSON as code) is rejected", () => {
    for (const argv of [["bash"], ["sh", "-s"], ["node", "-"], ["python3", "-i"]]) {
      installApp("demo", manifest({}, [tool({ exec: { argv } })]));
      expect(mgr.scan()[0]!.state).toBe("invalid");
    }
  });

  test("an optional property named like an Object.prototype member still validates", () => {
    const schema = inputToZod({ type: "object", properties: { note: { type: "string" } }, required: [] });
    expect(schema.safeParse({}).success).toBe(true);
    expect(ManifestSchema.safeParse(manifest({}, [tool({ input: { type: "object", properties: { toString: { type: "string" } }, required: [] } })])).success).toBe(false);
  });

  test("a huge JSON result is capped and onChange fires only when the enabled set changes", async () => {
    installApp("demo", manifest(), "console.log(JSON.stringify({a:'x'.repeat(500000)}));");
    let changes = 0;
    const m2 = createAppsManager({ dataDir: dir, getEnabled: () => enabled, setEnabled: (n) => void (enabled = n), env: { PATH: process.env.PATH }, onChange: () => void changes++ });
    m2.scan();
    m2.scan();
    expect(changes).toBe(0);
    m2.enable("demo", m2.list()[0]!.hash);
    expect(changes).toBe(1);
    m2.scan();
    expect(changes).toBe(1);
    const out = (await m2.executors().app_demo_echo!({ botId: "boss", dataDir: dir }, { text: "x" })) as { truncated?: boolean; result: string };
    expect(out.truncated).toBe(true);
    expect(out.result.length).toBeLessThanOrEqual(100_000);
  });
});

describe("loading and enabling", () => {
  test("an installed app is listed but does NOTHING until the owner enables it with the reviewed hash", async () => {
    installApp("demo", manifest());
    const [app] = mgr.scan();
    expect(app).toMatchObject({ id: "demo", state: "disabled", tools: [{ name: "app_demo_echo", class: "read" }] });
    expect(mgr.toolDefs()).toEqual([]);
    expect(classify("app_demo_echo")).toBe("act-external"); // unknown until enabled
    expect(() => mgr.enable("demo", "0".repeat(64))).toThrow(AppsError);
    mgr.enable("demo", app!.hash);
    expect(mgr.list()[0]!.state).toBe("enabled");
    expect(classify("app_demo_echo")).toBe("read");
    expect(mgr.toolDefs().map((d) => d.name)).toEqual(["app_demo_echo"]);
  });

  test("changing the manifest after approval disables the app again, even between scans, and a stale approval is dropped", async () => {
    const d = installApp("demo", manifest());
    mgr.scan();
    mgr.enable("demo", hashOf("demo"));
    expect(await run("app_demo_echo", { text: "a" })).toMatchObject({ result: { echo: { text: "a" } } });
    const execute = mgr.executors().app_demo_echo!;
    writeFileSync(join(d, "manifest.json"), JSON.stringify(manifest({ version: "2.0.0" })));
    // No rescan yet: the per-call check already refuses.
    await expect(execute({ botId: "boss", dataDir: dir }, { text: "a" })).rejects.toThrow(/not enabled/);
    mgr.scan();
    expect(mgr.list()[0]!.state).toBe("disabled");
    expect(enabled).toEqual({});
    expect(classify("app_demo_echo")).toBe("act-external");
  });

  test("disable removes the tool and its class", () => {
    installApp("demo", manifest());
    mgr.scan();
    mgr.enable("demo", hashOf("demo"));
    mgr.disable("demo");
    expect(mgr.toolDefs()).toEqual([]);
    expect(classify("app_demo_echo")).toBe("act-external");
  });

  test("enabling something the scan did not see, or an invalid app, fails", () => {
    expect(() => mgr.enable("ghost", "0".repeat(64))).toThrow(AppsError);
    installApp("bad", { id: "bad" });
    mgr.scan();
    expect(() => mgr.enable("bad", hashOf("bad"))).toThrow(AppsError);
  });
});

describe("manifest validation", () => {
  const rejected = (m: unknown, re: RegExp, id = "demo") => {
    installApp(id, m);
    const info = mgr.scan().find((a) => a.id === id)!;
    expect(info.state).toBe("invalid");
    expect(info.error).toMatch(re);
  };

  test.each([
    ["not an object", [], /invalid manifest/],
    ["unknown top-level key", { ...manifest(), extra: 1 }, /invalid manifest/],
    ["no tools", manifest({}, []), /invalid manifest/],
    ["unknown class (secrets can never be declared)", manifest({}, [tool({ class: "secrets" })]), /invalid manifest/],
    ["unknown class", manifest({}, [tool({ class: "root" })]), /invalid manifest/],
    ["bad tool name", manifest({}, [tool({ name: "Bad-Name" })]), /invalid manifest/],
    ["tool name with a prototype word is allowed but a bad id is not", manifest({ id: "Demo" }), /invalid manifest/],
    ["unsupported schema type", manifest({}, [tool({ input: { type: "object", properties: { x: { type: "object" } } } })]), /invalid manifest/],
    ["additionalProperties true", manifest({}, [tool({ input: { type: "object", properties: {}, additionalProperties: true } })]), /invalid manifest/],
    ["a $ref", manifest({}, [tool({ input: { type: "object", properties: { x: { $ref: "#/x" } } } })]), /invalid manifest/],
    ["undeclared required property", manifest({}, [tool({ input: { type: "object", properties: {}, required: ["ghost"] } })]), /required property/],
    ["env name that is not UPPER_CASE", manifest({}, [tool({ exec: { argv: ["node", "tool.mjs"], env: ["lower"] } })]), /invalid manifest/],
    ["timeout over the cap", manifest({}, [tool({ exec: { argv: ["node", "tool.mjs"], timeoutSec: 9999 } })]), /invalid manifest/],
    ["NUL in argv", manifest({}, [tool({ exec: { argv: ["node", "a\0b"] } })]), /invalid manifest/],
    ["absolute command", manifest({}, [tool({ exec: { argv: ["/bin/ls"] } })]), /command must be/],
    ["command escaping the folder", manifest({}, [tool({ exec: { argv: ["../../bin/ls"] } })]), /command must be/],
    ["a non-interpreter bare command", manifest({}, [tool({ exec: { argv: ["curl", "x"] } })]), /command must be/],
    ["a bundled command that does not exist", manifest({}, [tool({ exec: { argv: ["bin/nope"] } })]), /command must be/],
    ["duplicate tool names", manifest({}, [tool(), tool()]), /duplicate tool name/],
  ])("%s is rejected", (_n, m, re) => rejected(m, re as RegExp));

  test("the manifest id must equal the folder name", () => rejected(manifest({ id: "other" }), /must equal the folder name/, "demo"));

  test("an invalid manifest never reaches the registry, and invalid JSON / oversize are rejected", () => {
    const d = join(dir, "apps", "junk");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "manifest.json"), "{ not json");
    expect(mgr.scan().find((a) => a.id === "junk")).toMatchObject({ state: "invalid", error: "manifest.json is not valid JSON" });
    writeFileSync(join(d, "manifest.json"), " ".repeat(70_000));
    expect(mgr.scan().find((a) => a.id === "junk")).toMatchObject({ state: "invalid", error: "manifest.json is too large" });
    expect(mgr.toolDefs()).toEqual([]);
  });

  test("a symlinked app folder or symlinked manifest is refused", () => {
    const real = join(dir, "elsewhere");
    mkdirSync(real);
    writeFileSync(join(real, "manifest.json"), JSON.stringify(manifest()));
    mkdirSync(join(dir, "apps"), { recursive: true });
    symlinkSync(real, join(dir, "apps", "demo"));
    expect(mgr.scan().find((a) => a.id === "demo")).toMatchObject({ state: "invalid", error: "not a plain folder" });
    rmSync(join(dir, "apps", "demo"));
    const d = join(dir, "apps", "demo");
    mkdirSync(d);
    symlinkSync(join(real, "manifest.json"), join(d, "manifest.json"));
    expect(mgr.scan().find((a) => a.id === "demo")).toMatchObject({ state: "invalid" });
  });

  test("folders whose names are not valid ids are ignored", () => {
    for (const n of ["Bad", ".hidden", "a", "has_underscore", "x".repeat(30)]) mkdirSync(join(dir, "apps", n), { recursive: true });
    expect(mgr.scan()).toEqual([]);
  });

  test("ManifestSchema accepts a minimal valid manifest", () => {
    expect(ManifestSchema.safeParse(manifest()).success).toBe(true);
  });
});

describe("argument validation", () => {
  const z = (props: Record<string, unknown>, required: string[] = []) => inputToZod({ type: "object", properties: props, required } as never);

  test("strict objects: unknown keys, wrong types, bounds and enums are refused", () => {
    const schema = z({ s: { type: "string", maxLength: 3 }, n: { type: "integer", minimum: 1, maximum: 5 }, b: { type: "boolean" }, e: { type: "string", enum: ["a", "b"] }, l: { type: "array", items: { type: "number" }, maxItems: 2 } }, ["s"]);
    expect(schema.safeParse({ s: "abc" }).success).toBe(true);
    for (const bad of [{}, { s: "abcd" }, { s: "a", n: 0 }, { s: "a", n: 6 }, { s: "a", n: 1.5 }, { s: "a", b: "yes" }, { s: "a", e: "c" }, { s: "a", l: [1, 2, 3] }, { s: "a", extra: 1 }, { s: "a", __proto__x: 1 }, "str", null]) {
      expect(schema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  test("a property named like a prototype member is an ordinary own property", () => {
    const schema = z({ constructor: { type: "string" } }, ["constructor"]);
    expect(schema.safeParse({ constructor: "x" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });
});

describe("running tools", () => {
  const enable = (id: string) => {
    mgr.scan();
    mgr.enable(id, hashOf(id));
  };

  test("the model's arguments go to stdin as JSON ONLY, the result is wrapped as untrusted data", async () => {
    installApp("demo", manifest());
    enable("demo");
    const res = (await run("app_demo_echo", { text: "hello; rm -rf ~ $(id)" })) as { untrusted: boolean; app: string; result: unknown };
    expect(res).toMatchObject({ untrusted: true, app: "demo", result: { echo: { text: "hello; rm -rf ~ $(id)" } } });
  });

  test("invalid arguments never start a process", async () => {
    const marker = join(dir, "ran");
    installApp("demo", manifest(), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)}, '1');`);
    enable("demo");
    await expect(run("app_demo_echo", { text: 123 })).rejects.toThrow(/invalid arguments/);
    await expect(run("app_demo_echo", { text: "x", extra: true })).rejects.toThrow(/invalid arguments/);
    expect(existsSync(marker)).toBe(false);
  });

  test("the child environment is minimal: declared variables only, never OPENAG_* or the daemon's other secrets", async () => {
    installApp("demo", manifest({}, [tool({ exec: { argv: ["node", "tool.mjs"], env: ["DECLARED_VAR", "OPENAG_TOKEN", "MISSING_VAR"] } })]), "console.log(JSON.stringify(Object.keys(process.env).sort()));");
    mgr = make({ PATH: process.env.PATH, LANG: "C.UTF-8", DECLARED_VAR: "yes", OPENAG_TOKEN: "owner-secret", ANTHROPIC_API_KEY: "sk-leak", BROWSERBASE_API_KEY: "bb", SECRET_OTHER: "x" });
    enable("demo");
    const keys = ((await run("app_demo_echo", { text: "x" })) as { result: string[] }).result;
    expect(keys).toEqual(expect.arrayContaining(["DECLARED_VAR", "HOME", "PATH"]));
    for (const forbidden of ["OPENAG_TOKEN", "ANTHROPIC_API_KEY", "BROWSERBASE_API_KEY", "SECRET_OTHER"]) expect(keys).not.toContain(forbidden);
  });

  test("HOME is the app's own data directory, created private", async () => {
    installApp("demo", manifest(), "console.log(JSON.stringify(process.env.HOME));");
    enable("demo");
    const home = ((await run("app_demo_echo", { text: "x" })) as { result: string }).result;
    expect(home.endsWith(join("apps", "demo", "data"))).toBe(true);
  });

  test("a runaway tool is killed at its time limit, including the processes it started", async () => {
    const pidFile = join(dir, "child.pid");
    installApp(
      "demo",
      manifest({}, [tool({ exec: { argv: ["node", "tool.mjs"], timeoutSec: 1 } })]),
      `import {spawn} from 'node:child_process';import fs from 'node:fs';const c=spawn('sleep',['30'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`,
    );
    enable("demo");
    const t0 = Date.now();
    await expect(run("app_demo_echo", { text: "x" })).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(8000);
    await new Promise((r) => setTimeout(r, 300));
    const pid = Number(readFileSync(pidFile, "utf8"));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });

  test("output over 1 MB is refused", async () => {
    installApp("demo", manifest(), "process.stdout.write('x'.repeat(2*1024*1024));");
    enable("demo");
    await expect(run("app_demo_echo", { text: "x" })).rejects.toThrow(/too much output/);
  });

  test("a failing tool reports only its exit code, never stderr", async () => {
    installApp("demo", manifest(), "console.error('boom sk-abcdefghijklmnopqrstuvwxyz0123 and more\\nsecond line');process.exit(3);");
    enable("demo");
    const err = await run("app_demo_echo", { text: "x" }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/exited with code 3/);
    expect((err as Error).message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect((err as Error).message).not.toContain("second line");
  });

  test("secrets in a result are redacted; plain text results are accepted", async () => {
    installApp("demo", manifest(), "console.log(JSON.stringify({token:'sk-abcdefghijklmnopqrstuvwxyz0123'}));");
    enable("demo");
    expect(JSON.stringify(await run("app_demo_echo", { text: "x" }))).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    installApp("demo", manifest(), "console.log('just text');");
    mgr.scan();
    mgr.enable("demo", hashOf("demo"));
    expect(await run("app_demo_echo", { text: "x" })).toMatchObject({ result: "just text\n" });
  });

  test("a bundled executable inside the folder runs; one that is a symlink out of the folder is refused", async () => {
    const d = installApp("demo", manifest({}, [tool({ exec: { argv: ["bin/run.sh"] } })]));
    mkdirSync(join(d, "bin"));
    writeFileSync(join(d, "bin", "run.sh"), '#!/bin/sh\ncat >/dev/null\necho \'{"ok":true}\'\n');
    chmodSync(join(d, "bin", "run.sh"), 0o755);
    mgr.scan();
    mgr.enable("demo", hashOf("demo"));
    expect(await run("app_demo_echo", { text: "x" })).toMatchObject({ result: { ok: true } });
    const execute = mgr.executors().app_demo_echo!;
    rmSync(join(d, "bin", "run.sh"));
    symlinkSync("/bin/echo", join(d, "bin", "run.sh"));
    // The manifest is unchanged, but the per-call re-check sees the escape and refuses before anything runs.
    await expect(execute({ botId: "boss", dataDir: dir }, { text: "x" })).rejects.toThrow(/not enabled/);
    expect(mgr.scan()[0]).toMatchObject({ state: "invalid" });
  });

  test("two apps cannot shadow each other's tools and tool names are namespaced", () => {
    installApp("alpha", manifest({ id: "alpha" }));
    installApp("beta", manifest({ id: "beta" }));
    mgr.scan();
    mgr.enable("alpha", hashOf("alpha"));
    mgr.enable("beta", hashOf("beta"));
    expect(mgr.toolDefs().map((d) => d.name).sort()).toEqual(["app_alpha_echo", "app_beta_echo"]);
  });

  test("an app can declare act-external, and that class is what the gate sees", () => {
    installApp("demo", manifest({}, [tool({ class: "act-external" })]));
    mgr.scan();
    mgr.enable("demo", hashOf("demo"));
    expect(classify("app_demo_echo")).toBe("act-external");
  });
});

describe("required environment", () => {
  test("an app that requires a daemon variable offers no tools (and no class) until it is set", async () => {
    installApp("demo", manifest({ requires: ["DEMO_API_KEY"] }));
    mgr = make({ PATH: process.env.PATH });
    mgr.scan();
    mgr.enable("demo", hashOf("demo"));
    expect(mgr.list()[0]).toMatchObject({ state: "enabled", missingEnv: ["DEMO_API_KEY"] });
    expect(mgr.toolDefs()).toEqual([]);
    expect(mgr.hasTool("app_demo_echo")).toBe(false);
    expect(classify("app_demo_echo")).toBe("act-external");
    mgr = make({ PATH: process.env.PATH, DEMO_API_KEY: "present" });
    mgr.scan();
    expect(mgr.list()[0]).toMatchObject({ state: "enabled", missingEnv: [] });
    expect(mgr.toolDefs().map((d) => d.name)).toEqual(["app_demo_echo"]);
    expect(mgr.hasTool("app_demo_echo")).toBe(true);
  });

  test("the variable's VALUE never appears in the listing", () => {
    installApp("demo", manifest({ requires: ["DEMO_API_KEY"] }));
    mgr = make({ PATH: process.env.PATH, DEMO_API_KEY: "super-secret-value-123456" });
    mgr.scan();
    expect(JSON.stringify(mgr.list())).not.toContain("super-secret");
  });
});
