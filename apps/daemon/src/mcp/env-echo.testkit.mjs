// Test-only stdio MCP server. Reports the keys of its own environment so tests can verify env isolation.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "env-echo", version: "1.0.0" });
server.registerTool("env_keys", { description: "Lists the environment variable names of this process." }, async () => ({
  content: [{ type: "text", text: JSON.stringify({ pid: process.pid, keys: Object.keys(process.env).sort() }) }],
}));
await server.connect(new StdioServerTransport());
