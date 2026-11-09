import { createRequire } from "node:module";
import { modelProviders, providerCredential } from "./providers.js";
import type { Bot } from "./rooms.js";

// Read-only status for the Models page. Provider keys come ONLY from the environment (CLAUDE.md): this reports whether
// one is set and its last four characters, never the value. Nothing here runs a command or writes anything.

export interface ProviderStatus {
  id: string;
  name: string;
  envVar: string;
  set: boolean;
  /** Last four characters of the key, or null when unset or too short to show safely. */
  last4: string | null;
  usedFor: string;
  envVars?: string[];
  envMode?: string;
  chat?: boolean;
  decisions?: boolean;
  docUrl?: string;
}

export interface CliStatus {
  id: "claude-code" | "codex";
  name: string;
  adapterPackage: string;
  adapterInstalled: boolean;
  usedBy: string[];
}

export interface OllamaStatus {
  url: string;
  reachable: boolean;
  models: string[];
  embedModel: string;
  embedEnabled: boolean;
}

export interface ModelsStatus {
  clis: CliStatus[];
  providers: ProviderStatus[];
  ollama: OllamaStatus;
}

const PROVIDERS = [
  ...modelProviders().map(p => ({ ...p, envVar: p.envVars[0]!, usedFor: [p.chat ? "API bots and chat-model routing" : !p.decisions ? "Non-chat models" : "", p.decisions ? "Decision routing" : ""].filter(Boolean).join(" · ") })),
  { id: "brave", name: "Brave Search", envVar: "BRAVE_API_KEY", envVars: ["BRAVE_API_KEY"], envMode: "any", usedFor: "Web search tool", chat: false, decisions: false },
];

const ADAPTERS = [
  { id: "claude-code", name: "Claude Code", pkg: "@agentclientprotocol/claude-agent-acp" },
  { id: "codex", name: "Codex", pkg: "@agentclientprotocol/codex-acp" },
] as const;

const DEFAULT_OLLAMA = "http://127.0.0.1:11434";
const OLLAMA_TIMEOUT_MS = 1500;
const MAX_MODELS = 50;

function last4(v: string | undefined): string | null {
  return v && v.length >= 12 ? v.slice(-4) : null;
}

function installed(pkg: string): boolean {
  try {
    createRequire(import.meta.url).resolve(`${pkg}/package.json`);
    return true;
  } catch {
    return false;
  }
}

/** The ACP adapter packages that are installed, Claude Code first. Module resolution only: no process, no network. */
export function detectAdapter(isInstalled: (pkg: string) => boolean = installed): CliStatus["id"] | null {
  return ADAPTERS.find((a) => isInstalled(a.pkg))?.id ?? null;
}

export function adapterPackage(id: CliStatus["id"]): string {
  return ADAPTERS.find((a) => a.id === id)!.pkg;
}

export function adapterInstalled(id: CliStatus["id"], isInstalled: (pkg: string) => boolean = installed): boolean {
  return isInstalled(adapterPackage(id));
}

/** Whether the env holds a credential for a catalogue model provider; null for other services. */
export function providerKeySet(provider: string, env: NodeJS.ProcessEnv = process.env): boolean | null {
  const p = PROVIDERS.find((x) => x.id === provider && x.id !== "brave");
  return p ? !!providerCredential(provider, env) : null;
}

function ollamaBase(raw: string | undefined): string {
  try {
    const u = new URL(raw || DEFAULT_OLLAMA);
    if ((u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password) return u.origin;
  } catch {
    /* fall through */
  }
  return DEFAULT_OLLAMA;
}

export async function modelsStatus(deps: {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  bots: Bot[];
  isInstalled?: (pkg: string) => boolean;
}): Promise<ModelsStatus> {
  const env = deps.env ?? process.env;
  const has = deps.isInstalled ?? installed;
  const usesCodex = (b: Bot) => b.model === "codex" || (b.config as { adapter?: unknown } | null)?.adapter === "codex";
  const acp = deps.bots.filter((b) => b.runtime === "acp");

  const clis: CliStatus[] = ADAPTERS.map((a) => ({
    id: a.id,
    name: a.name,
    adapterPackage: a.pkg,
    adapterInstalled: has(a.pkg),
    usedBy: acp.filter((b) => (a.id === "codex" ? usesCodex(b) : !usesCodex(b))).map((b) => b.id),
  }));

  const providers: ProviderStatus[] = PROVIDERS.map((p) => {
    const v = p.id === "brave" ? env.BRAVE_API_KEY : providerCredential(p.id, env);
    return { ...p, set: !!v, last4: last4(v) };
  });

  const url = ollamaBase(env.OPENAG_OLLAMA_URL);
  const ollama: OllamaStatus = {
    url,
    reachable: false,
    models: [],
    embedModel: env.OPENAG_EMBED_MODEL || "nomic-embed-text",
    embedEnabled: env.OPENAG_EMBED !== "off",
  };
  try {
    const res = await (deps.fetch ?? fetch)(`${url}/api/tags`, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS), redirect: "error" });
    if (res.ok) {
      const body = (await res.json()) as { models?: { name?: unknown }[] };
      ollama.reachable = true;
      ollama.models = (body.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === "string").slice(0, MAX_MODELS);
    }
  } catch {
    /* not running: reported as unreachable */
  }
  return { clis, providers, ollama };
}
