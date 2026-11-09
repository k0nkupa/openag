import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IGNORE_LINES = ["*.db", "*.db-*", "*.db*", "logs/", ".owner/", ".connectors/", "bots/*/work/"];
const MEMORY_PATHSPEC = ":(glob)bots/*/MEMORY.md";
const SKILLS_PATHSPEC = ":(glob)bots/*/skills/*/SKILL.md";

// Git settings come from the daemon, never the user's environment or global config: no signing, no hooks,
// no author override.
const CONFIG_ARGS = [
  "-c",
  "user.name=openagd",
  "-c",
  "user.email=openagd@localhost",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

const STRIPPED_ENV = [/^GIT_(AUTHOR|COMMITTER)_/, /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|NAMESPACE)$/];

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (STRIPPED_ENV.some((re) => re.test(k))) continue;
    env[k] = v;
  }
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
}

async function git(dataDir: string, args: string[]) {
  return execFileAsync("git", [...CONFIG_ARGS, ...args], { cwd: dataDir, timeout: 15000, env: gitEnv() });
}

function ensureIgnoreFile(dataDir: string): void {
  const path = join(dataDir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORE_LINES.filter((line) => !have.has(line));
  if (missing.length === 0) return;
  const prefix = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  writeFileSync(path, `${prefix}${missing.join("\n")}\n`);
}

/** Makes the data dir a git repo (only once) with an initial commit of .gitignore. Idempotent. */
export async function ensureDataRepo(dataDir: string): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(join(dataDir, ".git"))) { ensureIgnoreFile(dataDir); return; }
  await git(dataDir, ["init", "-q"]);
  ensureIgnoreFile(dataDir);
  await git(dataDir, ["add", "--", ".gitignore"]);
  await git(dataDir, ["commit", "-q", "-m", "openagd: init"]);
}

// Commits run one at a time so concurrent turns never race on the git index.
let chain: Promise<unknown> = Promise.resolve();

async function commitMemoryNow(dataDir: string, message: string): Promise<boolean> {
  // Start from an empty index so a file someone staged by hand can never ride along in a memory commit.
  await git(dataDir, ["reset", "-q"]).catch(() => undefined);
  // One pathspec at a time: git refuses a pathspec that matches nothing (e.g. no skills yet), which is not an error here.
  for (const spec of [".gitignore", MEMORY_PATHSPEC, SKILLS_PATHSPEC]) {
    try {
      await git(dataDir, ["add", "--", spec]);
    } catch (err) {
      if (!/did not match any files/.test(String((err as { stderr?: unknown }).stderr ?? (err as Error).message))) throw err;
    }
  }
  try {
    await git(dataDir, ["diff", "--cached", "--quiet"]);
    return false; // exit 0: nothing staged
  } catch (err) {
    if ((err as { code?: unknown }).code !== 1) throw err; // exit 1 means changes are staged
  }
  await git(dataDir, ["commit", "-q", "-m", message]);
  return true;
}

/** Serialized history write. A clean index is false; a git failure rejects. */
export function commitMemoryOrThrow(dataDir: string, message: string): Promise<boolean> {
  const run = chain.then(() => commitMemoryNow(dataDir, message));
  chain = run.catch(() => undefined);
  return run;
}

/** Best-effort history write for existing callers; false means no change or a logged failure. */
export function commitMemory(dataDir: string, message: string): Promise<boolean> {
  return commitMemoryOrThrow(dataDir, message).catch((err: unknown) => {
    const text = err instanceof Error ? err.message : String(err);
    console.error("memory commit failed:", text);
    return false;
  });
}
