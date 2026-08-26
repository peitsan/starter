/**
 * 启动项行的人类可读格式化
 */
import type { StartupItemRow } from '@starter/core';

const SOURCE_PAD = 18;
const NAME_PAD = 24;
const RISK_PAD = 15;
const PRIO_PAD = 2;

export function formatItemRow(r: StartupItemRow, _opts: { color?: boolean } = {}): string {
  const state = r.enabled ? 'ON ' : 'off';
  const delay = r.delay_ms === 0 ? '-' : `${(r.delay_ms / 1000).toFixed(1)}s`;
  const cmd = r.command.length > 60 ? r.command.slice(0, 57) + '...' : r.command;
  return [
    state,
    `[${r.source.padEnd(SOURCE_PAD)}]`,
    r.name.padEnd(NAME_PAD),
    `risk=${r.risk.padEnd(RISK_PAD)}`,
    `delay=${delay.padEnd(8)}`,
    `prio=${String(r.priority).padEnd(PRIO_PAD)}`,
    cmd,
  ].join(' ');
}

export function formatItemTable(items: StartupItemRow[]): string {
  if (items.length === 0) return '(no items)';
  const lines = items.map((r) => formatItemRow(r));
  return lines.join('\n');
}

export function formatItemDetail(r: StartupItemRow): string {
  return [
    `id:           ${r.id}`,
    `name:         ${r.name}`,
    `source:       ${r.source}`,
    `source_path:  ${r.source_path}`,
    `enabled:      ${r.enabled ? 'yes' : 'no'}`,
    `risk:         ${r.risk}`,
    `delay_ms:     ${r.delay_ms}`,
    `priority:     ${r.priority}`,
    `vendor:       ${r.vendor ?? '(unknown)'}`,
    `command:      ${r.command}`,
    `updated_at:   ${new Date(r.updated_at).toISOString()}`,
  ].join('\n');
}

export function formatDoctor(d: {
  platform: string;
  dbPath: string;
  itemCount: number;
  enabledCount: number;
  config: {
    concurrent_max: number;
    io_busy_threshold_pct: number;
    io_queue_threshold: number;
    io_idle_confirm_ms: number;
    auto_start: boolean;
  };
}): string {
  return [
    `platform:     ${d.platform}`,
    `db:           ${d.dbPath}`,
    `items:        ${d.itemCount} (${d.enabledCount} enabled)`,
    `config:`,
    `  concurrent_max:        ${d.config.concurrent_max}`,
    `  io_busy_threshold_pct: ${d.config.io_busy_threshold_pct}`,
    `  io_queue_threshold:    ${d.config.io_queue_threshold}`,
    `  io_idle_confirm_ms:    ${d.config.io_idle_confirm_ms}`,
    `  auto_start:            ${d.config.auto_start}`,
  ].join('\n');
}
