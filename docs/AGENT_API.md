# Starter Agent / MCP API 文档

> 让外部 Agent（Claude / DeepSeek / OpenCode / 自定义 MCP 客户端）**完整操作启动排程表**。
> 所有写操作都会写入审计日志 `op_log`，可用 `undo_last_change` / `revert_preset` 回滚。

## 传输

- **stdio**：`node packages/mcp/dist/index.js`（默认）
- **SSE**：`STARTER_MCP_SSE=1 node packages/mcp/dist/index.js`（绑 `127.0.0.1:7812/sse`；`--sse` 同效）
  - 端口/绑定可用 `STARTER_MCP_SSE_PORT` / `STARTER_MCP_SSE_HOST` 覆盖，默认 `127.0.0.1:7812`，只绑本机回环。

## 写操作走 daemon（RFC-001 §4.7）

MCP/CLI 的**注册表写操作**（enable / disable / set_delay / set_priority / add/remove_dependency）统一路由到 **daemon HTTP RPC**（`127.0.0.1:7811`，Bearer token）：

- daemon 可达 → 走 daemon（统一审计 + HKLM UAC 支持）
- daemon 不可达 → 本地 fallback（同一 SQLite WAL，语义一致）

token 从 `%ProgramData%\Starter\auth.token` 或 `~/.starter/auth.token` 读取。

## 工具一览（27 个）

### 扫描 / 查询（只读）

| 工具 | 作用 |
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
| `get_config` | 读全局配置（含默认来源标注） |
| `list_changes` | 审计日志（所有写操作） |

### 写操作（需 `yes:true` 确认）

| 工具 | 作用 |
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

### 其他

| 工具 | 作用 |
|---|---|
| `export_config` | 导出配置快照（items + deps + config） |
| `simulate_dry_run` | 纯干跑模拟（不起进程） |

### 写操作确认流（RFC-001 §4.6）

**所有写操作都要求 `yes: true`**。不传 `yes` 时返回预览、不执行：

```json
{ "ok": false, "require_yes": true, "preview": { "id": "fp_xxx", "name": "OneDrive" } }
```

Agent 看到 preview 后再带 `yes:true` 重调才真正执行。`schedule_run` 仅在 `real=true` 时要求确认。

## 常用流

### 1. 查看当前启动项

```
list_startup_items  →  看所有项
show_startup_item({id:"<id>"})  →  看单项 + 依赖
get_dependency_graph  →  看全图
```

### 2. 优化启动顺序（IO 友好）

```
list_startup_items({risk:"recommend_off"})  →  找出可优化项
apply_preset({rules:[{match:"onedrive", delay_ms:0, priority:2}], yes:true})
simulate_dry_run()                          →  纯干跑验证
timeline                                    →  看效果
```

### 3. 安全禁用

```
apply_preset({rules:[{match:"steam", enabled:false}], yes:true})   →  禁一个
undo_last_change({limit:1, yes:true})                               →  反悔回滚
```

### 4. 加"必须等 A 启动后再起 B"

```
add_dependency({id:"<B-id>", depends_on:"<A-id>", yes:true})  →  加边（自动防环）
remove_dependency({id:"<B-id>", depends_on:"<A-id>", yes:true}) →  删边
```

### 5. 备份 / 恢复配置（F9）

```
export_config()                                      →  导出快照
import_config({snapshot:"<json>", mode:"merge", yes:true})  →  导入（merge 不覆盖已有）
```

导入模式：`merge`（upsert 覆盖同名）/ `replace`（清空后全量，危险）/ `append`（只加新的）。导入前自动备份 db 到 `starter.db.bak-<ts>`。

### 6. 诊断慢启动

```
doctor               →  看整体
schedule_run({real:true, yes:true})  →  真起一次量实际耗时
timeline             →  看谁卡住
```

## 资源（6 个）

| URI | 内容 |
|---|---|
| `starter://items` | 全部启动项（含 delay/priority/enabled） |
| `starter://timeline` | 最近一次 run 的事件 |
| `starter://doctor` | 自检报告 |
| `starter://config` | 全局配置（含默认来源） |
| `starter://io` | 当前磁盘 IO 采样 |
| `starter://runs/latest` | 最近一次 run 摘要 + 事件 |

## Prompts（5 个）

| 名称 | 用途 |
|---|---|
| `optimize_for_io` | 低 IO 启动顺序 + 延迟建议（含具体 tool 调用） |
| `diagnose_slow_boot` | 慢启动瓶颈分析 |
| `safe_disable_plan` | 安全禁用计划（跳过 Microsoft/驱动类） |
| `find_bloat` | 找臃肿项（高延迟可禁项） |
| `dependency_audit` | 依赖图审计（环/孤点/长链） |

## 撤销（undo）机制

每个写操作（enable/disable/set_delay/set_priority/add_dep/rm_dep/config_set/import）都会在 `op_log` 记录一行：

```json
{ "id": 42, "at": 1787000000000, "actor": "mcp",
  "action": "set_delay", "target": "fp_xxx", "args": {"prev": 0, "next": 5000}, "result": "ok" }
```

`undo_last_change({limit: 5})` 会**从最近的开始**反向执行（set_delay 恢复 prev；disable 恢复 enable；add_dep 变 rm_dep 等），返回每条结果：

```json
{ "ok": true, "reverted": 2, "failed": 0,
  "entries": [ { "id": 42, "action": "set_delay", "target": "fp_xxx", "ok": true } ] }
```

## 安全设计

- **critical 项**：enable/disable 返回 `{ ok:false, reason:"protected" }`，不写入注册表
- **写确认**：全部写操作需 `yes:true`，防止 agent 误操作
- **依赖防环**：`add_dependency` 自动 DFS 检测循环，返回 `cycle_detected`
- **审计**：全部写操作进 `op_log`，可追溯（`list_changes` 查询）
- **DAO 可用性**：`apply_preset` 一个 item 只匹配第一条 rule，避免误伤
- **范围校验**：`set_config` / `set_io_throttle` 写入前校验范围（concurrent_max 1-16、io_busy_threshold_pct 0-100 等）

## 同一能力的其他入口

| 入口 | 说明 |
|---|---|
| CLI | `starter <cmd>`（写操作同样走 daemon IPC + 本地 fallback） |
| Daemon RPC | `POST /rpc` at 127.0.0.1:7811（Bearer token） |
| MCP | 本文件 — 供外部 Agent（含 OpenCode）用 |
| UI | Tauri EXE（托盘 + 窗口 / 浏览器 preview） |
