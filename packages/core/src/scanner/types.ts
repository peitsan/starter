/**
 * 启动项扫描 — 领域类型
 *
 * 这一层不依赖任何平台 API（无 child_process / 无注册表调用），
 * 仅定义"扫描器"应当产出 / 消费的结构。
 */

export const SCHEMA_VERSION = 'v1' as const;

/** 启动项来源：注册表、启动文件夹、计划任务、服务 */
export type Source =
  | 'HKCU_Run'
  | 'HKLM_Run'
  | 'HKCU_RunOnce'
  | 'HKLM_RunOnce'
  | 'StartupFolder'
  | 'CommonStartupFolder'
  | 'TaskScheduler'
  | 'Service';

export type Risk = 'critical' | 'normal' | 'recommend_off';

/** 扫描器产出的统一结构（与 SQLite startup_item 表一一对应） */
export interface ScannedItem {
  /** 在本机上的稳定指纹（source + source_path + name） */
  fingerprint: string;
  name: string;
  /** 完整命令行（含参数），解析失败则填可执行文件路径 */
  command: string;
  /** 可执行文件路径（从 command 解析） */
  exe: string | null;
  /** 命令行参数（数组） */
  args: string[];
  source: Source;
  /** 注册表键 / 文件夹路径 / 任务路径 */
  source_path: string;
  /** 当前是否启用（注册表值非空、文件存在、任务未被禁用） */
  enabled: boolean;
  risk: Risk;
  /** 厂商（解析自 PE 资源；MVP 先返回 null） */
  vendor: string | null;
  /** 扫描时间戳（ms since epoch） */
  scanned_at: number;
}

/** 扫描器实现接口 — 任何平台都实现这个 */
export interface Scanner {
  /** 平台名（"win32" / "darwin" / "linux"） */
  readonly platform: string;
  /** 执行一次扫描；source 过滤可选 */
  scan(opts?: ScanOptions): Promise<ScannedItem[]>;
}

export interface ScanOptions {
  sources?: Source[];
  /** 排除系统关键项，默认 true */
  skipCritical?: boolean;
}

/** 关键项识别：路径含 Windows / Program Files 且厂商为 Microsoft */
export const SYSTEM_VENDORS = new Set(['Microsoft Corporation', 'Microsoft Windows', 'Microsoft']);
