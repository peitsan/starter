# Agent 30 秒上手

> 最快路径：接入 MCP 并完成一个完整任务。

## 1. 接入

在 Cursor / Claude Desktop 的 MCP 配置里加：

```json
{
  "mcpServers": {
    "starter": {
      "command": "node",
      "args": ["C:/path/to/starter/packages/mcp/dist/index.js"]
    }
  }
}
```

接入后你有 **17 个 tool + 3 个 resource + 3 个 prompt**。

## 2. 完成一个任务（示例：把 OneDrive 设为最高优先级且第一个启动）

```text
1. list_startup_items(search="OneDrive")        → 拿到 fingerprint id
2. set_priority(id, 2)                           → 优先级 2
3. add_dependency(id, depends_on) 或 无需       → 排序
4. schedule_run(simulated_ms=3000)               → 干跑验证
5. timeline                                       → 看效果
```

## 3. 常见入口速查

| 想做什么 | 先调 |
| --- | --- |
| 看全部启动项 | `list_startup_items` |
| 看单项 + 依赖 | `show_startup_item(id)` |
| 找出可优化项 | `list_startup_items({risk:"recommend_off"})` |
| 自检 | `doctor` |
| 看磁盘 IO | `io_status` |

## 重要提醒

- 所有写操作进 `op_log`，可撤销（`undo_last_change`）
- critical 项不可禁用 → `E_PROTECTED`
- HKLM 写需要管理员 → `E_ELEVATION_REQUIRED`
- 延迟单位是**毫秒**
