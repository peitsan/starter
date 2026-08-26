/**
 * 静态 catalog：让测试能 verify server 暴露了正确的 tool/resource/prompt 数量
 * （不在 server.ts 里 export，避免 import server.ts 时连 stdio 一起起）
 */

export const STARTER_TOOL_NAMES = [
  'scan_startup_items',
  'list_startup_items',
  'show_startup_item',
  'enable_startup_item',
  'disable_startup_item',
  'set_delay',
  'set_priority',
  'add_dependency',
  'remove_dependency',
  'list_dependencies',
  'apply_preset',
  'undo_last_change',
  'schedule_run',
  'doctor',
  'io_status',
  'service_status',
  'timeline',
] as const;

export const STARTER_RESOURCE_URIS = [
  'starter://items',
  'starter://timeline',
  'starter://doctor',
] as const;

export const STARTER_PROMPT_NAMES = [
  'optimize_for_io',
  'diagnose_slow_boot',
  'safe_disable_plan',
] as const;
