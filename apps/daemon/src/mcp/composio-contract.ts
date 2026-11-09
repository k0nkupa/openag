import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolClass } from "../policy.js";

// Operator-reviewed permission contracts, not server hints. New names retain opaque permissions.
// Source inventory and references: docs/notes/composio-e2e-test-map.md.
export const COMPOSIO_TOOL_CLASSES: Readonly<Record<string, ToolClass>> = Object.freeze({
  COMPOSIO_SEARCH_TOOLS: "search",
  COMPOSIO_GET_TOOL_SCHEMAS: "read",
  COMPOSIO_SEARCH_SKILLS: "search",
  COMPOSIO_USE_SKILL: "read",
  COMPOSIO_WAIT_FOR_CONNECTIONS: "act-external", // Requires a user-confirmed auth attempt; not passive status.
  COMPOSIO_MANAGE_CONNECTIONS: "act-external",
  COMPOSIO_MULTI_EXECUTE_TOOL: "act-external",
  COMPOSIO_PROXY_EXECUTE: "act-external",
  COMPOSIO_REMOTE_WORKBENCH: "act-external",
  COMPOSIO_REMOTE_BASH_TOOL: "act-external",
  COMPOSIO_MANAGE_SKILL: "act-external",
  COMPOSIO_SUBMIT_FEEDBACK: "act-external",
});
// Provider operations reviewed as read-only, by exact slug. Only the managed connection consults this, and only against the
// approved request, never the reply. This list controls permission only, never invocation completion.
export const COMPOSIO_READ_SLUGS: ReadonlySet<string> = new Set(["OUTLOOK_GET_PROFILE", "OUTLOOK_QUERY_EMAILS"]);
// The request shape the read-only acceptance check (scripts/verify-composio-readonly-e2e.mjs) treats as in scope; any other key could carry a side effect.
const READ_BATCH_KEYS: ReadonlySet<string> = new Set(["tools", "sync_response_to_workbench", "session_id", "current_step", "current_step_metric", "thought"]);
const READ_TOOL_KEYS: ReadonlySet<string> = new Set(["tool_slug", "arguments", "account"]);
// Keeps one batch within a reviewable size; matches docs/notes/mcp.md.
const COMPOSIO_MAX_BATCH = 10;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const failed = (value: unknown) => value !== undefined && value !== null && value !== "";

/** Interpret the reviewed provider envelope before bounding it; a delivered reply can still be a failure. */
/** Every requested batch operation must return a matching slug and an explicit nested success. */
function batchAnswered(envelope: Record<string, unknown>, args: unknown): boolean {
  const tools = object(args) ? args.tools : undefined;
  if (!Array.isArray(tools)) return true; // No request to compare against: keep the envelope-only verdict.
  const slug = (item: unknown) => (object(item) && typeof item.tool_slug === "string" ? item.tool_slug : "");
  if (!object(envelope.data) || !Array.isArray(envelope.data.results) || envelope.data.results.length !== tools.length) return false;
  const requested = tools.map(slug).sort(), returned = envelope.data.results.map(slug).sort();
  return requested.every((value, index) => value !== "" && value === returned[index]) && envelope.data.results.every(item =>
    object(item) && object(item.response) && item.response.successful === true && !failed(item.response.error));
}

export function composioResult(name: string, result: CallToolResult, args?: unknown): CallToolResult & { providerDiagnostic?: { code: string; logId?: string } } {
  let envelope: Record<string, unknown> | undefined;
  if (object(result.structuredContent) && Object.hasOwn(result.structuredContent, "successful")) envelope = result.structuredContent;
  else {
    const values: Record<string, unknown>[] = [];
    for (const block of result.content) {
      if (block.type !== "text") continue;
      try { const value: unknown = JSON.parse(block.text); if (object(value) && Object.hasOwn(value, "successful")) values.push(value); } catch { /* Non-JSON text is retained as evidence. */ }
    }
    if (values.length === 1) envelope = values[0];
  }
  let code: string | undefined;
  if (!envelope || typeof envelope.successful !== "boolean") code = "invalid_envelope";
  else if (!envelope.successful || failed(envelope.error)) code = "provider_error";
  else if (name === "COMPOSIO_MULTI_EXECUTE_TOOL" && object(envelope.data) && Array.isArray(envelope.data.results) && envelope.data.results.some(item =>
    object(item) && (failed(item.error) || object(item.response) && (item.response.successful === false || failed(item.response.error))))) code = "partial_failure";
  else if (name === "COMPOSIO_MULTI_EXECUTE_TOOL" && !batchAnswered(envelope, args)) code = "unmatched_results"; // The returned batch does not establish completion of the requested operations.
  else if (name === "COMPOSIO_PROXY_EXECUTE" && object(envelope.data) && typeof envelope.data.status === "number" && envelope.data.status >= 400) code = "provider_http_error";
  return { ...result, ...(code ? { isError: true } : {}), providerDiagnostic: { code: code ?? "provider_returned", ...(typeof envelope?.log_id === "string" ? { logId: envelope.log_id.slice(0, 300) } : {}) } };
}

/** Trusted request contract only; remote hints and results cannot select effect classes. */
export function composioReadRequest(name:string,args:unknown):string[]|undefined {
  if (name !== "COMPOSIO_MULTI_EXECUTE_TOOL" || !object(args)) return undefined;
  if (!Object.keys(args).every(key => READ_BATCH_KEYS.has(key)) || (args.sync_response_to_workbench !== undefined && args.sync_response_to_workbench !== false)) return undefined;
  const tools = args.tools;
  if (!Array.isArray(tools) || tools.length === 0 || tools.length > COMPOSIO_MAX_BATCH) return undefined;
  const slugs: string[] = [];
  for (const tool of tools) {
    if (!object(tool) || !Object.keys(tool).every(key => READ_TOOL_KEYS.has(key)) || typeof tool.tool_slug !== "string" || !COMPOSIO_READ_SLUGS.has(tool.tool_slug)) return undefined;
    slugs.push(tool.tool_slug);
  }
  return slugs;
}
