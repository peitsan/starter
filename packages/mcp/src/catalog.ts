/**
 * 静态 catalog：让测试能 verify server 暴露了正确的 tool/resource/prompt 数量
 * （不在 server.ts 里 export，避免 import server.ts 时连 stdio 一起起）
 */

export const STARTER_TOOL_NAMES = [
  'scan_startup_items',
  'list_startup_items',
  'enable_startup_item',
  'disable_startup_item',
  'set_delay',
] as const;

export const STARTER_RESOURCE_URIS = ['starter://items'] as const;

export const STARTER_PROMPT_NAMES = ['optimize_for_io'] as const;
