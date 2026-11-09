export interface Redactor {
  /** Deep copy with every string redacted; booleans and null are untouched. Never mutates the input. */
  redact<T>(value: T): T;
  redactString(s: string): string;
  /** Register a known secret at runtime (e.g. a device token). */
  addSecret(value: string): void;
}

export interface RedactorOptions {
  env?: NodeJS.ProcessEnv;
  extraSecrets?: string[];
}

// Node 22 preserves numeric source text; keep it opaque until JSON.stringify.
type RawJson = { readonly rawJSON: string };
const losslessJson = JSON as typeof JSON & { rawJSON(source: string): RawJson; isRawJSON(value: unknown): value is RawJson };
const MAX_DEPTH = 20;
const ENV_NAME_RE = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;
const KEY_RE = /(password|passwd|secret|token|api[_-]?key|authorization)/i;
const PATH_OR_URL_PREFIXES = ["/", "~/", "file:", "http://", "https://"];

const PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, "api-key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, "github-token"],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}/g, "github-token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "slack-token"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "aws-key"],
  [/\boag_[A-Za-z0-9_-]{40,}/g, "device-token"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "jwt"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "private-key"],
];
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi;
const BASIC_RE = /\b(Basic)\s+[A-Za-z0-9+/=]{16,}/g;
// The lookahead keeps an already-redacted value from being re-labelled, so redaction is idempotent. The leading lookahead leaves exactly a `${secret:NAME}` reference alone: it names a secret, it is not one.
const GENERIC_RE =
  /(?!(?<=\$\{)secret:[A-Z][A-Z0-9_]{0,63}\})\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|api_key|apikey|api-key|authorization)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(["']?)(?!\[REDACTED:)([^\s"',;]{8,})/gi;

function isUsableSecret(value: string): boolean {
  return value.length >= 12 && !/\s/.test(value) && !PATH_OR_URL_PREFIXES.some((p) => value.startsWith(p));
}

export function createRedactor(opts: RedactorOptions = {}): Redactor {
  const secrets = new Set<string>();
  const addKnown = (value: string) => {
    if (isUsableSecret(value)) secrets.add(value);
  };

  for (const [name, value] of Object.entries(opts.env ?? process.env)) {
    if (value === undefined) continue;
    if (name === "OPENAG_TOKEN" || ENV_NAME_RE.test(name)) addKnown(value);
  }
  for (const s of opts.extraSecrets ?? []) addKnown(s);

  // Longest first, so a secret that contains a shorter one is replaced whole.
  const sorted = (): string[] => [...secrets].sort((a, b) => b.length - a.length);

  function redactString(s: string, depth = 0): string {
    if (depth > MAX_DEPTH) return "[REDACTED:too-deep]";
    // Redact decoded JSON leaves so replacements cannot consume string escapes.
    if (/^[\s]*[\[{"]/.test(s)) {
      try {
        const parsed: unknown = JSON.parse(s, (_key, value: unknown, context?: { source?: string }) =>
          typeof value === "number" && context?.source ? losslessJson.rawJSON(context.source) : value,
        );
        const safe = walk(parsed, depth + 1, new WeakSet());
        const encoded = JSON.stringify(safe);
        // A registered secret can also occupy JSON syntax or a numeric value.
        if (sorted().some(secret => encoded.includes(secret))) return JSON.stringify("[REDACTED:secret]");
        return JSON.stringify(parsed) === encoded && !sorted().some(secret => s.includes(secret)) ? s : encoded;
      } catch { /* Plain or truncated text still needs the normal secret filters. */ }
    }
    let out = s;
    for (const secret of sorted()) out = out.split(secret).join("[REDACTED:secret]");
    for (const [re, kind] of PATTERNS) out = out.replace(re, `[REDACTED:${kind}]`);
    out = out.replace(BEARER_RE, "$1 [REDACTED:bearer]");
    out = out.replace(BASIC_RE, "$1 [REDACTED:basic]");
    out = out.replace(GENERIC_RE, (_m, name: string, sep: string, quote: string) => `${name}${sep}${quote}[REDACTED:secret]`);
    return out;
  }

  function walk(v: unknown, depth: number, ancestors: WeakSet<object>): unknown {
    if (typeof v === "string") return redactString(v, depth);
    if (losslessJson.isRawJSON(v)) {
      const safe = redactString(v.rawJSON, depth);
      return safe === v.rawJSON ? v : safe;
    }
    if (v === null || typeof v !== "object") return v;
    if (depth > MAX_DEPTH) return "[REDACTED:too-deep]"; // fail closed: never pass an unscanned subtree through
    if (ancestors.has(v)) return "[Circular]";
    ancestors.add(v);
    try {
      if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1, ancestors));
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        Object.defineProperty(out, redactString(k, depth + 1), {
          value: KEY_RE.test(k) && ((typeof val === "string" && val.length > 0) || (typeof val === "number" && String(val).length >= 8) || (losslessJson.isRawJSON(val) && String(Number(val.rawJSON)).length >= 8))
            ? "[REDACTED:key]"
            : walk(val, depth + 1, ancestors),
          enumerable: true, writable: true, configurable: true,
        });
      }
      return out;
    } finally {
      ancestors.delete(v);
    }
  }

  return {
    redact<T>(value: T): T {
      return walk(value, 0, new WeakSet()) as T;
    },
    redactString,
    addSecret(value: string) {
      addKnown(value);
    },
  };
}

let defaultRedactor: Redactor | undefined;

export function getDefaultRedactor(): Redactor {
  defaultRedactor ??= createRedactor({ env: process.env });
  return defaultRedactor;
}

export function resetDefaultRedactor(): void {
  defaultRedactor = undefined;
}

/**
 * Line-buffered, redacting log writer. A secret split across two stream chunks is only whole once the line is
 * complete, so lines are redacted after reassembly. A runaway line without a newline is flushed at 64 KB.
 */
export function createRedactingLineWriter(
  write: (line: string) => void,
  redactor: Redactor = getDefaultRedactor(),
): { push(chunk: string): void; flush(): void } {
  let buffer = "";
  const emit = (text: string) => write(`${redactor.redactString(text)}\n`);
  return {
    push(chunk) {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        emit(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
      if (buffer.length > 65536) {
        emit(buffer);
        buffer = "";
      }
    },
    flush() {
      if (buffer !== "") emit(buffer);
      buffer = "";
    },
  };
}
