import { randomBytes } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { hashToken } from "./auth.js";
import type { Runner } from "./runtimes/runner.js";
import { enabledTools, toolSchema, type ToolDef } from "./tools/registry.js";

/**
 * openagd as an MCP server for ACP bots. A bot's adapter gets a token scoped to one (bot, room) pair; it is accepted
 * only here, and only while that pair has an active turn. Every tool call goes through the turn's normal gate
 * (ctx.callTool): this module never executes a tool itself.
 */

/** The only tools the bot-facing MCP endpoint exposes. The ACP runtime auto-allows exactly these (see acp.ts). */
export const MCP_TOOL_NAMES = [
  "agent_list", "agent_consult", "agent_request_cancel",
  "request_input",
  "create_work",
  "avatar_preview",
  "avatar_library_add",
  "drive_search",
  "drive_read",
  "gmail_search",
  "gmail_read",
  "read_file",
  "list_files",
  "search_files",
  "write_file",
  "run_shell",
  "brave_search",
  "notify_user",
  "computer_screenshot",
  "computer_click",
  "computer_type",
  "computer_key",
  "computer_scroll",
  "computer_open",
  "computer_shell",
  "memory_append",
  "openag_capabilities",
  "openag_help",
  "openag_status",
  "skill_load",
  "skill_list",
  "skill_save",
  "save_result",
] as const;

export interface McpAccessDeps {
  runner: Pick<Runner, "activeTurn">;
  dataDir: string;
  /** First-party tool definitions. Filtered by `enabled()` on every request. */
  tools: () => ToolDef[];
  /** Longest an approval may stay pending for an MCP call before it is expired. Default 10 min. */
  maxWaitMs?: number;
  /** Tool calls allowed per turn. Default 200. */
  maxCallsPerTurn?: number;
}

export interface McpAccess {
  issue(botId: string, roomId: string, opts?: { maxWaitMs?: number }): { token: string; url: (base: string) => string };
  revoke(botId: string, roomId: string): void;
  revokeAll(): void;
  /** The /mcp HTTP handler. Scoped tokens only; POST only. */
  handle(req: Request): Promise<Response>;
}

interface Binding {
  botId: string;
  roomId: string;
  /** Longest an approval may stay pending for a call under this token. */
  maxWaitMs: number;
}

const TOKEN_PREFIX = "oagt_";
const MAX_TOKEN_LENGTH = 128;
const DEFAULT_MAX_WAIT_MS = 10 * 60_000;
const DEFAULT_MAX_CALLS = 200;
const RESULT_CAP = 50_000;
const SHOT_MAX_BYTES = 2 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const fail = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });



/** Reads a screenshot the computer wrote under <dataDir>/computer/screens. Returns base64, or null when it is not a small PNG there. */
function readScreenshot(dataDir: string, relPath: string): string | null {
  try {
    const realDir = realpathSync(join(dataDir, "computer", "screens"));
    const real = realpathSync(join(dataDir, relPath));
    if (!real.startsWith(realDir + sep)) return null;
    const st = statSync(real);
    if (!st.isFile() || st.size === 0 || st.size > SHOT_MAX_BYTES) return null;
    const bytes = readFileSync(real);
    if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return null;
    return bytes.toString("base64");
  } catch {
    return null;
  }
}

export function createMcpAccess(deps: McpAccessDeps): McpAccess {
  const defaultWaitMs = deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const maxCallsPerTurn = deps.maxCallsPerTurn ?? DEFAULT_MAX_CALLS;
  // Only hashes are kept. byPair maps a (bot, room) pair to its current hash, so re-issuing replaces the old token.
  const byHash = new Map<string, Binding>();
  const byPair = new Map<string, string>();
  const pairKey = (botId: string, roomId: string) => JSON.stringify([botId, roomId]);

  function authenticate(req: Request): Binding | undefined {
    const header = req.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return undefined;
    const token = header.slice(7);
    if (!token.startsWith(TOKEN_PREFIX) || token.length > MAX_TOKEN_LENGTH) return undefined;
    return byHash.get(hashToken(token));
  }

  async function runTool(binding: Binding, def: ToolDef, args: unknown, signal: AbortSignal): Promise<CallToolResult> {
    const ctx = deps.runner.activeTurn(binding.botId, binding.roomId);
    if (!ctx) return fail("no active turn for this session");
    if (ctx.toolCalls >= maxCallsPerTurn) return fail("tool call limit reached for this turn");
    const outcome = await ctx.callTool(def.name, args, { signal, maxWaitMs: binding.maxWaitMs });
    if (outcome.ok) return resultOf(def.name, outcome.result);
    if (outcome.invocationOutcome === "returned" && Object.hasOwn(outcome, "result")) {
      const text = JSON.stringify(outcome);
      const projected = text.length <= RESULT_CAP ? outcome : {
        ...outcome,
        message: outcome.message.slice(0, 2000),
        result: { untrusted: true, truncated: true, originalCharacters: text.length, excerpt: (JSON.stringify(outcome.result) ?? "null").slice(0, RESULT_CAP / 4) },
      };
      return { isError: true, ...jsonResult(projected) };
    }
    if(outcome.reason==='receipt_conflict')return {isError:true,...jsonResult(outcome)};
    if (outcome.status === "responded") return fail(`The user replied instead: ${outcome.message}`);
    return fail(outcome.message);
  }

  function resultOf(name: string, result: unknown): CallToolResult {
    if (name === "computer_screenshot") {
      const shot = (result as { screenshot?: { path?: unknown; width?: unknown; height?: unknown } } | undefined)?.screenshot;
      const data = shot && typeof shot.path === "string" ? readScreenshot(deps.dataDir, shot.path) : null;
      if (!shot || data === null) return fail("screenshot is unavailable");
      return {
        content: [
          { type: "image", data, mimeType: "image/png" },
          { type: "text", text: `screenshot ${String(shot.width)}x${String(shot.height)}` },
        ],
      };
    }
    return jsonResult(result);
  }

  function jsonResult(result: unknown): CallToolResult {
    const text = JSON.stringify(result) ?? "null";
    if (text.length <= RESULT_CAP) return { content: [{ type: "text", text }] };
    let limit = RESULT_CAP / 4;
    let projected: string;
    do {
      projected = JSON.stringify({ untrusted: true, truncated: true, originalCharacters: text.length, excerpt: text.slice(0, limit) });
      limit = Math.floor(limit / 2);
    } while (projected.length > RESULT_CAP);
    return { content: [{ type: "text", text: projected }] };
  }

  function buildServer(binding: Binding, req: Request): McpServer {
    const server = new McpServer({ name: "openag", version: "1" });
    for (const def of enabledTools(deps.tools())) {
      server.registerTool(def.name, { description: def.description, inputSchema: def.input }, (args: unknown, extra) =>
        // Abort when the SDK cancels the request or the HTTP caller goes away (the SDK alone does not signal the latter).
        runTool(binding, def, args, AbortSignal.any([extra.signal, req.signal])),
      );
    }
    // The SDK's high-level listing replaces non-object Zod unions with an empty schema.
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: enabledTools(deps.tools()).map(def => ({
        name: def.name, description: def.description, inputSchema: { ...toolSchema(def, true), type: 'object' as const },
      })),
    }));
    return server;
  }

  return {
    issue(botId, roomId, opts) {
      const key = pairKey(botId, roomId);
      const previous = byPair.get(key);
      if (previous) byHash.delete(previous);
      const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
      const hash = hashToken(token);
      byHash.set(hash, { botId, roomId, maxWaitMs: opts?.maxWaitMs ?? defaultWaitMs });
      byPair.set(key, hash);
      return { token, url: (base) => `${base.replace(/\/+$/, "")}/mcp` };
    },

    revoke(botId, roomId) {
      const key = pairKey(botId, roomId);
      const hash = byPair.get(key);
      if (hash) byHash.delete(hash);
      byPair.delete(key);
    },

    revokeAll() {
      byHash.clear();
      byPair.clear();
    },

    async handle(req) {
      if (req.method !== "POST") return json(405, { error: "method not allowed" }, { allow: "POST" });
      const binding = authenticate(req);
      if (!binding) return json(401, { error: "unauthorized" });
      try {
        const server = buildServer(binding, req);
        // Stateless and JSON-only: a fresh server and transport per request, no session ids, no SSE stream.
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        return await transport.handleRequest(req);
      } catch {
        return json(500, { error: "internal error" });
      }
    },
  };
}
