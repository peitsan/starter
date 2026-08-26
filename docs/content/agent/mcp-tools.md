# MCP 工具一览（17 个）

> 让外部 Agent（Claude / DeepSeek / 自定义 MCP 客户端）**完整操作启动排程表**。所有写操作写入审计日志 `op_log`，可用 `undo_last_change` 回滚。

## 工具表

| Tool 名称 | 作用 | 写操作 |
| --- | --- | --- |
| `scan_startup_items` | 重扫注册表/启动文件夹并入 db | ✅ 扫描 |
| `list_startup_items` | 列表（按 source/enabled/risk/search 过滤） | — |
| `show_startup_item` | 单个项目详情 + 依赖边 | — |
| `enable_startup_item` | 启用（写注册表） | ✅ |
| `disable_startup_item` | 禁用（写注册表） | ✅ |
| `set_delay` | 设延迟 ms（0=立即） | ✅ |
| `set_priority` | 设优先级 0-5 | ✅ |
| `add_dependency` | 加启动顺序边 `id 在 depends_on 之后` | ✅ |
| `remove_dependency` | 删启动顺序边 | ✅ |
| `list_dependencies` | 列出 inbound/outbound 依赖 | — |
| `apply_preset` | 按 name 匹配批量改 delay/priority/enabled | ✅ |
| `undo_last_change` | 回滚最近 N 条可逆变更 | ✅ |
| `schedule_run` | 跑一次调度（默认模拟，`real=true` 真起进程） | ✅ |
| `doctor` | 自检（数量/config/平台） | — |
| `io_status` | 采样磁盘 IO（idle%/队列） | — |
| `service_status` | `sc query StarterDaemon` | — |
| `timeline` | 最近一次 run 的事件 | — |

## 必填参数

| Tool | 必填 |
| --- | --- |
| `show_startup_item` | `id` |
| `enable_startup_item` / `disable_startup_item` | `id` |
| `set_delay` | `id`, `delay_ms` |
| `set_priority` | `id`, `priority` |
| `add_dependency` | `id`, `depends_on` |
| `remove_dependency` | `id`, `depends_on` |
| `list_dependencies` | `id` |
| `apply_preset` | `rules` |
| `undo_last_change` | `limit?` |
| `schedule_run` | `real?`, `simulated_ms?` |
| `timeline` | `limit?` |

> 详细流与 JSON 示例见 [MCP API 参考](api)。