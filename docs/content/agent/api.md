# MCP API 参考

> 传输方式、资源、prompts、撤销机制的完整参考。

## 传输

- **stdio**：`node packages/mcp/dist/index.js`（默认）
- **SSE**：`STARTER_MCP_SSE=1 node packages/mcp/dist/index.js`（绑 `127.0.0.1:7812/sse`；`--sse` 同效）
  - 端口/绑定：`STARTER_MCP_SSE_PORT` / `STARTER_MCP_SSE_HOST`，默认 `127.0.0.1:7812`
- **Daemon RPC**：`POST /rpc` at `127.0.0.1:7811`（Bearer token）
  - 写操作（enable/disable/set_delay/…）统一走 daemon → HKLM 提权

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

## 常用流

### 1. 查看当前启动项

```text
list_startup_items  →  看所有项
show_startup_item(id)  →  看单项 + 依赖
get_dependency_graph  →  看全图
```

### 2. 优化启动顺序（IO 友好）

```text
list_startup_items({risk:"recommend_off"})  →  找出可优化项
apply_preset({rules:[{match:"onedrive", delay_ms:0, priority:2}], yes:true})
simulate_dry_run()                          →  纯干跑验证
timeline                                    →  看效果
```

### 3. 安全禁用

```text
apply_preset({rules:[{match:"steam", enabled:false}], yes:true})   →  禁一个
undo_last_change({limit:1, yes:true})                               →  反悔回滚
```

### 4. 加"必须等 A 启动后再起 B"

```text
add_dependency({id:"<B-id>", depends_on:"<A-id>", yes:true})  →  加边（自动防环）
remove_dependency({id:"<B-id>", depends_on:"<A-id>", yes:true}) →  删边
```

### 5. 备份 / 恢复配置（F9）

```text
export_config()                                      →  导出快照
import_config({snapshot:"<json>", mode:"merge", yes:true})  →  导入（merge 不覆盖已有）
```

### 6. 诊断慢启动

```text
doctor               →  看整体
schedule_run({real:true, yes:true})  →  真起一次量实际耗时
timeline             →  看谁卡住
```

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

## 同一能力的其他入口

| 入口 | 说明 |
|---|---|
| CLI | `node packages/cli/dist/index.js <cmd>`（写操作同样走 daemon IPC + 本地 fallback） |
| Daemon RPC | `POST /rpc` at 127.0.0.1:7811（Bearer token） |
| MCP | 本页 — 供外部 Agent 用 |
| UI | Tauri EXE（托盘 + 窗口 / 浏览器 preview） |