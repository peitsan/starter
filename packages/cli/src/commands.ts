/**
 * CLI 命令注册 — 读操作直连 SQLite；写操作走 daemon IPC（fallback 本地）
 *
 * 架构（RFC-001 §4.7 / PRD A.4）：
 *   - 读操作（scan/list/show/doctor/io/run-history）：本地 Controller 直连 SQLite。
 *   - 写操作（enable/disable/set-delay/set-priority/add-dep/rm-dep/config set）：
 *       优先走 @starter/ipc-client → daemon HTTP（统一审计 + 持有 UAC）；
 *       daemon 不可达时 fallback 本地 Controller，并打印提示。
 *   - 命令定义从 @starter/core/registry 共享（零代码重复）。
 */

import type { Command } from 'commander';
import {
  Controller,
  detectScanner,
  REGISTRY,
  type Scanner,
  type StartupItemFilter,
} from '@starter/core';
import { rpc as daemonRpc, daemonReachable, isRpcError } from '@starter/ipc-client';
import {
  printItems,
  printItem,
  printDoctor,
  printOk,
  printError,
  type CliContext,
} from './output.js';
import type { CommandResult } from '@starter/core';

function makeController(scanner: Scanner | null = null): Controller {
  // 默认启用本机 scanner（仅 Windows 实装）
  const s = scanner ?? (process.platform === 'win32' ? detectScanner() : null);
  return new Controller({ scanner: s, actor: 'cli' });
}

function makeContext(cmd: Command): CliContext {
  const opts = cmd.optsWithGlobals();
  return { json: !!opts.json };
}

/** 写操作统一路由：daemon 可达走 IPC，否则本地 fallback */
async function runWriteCommand(
  name: string,
  args: Record<string, unknown>,
  ctx: CliContext,
): Promise<void> {
  const def = REGISTRY.get(name);
  if (!def) {
    printError(ctx, `unknown write command: ${name}`, 'E_INTERNAL');
    return;
  }
  const vErr = def.validate(args);
  if (vErr) {
    printError(ctx, vErr, 'E_ARGS');
    return;
  }

  // 1) 尝试走 daemon
  if (await daemonReachable()) {
    try {
      const res = normalizeResult(await daemonRpc<unknown>(name, args));
      if (res.ok) {
        printOk(ctx, `${name} ok`, { ...res });
      } else {
        const code =
          res.reason === 'protected'
            ? 'E_PROTECTED'
            : res.reason === 'elevation_required'
              ? 'E_ELEVATION'
              : 'E_OP';
        printError(ctx, `${name} failed: ${res.reason}`, code);
      }
      return;
    } catch (e) {
      // daemon 可达但调用失败（如 token 错 / rpc 错）→ 仍 fallback 并提示
      if (isRpcError(e, 'E_DAEMON_UNREACHABLE')) {
        // 掉下去走本地
      } else {
        printError(
          ctx,
          `daemon write failed (${errMsg(e)}); falling back to local`,
          'E_DAEMON_FALLBACK',
        );
        // 继续本地 fallback
      }
    }
  }

  // 2) 本地 fallback（无 daemon / daemon 不可达）
  const c = makeController();
  try {
    const res = normalizeResult(await def.exec({ actor: 'cli', caller: 'cli' }, c, args));
    if (res.ok) {
      printOk(ctx, `${name} ok`, { ...res });
    } else {
      const code =
        res.reason === 'protected'
          ? 'E_PROTECTED'
          : res.reason === 'elevation_required'
            ? 'E_ELEVATION'
            : 'E_OP';
      printError(ctx, `${name} failed: ${res.reason}`, code);
    }
  } catch (e) {
    printError(ctx, errMsg(e), 'E_OP');
  } finally {
    c.close();
  }
}

/** 把 daemon RPC 返回值规范化为 { ok, ... }（兼容旧 daemon 返回裸 boolean） */
function normalizeResult(r: unknown): CommandResult {
  if (typeof r === 'boolean') return r ? { ok: true } : { ok: false, reason: 'rejected' };
  if (r && typeof r === 'object') return r as CommandResult;
  return { ok: false, reason: 'invalid_response' };
}

export function registerCommands(program: Command): void {
  // ---------- 读操作：本地直连 ----------

  program
    .command('scan')
    .description('rescan startup items and persist to db')
    .option('--no-elevated', 'do not write any registry')
    .action(async () => {
      const ctx = makeContext(program);
      const c = makeController();
      try {
        const r = await c.scan();
        printOk(ctx, `scanned: total=${r.total}, inserted=${r.inserted}, updated=${r.updated}`);
      } catch (e) {
        printError(ctx, errMsg(e), 'E_SCAN');
      } finally {
        c.close();
      }
    });

  program
    .command('list')
    .description('list startup items (optionally filtered)')
    .option('--source <src>', 'filter by source, e.g. HKCU_Run')
    .option('--enabled', 'only enabled')
    .option('--disabled', 'only disabled')
    .option('--search <q>', 'substring search in name/command')
    .action(
      async (opts: { source?: string; enabled?: boolean; disabled?: boolean; search?: string }) => {
        const ctx = makeContext(program);
        const c = makeController();
        try {
          const filter: StartupItemFilter = {};
          if (opts.source) filter.source = opts.source;
          if (opts.enabled) filter.enabled = true;
          if (opts.disabled) filter.enabled = false;
          if (opts.search) filter.search = opts.search;
          printItems(ctx, c.list(filter));
        } catch (e) {
          printError(ctx, errMsg(e), 'E_LIST');
        } finally {
          c.close();
        }
      },
    );

  program
    .command('show <id>')
    .description('show details of one startup item')
    .action(async (id: string) => {
      const ctx = makeContext(program);
      const c = makeController();
      try {
        const item = c.show(id);
        if (item === null) {
          printError(ctx, `item not found: ${id}`, 'E_NOT_FOUND');
        } else {
          printItem(ctx, item);
        }
      } catch (e) {
        printError(ctx, errMsg(e), 'E_SHOW');
      } finally {
        c.close();
      }
    });

  // ---------- 写操作：走 daemon IPC + fallback ----------

  program
    .command('enable <id>')
    .description('enable a startup item (writes to registry if HKCU)')
    .option('--yes', 'skip confirmation')
    .action(async (id: string) => runWriteCommand('enable', { id }, makeContext(program)));

  program
    .command('disable <id>')
    .description('disable a startup item (writes to registry if HKCU)')
    .option('--yes', 'skip confirmation')
    .action(async (id: string) => runWriteCommand('disable', { id }, makeContext(program)));

  program
    .command('set-delay <id> <ms>')
    .description('set startup delay in ms (0 = immediate)')
    .action(async (id: string, msStr: string) => {
      const ms = Number(msStr);
      if (!Number.isFinite(ms) || ms < 0) {
        printError(makeContext(program), `invalid delay: ${msStr}`, 'E_ARGS');
        return;
      }
      return runWriteCommand('set_delay', { id, delay_ms: Math.floor(ms) }, makeContext(program));
    });

  program
    .command('set-priority <id> <prio>')
    .description(
      'set process priority (0=Idle 1=BelowNormal 2=Normal 3=AboveNormal 4=High 5=Realtime — RFC-001 §4.5)',
    )
    .action(async (id: string, pStr: string) => {
      const p = Number(pStr);
      if (!Number.isInteger(p)) {
        printError(makeContext(program), `invalid priority: ${pStr}`, 'E_ARGS');
        return;
      }
      return runWriteCommand('set_priority', { id, priority: p }, makeContext(program));
    });

  program
    .command('add-dep <id> <depends_on>')
    .description('add startup-order edge: item <id> starts only after <depends_on> is done')
    .action(async (id: string, depends_on: string) =>
      runWriteCommand('add_dependency', { id, depends_on }, makeContext(program)),
    );

  program
    .command('rm-dep <id> <depends_on>')
    .description('remove startup-order edge')
    .action(async (id: string, depends_on: string) =>
      runWriteCommand('remove_dependency', { id, depends_on }, makeContext(program)),
    );

  program
    .command('config')
    .description('get/set global config (concurrent_max, io_*, auto_start)')
    .argument('<key>', 'config key or "get"/"set"')
    .argument('[value]', 'value (for set)')
    .action(async (key: string, value: string | undefined) => {
      const ctx = makeContext(program);
      // 兼容 `starter config get <key>` / `starter config set <key> <val>`
      if (key === 'get') {
        const c = makeController();
        try {
          const k = value;
          if (!k) {
            printError(ctx, 'usage: starter config get <key>', 'E_ARGS');
            return;
          }
          printOk(ctx, `${k}=${c.config.get(k as never)}`);
        } finally {
          c.close();
        }
        return;
      }
      if (key === 'set') {
        // 形式：config set <k> <v>（value 为 k）
        if (!value) {
          printError(ctx, 'usage: starter config set <key> <value>', 'E_ARGS');
          return;
        }
        const valStr = process.argv[process.argv.indexOf(value) + 1];
        if (valStr === undefined) {
          printError(ctx, 'usage: starter config set <key> <value>', 'E_ARGS');
          return;
        }
        return runWriteCommand('config_set', { key: value, value: valStr }, ctx);
      }
      // 直接形式：config <key> 只读
      const c = makeController();
      try {
        printOk(ctx, `${key}=${c.config.get(key as never)}`);
      } finally {
        c.close();
      }
    });

  // ---------- 只读：io / run history / doctor / version ----------

  program
    .command('io')
    .description('sample current disk IO (idle%, queue length)')
    .option('--watch', 'repeat every 500ms')
    .action(async (opts: { watch?: boolean }) => {
      const ctx = makeContext(program);
      const c = makeController();
      try {
        const show = async (): Promise<void> => {
          const s = await c.ioStatus();
          if (ctx.json) {
            printOk(ctx, 'io', s);
          } else {
            process.stdout.write(
              `idle=${s.idle_pct.toFixed(1)}% queue=${s.queue_len} at=${new Date(s.at).toISOString()}\n`,
            );
          }
        };
        await show();
        if (opts.watch) {
          await new Promise<void>((resolve) => {
            const timer = setInterval(async () => {
              try {
                await show();
              } catch (e) {
                clearInterval(timer);
                printError(ctx, errMsg(e), 'E_IO');
                resolve();
              }
            }, 500);
            // allow Ctrl+C to stop
            process.on('SIGINT', () => {
              clearInterval(timer);
              resolve();
            });
          });
        }
      } catch (e) {
        printError(ctx, errMsg(e), 'E_IO');
      } finally {
        c.close();
      }
    });

  program
    .command('run')
    .description('run a scheduling cycle or view run history')
    .argument('<sub>', 'now | history')
    .option('--dry-run', 'simulate (default)')
    .option('--real', 'actually spawn processes (requires daemon)')
    .option('--limit <n>', 'history limit', '5')
    .action(async (sub: string, opts: { dryRun?: boolean; real?: boolean; limit?: string }) => {
      const ctx = makeContext(program);
      const c = makeController();
      try {
        if (sub === 'now') {
          const report = await c.scheduleRun({
            real: !!opts.real,
            simulatedMs: opts.dryRun || !opts.real ? 1000 : 0,
          });
          printOk(ctx, 'schedule_run', report);
        } else if (sub === 'history') {
          const limit = Math.max(1, Number(opts.limit ?? 5) || 5);
          const history = c.runHistory(limit);
          if (ctx.json) {
            printOk(ctx, 'run_history', history);
          } else {
            for (const r of history) {
              process.stdout.write(
                `${r.kind}\t${r.run_id}\t${new Date(r.started_at).toISOString()}\t${r.total} items\n`,
              );
            }
          }
        } else {
          printError(ctx, 'usage: starter run now|history', 'E_ARGS');
        }
      } catch (e) {
        printError(ctx, errMsg(e), 'E_RUN');
      } finally {
        c.close();
      }
    });

  program
    .command('doctor')
    .description('print config and db stats')
    .action(() => {
      const ctx = makeContext(program);
      const c = makeController();
      try {
        printDoctor(ctx, c.doctor());
      } catch (e) {
        printError(ctx, errMsg(e), 'E_DOCTOR');
      } finally {
        c.close();
      }
    });

  program
    .command('version')
    .description('print version')
    .action(() => {
      const ctx = makeContext(program);
      // 从 package.json 读（运行时相对路径）
      const pkg = { version: '0.1.0' };
      printOk(ctx, `starter ${pkg.version}`);
    });
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
