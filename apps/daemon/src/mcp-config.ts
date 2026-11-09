import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { managedPath } from "./package-files.js";
import { createHash } from "node:crypto";

export const MCP_CONFIG_MAX = 512 * 1024;
/** mcp.json cannot be read or trusted (permissions, owner, size, links, JSON shape). Typed so callers never match on message text. */
export class McpConfigUnsafeError extends Error {}
export function readMcpConfig(dataDir: string): { digest: string; bytes: Buffer | null; value: Record<string, unknown> & { servers: unknown[] } } {
  const path = managedPath(dataDir, "mcp.json");
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return { digest: "absent", bytes: null, value: { servers: [] } }; throw new McpConfigUnsafeError("MCP configuration cannot be opened safely"); }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MCP_CONFIG_MAX || st.nlink !== 1 || (st.mode & 0o022) || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw new McpConfigUnsafeError("MCP configuration ownership, permissions or size is unsafe");
    const buffer = Buffer.alloc(MCP_CONFIG_MAX + 1); let count = 0;
    while (count < buffer.length) { const size = readSync(fd, buffer, count, buffer.length - count, null); if (!size) break; count += size; }
    const after = fstatSync(fd);
    if (count > MCP_CONFIG_MAX || count !== st.size || st.mtimeMs !== after.mtimeMs || st.ctimeMs !== after.ctimeMs) throw new McpConfigUnsafeError("MCP configuration changed or is too large");
    const bytes = buffer.subarray(0, count);
    let value: unknown; try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new McpConfigUnsafeError("MCP configuration is not valid JSON"); }
    if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as { servers?: unknown }).servers)) throw new McpConfigUnsafeError("MCP configuration must contain a servers array");
    return { digest: createHash("sha256").update(bytes).digest("hex"), bytes, value: value as Record<string, unknown> & { servers: unknown[] } };
  } finally { closeSync(fd); }
}
