/**
 * @starter/mcp — MCP Server 入口
 *
 * 暴露 5 tool + 1 resource + 1 prompt：
 *   - scan_startup_items
 *   - list_startup_items
 *   - enable_startup_item
 *   - disable_startup_item
 *   - set_delay
 *   - resource: starter://items
 *   - prompt: optimize_for_io
 *
 * 传输：stdio（默认）；SSE 留 TODO
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Controller, detectScanner, type StartupItemFilter } from '@starter/core';

const server = new Server(
  { name: 'starter', version: '0.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);

/** shared controller instance（单 db 打开一次） */
let ctrl: Controller | null = null;
function getCtrl(): Controller {
  if (!ctrl) {
    ctrl = new Controller({
      scanner: process.platform === 'win32' ? detectScanner() : null,
      actor: 'mcp',
    });
  }
  return ctrl;
}

function jsonResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ============ Tools ============

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scan_startup_items',
      description:
        'Rescan all Windows startup items (registry Run/RunOnce + startup folders) and persist to db.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_startup_items',
      description: 'List startup items with optional filters.',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description:
              'HKCU_Run / HKLM_Run / HKCU_RunOnce / HKLM_RunOnce / StartupFolder / CommonStartupFolder / TaskScheduler / Service',
          },
          enabled: { type: 'boolean' },
          risk: { type: 'string', description: 'critical / normal / recommend_off' },
          search: { type: 'string', description: 'substring match on name/command' },
        },
      },
    },
    {
      name: 'enable_startup_item',
      description:
        'Enable a startup item by id (writes to registry if HKCU; HKLM requires elevation).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      name: 'disable_startup_item',
      description:
        'Disable a startup item by id (writes to registry if HKCU; HKLM requires elevation).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      name: 'set_delay',
      description: 'Set startup delay in ms (0 = immediate). 24h max.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, delay_ms: { type: 'number' } },
        required: ['id', 'delay_ms'],
      },
    },
  ],
}));

interface ListArgs {
  source?: string;
  enabled?: boolean;
  risk?: string;
  search?: string;
}
interface IdArgs {
  id: string;
}
interface DelayArgs {
  id: string;
  delay_ms: number;
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const c = getCtrl();
  try {
    switch (name) {
      case 'scan_startup_items': {
        const r = await c.scan();
        return jsonResult({ ok: true, total: r.total, inserted: r.inserted, updated: r.updated });
      }
      case 'list_startup_items': {
        const a = (args ?? {}) as ListArgs;
        const filter: StartupItemFilter = {};
        if (a.source) filter.source = a.source;
        if (a.enabled !== undefined) filter.enabled = a.enabled;
        if (a.risk) filter.risk = a.risk;
        if (a.search) filter.search = a.search;
        return jsonResult({ ok: true, items: c.list(filter) });
      }
      case 'enable_startup_item': {
        const a = (args ?? {}) as unknown as IdArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        const r = await c.enable(a.id);
        if (r.ok) return jsonResult({ ok: true });
        return jsonResult({ ok: false, reason: r.reason });
      }
      case 'disable_startup_item': {
        const a = (args ?? {}) as unknown as IdArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        const r = await c.disable(a.id);
        if (r.ok) return jsonResult({ ok: true });
        return jsonResult({ ok: false, reason: r.reason });
      }
      case 'set_delay': {
        const a = (args ?? {}) as unknown as DelayArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        if (typeof a.delay_ms !== 'number') throw new Error('delay_ms must be number');
        const ok = c.setDelay(a.id, a.delay_ms);
        return jsonResult({ ok, id: a.id, delay_ms: a.delay_ms });
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: msg }) }],
      isError: true,
    };
  }
});

// ============ Resources ============

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'starter://items',
      name: 'All startup items',
      description: 'All startup items in db (with current enabled/delay/priority).',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const { uri } = req.params;
  if (uri === 'starter://items') {
    const c = getCtrl();
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(c.list(), null, 2) }],
    };
  }
  throw new Error(`unknown resource: ${uri}`);
});

// ============ Prompts ============

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'optimize_for_io',
      description: 'Analyze current startup items and suggest IO-friendly ordering + delays.',
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  if (req.params.name === 'optimize_for_io') {
    const c = getCtrl();
    const items = c.list({ enabled: true });
    const sample = items
      .slice(0, 20)
      .map((i) => `- ${i.name} (source=${i.source}, risk=${i.risk}, delay=${i.delay_ms}ms)`)
      .join('\n');
    return {
      description: 'Optimize startup config for low IO pressure',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `I have ${items.length} enabled startup items. Sample:\n${sample}\n\n` +
              'Suggest an IO-friendly ordering and delays. ' +
              'Specifically:\n' +
              '1. Items with `risk=critical` MUST stay enabled with delay=0\n' +
              '2. Cloud sync (OneDrive/Dropbox/GoogleDrive) should start first (delay=0)\n' +
              '3. Other items should have delay >= 30s to spread IO\n' +
              '4. Suggest specific tool calls (set_delay / add_dependency) to apply\n',
          },
        },
      ],
    };
  }
  throw new Error(`unknown prompt: ${req.params.name}`);
});

// ============ Start ============

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('[starter-mcp] connected via stdio\n');
