/**
 * 命令注册器 — CLI / MCP / daemon 共享同一份写操作定义（RFC-001 §4.2）
 *
 * 目标：零代码重复。CLI、MCP、daemon 都从 @starter/core/registry import
 * 同一个命令表，各自只做"参数解析 + 输出格式"。
 *
 * 范围：写操作（enable/disable/set_delay/set_priority/add_dependency/
 *       remove_dependency/config_set/import/export）。读操作（scan/list/show/
 *       doctor/io/run_history）因各端差异小且无副作用，保持直接调用 Controller。
 *
 * 设计约束：
 *  - 不引入 zod / schema 库（依赖重量）；用轻量 validate 函数。
 *  - 每个命令：name / cli（commander 用）/ describe / validate / exec / actor。
 *  - exec 统一返回 { ok: true, ... } 或 { ok: false, reason }，供 CLI/MCP 包装。
 */

import type { Controller, Actor } from '../controller.js';
import { ElevationRequiredError } from '../winreg.js';

export interface CommandContext {
  /** 操作来源 actor，写入 op_log */
  actor: Actor;
  /** 命令被谁调用：'cli' | 'mcp' | 'daemon' */
  caller: 'cli' | 'mcp' | 'daemon';
  /** daemon 是否可达（用于 CLI 是否走 IPC；MCP/daemon 内部直接本地） */
  daemonReachable?: () => Promise<boolean>;
  /** CLI 走 IPC 时使用；null 表示未配置 */
  ipc?: {
    rpc<T>(method: string, params: unknown, opts?: { url?: string; token?: string }): Promise<T>;
  } | null;
}

export type CommandResult =
  { ok: true; [k: string]: unknown } | { ok: false; reason: string; [k: string]: unknown };

export interface CommandDef<P> {
  name: string;
  cli: string; // 子命令名（commander）
  describe: string;
  /** 参数校验；返回 null 表示通过，否则返回错误消息 */
  validate(args: unknown): string | null;
  /** 执行本地（Controller 直调）；只负责业务，不负责 IPC 路由 */
  exec(ctx: CommandContext, c: Controller, args: P): Promise<CommandResult> | CommandResult;
}

export interface CommandRegistry {
  list(): CommandDef<unknown>[];
  get(name: string): CommandDef<unknown> | undefined;
}

// ---------- 写操作实现 ----------

const requireString = (args: unknown, key: string): string | null => {
  const a = args as Record<string, unknown> | null;
  if (!a || typeof a[key] !== 'string') return `${key} must be a string`;
  return null;
};

const requireNumber = (args: unknown, key: string): string | null => {
  const a = args as Record<string, unknown> | null;
  const v = a?.[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return `${key} must be a number`;
  return null;
};

async function guardProtected(
  c: Controller,
  id: string,
  action: 'enable' | 'disable',
): Promise<CommandResult> {
  const row = c.show(id);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.risk === 'critical') {
    return { ok: false, reason: 'protected', code: 'E_PROTECTED' };
  }
  try {
    const r = action === 'enable' ? await c.enable(id) : await c.disable(id);
    return r.ok
      ? { ok: true, id }
      : {
          ok: false,
          reason: r.reason,
          code:
            r.reason === 'protected'
              ? 'E_PROTECTED'
              : r.reason === 'elevation_required'
                ? 'E_ELEVATION'
                : 'E_OP',
        };
  } catch (e) {
    if (e instanceof ElevationRequiredError) {
      return { ok: false, reason: 'elevation_required', code: 'E_ELEVATION' };
    }
    throw e;
  }
}

const COMMANDS: CommandDef<unknown>[] = [
  {
    name: 'enable',
    cli: 'enable <id>',
    describe: 'Enable a startup item (HKCU direct; HKLM via daemon).',
    validate: (a) => requireString(a, 'id'),
    exec: (ctx, c, args) => guardProtected(c, (args as { id: string }).id, 'enable'),
  },
  {
    name: 'disable',
    cli: 'disable <id>',
    describe: 'Disable a startup item (HKCU direct; HKLM via daemon).',
    validate: (a) => requireString(a, 'id'),
    exec: (ctx, c, args) => guardProtected(c, (args as { id: string }).id, 'disable'),
  },
  {
    name: 'set_delay',
    cli: 'set-delay <id> <ms>',
    describe: 'Set startup delay in ms (0 = immediate; 24h max).',
    validate: (a) => {
      const r1 = requireString(a, 'id');
      if (r1) return r1;
      const r2 = requireNumber(a, 'delay_ms');
      if (r2) return r2;
      const ms = (a as { delay_ms: number }).delay_ms;
      if (ms < 0 || ms > 24 * 3600 * 1000) return 'delay_ms out of range [0, 24h]';
      return null;
    },
    exec: (ctx, c, args) => {
      const { id, delay_ms } = args as { id: string; delay_ms: number };
      const ok = c.setDelay(id, Math.floor(delay_ms));
      return ok
        ? { ok: true, id, delay_ms: Math.floor(delay_ms) }
        : { ok: false, reason: 'not_found', id };
    },
  },
  {
    name: 'set_priority',
    cli: 'set-priority <id> <prio>',
    describe:
      'Set process priority 0..5 (0=Idle 1=BelowNormal 2=Normal 3=AboveNormal 4=High 5=Realtime — RFC-001 §4.5).',
    validate: (a) => {
      const r1 = requireString(a, 'id');
      if (r1) return r1;
      const r2 = requireNumber(a, 'priority');
      if (r2) return r2;
      const p = (a as { priority: number }).priority;
      if (!Number.isInteger(p) || p < 0 || p > 5) return 'priority must be integer 0..5';
      return null;
    },
    exec: (ctx, c, args) => {
      const { id, priority } = args as { id: string; priority: number };
      const ok = c.setPriority(id, priority);
      return ok ? { ok: true, id, priority } : { ok: false, reason: 'not_found', id };
    },
  },
  {
    name: 'add_dependency',
    cli: 'add-dep <id> <depends_on>',
    describe: 'Add startup-order edge: item `id` starts only after `depends_on` is done.',
    validate: (a) => {
      const r1 = requireString(a, 'id');
      if (r1) return r1;
      const r2 = requireString(a, 'depends_on');
      if (r2) return r2;
      if ((a as { id: string }).id === (a as { depends_on: string }).depends_on) {
        return 'self dependency not allowed';
      }
      return null;
    },
    exec: (ctx, c, args) => {
      const { id, depends_on } = args as { id: string; depends_on: string };
      const r = c.addDependency(id, depends_on);
      return r.ok ? { ok: true, id, depends_on } : { ok: false, reason: r.reason };
    },
  },
  {
    name: 'remove_dependency',
    cli: 'rm-dep <id> <depends_on>',
    describe: 'Remove startup-order edge.',
    validate: (a) => {
      const r1 = requireString(a, 'id');
      if (r1) return r1;
      return requireString(a, 'depends_on');
    },
    exec: (ctx, c, args) => {
      const { id, depends_on } = args as { id: string; depends_on: string };
      const ok = c.removeDependency(id, depends_on);
      return ok ? { ok: true, id, depends_on } : { ok: false, reason: 'not_found' };
    },
  },
  {
    name: 'config_set',
    cli: 'config set <key> <value>',
    describe: 'Write a global config key (concurrent_max / io_* / auto_start). Validates range.',
    validate: (a) => {
      const r1 = requireString(a, 'key');
      if (r1) return r1;
      const r2 = requireString(a, 'value');
      if (r2) return r2;
      const { key, value } = a as { key: string; value: string };
      const keys: ReadonlyArray<string> = [
        'concurrent_max',
        'io_queue_threshold',
        'io_busy_threshold_pct',
        'io_idle_confirm_ms',
        'auto_start',
      ];
      if (!keys.includes(key)) return `unknown config key: ${key}`;
      // 纯范围校验（与 ConfigRepository.set 一致），副作用放 exec
      switch (key) {
        case 'concurrent_max': {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1 || n > 16) return 'concurrent_max out of range [1,16]';
          break;
        }
        case 'io_busy_threshold_pct': {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0 || n > 100)
            return 'io_busy_threshold_pct out of range [0,100]';
          break;
        }
        case 'io_queue_threshold': {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0) return 'io_queue_threshold must be >= 0';
          break;
        }
        case 'io_idle_confirm_ms': {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 0)
            return 'io_idle_confirm_ms must be a non-negative integer';
          break;
        }
        case 'auto_start':
          if (value !== 'true' && value !== 'false') return 'auto_start must be "true" or "false"';
          break;
      }
      return null;
    },
    exec: (ctx, c, args) => {
      const { key, value } = args as { key: string; value: string };
      // Controller 已暴露 config（ConfigRepository）；用带校验的写入
      c.config.set(key as never, value, ctx.actor);
      return { ok: true, key, value };
    },
  },
];

const REGISTRY: CommandRegistry = {
  list: () => [...COMMANDS],
  get: (name) => COMMANDS.find((c) => c.name === name),
};

export { REGISTRY, COMMANDS };
