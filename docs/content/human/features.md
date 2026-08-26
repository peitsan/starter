# 核心特性

Starter 通过 12 个特性（F1–F12）解决 Windows 启动管理的问题。下面是核心能力一览。

## F1 — 启动项扫描 📊

把分散在注册表与启动文件夹里的自启项，统一归入一张表：

- 注册表 `Run` / `RunOnce`（`HKCU` / `HKLM`）
- 启动文件夹 / 公共启动文件夹
- 每个项带稳定的 **fingerprint** 与 **风险分级**

```bash
node packages/cli/dist/index.js scan
node packages/cli/dist/index.js list --search OneDrive
```

## F2 — 启 / 停 ⏯

启停某个启动项（写注册表，HKCU 立即生效；HKLM 需提权）。

## F3 — 延迟启动 ⏱

给某个启动项设置登录后多久才允许启动（单位毫秒）。

```bash
node packages/cli/dist/index.js set-delay <id> 30000   # 延迟 30 秒
```

## F4 — DAG 依赖 🧩

定义"必须先 A 后 B"的启动顺序，自动检测并阻止循环依赖。

## F5 — 并发控制 ⚡

限制同一时刻启动的项数，避免开机瞬间资源争抢。

## F6 — IO 感知节流 ⭐

**核心差异化能力**：持续采样磁盘 IO（队列长度 + 活动时间双阈值），磁盘繁忙时**自动暂停**下一批启动项，IO 恢复后再续跑。这是它跟系统自带启动管理的最大区别。

## F11 — CLI 命令行 ⌨️

8 个稳定命令，全部支持 `--json` 机器可读输出。详见 [CLI 指南](cli)。

## F12 — MCP Server 🤖

让 LLM Agent（Cursor / Claude Desktop / DSH）通过 **17 个工具 + 3 资源 + 3 prompts** 完整操作启动排程表。详见 [接入 LLM Agent](mcp)。

## 🔒 安全设计

- **可审计**：所有写操作进入 SQLite `op_log` 表
- **可撤销**：`undo_last_change` 反向执行最近的可逆变更
- **硬保护**：critical 项（Microsoft Defender 等）不可禁用
- **防环**：依赖图自动 DFS 检测循环
