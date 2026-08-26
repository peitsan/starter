/**
 * @starter/mcp — MCP Server 入口
 *
 * 暴露工具让外部 Agent 完整操作排程表（Agent Settings）：
 *   - scan_startup_items
 *   - list_startup_items
 *   - show_startup_item
 *   - enable_startup_item
 *   - disable_startup_item
 *   - set_delay
 *   - set_priority
 *   - add_dependency
 *   - remove_dependency
 *   - list_dependencies
 *   - apply_preset
 *   - undo_last_change
 *   - schedule_run
 *   - doctor
 *   - io_status
 *   - service_status
 *   - timeline
 *
 * 资源：
 *   - starter://items          所有启动项
 *   - starter://timeline       最近一次 run 的事件
 *   - starter://doctor         自检报告
 *
 * Prompts：
 *   - optimize_for_io          低 IO 启动顺序建议
 *   - diagnose_slow_boot       慢启动诊断
 *   - safe_disable_plan        安全禁用计划
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
import { Controller, detectScanner, type StartupItemFilter, type PresetRule } from '@starter/core';

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
      name: 'show_startup_item',
      description: 'Get full details of a single startup item by id.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
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
    {
      name: 'set_priority',
      description: 'Set startup priority 0..5 (0=IDLE, 5=REALTIME).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          priority: { type: 'number', minimum: 0, maximum: 5 },
        },
        required: ['id', 'priority'],
      },
    },
    {
      name: 'add_dependency',
      description: 'Add a startup-order edge: itemId must start AFTER dependsOn.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, depends_on: { type: 'string' } },
        required: ['id', 'depends_on'],
      },
    },
    {
      name: 'remove_dependency',
      description: 'Remove a startup-order edge.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, depends_on: { type: 'string' } },
        required: ['id', 'depends_on'],
      },
    },
    {
      name: 'list_dependencies',
      description: 'List outgoing/incoming dependency edges for an item.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    {
      name: 'apply_preset',
      description:
        'Apply a batch of name-pattern rules to set delay/priority/enabled in one call. Each rule: { match, delay_ms?, priority?, enabled? }. First matching rule wins per item.',
      inputSchema: {
        type: 'object',
        properties: {
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                match: { type: 'string' },
                delay_ms: { type: 'number' },
                priority: { type: 'number' },
                enabled: { type: 'boolean' },
              },
              required: ['match'],
            },
          },
        },
        required: ['rules'],
      },
    },
    {
      name: 'undo_last_change',
      description:
        'Reverse the most recent N (default 5) reversible changes (enable/disable/set_delay/set_priority/add_dep/remove_dep). Returns per-entry result.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', default: 5 } },
      },
    },
    {
      name: 'schedule_run',
      description:
        'Run a scheduling cycle. real=true to actually spawn; default simulated. Returns run id + started/failed/paused stats.',
      inputSchema: {
        type: 'object',
        properties: {
          real: { type: 'boolean', default: false },
          simulated_ms: { type: 'number', default: 1000 },
        },
      },
    },
    {
      name: 'doctor',
      description: 'Self-check: counts, config, platform info.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'io_status',
      description: 'Sample current disk IO (idle%, queue length) via typeperf on Windows.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'service_status',
      description: 'Query Windows service StarterDaemon via sc query.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'timeline',
      description: 'Get events from the most recent run (last N events).',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', default: 50 } },
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
interface PriorityArgs {
  id: string;
  priority: number;
}
interface DepArgs {
  id: string;
  depends_on: string;
}
interface PresetArgs {
  rules: PresetRule[];
}
interface UndoArgs {
  limit?: number;
}
interface ScheduleArgs {
  real?: boolean;
  simulated_ms?: number;
}
interface LimitArgs {
  limit?: number;
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
      case 'show_startup_item': {
        const a = (args ?? {}) as unknown as IdArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        const r = c.show(a.id);
        if (!r) return jsonResult({ ok: false, reason: 'not_found' });
        const deps = c.listDependencies(a.id);
        return jsonResult({ ok: true, item: r, dependencies: deps });
      }
      case 'enable_startup_item': {
        const a = (args ?? {}) as unknown as IdArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        return jsonResult(await c.enable(a.id));
      }
      case 'disable_startup_item': {
        const a = (args ?? {}) as unknown as IdArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        return jsonResult(await c.disable(a.id));
      }
      case 'set_delay': {
        const a = (args ?? {}) as unknown as DelayArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        if (typeof a.delay_ms !== 'number') throw new Error('delay_ms must be number');
        const ok = c.setDelay(a.id, a.delay_ms);
        return jsonResult({ ok, id: a.id, delay_ms: a.delay_ms });
      }
      case 'set_priority': {
        const a = (args ?? {}) as unknown as PriorityArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        if (typeof a.priority !== 'number') throw new Error('priority must be number');
        if (a.priority < 0 || a.priority > 5) throw new Error('priority must be 0..5');
        const ok = c.setPriority(a.id, a.priority);
        return jsonResult({ ok, id: a.id, priority: a.priority });
      }
      case 'add_dependency': {
        const a = (args ?? {}) as unknown as DepArgs;
        if (typeof a.id !== 'string' || typeof a.depends_on !== 'string')
          throw new Error('id/depends_on must be string');
        return jsonResult(c.addDependency(a.id, a.depends_on));
      }
      case 'remove_dependency': {
        const a = (args ?? {}) as unknown as DepArgs;
        if (typeof a.id !== 'string' || typeof a.depends_on !== 'string')
          throw new Error('id/depends_on must be string');
        const ok = c.removeDependency(a.id, a.depends_on);
        return jsonResult({ ok, id: a.id, depends_on: a.depends_on });
      }
      case 'list_dependencies': {
        const a = (args ?? {}) as unknown as IdArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        return jsonResult({ ok: true, ...c.listDependencies(a.id) });
      }
      case 'apply_preset': {
        const a = (args ?? {}) as unknown as PresetArgs;
        if (!Array.isArray(a.rules)) throw new Error('rules must be array');
        return jsonResult({ ok: true, ...c.applyPreset(a.rules) });
      }
      case 'undo_last_change': {
        const a = (args ?? {}) as UndoArgs;
        return jsonResult({ ok: true, ...(await c.undoLast(a.limit ?? 5)) });
      }
      case 'schedule_run': {
        const a = (args ?? {}) as ScheduleArgs;
        const opts: { real?: boolean; simulatedMs?: number } = {};
        if (a.real !== undefined) opts.real = a.real;
        if (a.simulated_ms !== undefined) opts.simulatedMs = a.simulated_ms;
        const r = await c.scheduleRun(opts);
        return jsonResult({ ok: true, run: r });
      }
      case 'doctor': {
        const r = c.doctor();
        return jsonResult({ ok: true, report: r });
      }
      case 'io_status': {
        const r = await c.ioStatus();
        return jsonResult({ ok: true, io: r });
      }
      case 'service_status': {
        const r = await c.serviceStatus();
        return jsonResult({ ok: true, service: r });
      }
      case 'timeline': {
        const a = (args ?? {}) as LimitArgs;
        return jsonResult({ ok: true, events: c.timeline(a.limit ?? 50) });
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
    {
      uri: 'starter://timeline',
      name: 'Last run timeline',
      description: 'Events from the most recent run (with run id, item id, status, timestamps).',
      mimeType: 'application/json',
    },
    {
      uri: 'starter://doctor',
      name: 'Doctor report',
      description: 'Self-check: counts, config, platform info.',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const { uri } = req.params;
  const c = getCtrl();
  if (uri === 'starter://items') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(c.list(), null, 2) }],
    };
  }
  if (uri === 'starter://timeline') {
    return {
      contents: [
        { uri, mimeType: 'application/json', text: JSON.stringify(c.timeline(50), null, 2) },
      ],
    };
  }
  if (uri === 'starter://doctor') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(c.doctor(), null, 2) }],
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
    {
      name: 'diagnose_slow_boot',
      description: 'Walk through items sorted by risk+delay to find slow-boot culprits.',
    },
    {
      name: 'safe_disable_plan',
      description:
        'Generate a safe-to-disable plan (skip critical, only recommend_off with low vendor risk).',
    },
  ],
}));

function buildItemSummary(c: Controller, filter?: StartupItemFilter): string {
  const items = c.list(filter);
  return items
    .slice(0, 30)
    .map(
      (i) =>
        `- ${i.name} (source=${i.source}, risk=${i.risk}, delay=${i.delay_ms}ms, priority=${i.priority}, enabled=${i.enabled})`,
    )
    .join('\n');
}

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const c = getCtrl();
  if (req.params.name === 'optimize_for_io') {
    const items = c.list({ enabled: true });
    const sample = buildItemSummary(c, { enabled: true });
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
              '4. Suggest specific tool calls (apply_preset with match-by-name) to apply\n',
          },
        },
      ],
    };
  }
  if (req.params.name === 'diagnose_slow_boot') {
    const items = c.list({ enabled: true });
    const sorted = [...items].sort((a, b) => b.delay_ms - a.delay_ms).slice(0, 15);
    const top = sorted
      .map((i) => `- ${i.name} delay=${i.delay_ms}ms priority=${i.priority} risk=${i.risk}`)
      .join('\n');
    return {
      description: 'Diagnose slow boot by analyzing delays and IO contention',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Top 15 items by delay:\n${top}\n\n` +
              'Help me find the bottleneck:\n' +
              '1. Are there any items with delay=0 AND risk=critical that could move later?\n' +
              '2. Are there recommend_off items taking priority 0/1?\n' +
              '3. Use schedule_run (real=true) once to measure actual timing, then re-evaluate.\n' +
              '4. Suggest 3 specific apply_preset / set_delay / set_priority calls to improve boot time.\n',
          },
        },
      ],
    };
  }
  if (req.params.name === 'safe_disable_plan') {
    const items = c.list({ enabled: true, risk: 'recommend_off' });
    const top = items
      .slice(0, 20)
      .map((i) => `- ${i.name} (vendor=${i.vendor ?? '?'}, source=${i.source})`)
      .join('\n');
    return {
      description: 'Plan a safe disable pass for recommend_off items',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Recommend-off items (${items.length} total):\n${top}\n\n` +
              'Generate a safe disable plan:\n' +
              '1. Skip any item where vendor is Microsoft, Intel, AMD, NVIDIA, Realtek (driver/security)\n' +
              '2. Group remaining items by source — disable StartupFolder ones first (least invasive)\n' +
              '3. Use apply_preset with multiple rules, each with enabled:false and a match substring\n' +
              '4. Output exact JSON rules to pass to apply_preset.\n',
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
process.stderr.write('[starter-mcp] connected via stdio (17 tools, 3 resources, 3 prompts)\n');
