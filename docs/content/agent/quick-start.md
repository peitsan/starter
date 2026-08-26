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

接入后你有 **27 个 tool + 6 个 resource + 5 个 prompt**。

## 2. 完成一个任务（示例：把 OneDrive 设为最高优先级且第一个启动）

```text
1. list_startup_items(search="OneDrive")        → 拿到 fingerprint id
2. set_priority({id, priority:2, yes:true})      → 优先级 2
3. add_dependency({id, depends_on, yes:true})    → 排序
4. simulate_dry_run()                            → 干跑验证
5. timeline                                       → 看效果
```

## 3. 常见入口速查

| 想做什么 | 先调 |
|---|---|
| 看全部启动项 | `list_startup_items` |
| 看单项 + 依赖 | `show_startup_item(id)` |
| 找出可优化项 | `list_startup_items({risk:"recommend_off"})` |
| 自检 | `doctor` |
| 看磁盘 IO | `io_status` |
| 看全局配置 | `get_config` |
| 看审计日志 | `list_changes` |
| 导出备份 | `export_config` |
| 导入恢复 | `import_config({snapshot, mode, yes:true})` |

## 重要提醒

- 所有写操作进 `op_log`，可撤销（`undo_last_change` / `revert_preset`）
- critical 项不可禁用 → `E_PROTECTED`
- HKLM 写需要管理员 → `E_ELEVATION_REQUIRED`（装 daemon 后自动走提权）
- 延迟单位是**毫秒**