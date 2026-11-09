import { isDeepStrictEqual } from "node:util";
/** Local administrator entry point. No HTTP caller can invoke it or supply executable configuration. */
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { createRequire } from "node:module";
import { inspectAppFolder } from "./apps.js";
import { DAEMON_ROOT, connectorDirectory, integrationPackage, launchCommand, packageProblem, referenceEntry } from "./integration-packages.js";
import { managedPath, packageContents } from "./package-files.js";
import { readMcpConfig } from "./mcp-config.js";
import { SETUP_LOCK, audit, ensureDirectory, writeConfig } from "./mcp-config-write.js";

function options(argv: string[]) {
  const [action, id, ...rest] = argv;
  if (!["install", "disable"].includes(action ?? "") || !["hello", "local-reference", "apple-apps"].includes(id ?? "")) throw Error("usage: setup install|disable hello|local-reference|apple-apps --data-dir PATH --machine NAME [--digest SHA256] [--config-digest SHA256|absent]");
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]!, value = rest[i + 1];
    if (!["--data-dir", "--machine", "--digest", "--config-digest"].includes(key) || flags.has(key) || !value) throw Error("unknown, duplicate or incomplete option");
    flags.set(key, value);
  }
  const dataDir = flags.get("--data-dir");
  if (!dataDir || !isAbsolute(dataDir)) throw Error("an absolute existing --data-dir is required");
  if (flags.get("--machine") !== hostname()) throw Error("wrong target machine; run this command on the machine shown in the desk");
  if (Number(process.versions.node.split(".")[0]) < 22) throw Error("Node.js 22+ is required");
  if (action === "disable" && id === "hello") throw Error("pause Apps through the existing owner-only desk control");
  return { action: action!, id: id!, root: managedPath(dataDir), digest: flags.get("--digest"), configDigest: flags.get("--config-digest") };
}
function publish(root: string, destination: string, staged: string, digest: string) {
  if (existsSync(destination)) {
    if (packageContents(destination).hash !== digest) throw Error("a different installation already exists; it was not replaced");
    return false;
  }
  const rel = destination.slice(root.length + 1); ensureDirectory(root, dirname(rel));
  const snapshot = packageContents(staged), created: { path: string; ino: number; dev: number; mtimeMs: number; ctimeMs: number; directory: boolean }[] = [];
  const remember = (path: string, directory: boolean) => { const st = lstatSync(path); created.push({ path, ino: st.ino, dev: st.dev, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, directory }); };
  try {
    managedPath(root, rel); mkdirSync(destination, { mode: 0o700 }); remember(destination, true);
    const directories = new Set<string>();
    for (const file of snapshot.files) { let parent = dirname(file.rel); while (parent !== ".") { directories.add(parent); parent = dirname(parent); } }
    for (const directory of [...directories].sort((a, b) => a.split("/").length - b.split("/").length)) {
      const path = managedPath(root, join(rel, directory)); mkdirSync(path, { mode: 0o700 }); remember(path, true);
    }
    // The final manifest is the publication marker. Every link is exclusive; existing files are never overwritten.
    for (const file of [...snapshot.files.filter(f => f.rel !== "manifest.json"), ...snapshot.files.filter(f => f.rel === "manifest.json")]) {
      const target = managedPath(root, join(rel, file.rel)); linkSync(join(staged, file.rel), target); remember(target, false);
    }
    if (packageContents(destination).hash !== digest) throw Error("published package changed; no runtime was enabled");
    return true;
  } catch (err) {
    // Remove only unchanged files this invocation created. New/edited user files and data/ always survive.
    for (const item of created.reverse()) try {
      managedPath(root, item.path.slice(root.length + 1)); const st = lstatSync(item.path);
      if (st.ino !== item.ino || st.dev !== item.dev || st.isSymbolicLink()) continue;
      if (item.directory) rmdirSync(item.path);
      else if (st.mtimeMs === item.mtimeMs && st.ctimeMs === item.ctimeMs) unlinkSync(item.path);
    } catch { /* A nonempty or changed destination belongs to the operator; never force cleanup. */ }
    throw err;
  }
}

function main() {
  const opts = options(process.argv.slice(2)), lock = managedPath(opts.root, SETUP_LOCK);
  mkdirSync(lock, { mode: 0o700 }); // Exclusive local writer; never steal a lock left by an interrupted command.
  let stage: string | undefined, started = false;
  try {
    audit(opts.root, { operation: opts.action, id: opts.id, outcome: "started" }); started = true;
    const config = opts.id !== "hello" ? readMcpConfig(opts.root) : null;
    if (config && (!opts.configDigest || config.digest !== opts.configDigest)) throw Error("MCP configuration changed since review; review again before setup");
    if (opts.action === "disable") {
      const matches = config!.value.servers.filter((entry: any) => entry?.id === opts.id) as Record<string, unknown>[];
      if (matches.length !== 1 || (matches[0]!.openagPackage as { id?: unknown })?.id !== opts.id) throw Error("no unique supported connector configuration to disable");
      const backup = writeConfig(opts.root, opts.configDigest, { ...config!.value, servers: config!.value.servers.map(entry => entry === matches[0] ? { ...matches[0], enabled: false } : entry) }, config!);
      audit(opts.root, { operation: "disable", id: opts.id, outcome: "completed" });
      return { id: opts.id, status: "disabled", backup, next: "Reload MCP in the desk. Installed code and user data were preserved." };
    }
    const pkg = integrationPackage(opts.id);
    if (!opts.digest || opts.digest !== pkg.digest) throw Error("package digest differs from the reviewed version; review again before setup");
    if (pkg.kind === "mcp") {
      const require = createRequire(join(DAEMON_ROOT, "package.json")); require.resolve("@modelcontextprotocol/sdk/server/mcp.js");
      const existing = config!.value.servers.filter((entry: any) => entry?.id === opts.id) as Record<string, unknown>[];
      if (existing.length && (existing.length !== 1 || !existing[0]!.openagPackage || packageProblem(opts.root, existing[0]!) || !isDeepStrictEqual({ ...existing[0], enabled: true, ...launchCommand(opts.root, existing[0]!) }, referenceEntry(opts.root, pkg.digest, pkg.id)))) throw Error("connector ID already exists or differs; existing configuration was not replaced");
    }
    stage = mkdtempSync(join(opts.root, ".integration-stage-"));
    for (const file of pkg.files) {
      const target = join(stage, file.rel); mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, file.body, { flag: "wx", mode: 0o600 | (file.mode & 0o100) });
    }
    if (packageContents(stage).hash !== pkg.digest) throw Error("staged package digest differs");
    if (pkg.kind === "app" && !inspectAppFolder(stage, pkg.id).manifest) throw Error("staged App is invalid");
    const destination = pkg.kind === "app" ? managedPath(opts.root, `apps/${pkg.id}`) : connectorDirectory(opts.root, pkg.digest, pkg.id);
    publish(opts.root, destination, stage, pkg.digest);
    let backup: string | null = null;
    if (pkg.kind === "mcp") {
      const existing = config!.value.servers.find((entry: any) => entry?.id === pkg.id) as { enabled?: boolean } | undefined;
      if (!existing || existing.enabled === false) backup = writeConfig(opts.root, opts.configDigest, { ...config!.value, servers: existing ? config!.value.servers.map(entry => entry === existing ? { ...existing, enabled: true } : entry) : [...config!.value.servers, referenceEntry(opts.root, pkg.digest, pkg.id)] }, config!);
    }
    audit(opts.root, { operation: "install", id: pkg.id, version: pkg.version, digest: pkg.digest, outcome: "completed" });
    return { id: pkg.id, version: pkg.version, digest: pkg.digest, status: "needs-daemon-check", backup,
      next: pkg.kind === "app" ? "Check installation in the desk, then review and enable the detected App." : "Check installation in the desk to perform the actual MCP handshake. No bot approval mode changed." };
  } catch (err) {
    if (started) audit(opts.root, { operation: opts.action, id: opts.id, outcome: "failed" });
    throw err;
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
    rmSync(lock, { recursive: true });
  }
}
try { console.log(JSON.stringify(main())); }
catch (err) { console.error(JSON.stringify({ error: err instanceof Error ? err.message : "local setup failed", notice: "Inspect the target before retrying: files or configuration may already have been written. App approvals and bot policy were not changed." })); process.exitCode = 1; }
