// @starter/mcp — placeholder entry. Real MCP server lands in later PRs.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  { name: 'starter', version: '0.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);

const transport = new StdioServerTransport();
await server.connect(transport);
