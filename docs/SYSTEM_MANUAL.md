# 系统手册（System Manual）

> 面向**部署 / 运维 / 管理员**：告诉你 Starter 是什么、怎么装、怎么配、怎么用、怎么排查。
> 开发者请看 [开发手册](developer-manual.md)。

---

## 1. 这是什么

Starter 是一个 **Windows 启动项管理器**。与系统自带「任务管理器 → 启动」相比，它解决三类痛点：

| 痛点 | Starter 的方案 |
|---|---|
| 多盘 IO 冲突导致开机卡死 | **F6 IO 感知节流** — 磁盘繁忙自动暂停下一批启动项 |
| 想让某些软件晚点起 / 排队起 | **F3 延迟启动 + F4 DAG 依赖 + F5 并发控制** |
| 想用 LLM 直接改启动项 | **F12 MCP Server** — Cursor / Claude Desktop 一键接入 |

**一句话**：扫描你的启动项 → 用数据库管理它们 → 按「延迟 / 顺序 / 并发 / IO 负载」智能调度 → 所有写操作可审计、可回滚。

---

## 2. 系统组成（组件拓扑）

```
┌────────────────────────────────────────────────────────────┐
│  LLM Agent (Cursor / Claude Desktop / OpenCode / DSH)       │
└──────────────────┬─────────────────────────────────────────┘
                   │ MCP (stdio / SSE)
                   ▼
┌────────────────────────────────────────────────────────────┐
│  @starter/mcp     MCP Server  (Node.js)  127.0.0.1:7812    │
└──────────────────┬─────────────────────────────────────────┘
                   │ 本机 HTTP + Bearer Token
                   ▼
┌────────────────────────────────────────────────────────────┐
│  @starter/daemon  已提权守护进程 (Windows Service)          │
│                   127.0.0.1:7811  /rpc                      │
└──────────────────┬─────────────────────────────────────────┘
                   ▼
┌────────────────────────────────────────────────────────────┐
│  @starter/core    领域模型 + SQLite + 调度引擎              │
└──────────────────┬─────────────────────────────────────────┘
                   ▲
┌──────────────────┴─────────────────────────────────────────┐
│  @starter/cli     CLI (读直连 / 写走 daemon)                │
│  @starter/ui      Tauri 桌面壳                              │
└────────────────────────────────────────────────────────────┘
```

**数据流原则（RFC-001 §4.7）**：
- **读操作**（scan / list / show / doctor / io / history）：CLI/MCP 直连 SQLite（同一 WAL 文件）。
- **写操作**（enable / disable / set_delay / set_priority / add/remove_dependency / config set）：**统一走 daemon HTTP RPC**，让主进程统一审计 + 持有 UAC（HKLM 写无需每次弹窗）。daemon 不可达时本地 fallback（语义一致）。

---

## 3. 安装 / 部署

### 3.1 前置要求
- **Node.js ≥ 20**（`.nvmrc` 锁 Node 22，推荐 `nvm use`）
- **pnpm ≥ 9**（monorepo 用 `pnpm-workspace.yaml`）
- 仅 **Windows** 全功能（扫描/调度/服务）；其他平台可跑 CLI 读操作与模拟。

### 3.2 拉取与构建
```bash
git clone git@github.com:peitsan/starter.git
cd starter
nvm use                 # Node 22
pnpm install
pnpm -r run build       # 构建 core/cli/daemon/ipc-client/mcp（ui 需另装 cargo）
```

### 3.3 CLI 冒烟
```bash
node packages/cli/dist/index.js hello --name paxon   # 历史占位，见真实命令 §5
node packages/cli/dist/index.js doctor                # 自检：数量/config/平台
node packages/cli/dist/index.js list                  # 列出启动项
```

### 3.4 启动 MCP Server
```bash
# stdio 模式（默认，供 Cursor/Claude Desktop 配置）
node packages/mcp/dist/index.js

# SSE 模式（HTTP，供自研客户端 / OpenCode）
STARTER_MCP_SSE=1 node packages/mcp/dist/index.js     # 绑 127.0.0.1:7812/sse
```

### 3.5 部署 daemon（可选，写操作提权推荐）
```bash
cd packages/daemon
node dist/index.js install        # 装成 Windows 服务 StarterDaemon（SYSTEM 权限）
node dist/index.js start          # 启动服务
node dist/index.js register-logon # 注册登录调度任务（schtasks StarterScheduler）
# 卸载：uninstall / stop / unregister-logon
```

> daemon 首次启动会在 `%ProgramData%\Starter\auth.token` 生成一次性 Bearer token；
> CLI/MCP 会自动读取该 token 调用 `/rpc`。

---

## 4. 数据与配置

### 4.1 数据目录
| 内容 | 路径 |
|---|---|
| 用户库 SQLite | `%USERPROFILE%\.starter\starter.db` |
| daemon 库/配置 | `%ProgramData%\Starter\starter.db` |
| daemon token | `%ProgramData%\Starter\auth.token` |
| daemon 运行事件 | `%ProgramData%\Starter\run_events.ndjson` |
| daemon 日志 | `%ProgramData%\Starter\daemon.log` |

### 4.2 数据库表（schema v1）
| 表 | 说明 |
|---|---|
| `startup_item` | 启动项（`id`=fingerprint，`name/command/source/enabled/delay_ms/priority/risk/vendor`） |
| `startup_dependency` | 启动顺序边（`item_id` → `depends_on`，防环） |
| `startup_run` | 一次 run（kind: boot/manual/simulate） |
| `startup_run_event` | 每条 run 每 item 状态与时间戳 |
| `op_log` | 写操作审计（含 prev/next，支持撤销） |
| `app_config` | KV 配置 |
| `schema_meta` | 版本（v1） |

### 4.3 全局配置项（`app_config`）
| key | 默认 | 范围 | 含义 |
|---|---|---|---|
| `concurrent_max` | `4` | 1–16 | 并发启动数上限 |
| `io_queue_threshold` | `2` | ≥0 | 磁盘队列长度阈值（≥ 判忙） |
| `io_busy_threshold_pct` | `80` | 0–100 | 磁盘活动率阈值（≥ 判忙） |
| `io_idle_confirm_ms` | `3000` | ≥0 int | 连续忙多久才暂停（ms） |
| `auto_start` | `false` | true/false | 是否随登录自启 |

### 4.4 优先级语义（RFC-001 §4.5）
`startup_item.priority` 统一标尺：`0=Idle · 1=BelowNormal · 2=Normal(默认) · 3=AboveNormal · 4=High · 5=Realtime`。

### 4.5 备份 / 恢复
- **导出**：`export_config`（MCP）或配置快照，得到 `{schema_version, items, dependencies, config}` JSON。
- **导入**：`import_config(snapshot, mode)`；`merge`（upsert）/ `replace`（清空全量，危险）/ `append`（只加新）。导入前**自动备份** db 到 `starter.db.bak-<ts>`。

---

## 5. CLI 命令参考

| 命令 | 说明 |
|---|---|
| `scan` | 重扫注册表/启动文件夹并入 db |
| `list [--source] [--enabled/--disabled] [--search]` | 列出启动项（可过滤） |
| `show <id>` | 单项详情 |
| `enable <id>` / `disable <id>` | 启用/禁用（写注册表，走 daemon） |
| `set-delay <id> <ms>` | 设延迟（0=立即，24h 上限） |
| `set-priority <id> <prio>` | 设优先级 0–5 |
| `add-dep <id> <depends_on>` / `rm-dep <id> <depends_on>` | 加/删启动顺序边 |
| `config get <key>` / `config set <key> <val>` / `config <key>` | 读写全局配置 |
| `io [--watch]` | 采样磁盘 IO |
| `run now [--real] [--dry-run]` / `run history [--limit]` | 跑调度 / 看历史 |
| `doctor` | 自检报告 |
| `version` | 版本 |

> CLI 也支持全局 `--json` 输出，便于脚本化。

---

## 6. 接入 LLM Agent（MCP）

在 Cursor / Claude Desktop 的 MCP 配置：
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

### 6.1 能力清单（M2.5 实测）
- **27 个工具**：扫描/查询（12 只读）+ 写操作（12，均需 `yes:true`）+ 其他（2）+ 补充（2）。
- **6 个资源**：`starter://items|timeline|doctor|config|io|runs/latest`。
- **5 个 Prompts**：optimize_for_io / diagnose_slow_boot / safe_disable_plan / find_bloat / dependency_audit。

完整 API 参考见 [AGENT_API.md](../AGENT_API.md) 与文档站 Agent 模式的「MCP / API」章节。

### 6.2 写操作确认流（安全关键）
所有写操作要求 `yes:true`。不传时返回预览、不执行：
```json
{ "ok": false, "require_yes": true, "preview": { "id": "fp_xxx", "name": "OneDrive" } }
```
`schedule_run` 仅在 `real=true` 时要求确认。

---

## 7. 安全模型

| 机制 | 说明 |
|---|---|
| **critical 项硬保护** | `enable/disable` 返回 `protected`，不写注册表 |
| **写确认（yes 流）** | 防止 agent/脚本误操作 |
| **依赖防环** | `add_dependency` 自动 DFS 检测，返回 `cycle_detected` |
| **全量审计** | 每个写操作写 `op_log`，`list_changes` 可查，`undo_last_change` 可回滚 |
| **范围校验** | `config_set` / `set_io_throttle` 写入前校验（concurrent_max 1-16、pct 0-100 等） |
| **daemon 鉴权** | `/rpc` 仅回环 + Bearer token，token 文件权限 600 |
| **HKLM 提权** | 本地写 HKLM 抛 `ElevationRequiredError`，统一走 daemon（SYSTEM） |

---

## 8. 错误码

| 错误码 | 含义 |
|---|---|
| `E_NOT_FOUND` | 启动项 id 不存在 |
| `E_PROTECTED` | 该启动项为 critical，禁止启停 |
| `E_ELEVATION` / `E_ELEVATION_REQUIRED` | HKLM 需要管理员，请走 daemon |
| `E_ARGS` | 参数不合法 / 超范围 |
| `E_OP` | 操作失败（通用） |
| `E_NO_TOKEN` / `E_UNAUTHORIZED` | daemon token 缺失 / 被拒（401） |
| `E_DAEMON_UNREACHABLE` / `E_HTTP` / `E_RPC` | daemon 连接失败 / HTTP 错误 / RPC 错误 |
| `cycle_detected` / `self_dependency` / `duplicate` | 依赖边问题 |
| `not_found` / `protected` / `elevation_required` / `unsupported_source` | 业务拒绝原因 |

---

## 9. 故障排查

| 症状 | 排查 |
|---|---|
| CLI 写操作提示 daemon fallback | `GET http://127.0.0.1:7811/health` 是否 `{ok:true}`；token 文件是否存在 |
| HKLM 项启停失败 `elevation_required` | 未装 daemon；安装并 `start` 服务 |
| 扫描为空 / 缺项 | 确认是 Windows；`reg query HKCU\...\Run` 手动验证；计划任务/服务暂未实现 |
| MCP 连不上 | stdio 用配置文件启动；SSE 确认 `127.0.0.1:7812/sse` 可访问 |
| 想彻底回滚一批修改 | `undo_last_change({limit:N, yes:true})` 或 `revert_preset` |
| UI 构建失败 `cargo not recognized` | 安装 [Rust/cargo](https://rustup.rs)（Tauri 依赖） |

---

## 10. 已知限制（来自审计）

- 计划任务（TaskScheduler）与系统服务（Service）**尚未实现扫描**（`Source` 已定义）。
- 风险分级较粗（仅 SecurityHealth/Defender/OneDrive 特判，其余默认 recommend_off）。
- `startup_run.paused_count` 未持久化（恒 0）。
- UI 为 Tauri 桌面壳，需 Rust 工具链。

完整审计见 [AUDIT_REPORT.md](../AUDIT_REPORT.md)。
