import { writeTarget, type EffectScope } from "./effect-scope.js";
import { existsSync, lstatSync, mkdirSync, readFileSync, opendirSync, realpathSync, renameSync, rmSync, writeFileSync, openSync, closeSync, fstatSync, readSync, constants } from "node:fs";
import { join, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { relative, isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Db } from "./db/index.js";
import { getSetting, setSetting } from "./settings.js";
import { getDefaultRedactor } from "./redact.js";
import { SKILL_BODY_MAX, SKILL_SLUG_RE } from "./reflection-schema.js";

/**
 * Per-bot skills: `$OPENAG_DATA/bots/<bot>/skills/<slug>/SKILL.md`, versioned by datagit. Facts belong in MEMORY.md;
 * repeatable workflows belong here. Every path is built from a validated slug and re-checked with realpath, and a
 * symlink anywhere on the way is refused, so neither a bot nor a hand-made link can read or write outside the tree.
 */

const BOT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_MAX_BYTES = 64 * 1024;
const MAX_SCANNED = 200;
export const INDEX_MAX_ENTRIES = 40;
export const INDEX_MAX_CHARS = 2000;

export interface Skill {
  slug: string;
  name: string;
  description: string;
  version: number;
  triggers: string[];
  body: string;
}
export type SkillSummary = Pick<Skill, "slug" | "name" | "description" | "version">;
export interface SkillInput {
  slug: string;
  name: string;
  description: string;
  body: string;
  triggers?: string[];
}

export class SkillError extends Error {}

const oneLine = (s: string, max: number) => getDefaultRedactor().redactString(s).replace(/\s+/g, " ").trim().slice(0, max);

function botDir(dataDir: string, botId: string): string {
  if (!BOT_ID_RE.test(botId)) throw new SkillError("invalid bot id");
  return join(dataDir, "bots", botId);
}

/** True when `path` exists and is a plain (non-symlink) entry of the wanted kind. */
function plain(path: string, kind: "dir" | "file"): boolean {
  try {
    const st = lstatSync(path);
    return !st.isSymbolicLink() && (kind === "dir" ? st.isDirectory() : st.isFile());
  } catch {
    return false;
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The real path of `path` must stay inside the real path of `root`. */
function contained(root: string, path: string): boolean {
  try {
    return realpathSync(path).startsWith(realpathSync(root) + sep);
  } catch {
    return false;
  }
}

export function parseSkill(slug: string, text: string): Skill | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const name = fields.name ?? "";
  const description = fields.description ?? "";
  const version = Number(fields.version);
  if (!name || !description || !Number.isInteger(version) || version < 1) return null;
  const triggers = (fields.triggers ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10);
  return { slug, name: name.slice(0, 80), description: description.slice(0, 200), version, triggers, body: m[2]! };
}

function render(skill: Skill): string {
  const head = [`name: ${skill.name}`, `description: ${skill.description}`, `version: ${skill.version}`];
  if (skill.triggers.length > 0) head.push(`triggers: ${skill.triggers.join(", ")}`);
  return `---\n${head.join("\n")}\n---\n${skill.body.replace(/\s+$/, "")}\n`;
}

/** One skill by slug; null for an unknown, invalid or unsafe one (never throws). */
export function loadSkill(dataDir: string, botId: string, slug: string): Skill | null {
  if (getDefaultRedactor().redactString(slug) !== slug) return null;
  try {
    if (!SKILL_SLUG_RE.test(slug)) return null;
    const bot = botDir(dataDir, botId);
    const root = join(bot, "skills");
    const dir = join(root, slug);
    const file = join(dir, "SKILL.md");
    if (!plain(join(dataDir, "bots"), "dir") || !plain(bot, "dir")) return null;
    if (!plain(root, "dir") || !plain(dir, "dir") || !plain(file, "file") || !contained(root, file)) return null;
    if (lstatSync(file).size > FILE_MAX_BYTES) return null;
    const skill = parseSkill(slug, readFileSync(file, "utf8"));
    if (!skill) return null;
    const redactor = getDefaultRedactor();
    // Everything that leaves this function is redacted, including text edited by hand or a secret registered later.
    return {
      ...skill,
      name: redactor.redactString(skill.name),
      description: redactor.redactString(skill.description),
      triggers: skill.triggers.map((t) => redactor.redactString(t)),
      body: redactor.redactString(skill.body),
    };
  } catch {
    return null;
  }
}

export function listSkills(dataDir: string, botId: string): SkillSummary[] {
  try {
    const bot = botDir(dataDir, botId);
    const root = join(bot, "skills");
    if (!plain(join(dataDir, "bots"), "dir") || !plain(bot, "dir") || !plain(root, "dir")) return [];
    const out: SkillSummary[] = [];
    for (const slug of packageNames(root)) {
      const s = loadSkill(dataDir, botId, slug);
      if (s) out.push({ slug: s.slug, name: s.name, description: s.description, version: s.version });
    }
    return out;
  } catch {
    return [];
  }
}

/** The capped text for the prompt: one line per skill. */
export function skillsIndex(entries: SkillSummary[], maxEntries = INDEX_MAX_ENTRIES, maxChars = INDEX_MAX_CHARS): string {
  const lines: string[] = [];
  let used = 0;
  for (const e of entries.slice(0, maxEntries)) {
    const line = `- ${e.slug}: ${oneLine(e.name, 80)} - ${oneLine(e.description, 120)}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  const more = entries.length - lines.length;
  if (more > 0) lines.push(`(+${more} more skills not listed)`);
  return lines.join("\n");
}

/** Writes (or version-bumps) a skill. Atomic: the old file stays intact if anything fails. Throws SkillError. */
export function saveSkill(dataDir: string, botId: string, input: SkillInput): { slug: string; version: number; created: boolean } {
  if (getDefaultRedactor().redactString(input.slug) !== input.slug) throw new SkillError("Skill slug must not contain secrets");
  if (!SKILL_SLUG_RE.test(input.slug)) throw new SkillError("invalid skill slug");
  if (input.body.length === 0 || input.body.length > SKILL_BODY_MAX) throw new SkillError("skill body is empty or too long");
  const bot = botDir(dataDir, botId);
  const root = join(bot, "skills");
  const dir = join(root, input.slug);
  const file = join(dir, "SKILL.md");

  // Walk down one level at a time and refuse a symlink BEFORE creating anything below it: a recursive mkdir would
  // happily create `<slug>` inside the target of a link planted at `skills/`.
  mkdirSync(join(dataDir, "bots"), { recursive: true });
  for (const level of [bot, root, dir]) {
    if (existsSync(level) || isLink(level)) {
      if (!plain(level, "dir")) throw new SkillError("skill path is not allowed");
    } else {
      mkdirSync(level);
    }
  }
  if (!contained(bot, dir)) throw new SkillError("skill path is not allowed");
  if (existsSync(file) && !plain(file, "file")) throw new SkillError("skill file is not allowed");

  const previous = loadSkill(dataDir, botId, input.slug);
  const redactor = getDefaultRedactor();
  const skill: Skill = {
    slug: input.slug,
    name: oneLine(input.name, 80),
    description: oneLine(input.description, 200),
    version: (previous?.version ?? 0) + 1,
    triggers: (input.triggers ?? []).map((t) => oneLine(t, 40)).filter(Boolean).slice(0, 10),
    body: redactor.redactString(input.body),
  };
  if (!skill.name || !skill.description) throw new SkillError("skill needs a name and a description");

  const tmp = join(dir, `.SKILL.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, render(skill), { flag: "wx", mode: 0o644 });
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return { slug: skill.slug, version: skill.version, created: previous === null };
}

export interface SkillEntry {
  id: string;
  slug: string;
  name: string;
  description: string;
  source: "shared" | "agent";
  version: number | null;
  assigned: boolean;
  availability: "available" | "invalid" | "missing";
  reason: string | null;
  requirements: string | null;
}
export interface SkillPackage extends SkillEntry { body: string; triggers: string[]; resources: string[] }
export type SkillCatalogue = ReturnType<typeof createSkillCatalogue>;

function readPackageText(file: string): string {
  if (!lstatSync(file).isFile()) throw new SkillError("Resource is not a regular file");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile() || fstatSync(fd).size > FILE_MAX_BYTES) throw new SkillError("Resource is not a bounded regular file");
    const buffer = Buffer.alloc(FILE_MAX_BYTES + 1);
    let length = 0, count: number;
    while (length < buffer.length && (count = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += count;
    if (length > FILE_MAX_BYTES) throw new SkillError("Resource is too large");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
    if (text.includes("\0")) throw new SkillError("Resource is not UTF-8 text");
    return getDefaultRedactor().redactString(text);
  } finally { closeSync(fd); }
}

function packageNames(path: string): string[] {
  const directory = opendirSync(path), names: string[] = [];
  try {
    while (names.length < MAX_SCANNED) {
      const entry = directory.readSync();
      if (!entry) break;
      names.push(entry.name);
    }
  } finally { directory.closeSync(); }
  return names.sort();
}

/** All package paths stay here. The injected root is for controlled daemon acceptance, never HTTP/tool input. */
export function createSkillCatalogue(db: Db, dataDir: string, sharedRoot = join(homedir(), ".agents", "skills")) {
  const config = () => getSetting(db, "skillLibrary");
  const safeIdentity = (id: string) => getDefaultRedactor().redactString(id) === id;
  const writeConfig = (setting: ReturnType<typeof config>) => setSetting(db, "skillLibrary", { enabled: setting.enabled,
    assignments: Object.fromEntries(Object.entries(setting.assignments).filter(([key]) => safeIdentity(key)).map(([key, ids]) => [key, ids.filter(safeIdentity)])) });
  const safeRelative = (path: string) => path.length <= 256 && safeIdentity(path) && !isAbsolute(path) && !path.includes("\\") && path.split("/").every(p => /^[A-Za-z0-9_@.+-]+$/.test(p) && p !== "." && p !== "..");
  function sharedPackage(location: string, includeResources = true): SkillPackage | null {
    if (!safeRelative(location) || !safeIdentity(`shared:${location}`) || !config().enabled) return null;
    try {
      const dir = realpathSync(join(sharedRoot, location));
      if (!lstatSync(dir).isDirectory()) return null;
      const text = readPackageText(join(dir, "SKILL.md"));
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
      if (!match) return null;
      const head = parseYaml(match[1]!, { maxAliasCount: 0 });
      if (!head || typeof head.name !== "string" || !head.name.trim() || head.name.length > 80 ||
        typeof head.description !== "string" || !head.description.trim() || head.description.length > 1024 || Buffer.byteLength(match[2]!) > SKILL_BODY_MAX) return null;
      const resources: string[] = [];
      let scanned = 0;
      function visit(path: string, depth = 0) {
        if (depth > 4 || resources.length >= 100 || scanned++ >= 200) return;
        for (const item of packageNames(join(dir, path))) {
          const name = path ? `${path}/${item}` : item;
          if (!safeRelative(name) || item.startsWith(".")) continue;
          const st = lstatSync(join(dir, name));
          if (st.isDirectory()) visit(name, depth + 1);
          else if (st.isFile() && name !== "SKILL.md" && resources.length < 100) resources.push(name);
        }
      }
      if (includeResources) visit("");
      const redactor = getDefaultRedactor();
      return { id: `shared:${location}`, slug: location, name: redactor.redactString(head.name), description: redactor.redactString(head.description),
        source: "shared", version: null, assigned: false, availability: "available", reason: null,
        requirements: typeof head.compatibility === "string" ? redactor.redactString(head.compatibility).slice(0, 500) : null,
        body: match[2]!, triggers: [], resources };
    } catch { return null; }
  }
  function list(botId: string, inventory = false): SkillEntry[] {
    const own: SkillEntry[] = listSkills(dataDir, botId).map(s => ({ ...s, id: `agent:${botId}:${s.slug}`, source: "agent", assigned: true,
      availability: "available", reason: null, requirements: null }));
    const setting = config(), assigned = new Set((Object.hasOwn(setting.assignments, `agent:${botId}`) ? setting.assignments[`agent:${botId}`] : [])!.filter(safeIdentity));
    const shared = new Map<string, SkillEntry>();
    if (setting.enabled && inventory) {
      let visited = 0;
      function scan(location: string, ancestors: Set<string>, depth = 0) {
        if (depth > 6 || visited++ >= 400) return;
        try {
          const dir = realpathSync(join(sharedRoot, location));
          if (ancestors.has(dir)) return;
          const next = new Set(ancestors).add(dir);
          if (location && (existsSync(join(dir, "SKILL.md")) || isLink(join(dir, "SKILL.md")))) {
            const pkg = sharedPackage(location, false), id = `shared:${location}`;
            shared.set(id, pkg ? summary(pkg) : { id, slug: location, name: location, description: "", source: "shared", version: null,
              assigned: false, availability: "invalid", reason: "Invalid, unsafe or oversized skill package", requirements: null });
            return;
          }
          for (const name of packageNames(dir)) {
            const child = location ? `${location}/${name}` : name;
            if (!safeRelative(child) || name.startsWith(".")) continue;
            try { if (lstatSync(realpathSync(join(dir, name))).isDirectory()) scan(child, next, depth + 1); } catch { /* Unreadable entries are unavailable. */ }
          }
        } catch { /* A missing library stays inert. */ }
      }
      scan("", new Set());
    }
    for (const id of assigned) if (!shared.has(id)) {
      const pkg = setting.enabled ? sharedPackage(id.slice(7), false) : null;
      shared.set(id, pkg ? summary(pkg) : { id, slug: id.slice(7), name: id.slice(7), description: "", source: "shared", version: null,
        assigned: true, availability: "missing", reason: setting.enabled ? "Package missing or invalid" : "Shared library disabled", requirements: null });
    }
    return [...own, ...[...shared.values()].map(s => ({ ...s, assigned: assigned.has(s.id) })).filter(s => inventory || s.assigned)].filter(s => safeIdentity(s.id));
  }
  function summary({ body: _body, triggers: _triggers, resources: _resources, ...entry }: SkillPackage): SkillEntry { return entry; }
  function load(botId: string, id: string): SkillPackage | null {
    if (!safeIdentity(id)) return null;
    if (id.startsWith("shared:")) {
      const assignments = config().assignments;
      if (!Object.hasOwn(assignments, `agent:${botId}`) || !assignments[`agent:${botId}`]?.includes(id)) return null;
      const pkg = sharedPackage(id.slice(7));
      return pkg ? { ...pkg, assigned: true } : null;
    }
    const prefix = `agent:${botId}:`;
    if (id.includes(":") && !id.startsWith(prefix)) return null;
    const skill = loadSkill(dataDir, botId, id.startsWith(prefix) ? id.slice(prefix.length) : id);
    if (skill && !safeIdentity(`${prefix}${skill.slug}`)) return null;
    return skill ? { ...skill, id: `${prefix}${skill.slug}`, source: "agent", assigned: true, availability: "available", reason: null, requirements: null, resources: [] } : null;
  }
  return {
    list, load,
    setEnabled(enabled: boolean) { writeConfig({ ...config(), enabled }); },
    inspect(botId: string, id: string) { return id.startsWith("shared:") ? sharedPackage(id.slice(7)) : load(botId, id); },
    status: () => ({ enabled: config().enabled, source: "~/.agents/skills", note: "On the daemon host. Requirements are not automatically checked; assignments are not a filesystem sandbox." }),
    assign(botId: string, ids: string[]) {
      if (ids.some(id => !safeIdentity(id))) throw new SkillError("Skill assignment identities must not contain secrets");
      const setting = config();
      const known = new Set(list(botId, true).filter(s => s.source === "shared" && s.availability === "available").map(s => s.id));
      const previous = new Set(Object.hasOwn(setting.assignments, `agent:${botId}`) ? setting.assignments[`agent:${botId}`] : []);
      if (ids.some(id => !known.has(id) && !previous.has(id))) throw new SkillError("Select a valid discovered shared package");
      writeConfig({ ...setting, assignments: { ...setting.assignments, [`agent:${botId}`]: [...new Set(ids)] } });
    },
    index(botId: string) {
      return skillsIndex(list(botId).filter(s => s.availability === "available").map(s => ({ slug: s.id, name: s.name,
        description: `[${s.source}] ${s.description}`, version: s.version ?? 1 })));
    },
    resource(botId: string, id: string, path: string) {
      const pkg = load(botId, id);
      if (!pkg || pkg.source !== "shared" || !safeRelative(path) || !pkg.resources.includes(path)) return null;
      try {
        const dir = realpathSync(join(sharedRoot, pkg.slug));
        const file = realpathSync(join(dir, path));
        if (!contained(dir, file) || !relative(dir, file)) return null;
        return { id:pkg.id,version:pkg.version??null,path,text:readPackageText(file),untrusted:true };
      } catch { return null; }
    },
  };
}

/** Managed writes touch the package and serialized data-repository history. */
export function skillWriteScope(dataDir:string,botId:string,slug:string):EffectScope {
  if(!SKILL_SLUG_RE.test(slug))throw new SkillError('Invalid skill slug');
  return {kind:'paths',paths:[writeTarget(join(dataDir,'bots',botId,'skills',slug)),writeTarget(join(dataDir,'.git'))].sort()};
}
