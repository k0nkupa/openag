// Installed by the local setup CLI. Reuse OpenAg's existing SDK; never download dependencies at runtime.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(join(process.argv[2], 'package.json'));
const { McpServer } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/mcp.js')).href);
const { StdioServerTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')).href);
const server = new McpServer({ name: 'OpenAg local reference', version: '1.0.0' });
server.registerTool('clock', { description: 'Read the current time', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: new Date().toISOString() }] }));
await server.connect(new StdioServerTransport());
