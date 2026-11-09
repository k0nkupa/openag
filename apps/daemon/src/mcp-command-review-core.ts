import { createHash } from "node:crypto";
import { accessSync, closeSync, constants, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { INTERPRETERS } from "./apps.js";

// Programs that run code given to them: they need a reviewed script file as their first argument. Matched on the typed name and the real name.
const INTERPRETER_NAME = /^(node|nodejs|python[0-9.]*|perl|ruby|php|deno|bun|lua|tclsh|Rscript|osascript)$/;
// Wrappers that would run another program the review does not describe.
const WRAPPERS: ReadonlySet<string> = new Set(["env", "busybox", "nohup", "xargs", "sudo", "doas", "su", "exec", "time", "timeout", "nice", "ionice", "stdbuf", "setsid", "caffeinate", "arch", "chroot"]);
/** Variables that load code or change how the program starts, so a value there is code the review cannot show. PATH, HOME, LANG and TMPDIR are the daemon's own. */
const LOADER_ENV = /^(PATH|HOME|LANG|LC_.*|TMPDIR|SHELL|IFS|ENV|BASH_ENV|NODE_.*|NPM_CONFIG_.*|PYTHON.*|PERL.*|RUBY.*|GEM_.*|LD_.*|DYLD_.*|GCONV_PATH|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|CLASSPATH)$/i;
/** A reason an environment variable name may not be declared for a desk command, or null. */
export const envNameProblem = (name: string): string | null => (LOADER_ENV.test(name) ? `${name} cannot be set for a desk command (it controls how programs start)` : null);

/**
 * The command review for a desk-written local command (stdio) MCP server (OA-456). A review is the exact thing that will run:
 * the resolved executable, its arguments, the environment variable NAMES (with their `${...}` templates, never values), the working
 * directory and the content of up to three script files named in the arguments. Its sha256 is what an approval binds to and what the
 * loader re-checks before every spawn, so an unreviewed or changed command never starts.
 */

export const MAX_REVIEW_FILES = 3;
export const MAX_REVIEW_FILE_BYTES = 1024 * 1024;
const SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "fish", "csh", "tcsh", "ksh"]);
/** `arg` is the argument as given; `path` its realpath. Both are re-checked, so repointing a symlink is a change. */
export interface ReviewFile { arg: string; path: string; sha256: string }
export interface ReviewRecord {
  hash: string;
  /** Realpath of the program that runs. The loader spawns this, never a name looked up again through PATH. */
  executable: string;
  /** Binds stored secrets to this program and its arguments (not to the environment). */
  binding: string;
  files: ReviewFile[];
}
export interface CommandInput { id: string; command: string; args: string[]; env: Record<string, string> }
export interface ReviewDisplay { id: string; argv: string[]; env: { name: string; template: string }[]; cwd: string; hash: string; files: ReviewFile[] }

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
/** Relative on purpose: a restored backup in another data directory keeps the same review. */
export const workDirOf = (id: string) => `mcp-work/${id}`;

/** A reason the command is not acceptable for the desk, or null. Shells and inline code are refused because they would not be what was reviewed. */
export function commandProblem(command: string, args: string[]): string | null {
  const name = basename(command);
  if (WRAPPERS.has(name)) return "a wrapper such as env, nohup or sudo cannot be used as the command; name the program itself";
  if (/[\0\r\n]/.test(command) || args.some(arg => /[\0]/.test(arg))) return "the command contains an invalid character";
  if (SHELLS.has(name)) return "a shell cannot be used as the command; name the program and its arguments";
  // An interpreter's first argument must be the script: a leading flag could switch it to inline code (-e, -c, --eval) that would not be what was reviewed.
  if ((INTERPRETERS.has(name) || INTERPRETER_NAME.test(name)) && (args[0] === undefined || args[0].startsWith("-"))) return "an interpreter needs a script file as its first argument; inline code is not allowed";
  return null;
}

function resolveExecutable(command: string, pathEnv: string | undefined): string | { problem: string } {
  const candidates = command.includes("/") ? [command] : (pathEnv ?? "").split(delimiter).filter(Boolean).map(dir => join(dir, command));
  if (command.includes("/") && !isAbsolute(command)) return { problem: "a command with a path must be absolute" };
  for (const candidate of candidates) {
    try {
      const real = realpathSync(candidate);
      if (!statSync(real).isFile()) continue;
      accessSync(real, constants.X_OK);
      return real;
    } catch { /* try the next directory */ }
  }
  return { problem: command.includes("/") ? "the command was not found or is not executable" : "the command was not found in the daemon's PATH" };
}

const startsWithShebang = (path: string): boolean => {
  let fd: number | undefined;
  try { fd = openSync(path, "r"); const buffer = Buffer.alloc(2); return readSync(fd, buffer, 0, 2, 0) === 2 && buffer.toString("latin1") === "#!"; }
  catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
};
const fileRecord = (arg: string, real: string): ReviewFile | { problem: string } => {
  if (statSync(real).size > MAX_REVIEW_FILE_BYTES) return { problem: "a file named in the arguments is larger than 1 MiB and cannot be reviewed" };
  return { arg, path: real, sha256: sha256(readFileSync(real)) };
};

function fileRecords(executable: string, args: string[], needsScript: boolean): ReviewFile[] | { problem: string } {
  const files: ReviewFile[] = [];
  // A program that is itself a script (#!) is part of what runs: its content is reviewed too.
  if (startsWithShebang(executable)) { const record = fileRecord(executable, executable); if ("problem" in record) return record; files.push(record); }
  let named = 0;
  for (const [index, arg] of args.entries()) {
    const exists = isAbsolute(arg) && existsSync(arg);
    // An interpreter's script must exist now and be absolute, so what it will run is the content that was hashed.
    if (index === 0 && needsScript && !exists) return { problem: "an interpreter's script must be an existing file given by its absolute path" };
    if (!exists) continue;
    let real: string;
    try { real = realpathSync(arg); if (!statSync(real).isFile()) { if (index === 0 && needsScript) return { problem: "an interpreter's script must be a file" }; continue; } } catch { continue; }
    if (++named > MAX_REVIEW_FILES) return { problem: `at most ${MAX_REVIEW_FILES} existing files may be named in the arguments` };
    const record = fileRecord(arg, real); if ("problem" in record) return record;
    files.push(record);
  }
  return files;
}

const canonicalEnv = (env: Record<string, string>) => Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const specHash = (input: CommandInput, executable: string, files: ReviewFile[]) =>
  sha256(JSON.stringify({ v: 1, command: input.command, executable, args: input.args, env: canonicalEnv(input.env), cwd: workDirOf(input.id), files }));
const bindingOf = (input: CommandInput, executable: string, files: ReviewFile[]) => sha256(JSON.stringify({ v: 1, command: input.command, executable, args: input.args, files }));

/** Resolves what would run now. Throws nothing: the caller shows the problem. */
export function buildReview(input: CommandInput, pathEnv: string | undefined = process.env.PATH): { review: ReviewRecord; display: ReviewDisplay } | { problem: string } {
  const bad = commandProblem(input.command, input.args);
  if (bad) return { problem: bad };
  const executable = resolveExecutable(input.command, pathEnv);
  if (typeof executable !== "string") return executable;
  if (SHELLS.has(basename(executable)) || WRAPPERS.has(basename(executable))) return { problem: "a shell or wrapper cannot be used as the command; name the program itself" };
  const files = fileRecords(executable, input.args, INTERPRETERS.has(basename(input.command)) || INTERPRETER_NAME.test(basename(input.command)) || INTERPRETER_NAME.test(basename(executable)));
  if (!Array.isArray(files)) return files;
  const review: ReviewRecord = { hash: specHash(input, executable, files), executable, binding: bindingOf(input, executable, files), files };
  return { review, display: { id: input.id, argv: [executable, ...input.args], env: canonicalEnv(input.env).map(([name, template]) => ({ name, template })), cwd: `$OPENAG_DATA/${workDirOf(input.id)}`, hash: review.hash, files } };
}

/**
 * The loader's check for a desk-written command entry, run at load and before each spawn: the stored review must exist and match
 * the entry exactly, the program must still be the reviewed one, and every reviewed file must still have its reviewed content.
 */
export function reviewProblem(entry: { id: string; command: string; args: string[]; env: Record<string, string>; review?: ReviewRecord }): string | null {
  const review = entry.review;
  if (!review) return "command not reviewed";
  const bad = commandProblem(entry.command, entry.args);
  if (bad) return bad;
  const input = { id: entry.id, command: entry.command, args: entry.args, env: entry.env };
  if (specHash(input, review.executable, review.files) !== review.hash || bindingOf(input, review.executable, review.files) !== review.binding) return "command changed since it was reviewed";
  let real: string;
  try { real = realpathSync(review.executable); accessSync(real, constants.X_OK); } catch { return "the reviewed program is no longer available"; }
  if (real !== review.executable) return "the reviewed program changed since it was reviewed";
  if (SHELLS.has(basename(real)) || WRAPPERS.has(basename(real))) return "a shell or wrapper cannot be used as the command; name the program itself";
  for (const file of review.files) {
    try {
      // The argument is re-resolved: a symlink repointed at other code is a change, even when the old target is untouched.
      if (realpathSync(file.arg) !== file.path) return "a reviewed file changed since it was reviewed";
      if (sha256(readFileSync(file.path)) !== file.sha256) return "a reviewed file changed since it was reviewed";
    } catch { return "a reviewed file is no longer available"; }
  }
  return null;
}
