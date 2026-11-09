import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createAppsManager } from "./apps.js";

const EXAMPLE = join(__dirname, "..", "..", "..", "examples", "apps", "composio");
let dir: string;
let log: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-composio-"));
  log = join(dir, "requests.jsonl");
  // A fetch stand-in: records every request and answers from a table. No network is ever used.
  writeFileSync(
    join(dir, "fetchpatch.mjs"),
    `import fs from "node:fs";
globalThis.fetch = async (url, init = {}) => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ url: String(url), method: init.method, headers: init.headers, body: init.body, redirect: init.redirect }) + "\\n");
  const mode = process.env.STUB_MODE ?? "ok";
  if (mode === "401") return new Response('{"error":{"message":"bad key sk-abcdefghijklmnopqrstuvwxyz0123"}}', { status: 401 });
  if (mode === "500") return new Response("boom", { status: 500 });
  if (mode === "html") return new Response("<html>", { status: 200 });
  if (String(url).includes("/tools/execute/")) return new Response(JSON.stringify({ successful: true, data: { id: 7 }, error: null }), { status: 200 });
  return new Response(JSON.stringify({ items: [{ slug: "GITHUB_CREATE_AN_ISSUE", name: "Create issue", description: "d", toolkit: { slug: "github" } }] }), { status: 200 });
};
`,
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const KEY = "cmp_key_value_0123456789";
function runScript(mode: "find" | "run", args: unknown, env: Record<string, string> = {}) {
  return spawnSync("node", ["--import", join(dir, "fetchpatch.mjs"), join(EXAMPLE, "tool.mjs"), mode], {
    input: JSON.stringify(args),
    encoding: "utf8",
    env: { PATH: process.env.PATH, COMPOSIO_API_KEY: KEY, ...env },
  });
}
const requests = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { url: string; method: string; headers: Record<string, string>; body?: string; redirect: string });

describe("the Composio example app", () => {
  test("find: a fixed host, the key only in x-api-key, redirects refused, a compact result", () => {
    const r = runScript("find", { query: "create issue", toolkit: "github", limit: 5 });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ tools: [{ slug: "GITHUB_CREATE_AN_ISSUE", name: "Create issue", description: "d", toolkit: "github" }] });
    const [req] = requests();
    expect(req!.url.startsWith("https://backend.composio.dev/api/v3.1/tools?")).toBe(true);
    expect(req!.url).toContain("toolkit_slug=github");
    expect(req!.url).not.toContain(KEY);
    expect(req!.headers["x-api-key"]).toBe(KEY);
    expect(req!.redirect).toBe("error");
  });

  test("run: POST to the validated slug path with the arguments and optional account", () => {
    const r = runScript("run", { tool_slug: "GITHUB_CREATE_AN_ISSUE", arguments_json: '{"title":"x"}', connected_account_id: "ca_123" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ successful: true, data: { id: 7 }, error: null });
    const [req] = requests();
    expect(req).toMatchObject({ method: "POST", url: "https://backend.composio.dev/api/v3.1/tools/execute/GITHUB_CREATE_AN_ISSUE" });
    expect(JSON.parse(req!.body!)).toEqual({ arguments: { title: "x" }, connected_account_id: "ca_123" });
  });

  test.each([
    ["a slug with a path", { tool_slug: "A/../B" }, /invalid tool_slug/],
    ["a slug with a query", { tool_slug: "A?x=1" }, /invalid tool_slug/],
    ["a bad account id", { tool_slug: "A", connected_account_id: "x y" }, /invalid connected_account_id/],
    ["arguments that are not JSON", { tool_slug: "A", arguments_json: "{nope" }, /not valid JSON/],
    ["arguments that are not an object", { tool_slug: "A", arguments_json: "[1]" }, /must be a JSON object/],
  ])("%s is refused before any request", (_n, args, re) => {
    const r = runScript("run", args);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(re);
    expect(() => readFileSync(log)).toThrow(); // nothing was sent
  });

  test("a bad toolkit slug is refused", () => {
    expect(runScript("find", { query: "x", toolkit: "../evil" }).stderr).toMatch(/invalid toolkit/);
  });

  test.each([
    ["401", /rejected the API key/],
    ["500", /Composio error 500/],
    ["html", /unexpected response/],
  ])("a %s answer becomes a short fixed message that never contains the response body or the key", (mode, re) => {
    const r = runScript("find", { query: "x" }, { STUB_MODE: mode });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(re);
    expect(r.stderr).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(r.stderr).not.toContain(KEY);
  });

  test("without the key the script refuses to run and sends nothing", () => {
    const r = spawnSync("node", ["--import", join(dir, "fetchpatch.mjs"), join(EXAMPLE, "tool.mjs"), "find"], { input: "{}", encoding: "utf8", env: { PATH: process.env.PATH } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("COMPOSIO_API_KEY is not set");
    expect(() => readFileSync(log)).toThrow();
  });
});

describe("the app through the Apps manager", () => {
  const install = () => {
    cpSync(EXAMPLE, join(dir, "apps", "composio"), { recursive: true });
  };
  const make = (env: NodeJS.ProcessEnv) => {
    let enabled: Record<string, string> = {};
    return createAppsManager({ dataDir: dir, getEnabled: () => enabled, setEnabled: (n) => void (enabled = n), env });
  };

  test("a valid manifest, both tools act-external, and NO tools at all without the key (inert)", () => {
    install();
    const noKey = make({ PATH: process.env.PATH });
    const [app] = noKey.scan();
    expect(app).toMatchObject({ id: "composio", state: "disabled", missingEnv: ["COMPOSIO_API_KEY"] });
    expect(app!.tools.map((t) => [t.name, t.class])).toEqual([["app_composio_find_tools", "act-external"], ["app_composio_run_tool", "act-external"]]);
    noKey.enable("composio", app!.hash);
    expect(noKey.toolDefs()).toEqual([]);
    const withKey = make({ PATH: process.env.PATH, COMPOSIO_API_KEY: KEY });
    const [a2] = withKey.scan();
    withKey.enable("composio", a2!.hash);
    expect(withKey.toolDefs().map((d) => d.name)).toEqual(["app_composio_find_tools", "app_composio_run_tool"]);
    expect(JSON.stringify(withKey.list())).not.toContain(KEY);
  });

  test("the core never imports the optional example app, including with hosted OAuth support", () => {
    // Plain recursive walk: the check must not depend on ripgrep being installed.
    const out = (readdirSync(__dirname, { recursive: true, withFileTypes: true }) as Array<{ isFile(): boolean; name: string; parentPath: string }>)
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    expect(out.length).toBeGreaterThan(50);
    for (const file of out.filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".testkit.ts"))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/(?:from\s*|import\s*\(|require\s*\()["'][^"']*examples\/apps\/composio/);
    }
  });
});
