import { createHash } from "node:crypto";
import { z } from "zod";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectAppFolder } from "./apps.js";
import { managedPath, packageContents } from "./package-files.js";
import { readMcpConfig } from "./mcp-config.js";

export const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const DAEMON_ROOT = join(REPOSITORY_ROOT, "apps/daemon");
const recipes = [
  { id: "hello", kind: "app" as const, folder: "examples/apps/hello", category: "Local utilities" },
  { id: "local-reference", kind: "mcp" as const, folder: "examples/mcp/local-reference", category: "Connections" },
  { id: "apple-apps", kind: "mcp" as const, folder: "examples/mcp/apple-apps", category: "Productivity" },
];
const HASH = /^[a-f0-9]{64}$/;
export function integrationPackage(id: string) {
  const recipe = recipes.find(item => item.id === id); if (!recipe) throw Error("unsupported setup package");
  const sourceDir = managedPath(REPOSITORY_ROOT, recipe.folder), contents = packageContents(sourceDir);
  if (id === "apple-apps" && process.platform === "darwin") {
    const file = (name: string) => contents.files.find(f => f.rel === name)?.body;
    const source = file("calendar-reader.swift"), binary = file("calendar-reader"), usage = file("calendar-reader.plist"), info = file("calendar-build.json");
    if (!source || !binary || !usage || !info) throw Error("Build the native Calendar reader before package review");
    const build = JSON.parse(info.toString("utf8")), hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    if (build.source !== hash(source) || build.usage !== hash(usage) || build.binary !== hash(binary) || build.arch !== process.arch) throw Error("Calendar reader differs from its build; rebuild before review");
  }
  let metadata: { id: string; name: string; version: string; description: string; tools: { name: string; description: string; class: string }[] };
  if (recipe.kind === "app") {
    const parsed = inspectAppFolder(sourceDir, id); if (!parsed.manifest || parsed.hash !== contents.hash) throw Error("source package changed or is invalid");
    metadata = parsed.manifest;
  } else {
    metadata = z.object({ id: z.literal(id), name: z.string().min(1).max(100), version: z.literal("1.0.0"), description: z.string().max(1000), tools: z.array(z.object({ name: z.string().regex(/^[a-z][a-z-]{0,63}$/), description: z.string().max(300), class: z.enum(id === "apple-apps" ? ["read", "search"] : ["act-external"]) }).strict()).min(1).max(30) }).strict().parse(JSON.parse(contents.files.find(file => file.rel === "manifest.json")!.body.toString("utf8")));
    if (!contents.files.some(file => file.rel === "server.mjs")) throw Error("invalid bundled MCP package");
  }
  return { ...recipe, ...metadata, sourceDir, source: `OpenAg repository: ${recipe.folder} (local checkout; signature not verified)`, digest: contents.hash, files: contents.files,
    requirements: recipe.kind === "app" ? ["Node.js 22+", "Fresh whole-folder review before enabling"] : ["Node.js 22+", ...(id === "apple-apps" ? ["macOS 14+; build Calendar reader with installed Xcode Command Line Tools", "Calendar Full Access for native EventKit reads"] : []), "OpenAg's installed MCP SDK", "Administrator-managed mcp.json", "Tools keep their existing approval policy"] };
}
export function setupPackages() { return recipes.map(recipe => { try { return { package: integrationPackage(recipe.id), id: recipe.id, error: null }; } catch { return { package: null, id: recipe.id, error: "Bundled setup source is unavailable or invalid" }; } }); }
export function connectorDirectory(dataDir: string, digest: string, id = "local-reference") {
  if (!["local-reference", "apple-apps"].includes(id) || !HASH.test(digest)) throw Error("invalid package digest");
  return managedPath(dataDir, `connectors/${id}/${digest}`);
}
/** What the daemon runs for a pinned package: its own node and daemon root plus the digest-pinned server file. Pure path work, so it is safe to call on every reload. */
function launchFor(dataDir: string, digest: string, id: string) {
  if ([dataDir, process.execPath, DAEMON_ROOT].some(path => path.includes("${"))) throw Error("pinned connector paths cannot contain environment templates");
  return { command: process.execPath, args: [join(connectorDirectory(dataDir, digest, id), "server.mjs"), DAEMON_ROOT] };
}
export function referenceEntry(dataDir: string, digest: string, id = "local-reference") {
  return { id, enabled: true, transport: "stdio", ...launchFor(dataDir, digest, id),
    env: {}, toolClasses: id === "apple-apps" ? Object.fromEntries(integrationPackage(id).tools.map(t => [t.name, t.class])) : {}, openagPackage: { id, version: "1.0.0", digest } };
}
/** The command to start a pinned entry. Call only after `packageProblem` returned null for an entry that has a pin. */
export function launchCommand(dataDir: string, entry: { openagPackage?: unknown }): { command: string; args: string[] } {
  const pin = entry.openagPackage as { id: string; digest: string };
  return launchFor(dataDir, pin.digest, pin.id);
}
/** Only the explicit administrator metadata activates package checking; ordinary MCP entries remain supported. */
export function packageProblem(dataDir: string, entry: { id?: unknown; transport?: unknown; command?: unknown; args?: unknown; openagPackage?: unknown }): string | null {
  if (entry.openagPackage === undefined) return null;
  try {
    const pin = entry.openagPackage as { id?: string; version?: string; digest?: string };
    if (!["local-reference", "apple-apps"].includes(pin.id ?? "") || pin.version !== "1.0.0" || typeof pin.digest !== "string" || !HASH.test(pin.digest)) return "invalid setup package pin";
    launchFor(dataDir, pin.digest, pin.id!);
    // The daemon derives the launch command (`launchCommand`); a stored command, args or env are never trusted, so a release or node change cannot invalidate a pin.
    if (entry.id !== pin.id || entry.transport !== "stdio") return "package pin does not match this connector entry";
    if (packageContents(connectorDirectory(dataDir, pin.digest, pin.id)).hash !== pin.digest) return "installed connector code changed; local setup review is required";
    return null;
  } catch { return "installed connector package is missing or unsafe"; }
}
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
export function setupReview(dataDir: string, id: string) {
  const pkg = integrationPackage(id); if (id === "apple-apps" && process.platform !== "darwin") throw Error("Apple apps require macOS"); const root = managedPath(dataDir), config = pkg.kind === "mcp" ? readMcpConfig(root) : null;
  const destination = pkg.kind === "app" ? managedPath(root, `apps/${id}`) : connectorDirectory(root, pkg.digest, id);
  let installedDigest: string | null = null; if (existsSync(destination)) installedDigest = packageContents(destination).hash;
  const args = [process.execPath, join(DAEMON_ROOT, "dist/setup.js"), "install", id, "--data-dir", root, "--machine", hostname(), "--digest", pkg.digest, ...(config ? ["--config-digest", config.digest] : [])];
  const disable = pkg.kind === "mcp" ? [process.execPath, join(DAEMON_ROOT, "dist/setup.js"), "disable", id, "--data-dir", root, "--machine", hostname(), "--config-digest", config!.digest] : null;
  return { id, kind: pkg.kind, name: pkg.name, version: pkg.version, source: pkg.source, digest: pkg.digest, machine: hostname(), destination,
    requirements: pkg.requirements, tools: pkg.tools.map(({ name, description, class: cls }) => ({ name, description, class: cls })), installedDigest, configurationDigest: config?.digest ?? null,
    command: args.map(quote).join(" "), disableCommand: disable?.map(quote).join(" ") ?? null,
    access: "Runs as the daemon OS user with full file and network access. Tool approval modes do not sandbox code or grant automatic approval." };
}
