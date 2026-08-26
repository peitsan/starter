// @starter/core — domain types & schema-version constants
export const SCHEMA_VERSION = 'v1' as const;

export type Risk = 'critical' | 'normal' | 'recommend_off';
export type Source = 'HKCU_Run' | 'HKLM_Run' | 'StartupFolder' | 'TaskScheduler' | 'Service';
export type Priority = 'idle' | 'low' | 'normal' | 'high';

export interface StartupItem {
  id: string;
  name: string;
  command: string;
  source: Source;
  source_path: string;
  enabled: boolean;
  delay_ms: number;
  priority: Priority;
  risk: Risk;
  vendor: string | null;
  updated_at: number;
}

export interface AppConfig {
  schema_version: typeof SCHEMA_VERSION;
  concurrent_max: number;
  io_queue_threshold: number;
  io_busy_threshold_pct: number;
  io_idle_confirm_ms: number;
  auto_start: boolean;
}
