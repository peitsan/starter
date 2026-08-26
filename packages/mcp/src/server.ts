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
 *   - starter://config         全局配置
 *   - starter://io             当前磁盘 IO
 *   - starter://runs/latest    最近一次 run 摘要 + 事件
 *
 * Prompts：
 *   - optimize_for_io          低 IO 启动顺序建议
 *   - diagnose_slow_boot       慢启动诊断
 *   - safe_disable_plan        安全禁用计划
 *   - find_bloat               找臃肿项
 *   - dependency_audit         依赖图审计
 *
 * 传输：stdio（默认）；SSE（STARTER_MCP_SSE=1 或 --sse，绑 127.0.0.1:7812）
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Controller, detectScanner, type StartupItemFilter, type PresetRule } from '@starter/core';
import { rpc as daemonRpc, daemonReachable } from '@starter/ipc-client';

/**
 * 写操作统一路由（RFC-001 §4.7 / M1.4）：
 *   - daemon 可达 → 走 HTTP RPC（统一审计 + HKLM UAC 支持）
 *   - daemon 不可达 → 本地 fallback（同一 SQLite WAL，语义一致）
 * 返回 MCP 兼容的 { ok, ... }。
 */
async function writeViaDaemon(
  method: string,
  params: Record<string, unknown>,
  local: () => Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string },
): Promise<{ ok: boolean; reason?: string }> {
  if (await daemonReachable()) {
    try {
      const r: unknown = await daemonRpc(method, params);
      // 兼容旧 daemon 返回裸 boolean
      if (typeof r === 'boolean') return r ? { ok: true } : { ok: false, reason: 'rejected' };
      if (r && typeof r === 'object') return r as { ok: boolean; reason?: string };
      return { ok: false, reason: 'invalid_response' };
    } catch {
      // 掉到本地 fallback（daemon 可达但调用失败）
    }
  }
  const r = await local();
  return r;
}

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

/**
 * MCP 写操作确认流（RFC-001 §4.6）：
 *   调用写 tool 时若不传 yes:true，返回 { ok:false, require_yes:true, preview }，
 *   agent 看到 preview 后再带 yes:true 重调才真正执行。
 * 返回 null 表示确认通过（可继续执行）。
 */
function requireYes(
  args: unknown,
  preview: unknown,
): { ok: false; require_yes: true; preview: unknown } | null {
  const a = args as { yes?: boolean } | null;
  if (a?.yes === true) return null;
  return { ok: false, require_yes: true, preview };
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
        'Enable a startup item by id (writes to registry if HKCU; HKLM requires elevation). Write op — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, yes: { type: 'boolean', default: false } },
        required: ['id'],
      },
    },
    {
      name: 'disable_startup_item',
      description:
        'Disable a startup item by id (writes to registry if HKCU; HKLM requires elevation). Write op — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, yes: { type: 'boolean', default: false } },
        required: ['id'],
      },
    },
    {
      name: 'set_delay',
      description:
        'Set startup delay in ms (0 = immediate). 24h max. Write op — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          delay_ms: { type: 'number' },
          yes: { type: 'boolean', default: false },
        },
        required: ['id', 'delay_ms'],
      },
    },
    {
      name: 'set_priority',
      description:
        'Set startup priority 0..5 (0=Idle 1=BelowNormal 2=Normal 3=AboveNormal 4=High 5=Realtime — see RFC-001 §4.5). Write op — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          priority: { type: 'number', minimum: 0, maximum: 5 },
          yes: { type: 'boolean', default: false },
        },
        required: ['id', 'priority'],
      },
    },
    {
      name: 'add_dependency',
      description:
        'Add a startup-order edge: itemId must start AFTER dependsOn. Write op — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          depends_on: { type: 'string' },
          yes: { type: 'boolean', default: false },
        },
        required: ['id', 'depends_on'],
      },
    },
    {
      name: 'remove_dependency',
      description: 'Remove a startup-order edge. Write op — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          depends_on: { type: 'string' },
          yes: { type: 'boolean', default: false },
        },
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
        'Apply a batch of name-pattern rules to set delay/priority/enabled in one call. Each rule: { match, delay_ms?, priority?, enabled? }. First matching rule wins per item. Write op — requires yes:true.',
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
          yes: { type: 'boolean', default: false },
        },
        required: ['rules'],
      },
    },
    {
      name: 'undo_last_change',
      description:
        'Reverse the most recent N (default 5) reversible changes (enable/disable/set_delay/set_priority/add_dep/remove_dep). Returns per-entry result. Write op — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 5 },
          yes: { type: 'boolean', default: false },
        },
      },
    },
    {
      name: 'schedule_run',
      description:
        'Run a scheduling cycle. real=true to actually spawn; default simulated. Returns run id + started/failed/paused stats. Write op (real=true) — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: {
          real: { type: 'boolean', default: false },
          simulated_ms: { type: 'number', default: 1000 },
          yes: { type: 'boolean', default: false },
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
    {
      name: 'get_config',
      description: 'Read all global config values (concurrent_max, io_*, auto_start) with source.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'set_config',
      description:
        'Set a global config key. Write op — requires yes:true (returns preview otherwise). ' +
        'Keys: concurrent_max(1-16), io_queue_threshold(>=0), io_busy_threshold_pct(0-100), io_idle_confirm_ms(>=0 int), auto_start(true|false).',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          yes: { type: 'boolean', default: false },
        },
        required: ['key', 'value'],
      },
    },
    {
      name: 'import_config',
      description:
        'Import a config snapshot (RFC-001 §4.9). mode: merge|replace|append. Write op — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: {
          snapshot: { type: 'string', description: 'JSON snapshot as produced by export_config.' },
          mode: { type: 'string', enum: ['merge', 'replace', 'append'], default: 'merge' },
          yes: { type: 'boolean', default: false },
        },
        required: ['snapshot', 'yes'],
      },
    },
    {
      name: 'export_config',
      description: 'Export full config snapshot (items + dependencies + config) as JSON.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_run_history',
      description: 'List recent scheduling runs with item counts.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', default: 5 } },
      },
    },
    {
      name: 'get_dependency_graph',
      description: 'Return full startup dependency graph (nodes + edges).',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_changes',
      description: 'List recent audit log entries (all writes including config_set/import).',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', default: 50 } },
      },
    },
    {
      name: 'set_io_throttle',
      description:
        'Quick-set IO throttling thresholds (io_busy_threshold_pct, io_queue_threshold, io_idle_confirm_ms). Write op — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: {
          busy_threshold_pct: { type: 'number' },
          queue_threshold: { type: 'number' },
          idle_confirm_ms: { type: 'number' },
          yes: { type: 'boolean', default: false },
        },
      },
    },
    {
      name: 'simulate_dry_run',
      description:
        'Dry-run scheduling simulation according to current io load + delays. Never spawns processes.',
      inputSchema: {
        type: 'object',
        properties: { simulated_ms: { type: 'number', default: 1000 } },
      },
    },
    {
      name: 'revert_preset',
      description:
        'Reverse the last applied preset / batch change (undo semantics; alias of undo_last_change limit=1). Write op — requires yes:true.',
      inputSchema: {
        type: 'object',
        properties: { yes: { type: 'boolean', default: false } },
        required: ['yes'],
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
        const item = c.show(a.id);
        const need = requireYes(args, item ? { id: item.id, name: item.name } : { id: a.id });
        if (need) return jsonResult(need);
        return jsonResult(
          await writeViaDaemon('enable', { id: a.id }, async () => await c.enable(a.id)),
        );
      }
      case 'disable_startup_item': {
        const a = (args ?? {}) as unknown as IdArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        const item = c.show(a.id);
        const need = requireYes(args, item ? { id: item.id, name: item.name } : { id: a.id });
        if (need) return jsonResult(need);
        return jsonResult(
          await writeViaDaemon('disable', { id: a.id }, async () => await c.disable(a.id)),
        );
      }
      case 'set_delay': {
        const a = (args ?? {}) as unknown as DelayArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        if (typeof a.delay_ms !== 'number') throw new Error('delay_ms must be number');
        const need = requireYes(args, { id: a.id, delay_ms: a.delay_ms });
        if (need) return jsonResult(need);
        return jsonResult(
          await writeViaDaemon('set_delay', { id: a.id, delay_ms: a.delay_ms }, async () => ({
            ok: c.setDelay(a.id, a.delay_ms),
          })),
        );
      }
      case 'set_priority': {
        const a = (args ?? {}) as unknown as PriorityArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        if (typeof a.priority !== 'number') throw new Error('priority must be number');
        if (a.priority < 0 || a.priority > 5) throw new Error('priority must be 0..5');
        const need = requireYes(args, { id: a.id, priority: a.priority });
        if (need) return jsonResult(need);
        return jsonResult(
          await writeViaDaemon('set_priority', { id: a.id, priority: a.priority }, async () => ({
            ok: c.setPriority(a.id, a.priority),
          })),
        );
      }
      case 'add_dependency': {
        const a = (args ?? {}) as unknown as DepArgs;
        if (typeof a.id !== 'string' || typeof a.depends_on !== 'string')
          throw new Error('id/depends_on must be string');
        const need = requireYes(args, { id: a.id, depends_on: a.depends_on });
        if (need) return jsonResult(need);
        return jsonResult(
          await writeViaDaemon('add_dependency', { id: a.id, depends_on: a.depends_on }, async () =>
            c.addDependency(a.id, a.depends_on),
          ),
        );
      }
      case 'remove_dependency': {
        const a = (args ?? {}) as unknown as DepArgs;
        if (typeof a.id !== 'string' || typeof a.depends_on !== 'string')
          throw new Error('id/depends_on must be string');
        const need = requireYes(args, { id: a.id, depends_on: a.depends_on });
        if (need) return jsonResult(need);
        return jsonResult(
          await writeViaDaemon(
            'remove_dependency',
            { id: a.id, depends_on: a.depends_on },
            async () => ({ ok: c.removeDependency(a.id, a.depends_on) }),
          ),
        );
      }
      case 'list_dependencies': {
        const a = (args ?? {}) as unknown as IdArgs;
        if (typeof a.id !== 'string') throw new Error('id must be string');
        return jsonResult({ ok: true, ...c.listDependencies(a.id) });
      }
      case 'apply_preset': {
        const a = (args ?? {}) as unknown as PresetArgs;
        if (!Array.isArray(a.rules)) throw new Error('rules must be array');
        const need = requireYes(args, { rule_count: a.rules.length });
        if (need) return jsonResult(need);
        return jsonResult({ ok: true, ...c.applyPreset(a.rules) });
      }
      case 'undo_last_change': {
        const a = (args ?? {}) as unknown as UndoArgs;
        const need = requireYes(args, { limit: a.limit ?? 5 });
        if (need) return jsonResult(need);
        return jsonResult({ ok: true, ...(await c.undoLast(a.limit ?? 5)) });
      }
      case 'schedule_run': {
        const a = (args ?? {}) as unknown as ScheduleArgs;
        if (a.real === true) {
          const need = requireYes(args, { real: true, note: 'will actually spawn processes' });
          if (need) return jsonResult(need);
        }
        const opts: { real?: boolean; simulatedMs?: number } = {};
        if (a.real !== undefined) opts.real = a.real;
        if (a.simulated_ms !== undefined) opts.simulatedMs = a.simulated_ms;
        const r = await c.scheduleRun(opts);
        return jsonResult({ ok: true, run: r });
      }
      case 'revert_preset': {
        const need = requireYes(args, { action: 'revert_preset', note: 'undo last change' });
        if (need) return jsonResult(need);
        return jsonResult({ ok: true, ...(await c.undoLast(1)) });
      }
      case 'get_config': {
        return jsonResult({ ok: true, config: c.configAll() });
      }
      case 'set_config': {
        const a = (args ?? {}) as unknown as { key: string; value: string };
        if (typeof a.key !== 'string' || typeof a.value !== 'string')
          throw new Error('key/value must be string');
        const need = requireYes(args, { key: a.key, value: a.value });
        if (need) return jsonResult(need);
        c.config.set(a.key as never, a.value, 'mcp');
        return jsonResult({ ok: true, key: a.key, value: a.value });
      }
      case 'import_config': {
        const a = (args ?? {}) as unknown as { snapshot: string; mode?: string };
        if (typeof a.snapshot !== 'string') throw new Error('snapshot must be string');
        const need = requireYes(args, { mode: a.mode ?? 'merge' });
        if (need) return jsonResult(need);
        return jsonResult(
          c.importConfig(a.snapshot, (a.mode as 'merge' | 'replace' | 'append') ?? 'merge'),
        );
      }
      case 'export_config': {
        return jsonResult({ ok: true, snapshot: c.exportConfig() });
      }
      case 'get_run_history': {
        const a = (args ?? {}) as { limit?: number };
        const limit = Number(a.limit ?? 5) || 5;
        return jsonResult({ ok: true, runs: c.runHistory(limit) });
      }
      case 'get_dependency_graph': {
        return jsonResult({ ok: true, graph: c.dependencyGraph() });
      }
      case 'list_changes': {
        const a = (args ?? {}) as { limit?: number };
        const limit = Number(a.limit ?? 50) || 50;
        return jsonResult({ ok: true, changes: c.listChanges(limit) });
      }
      case 'set_io_throttle': {
        const a = (args ?? {}) as {
          busy_threshold_pct?: number;
          queue_threshold?: number;
          idle_confirm_ms?: number;
        };
        const preview: Record<string, string> = {};
        if (a.busy_threshold_pct !== undefined)
          preview.io_busy_threshold_pct = String(a.busy_threshold_pct);
        if (a.queue_threshold !== undefined) preview.io_queue_threshold = String(a.queue_threshold);
        if (a.idle_confirm_ms !== undefined) preview.io_idle_confirm_ms = String(a.idle_confirm_ms);
        const need = requireYes(args, preview);
        if (need) return jsonResult(need);
        const written: Record<string, string> = {};
        for (const [k, v] of Object.entries(preview)) {
          c.config.set(k as never, v, 'mcp');
          written[k] = v;
        }
        return jsonResult({ ok: true, config: written });
      }
      case 'simulate_dry_run': {
        const a = (args ?? {}) as { simulated_ms?: number };
        const simulatedMs = Number(a.simulated_ms ?? 1000) || 1000;
        const r = await c.scheduleRun({ simulatedMs });
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
    {
      uri: 'starter://config',
      name: 'Global config',
      description: 'All global config values with source (db/default).',
      mimeType: 'application/json',
    },
    {
      uri: 'starter://io',
      name: 'Current disk IO',
      description: 'Latest disk IO sample (idle%, queue length, timestamp).',
      mimeType: 'application/json',
    },
    {
      uri: 'starter://runs/latest',
      name: 'Latest run summary',
      description: 'Most recent scheduling run summary + its timeline events.',
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
  if (uri === 'starter://config') {
    return {
      contents: [
        { uri, mimeType: 'application/json', text: JSON.stringify(c.configAll(), null, 2) },
      ],
    };
  }
  if (uri === 'starter://io') {
    const io = await c.ioStatus();
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(io, null, 2) }],
    };
  }
  if (uri === 'starter://runs/latest') {
    const runs = c.runHistory(1);
    const latest = runs[0];
    const timeline = latest ? c.timeline(50) : [];
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ latest, timeline }, null, 2),
        },
      ],
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
    {
      name: 'find_bloat',
      description: 'Find bloat: many enabled non-critical items or repeated DLL/driver paths.',
    },
    {
      name: 'dependency_audit',
      description: 'Audit the startup dependency graph for cycles, orphans, or deep chains.',
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
  if (req.params.name === 'find_bloat') {
    const items = c.list({ enabled: true });
    const total = items.length;
    const nonCritical = items.filter((i) => i.risk !== 'critical');
    const sample = nonCritical
      .slice(0, 30)
      .map(
        (i) => `- ${i.name} (vendor=${i.vendor ?? '?'}, source=${i.source}, delay=${i.delay_ms}ms)`,
      )
      .join('\n');
    return {
      description: 'Find startup bloat (non-critical items that could be delayed/disabled)',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `I have ${total} enabled items, ${nonCritical.length} of them non-critical.\n` +
              `Sample of non-critical items:\n${sample}\n\n` +
              'Identify bloat:\n' +
              '1. Which non-critical items have high delay (>=60s) but still load — candidates to disable\n' +
              '2. Which are likely safe to disable (no vendor / consumer bloat like updaters)\n' +
              '3. Produce a concrete disable/set_delay plan as tool calls.\n',
          },
        },
      ],
    };
  }
  if (req.params.name === 'dependency_audit') {
    const graph = c.dependencyGraph();
    const depCount = graph.edges.length;
    const sample = graph.edges
      .slice(0, 30)
      .map((e) => `${e.from} -> ${e.to}`)
      .join('\n');
    return {
      description: 'Audit the dependency graph for issues',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Dependency graph: ${graph.nodes.length} nodes, ${depCount} edges.\n` +
              `Sample edges:\n${sample}\n\n` +
              'Audit for:\n' +
              '1. Cycles (would deadlock scheduling)\n' +
              '2. Nodes with no dependencies and no dependents (isolated)\n' +
              '3. Very long chains that delay startup\n' +
              '4. Suggest removals (remove_dependency) or additions (add_dependency) to fix.\n',
          },
        },
      ],
    };
  }
  throw new Error(`unknown prompt: ${req.params.name}`);
});

// ============ Start ============

const useSse = process.env.STARTER_MCP_SSE === '1' || process.argv.includes('--sse');
const SSE_PORT = Number(process.env.STARTER_MCP_SSE_PORT ?? 7812);
const SSE_HOST = process.env.STARTER_MCP_SSE_HOST ?? '127.0.0.1';

if (!useSse) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[starter-mcp] connected via stdio\n');
} else {
  const transports = new Map<string, SSEServerTransport>();
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? SSE_HOST}`);
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/message', res);
      transports.set(transport.sessionId, transport);
      // 连接关闭时清理
      res.on('close', () => {
        transports.delete(transport.sessionId);
      });
      await server.connect(transport);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const transport = transports.get(sessionId);
      if (transport) {
        await transport.handlePostMessage(req, res, sessionId);
        return;
      }
      res.statusCode = 400;
      res.end('unknown session');
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  httpServer.listen(SSE_PORT, SSE_HOST, () => {
    process.stderr.write(`[starter-mcp] SSE listening on http://${SSE_HOST}:${SSE_PORT}/sse\n`);
  });
}
