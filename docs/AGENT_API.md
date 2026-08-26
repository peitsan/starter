# Starter Agent / MCP API 文档

> 让外部 Agent（Claude / DeepSeek / 自定义 MCP 客户端）**完整操作启动排程表**。
> 所有写操作都会写入审计日志 `op_log`，可用 `undo_last_change` 回滚。

## 传输

- **stdio**：`node packages/mcp/dist/index.js`（默认）
- SSE：TODO

## 工具一览（17 个）

| 工具 | 作用 | 写操作 |
|---|---|---|
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

## 常用流

### 1. Agent 查看当前启动项

```
list_startup_items  →  看所有项
show_startup_item(id)  →  看单项 + 依赖
```

### 2. 优化启动顺序（IO 友好）

```
list_startup_items({risk: "recommend_off"})  →  找出可优化项
apply_preset([{match:"onedrive", delay_ms:0, priority:2}, ...])
schedule_run({simulated_ms:3000})            →  干跑验证
timeline                                     →  看效果
```

### 3. 安全禁用

```
apply_preset([{match:"steam", enabled:false}])     →  禁一个
undo_last_change({limit:1})                         →  反悔回滚
```

### 4. 加"必须等 A 启动后再起 B"

```
add_dependency({id:"<B-id>", depends_on:"<A-id>"})  →  加边（自动防环）
remove_dependency({id:"<B-id>", depends_on:"<A-id>"}) →  删边
```

### 5. 诊断慢启动

```
doctor               →  看整体
schedule_run({real:true, simulated_ms:0})  →  真起一次量实际耗时
timeline             →  看谁卡住
```

## 资源

| URI | 内容 |
|---|---|
| `starter://items` | 全部启动项（含 delay/priority/enabled） |
| `starter://timeline` | 最近一次 run 的事件 |
| `starter://doctor` | 自检报告 |

## Prompts

| 名称 | 用途 |
|---|---|
| `optimize_for_io` | 低 IO 启动顺序 + 延迟建议（含具体 tool 调用） |
| `diagnose_slow_boot` | 慢启动瓶颈分析 |
| `safe_disable_plan` | 安全禁用计划（跳过 Microsoft/驱动类） |

## 撤销（undo）机制

每个写操作（enable/disable/set_delay/set_priority/add_dep/rm_dep）都会在 `op_log` 记录一行：

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
- **依赖防环**：`add_dependency` 自动 DFS 检测循环，返回 `cycle_detected`
- **审计**：全部写操作进 `op_log`，可追溯
- **DAO 可用性**：`apply_preset` 一个 item 只匹配第一条 rule，避免误伤

## 同一能力的其他入口

| 入口 | 说明 |
|---|---|
| CLI | `node packages/cli/dist/index.js <cmd>`（人性化输出） |
| Daemon RPC | `POST /rpc` at 127.0.0.1:7811（Bearer token） |
| MCP | 本文件 — 供外部 Agent 用 |
| UI | Tauri EXE（托盘 + 窗口 / 浏览器 preview） |