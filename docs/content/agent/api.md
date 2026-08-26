# MCP API 参考

> 传输方式、资源、prompts、撤销机制的完整参考。

## 传输

- **stdio**：`node packages/mcp/dist/index.js`（默认）
- **SSE**：TODO
- **Daemon RPC**：`POST /rpc` at `127.0.0.1:7811`（Bearer token）

## 常用流

### 1. Agent 查看当前启动项

```text
list_startup_items  →  看所有项
show_startup_item(id)  →  看单项 + 依赖
```

### 2. 优化启动顺序（IO 友好）

```text
list_startup_items({risk: "recommend_off"})  →  找出可优化项
apply_preset([{match:"onedrive", delay_ms:0, priority:2}, ...])
schedule_run({simulated_ms:3000})            →  干跑验证
timeline                                     →  看效果
```

### 3. 安全禁用

```text
apply_preset([{match:"steam", enabled:false}])     →  禁一个
undo_last_change({limit:1})                         →  反悔回滚
```

### 4. 加"必须等 A 启动后再起 B"

```text
add_dependency({id:"<B-id>", depends_on:"<A-id>"})  →  加边（自动防环）
remove_dependency({id:"<B-id>", depends_on:"<A-id>"}) →  删边
```

### 5. 诊断慢启动

```text
doctor               →  看整体
schedule_run({real:true, simulated_ms:0})  →  真起一次量实际耗时
timeline             →  看谁卡住
```

## 资源（3 个）

| URI | 内容 |
| --- | --- |
| `starter://items` | 全部启动项（含 delay/priority/enabled） |
| `starter://timeline` | 最近一次 run 的事件 |
| `starter://doctor` | 自检报告 |

## Prompts（3 个）

| 名称 | 用途 |
| --- | --- |
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

## 同一能力的其他入口

| 入口 | 说明 |
| --- | --- |
| CLI | `node packages/cli/dist/index.js <cmd>`（人性化输出） |
| Daemon RPC | `POST /rpc` at 127.0.0.1:7811（Bearer token） |
| MCP | 本页 — 供外部 Agent 用 |
| UI | Tauri EXE（托盘 + 窗口 / 浏览器 preview） |