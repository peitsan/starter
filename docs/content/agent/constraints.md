# 约束 & 安全

> Agent 操作 Starter 时必须遵守的规则。

## 硬性约束

1. **不要关 critical 项**（会破坏系统安全）— `enable/disable` 对 critical 返回 `protected`
2. **修改注册表前先 scan + show 确认**（避免误操作）
3. **HKLM 项写操作需要管理员权限**（返回 `elevation_required`）
4. **延迟单位是毫秒**（不是秒）
5. **`schedule_run` 默认模拟**（写 `startup_run_event` 表）；`real:true` 真起进程（`cmd /c start /B /priority`）
6. **依赖边自动防环**：`add_dependency` 检测到循环返回 `cycle_detected`
7. **所有写操作可撤销**：`undo_last_change` 会反向执行最近的变更

## 5s+ 延迟注意

> **5s+ 延迟的项需要先 `set_delay` 再让 Starter 接管**（系统不读我们的 SQLite）。

## 审计

- 所有写操作进入 SQLite `op_log` 表，可追溯
- 要审计时：

```sql
SELECT * FROM op_log ORDER BY id DESC LIMIT 20;
```

## 安全设计

- **critical 项**：enable/disable 返回 `{ ok:false, reason:"protected" }`，不写入注册表
- **依赖防环**：`add_dependency` 自动 DFS 检测循环
- **DAO 可用性**：`apply_preset` 一个 item 只匹配第一条 rule，避免误伤

## 数据位置

- **用户数据**：`%USERPROFILE%\.starter\starter.db`（SQLite）
- **代码**：`G:\Starter\packages\{core,cli,mcp,ipc-client}`