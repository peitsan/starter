/**
 * 8 个 CLI 命令：scan / list / show / enable / disable / set-delay / set-priority / doctor
 */

import type { Command } from 'commander';
import { Controller, detectScanner, type Scanner, type StartupItemFilter } from '@starter/core';
import {
  printItems,
  printItem,
  printDoctor,
  printOk,
  printError,
  type CliContext,
} from './output.js';

function makeController(scanner: Scanner | null = null): Controller {
  // 默认启用本机 scanner（仅 Windows 实装）
  const s = scanner ?? (process.platform === 'win32' ? detectScanner() : null);
  return new Controller({ scanner: s });
}

function makeContext(cmd: Command): CliContext {
  const opts = cmd.optsWithGlobals();
  return { json: !!opts.json };
}

export function registerCommands(program: Command): void {
  // scan
  program
    .command('scan')
    .description('rescan startup items and persist to db')
    .option('--no-elevated', 'do not write any registry')
    .action(async (_opts: { elevated?: boolean }) => {
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

  // list
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

  // show
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

  // enable
  program
    .command('enable <id>')
    .description('enable a startup item (writes to registry if HKCU)')
    .option('--yes', 'skip confirmation')
    .action(async (id: string, opts: { yes?: boolean }) => {
      const ctx = makeContext(program);
      const c = makeController();
      try {
        if (!opts.yes) {
          const item = c.show(id);
          if (item === null) {
            printError(ctx, `item not found: ${id}`, 'E_NOT_FOUND');
            return;
          }
          process.stdout.write(`about to enable: ${item.name} (${item.command})\nproceed? [y/N] `);
          // simple stdin read; fall back to skip on non-tty
          const ans = await readLine().catch(() => '');
          if (ans.trim().toLowerCase() !== 'y') {
            printError(ctx, 'cancelled', 'E_CANCEL');
            return;
          }
        }
        const r = await c.enable(id);
        if (r.ok) {
          printOk(ctx, `enabled: ${id}`);
        } else {
          const code =
            r.reason === 'protected'
              ? 'E_PROTECTED'
              : r.reason === 'elevation_required'
                ? 'E_ELEVATION'
                : 'E_OP';
          printError(ctx, `enable failed: ${r.reason}`, code);
        }
      } catch (e) {
        printError(ctx, errMsg(e), 'E_ENABLE');
      } finally {
        c.close();
      }
    });

  // disable
  program
    .command('disable <id>')
    .description('disable a startup item (writes to registry if HKCU)')
    .option('--yes', 'skip confirmation')
    .action(async (id: string, opts: { yes?: boolean }) => {
      const ctx = makeContext(program);
      const c = makeController();
      try {
        if (!opts.yes) {
          const item = c.show(id);
          if (item === null) {
            printError(ctx, `item not found: ${id}`, 'E_NOT_FOUND');
            return;
          }
          process.stdout.write(`about to disable: ${item.name} (${item.command})\nproceed? [y/N] `);
          const ans = await readLine().catch(() => '');
          if (ans.trim().toLowerCase() !== 'y') {
            printError(ctx, 'cancelled', 'E_CANCEL');
            return;
          }
        }
        const r = await c.disable(id);
        if (r.ok) {
          printOk(ctx, `disabled: ${id}`);
        } else {
          const code =
            r.reason === 'protected'
              ? 'E_PROTECTED'
              : r.reason === 'elevation_required'
                ? 'E_ELEVATION'
                : 'E_OP';
          printError(ctx, `disable failed: ${r.reason}`, code);
        }
      } catch (e) {
        printError(ctx, errMsg(e), 'E_DISABLE');
      } finally {
        c.close();
      }
    });

  // set-delay
  program
    .command('set-delay <id> <ms>')
    .description('set startup delay in ms (0 = immediate)')
    .action(async (id: string, msStr: string) => {
      const ctx = makeContext(program);
      const ms = Number(msStr);
      if (!Number.isFinite(ms) || ms < 0) {
        printError(ctx, `invalid delay: ${msStr}`, 'E_ARGS');
        return;
      }
      const c = makeController();
      try {
        const ok = c.setDelay(id, Math.floor(ms));
        if (!ok) {
          printError(ctx, `item not found: ${id}`, 'E_NOT_FOUND');
        } else {
          printOk(ctx, `delay updated: ${id} -> ${Math.floor(ms)}ms`);
        }
      } catch (e) {
        printError(ctx, errMsg(e), 'E_SET_DELAY');
      } finally {
        c.close();
      }
    });

  // set-priority
  program
    .command('set-priority <id> <prio>')
    .description(
      'set process priority (0=idle, 1=low, 2=below-normal, 3=normal, 4=above-normal, 5=high)',
    )
    .action(async (id: string, pStr: string) => {
      const ctx = makeContext(program);
      const p = Number(pStr);
      if (!Number.isInteger(p)) {
        printError(ctx, `invalid priority: ${pStr}`, 'E_ARGS');
        return;
      }
      const c = makeController();
      try {
        const ok = c.setPriority(id, p);
        if (!ok) {
          printError(ctx, `item not found: ${id}`, 'E_NOT_FOUND');
        } else {
          printOk(ctx, `priority updated: ${id} -> ${p}`);
        }
      } catch (e) {
        printError(ctx, errMsg(e), 'E_SET_PRIORITY');
      } finally {
        c.close();
      }
    });

  // doctor
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
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function readLine(): Promise<string> {
  if (!process.stdin.isTTY) return '';
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      process.stdin.off('error', onError);
      resolve(chunk.toString('utf8').trim());
    };
    const onError = (err: Error) => {
      process.stdin.off('data', onData);
      reject(err);
    };
    process.stdin.once('data', onData);
    process.stdin.once('error', onError);
  });
}
