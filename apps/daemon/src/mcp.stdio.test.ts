import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMcpManager, type McpManager } from "./mcp.js";

const TESTKIT = fileURLToPath(new URL("./mcp/env-echo.testkit.mjs", import.meta.url));
const SECRET = "oag_" + "z".repeat(40);

let dir: string;
let saved: string | undefined;
let m: McpManager | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-mcp-stdio-"));
  saved = process.env.OPENAG_TOKEN;
  process.env.OPENAG_TOKEN = SECRET; // the child must never see this
});
afterEach(async () => {
  await m?.close();
  m = undefined;
  if (saved === undefined) delete process.env.OPENAG_TOKEN;
  else process.env.OPENAG_TOKEN = saved;
  rmSync(dir, { recursive: true, force: true });
});

describe("stdio child environment", () => {
  test("gets only PATH, HOME, LANG, TMPDIR and declared env, and is terminated on close()", async () => {
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({
        servers: [{ id: "envtest", transport: "stdio", command: process.execPath, args: [TESTKIT], env: { DECLARED_FLAG: "yes" } }],
      }),
    );
    chmodSync(join(dir, "mcp.json"), 0o600);

    m = createMcpManager({ dataDir: dir });
    await m.load();
    expect(m.status()).toEqual([expect.objectContaining({ id: "envtest", state: "connected", toolCount: 1 })]);

    const exec = m.executors()["mcp.envtest.env_keys"]!;
    const out = (await exec({ botId: "boss", dataDir: dir }, {})) as { content: string };
    const { pid, keys } = JSON.parse(out.content) as { pid: number; keys: string[] };

    // macOS CoreFoundation adds __CF_USER_TEXT_ENCODING to every process it starts; it is not inherited from the daemon.
    const allowed = ["DECLARED_FLAG", "HOME", "LANG", "PATH", "TMPDIR", "__CF_USER_TEXT_ENCODING"];
    for (const key of keys) expect(allowed, `unexpected child env ${key}`).toContain(key);
    expect(keys).not.toContain("OPENAG_TOKEN");
    expect(keys).toContain("DECLARED_FLAG");
    expect(JSON.stringify(out)).not.toContain(SECRET);

    await m.close();
    await vi.waitFor(() => {
      expect(() => process.kill(pid, 0)).toThrow();
    }, { timeout: 5000 });
  }, 30_000);
});
