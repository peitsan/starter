# 接入 LLM Agent

> Starter 内置 **MCP Server**，让 Cursor / Claude Desktop / DSH 里的 AI 代理通过自然语言直接操作你的启动排程表。

## 为什么用 MCP？

不用 MCP，你需要在表格 / 命令行里手动操作每个启动项。接入 MCP 后，你的 AI 编辑器能：

- 扫描、查询、启用 / 禁用 / 延迟 / 排序你的启动项
- 理解"IO 高"并自动生成优化方案
- 所有写操作自动审计、可撤销

## 配置

在 **Cursor** / **Claude Desktop** 的 MCP 配置中加：

```json
{
  "mcpServers": {
    "starter": {
      "command": "node",
      "args": ["<仓库绝对路径>/packages/mcp/dist/index.js"]
    }
  }
}
```

## 你能做什么

接入后，直接对 AI 说：

| 你说 | AI 会做什么 |
| --- | --- |
| "扫一下我电脑的启动项" | 调 `scan_startup_items` |
| "把所有 IO 高的启动项延迟 60 秒" | `list_startup_items` → `set_delay` 或 `apply_preset` |
| "OneDrive 必须第一个起，VS Code 等它完成再起" | `add_dependency`（自动防环） |
| "把 Steam 关掉" | `list_startup_items` → `disable_startup_item` |
| "我启动太慢了，帮我优化" | `diagnose_slow_boot` → `apply_preset` |
| "反悔，撤销我上次的改动" | `undo_last_change` |
| "现在磁盘 IO 怎么样？" | `io_status` / 读 `starter://doctor` |
| "模拟跑一次调度看效果" | `schedule_run(simulated_ms=3000)` → 读 `starter://timeline` |

## 能力清单

MCP Server 暴露 **27 个工具 + 6 个资源 + 5 个 prompts**，完整参考见：

- 🤖 **Agent 模式** → [工具一览](/agent/mcp-tools) / [MCP API 参考](/agent/api)
- 👤 人类版摘要 → [CLI 指南](cli)

## 传输方式

- **stdio**：`node packages/mcp/dist/index.js`（默认）
- **SSE**：`STARTER_MCP_SSE=1 node packages/mcp/dist/index.js`（绑 `127.0.0.1:7812/sse`；`--sse` 同效）
- **Daemon RPC**：`POST /rpc` at `127.0.0.1:7811`（Bearer token）
  - 写操作统一走 daemon（统一审计 + HKLM 提权），daemon 不可达时本地 fallback
