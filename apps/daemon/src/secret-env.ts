import { modelProviders } from "./providers.js";

/**
 * Environment variables that belong to the daemon: its owner secret, model-provider and other API keys, connector, sign-in,
 * computer-backend, channel and operations credentials. Bot processes never inherit them (withoutOwnerSecrets), and no
 * MCP http header may reference them.
 */
export function isDaemonSecretEnvName(name: string): boolean {
  if (name === "OPENAG_TOKEN" || name === "OPENAG_CONNECTOR_KEY" || name === "OPENAG_HEALTHCHECK_URL" || name === "OPENAG_BACKUP_DIR") return true;
  // API keys belong to the DAEMON (room router, Apps, hosted models); ANTHROPIC_API_KEY would also make Claude Code bill an API account.
  if (name.endsWith("_API_KEY")) return true;
  if (modelProviders().some(provider => provider.envVars.includes(name))) return true;
  return ["OPENAG_SIGNIN_", "OPENAG_GOOGLE_", "OPENAG_COMPOSIO_", "OPENAG_SSH_", "OPENAG_RTC_", "OPENAG_MCP_", "BROWSERBASE_", "SLACK_"].some(prefix => name.startsWith(prefix));
}

/**
 * Variables an owner deliberately provides for MCP servers: `OPENAG_MCP_<NAME>`. The daemon keeps them away from bot processes
 * (isDaemonSecretEnvName) but lets an MCP http header reference them.
 */
export const isMcpReferenceName = (name: string): boolean => /^OPENAG_MCP_[A-Z0-9_]+$/.test(name);

/** Names an MCP http header may not reference: every daemon-internal OPENAG_* variable (except OPENAG_MCP_*) plus the shared daemon-secret rules. */
// Existing operator-installed business MCP entries use this dedicated legacy credential name.
export const isForbiddenHeaderEnvName = (name: string): boolean => name!=="OPENAG_BUSINESS_MCP_API_KEY" && !isMcpReferenceName(name) && (name.startsWith("OPENAG_") || isDaemonSecretEnvName(name));

const referencesIn = (value: string): string[] => [...value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1]!);

/**
 * Write-time rule for desk edits: a reference that is new (not already in the entry being edited) must be an OPENAG_MCP_ name.
 * Returns the first refused name. Existing references are left alone; the load-time denylist still applies to them.
 */
export function newReferenceProblem(before: string[], after: string[]): string | undefined {
  const known = new Set(before.flatMap(referencesIn));
  return after.flatMap(referencesIn).find(name => !known.has(name) && !isMcpReferenceName(name));
}
