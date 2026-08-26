/**
 * CLI 统一输出：
 *  - 默认人类可读
 *  - --json 时输出稳定 JSON
 *  - 错误统一走 stderr
 */

import type { StartupItemRow, DoctorReport } from '@starter/core';
import { formatItemTable, formatItemDetail, formatDoctor } from './format.js';

export interface CliContext {
  json: boolean;
}

export function printItems(ctx: CliContext, items: StartupItemRow[]): void {
  if (ctx.json) {
    process.stdout.write(JSON.stringify({ ok: true, items }, null, 2) + '\n');
  } else {
    process.stdout.write(formatItemTable(items) + '\n');
  }
}

export function printItem(ctx: CliContext, item: StartupItemRow | null): void {
  if (ctx.json) {
    process.stdout.write(JSON.stringify({ ok: item !== null, item }, null, 2) + '\n');
  } else if (item === null) {
    process.stderr.write('not found\n');
  } else {
    process.stdout.write(formatItemDetail(item) + '\n');
  }
}

export function printDoctor(ctx: CliContext, d: DoctorReport): void {
  if (ctx.json) {
    process.stdout.write(JSON.stringify({ ok: true, doctor: d }, null, 2) + '\n');
  } else {
    process.stdout.write(formatDoctor(d) + '\n');
  }
}

export function printOk(ctx: CliContext, message: string, data?: unknown): void {
  if (ctx.json) {
    process.stdout.write(JSON.stringify({ ok: true, message, data }, null, 2) + '\n');
  } else {
    process.stdout.write(message + '\n');
  }
}

export function printError(ctx: CliContext, message: string, code: string = 'E_GENERIC'): void {
  const payload = { ok: false, error: { code, message } };
  if (ctx.json) {
    process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stderr.write(`error [${code}]: ${message}\n`);
  }
  process.exitCode = exitCodeFor(code);
}

function exitCodeFor(code: string): number {
  switch (code) {
    case 'E_NOT_FOUND':
      return 2;
    case 'E_ARGS':
      return 2;
    case 'E_PROTECTED':
      return 3;
    case 'E_ELEVATION':
      return 4;
    case 'E_INTERNAL':
      return 5;
    default:
      return 1;
  }
}
