/**
 * e2e：真实起 MCP server（stdio），用官方 Client 连接并验证
 * tools / resources / prompts 的暴露数量与名称（M2.5）。
 *
 * 运行：pnpm --filter @starter/mcp run e2e
 * 说明：server.ts 模块加载即 connect stdio，所以这里用 spawn 子进程
 *       跑 dist/server.js，用 StdioClientTransport 连接。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STARTER_TOOL_NAMES, STARTER_RESOURCE_URIS, STARTER_PROMPT_NAMES } from '../src/catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, '..', 'dist', 'index.js');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  stderr: 'pipe',
});

const client = new Client({ name: 'starter-e2e', version: '0.0.1' });
await client.connect(transport);

const tools = await client.listTools();
const resources = await client.listResources();
const prompts = await client.listPrompts();

const toolNames = tools.tools.map((t) => t.name);
const resUris = resources.resources.map((r) => r.uri);
const promptNames = prompts.prompts.map((p) => p.name);

let ok = true;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
}

check(
  `tools count ${toolNames.length} == ${STARTER_TOOL_NAMES.length}`,
  toolNames.length === STARTER_TOOL_NAMES.length,
);
for (const n of STARTER_TOOL_NAMES) check(`tool ${n}`, toolNames.includes(n));
check(
  `resources count ${resUris.length} == ${STARTER_RESOURCE_URIS.length}`,
  resUris.length === STARTER_RESOURCE_URIS.length,
);
for (const n of STARTER_RESOURCE_URIS) check(`resource ${n}`, resUris.includes(n));
check(
  `prompts count ${promptNames.length} == ${STARTER_PROMPT_NAMES.length}`,
  promptNames.length === STARTER_PROMPT_NAMES.length,
);
for (const n of STARTER_PROMPT_NAMES) check(`prompt ${n}`, promptNames.includes(n));

// 验证写 tool 带 yes 参数（确认流）
const writeTool = tools.tools.find((t) => t.name === 'set_config');
check(
  'set_config has yes in schema',
  !!writeTool && 'yes' in (writeTool.inputSchema.properties ?? {}),
);

await client.close();
process.exit(ok ? 0 : 1);
