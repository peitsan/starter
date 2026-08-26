# MCP 工具一览（27 个）

> 让外部 Agent（Claude / DeepSeek / 自定义 MCP 客户端）**完整操作启动排程表**。所有写操作写入审计日志 `op_log`，可用 `undo_last_change` / `revert_preset` 回滚。

## 扫描 / 查询（只读）

| Tool 名称 | 作用 |
|---|---|
| `scan_startup_items` | 重扫注册表/启动文件夹并入 db |
| `list_startup_items` | 列表（按 source/enabled/risk/search 过滤） |
| `show_startup_item` | 单个项目详情 + 依赖边 |
| `list_dependencies` | 列出 inbound/outbound 依赖 |
| `get_dependency_graph` | 全量依赖图（节点 + 边） |
| `doctor` | 自检（数量/config/平台） |
| `io_status` | 采样磁盘 IO（idle%/队列） |
| `service_status` | `sc query StarterDaemon` |
| `timeline` | 最近一次 run 的事件 |
| `get_run_history` | 最近 N 次 run 摘要 |
| `get_config` | 读全局配置（含默认来源） |
| `list_changes` | 审计日志（所有写操作） |

## 写操作（需 `yes:true` 确认）

| Tool 名称 | 作用 |
|---|---|
| `enable_startup_item` / `disable_startup_item` | 启用/禁用（写注册表，走 daemon） |
| `set_delay` | 设延迟 ms（0=立即，24h 上限） |
| `set_priority` | 设优先级 0-5（RFC-001 §4.5） |
| `add_dependency` / `remove_dependency` | 加/删启动顺序边（走 daemon） |
| `apply_preset` | 按 name 匹配批量改 delay/priority/enabled |
| `undo_last_change` | 回滚最近 N 条可逆变更 |
| `revert_preset` | 回滚最近一次批量变更（= undo limit=1） |
| `schedule_run` | 跑调度（`real=true` 才真起进程，需 `yes`） |
| `set_config` | 写全局配置键（校验范围） |
| `import_config` | 导入配置快照（merge/replace/append） |
| `set_io_throttle` | 快捷设 IO 节流阈值 |

## 其他

| Tool 名称 | 作用 |
|---|---|
| `export_config` | 导出配置快照（items + deps + config） |
| `simulate_dry_run` | 纯干跑模拟（不起进程） |

## 写操作确认流

所有写操作要求 `yes:true`。不传时返回预览、不执行。

## 必填参数

| Tool | 必填 |
|---|---|
| `show_startup_item` | `id` |
| `enable_startup_item` / `disable_startup_item` | `id` |
| `set_delay` | `id`, `delay_ms` |
| `set_priority` | `id`, `priority` |
| `add_dependency` / `remove_dependency` | `id`, `depends_on` |
| `list_dependencies` | `id` |
| `apply_preset` | `rules` |
| `undo_last_change` / `revert_preset` | `limit?` / `yes` |
| `schedule_run` / `simulate_dry_run` | `real?`, `simulated_ms?` |
| `set_config` | `key`, `value` |
| `set_io_throttle` | `busy_threshold_pct?` / `queue_threshold?` / `idle_confirm_ms?` |
| `import_config` | `snapshot`, `mode?` |
| `timeline` / `list_changes` / `get_run_history` | `limit?` |

> 详细流与 JSON 示例见 [MCP API 参考](api)。