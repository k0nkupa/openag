import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDefaultRedactor } from "./redact.js";

export function memoryPath(dataDir: string, botId: string): string {
  return join(dataDir, "bots", botId, "MEMORY.md");
}

function template(name: string): string {
  return `# Memory: ${name}\n\nStanding notes for this bot. Edit by hand any time; the first ~1500 tokens are sent to the bot every turn, so keep it short.\n\n## Facts\n\n## Preferences\n`;
}

/** Creates the bot's MEMORY.md from the template if missing. Never overwrites. */
export function ensureMemoryFile(dataDir: string, bot: { id: string; name: string }): void {
  const path = memoryPath(dataDir, bot.id);
  if (existsSync(path)) return;
  mkdirSync(join(dataDir, "bots", bot.id), { recursive: true });
  try {
    writeFileSync(path, template(bot.name), { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

/** Capped head of MEMORY.md, read fresh each call. Redacted so a pasted secret never reaches a model. */
export function readMemoryHead(
  dataDir: string,
  botId: string,
  maxTokens = Number(process.env.OPENAG_MEMORY_TOKENS) || 1500,
): string {
  const path = memoryPath(dataDir, botId);
  if (!existsSync(path)) return "";
  const text = readFileSync(path, "utf8");
  const limit = maxTokens * 4;
  let out = text;
  if (Math.ceil(text.length / 4) > maxTokens) {
    const nl = text.lastIndexOf("\n", limit);
    const cut = nl > 0 ? nl : limit;
    const more = text.length - cut;
    out = `${text.slice(0, cut)}\n[... MEMORY.md truncated: ${more} more characters. Shorten the file to include them ...]`;
  }
  return getDefaultRedactor().redactString(out);
}

/** Appends a dated, redacted, single-line note to MEMORY.md, creating the file if needed. */
export function appendMemoryNote(dataDir: string, botId: string, note: string): void {
  const path = memoryPath(dataDir, botId);
  mkdirSync(join(dataDir, "bots", botId), { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const clean = getDefaultRedactor().redactString(note).replace(/[\r\n]+/g, " ").trim();
  appendFileSync(path, `- ${date} ${clean}\n`);
}

export const MEMORY_MAX_BYTES = 16 * 1024;

/** Full MEMORY.md for the desk, redacted and capped. Empty string when the file does not exist yet. */
export function readMemoryFull(dataDir: string, botId: string): string {
  const path = memoryPath(dataDir, botId);
  if (!existsSync(path)) return "";
  return getDefaultRedactor().redactString(readFileSync(path, "utf8").slice(0, 4 * MEMORY_MAX_BYTES));
}

/** Replaces MEMORY.md with redacted text (the caller enforces the size cap). Returns what was written. */
export function writeMemoryFull(dataDir: string, bot: { id: string; name: string }, text: string): string {
  ensureMemoryFile(dataDir, bot);
  const clean = getDefaultRedactor().redactString(text);
  writeFileSync(memoryPath(dataDir, bot.id), clean);
  return clean;
}
