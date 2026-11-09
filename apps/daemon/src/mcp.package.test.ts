import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { connectorDirectory, integrationPackage, packageProblem, referenceEntry } from "./integration-packages.js";
import { createMcpManager, type ConnectorConfig, type McpManager } from "./mcp.js";
import { createRedactor } from "./redact.js";

const ID = "local-reference";
let dir: string, managers: McpManager[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "openag-pkg-")); chmodSync(dir, 0o700); });
afterEach(async () => { for (const m of managers.splice(0)) await m.close(); rmSync(dir, { recursive: true, force: true }); });

/** Installs the bundled package exactly where setup would, and returns its pin. */
function install() {
  const pkg = integrationPackage(ID), target = connectorDirectory(dir, pkg.digest, ID);
  for (const file of pkg.files) { const path = join(target, file.rel); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, file.body, { mode: 0o600 | (file.mode & 0o100) }); }
  return { digest: pkg.digest, target };
}
const writeConfig = (server: Record<string, unknown>) => writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: [server] }), { mode: 0o600 });

/** Records what the daemon actually launches; the connection itself always fails, which is irrelevant here. */
async function launched(server: Record<string, unknown>) {
  const seen: ConnectorConfig[] = [];
  writeConfig(server);
  const m = createMcpManager({ dataDir: dir, env: {}, redactor: createRedactor({ env: {} }), connector: async cfg => { seen.push(cfg); throw Error("not under test"); } });
  managers.push(m); await m.load();
  return { seen, status: m.status().find(s => s.id === server.id) };
}
const staleEntry = (digest: string, extra: Record<string, unknown> = {}) => ({ ...referenceEntry(dir, digest, ID), command: "/old/release/bin/node", args: ["/old/release/server.mjs", "/old/release/apps/daemon"], ...extra });

describe("packaged connector launch command", () => {
  test("a pin written by an earlier release (other node, other daemon root) is still valid", () => {
    const { digest } = install();
    expect(packageProblem(dir, staleEntry(digest))).toBeNull();
  });

  test("the daemon launches the derived command, never the one stored in mcp.json", async () => {
    const { digest } = install();
    const { seen, status } = await launched(staleEntry(digest, { command: "/bin/sh", args: ["-c", "echo not reviewed"] }));
    expect(status?.state).not.toBe("invalid");
    const expected = referenceEntry(dir, digest, ID);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.command).toBe(expected.command);
    expect(seen[0]!.args).toEqual(expected.args);
  });

  test("environment stored for a pinned entry never reaches the connector", async () => {
    const { digest } = install();
    const { seen } = await launched(staleEntry(digest, { env: { NODE_OPTIONS: "--require /not/reviewed.js" } }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.env).toEqual({});
  });

  test("a disabled pinned entry keeps its state and is never launched", async () => {
    const { digest } = install();
    const { seen, status } = await launched(staleEntry(digest, { enabled: false }));
    expect(status?.state).toBe("skipped");
    expect(seen).toEqual([]);
  });

  test("changed installed code is still refused and nothing is launched", async () => {
    const { digest, target } = install();
    writeFileSync(join(target, "server.mjs"), "// tampered\n");
    const { seen, status } = await launched(staleEntry(digest));
    expect(status?.state).toBe("invalid");
    expect(status?.detail).toMatch(/installed connector code changed/);
    expect(seen).toEqual([]);
  });

  test("a pin for one connector cannot be attached to another id or an HTTP entry", () => {
    const { digest } = install();
    expect(packageProblem(dir, staleEntry(digest, { id: "other" }))).toBe("package pin does not match this connector entry");
    expect(packageProblem(dir, staleEntry(digest, { transport: "http" }))).toBe("package pin does not match this connector entry");
  });

  test("a pin with no installed code reports the missing package", () => {
    expect(packageProblem(dir, staleEntry("f".repeat(64)))).toBe("installed connector package is missing or unsafe");
  });
});
