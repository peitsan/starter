# Starter 全量源码审计报告

> 审计时间：2026-08（M0–M3 里程碑之后）
> 审计范围：`packages/*` 全部 TypeScript 源码、测试、文档站、构建/测试/lint/typecheck
> 审计方式：逐文件人工审读 + 实测 build / typecheck / test
> 结论：**通过 ✅**（158/158 测试全绿，typecheck 全绿，仅有若干非阻塞发现）

---

## 1. 审计结论总览

| 维度 | 结果 |
|---|---|
| 单元测试 | ✅ **158/158 通过**（core 91 · ui 14 · ipc-client 10 · daemon 31 · cli 9 · mcp 3） |
| TypeScript typecheck | ✅ 全部 TS 包通过（`tsc --noEmit`） |
| 构建（TS） | ✅ core / cli / daemon / ipc-client / mcp 全部 `tsc` 构建成功 |
| 构建（UI） | ⚠️ `@starter/ui` 需 Rust/cargo 工具链；本机未装 cargo，故 `cargo tauri build` 失败（**环境问题，非代码缺陷**） |
| 里程碑覆盖 | ✅ M0–M3 全部落地（见 §3） |
| 阻塞性缺陷 | 无 |
| 建议修复（非阻塞） | 5 项（见 §6） |

---

## 2. 里程碑核对（M0–M3）

| 里程碑 | 要求 | 现状 |
|---|---|---|
| **M0** | 3 个 bug 修复 + 测试 | ✅ 见 `tests/store-new.test.ts`、`daemon/tests/controller.test.ts`（DAG 真调度从 db 读依赖等） |
| **M1.1–M1.4** | ipc-client / registry / CLI / MCP 统一走 daemon | ✅ `ipc-client`、`core/registry`、`cli`、`mcp` 均已实现 daemon HTTP 路由 + 本地 fallback |
| **M2.0** | core 支撑：transfer / configAll / graph / listChanges | ✅ `store/transfer.ts`、`Controller.configAll()`、`dependencyGraph()`、`listChanges()` |
| **M2.1–M2.3** | MCP 10 tool + 6 resource + 5 prompt（含 yes 确认流） | ✅ 见 `mcp/src/catalog.ts`（27 tool / 6 resource / 5 prompt） |
| **M2.4** | MCP SSE transport | ✅ `server.ts` 内置 SSE（`STARTER_MCP_SSE=1`，绑 `127.0.0.1:7812`） |
| **M2.5** | e2e 实测 27/6/5 | ✅ `mcp/scripts/e2e-mcp.ts`（文档站已记录实测） |
| **M3** | 收尾：更新 AGENT_API / AGENT_GUIDE / README + 全量验证 | ✅ 本文档即全量验证的一部分 |

---

## 3. 源码规模与结构

```
packages/
├── core/        领域模型 + SQLite + 调度引擎        (~28 个 .ts 文件)
│   ├── scanner/   注册表/启动文件夹扫描（Windows）
│   ├── store/     startup_item / dependency / run / op_log / config / transfer
│   ├── dag/       DAG 依赖图（环检测 + 就绪节点）
│   ├── io/        IO Watchdog（typeperf 采样）
│   ├── scheduler/ 调度引擎（DAG + 并发 + IO 节流）
│   └── registry/  命令注册器（CLI/MCP/daemon 共享写操作定义）
├── daemon/       Windows 服务（node-windows）+ HTTP RPC（127.0.0.1:7811）
├── ipc-client/   本地 HTTP 客户端（Bearer token 鉴权）
├── cli/          starter 命令行（commander）
├── mcp/          MCP Server（stdio / SSE）
└── ui/           Tauri 2.x 桌面壳（vanilla JS 前端）
```

### 数据模型（SQLite，schema v1）

`packages/core/src/store/schema.ts`：

| 表 | 作用 |
|---|---|
| `startup_item` | 启动项（id=fingerprint, name, command, source, enabled, delay_ms, priority, risk, vendor） |
| `startup_dependency` | 启动顺序 DAG 边（`item_id` → `depends_on`） |
| `startup_run` | 一次开机/手动 run（kind: boot/manual/simulate） |
| `startup_run_event` | 每条 run 中每个 item 的状态与时间戳 |
| `op_log` | 所有写操作审计（含 prev/next，支持撤销） |
| `app_config` | KV 配置（concurrent_max / io_* / auto_start） |
| `schema_meta` | 版本元信息（当前 v1） |

---

## 4. 分包审计要点

### 4.1 `@starter/core`
- **扫描器** `scanner/windows.ts`：走 `reg.exe query`（零原生依赖），覆盖 Run/RunOnce（HKCU/HKLM）+ 启动文件夹。计划任务/服务仅定义 `Source` 未实现（见 §6.1）。
- **风险分级**：`classifyRisk` 只识别 SecurityHealth / WindowsDefender（critical）与 OneDrive（normal），其余默认 `recommend_off`（较粗，见 §6.2）。
- **仓储**：`items.ts` 提供 upsert / list / setEnabled / setDelay / setPriority / addDependency（含防环 DFS）/ removeDependency，均写 `op_log`。
- **控制器** `controller.ts`：对外暴露 scan/list/show/enable/disable/setDelay/setPriority/依赖/applyPreset/undoLast/scheduleRun/timeline/runHistory/exportConfig/importConfig/configAll/dependencyGraph/listChanges/ioStatus/serviceStatus/doctor。HKLM 写抛 `ElevationRequiredError`，交由 daemon 提权。
- **transfer** `store/transfer.ts`：配置导入导出（v1），mode=merge/replace/append，导入前自动备份 db。
- **registry** `core/registry/commands.ts`：CLI/MCP/daemon 共享写操作定义（零代码重复），轻量 validate 不引入 zod。

### 4.2 `@starter/daemon`
- **服务** `service.ts`：node-windows 装/卸/启/停 + schtasks 登录任务（`StarterScheduler`，`schedule-run` 触发）。
- **RPC** `config.ts`：`startHttpServer` 提供 `GET /health`（免鉴权）+ `POST /rpc`（Bearer token），回环绑定 127.0.0.1:7811。
- **控制器** `controller.ts`：把 RPC method 映射到 core；`schedule_run` 真起进程（spawnItem），并写 `run_events.ndjson` 时间线。

### 4.3 `@starter/ipc-client`
- `rpc()`：POST `/rpc` + Bearer token；错误码 `E_NO_TOKEN` / `E_UNAUTHORIZED` / `E_HTTP` / `E_DAEMON_UNREACHABLE` / `E_RPC`。
- token 读取顺序：显式 → env `STARTER_DAEMON_TOKEN` → `%ProgramData%\Starter\auth.token` → `~/.starter/auth.token`。

### 4.4 `@starter/cli`
- 读操作本地直连 SQLite；写操作走 registry + daemon IPC（fallback 本地）。
- 命令：scan / list / show / enable / disable / set-delay / set-priority / add-dep / rm-dep / config / io / run(now|history) / doctor / version。

### 4.5 `@starter/mcp`
- **27 个工具**（12 只读 + 12 写 + 2 其他 + 2 补充）：见 `catalog.ts` 与 `AGENT_API.md`。
- **写操作确认流**：不传 `yes:true` 返回 `{ ok:false, require_yes:true, preview }`，防止 agent 误操作。
- **6 资源**：`starter://items|timeline|doctor|config|io|runs/latest`。
- **5 Prompts**：optimize_for_io / diagnose_slow_boot / safe_disable_plan / find_bloat / dependency_audit。
- **传输**：stdio（默认）/ SSE（`--sse` 或 `STARTER_MCP_SSE=1`，127.0.0.1:7812）。

### 4.6 `@starter/ui`（Tauri 2.x 桌面壳）
- vanilla JS 前端 + 3 个 tab（items/timeline/settings）+ i18n（zh-CN/en）+ 托盘 + gantt 时间线。
- 需要 Rust/cargo 工具链构建。

---

## 5. 测试核对

实测 `pnpm -r run test`：**158 通过，0 失败**（TAP 汇总）。

| 包 | 测试数 | 覆盖重点 |
|---|---|---|
| core | 91 | controller / dag / io / scanner / scheduler / store / transfer / winreg / types |
| ui | 14 | 前端静态结构 / i18n / tauri config |
| ipc-client | 10 | token 读取 / daemonReachable / rpc 鉴权与错误码 |
| daemon | 31 | config / RPC / scheduler-exec / timeline / io / service |
| cli | 9 | 输出格式 / smoke |
| mcp | 3 | catalog 数量（27/6/5） |

---

## 6. 非阻塞发现与建议（供后续迭代）

| # | 位置 | 发现 | 建议 | 优先级 |
|---|---|---|---|---|
| 1 | `core/src/scanner/types.ts` | `Source` 定义了 `TaskScheduler` / `Service` 但无扫描实现 | 后续补计划任务/服务扫描（PRD F1.6/F1.7） | P1 |
| 2 | `core/src/scanner/windows.ts` `classifyRisk` | 风险识别仅覆盖 SecurityHealth/Defender/OneDrive，其余一律 `recommend_off` | 引入厂商/PE 资源识别，细化分级 | P1 |
| 3 | `core/src/winreg.ts` `requiresElevation()`（L82-84） | 恒返回 `false`，属死代码 | 删除或实现真实判断 | P2 |
| 4 | `core/src/items.ts` 与 `dependencies.ts` | `wouldCreateCycle` DFS 逻辑重复两处 | 抽公共工具函数 | P2 |
| 5 | `core/controller.ts` `runHistory` | `paused_count` 恒写 0（startup_run 表无该列） | 后续扩展 schema 或从事件统计 | P2 |
| 6 | `mcp/server.ts` | Server 版本硬编码 `'0.0.0'`；`cli/commands.ts` version 硬编码 `'0.1.0'` | 从 package.json 注入 | P2 |
| 7 | 各包 `package.json` | UI 版本 0.2.0 与 core 0.1.0 不一致 | 统一版本管理（release-it） | P2 |
| 8 | 双时间线 | core 走 SQLite `startup_run_event`，daemon 另写 `run_events.ndjson` | 后续统一为单一来源 | P2 |
| 9 | UI 构建 | `@starter/ui` 需本机安装 Rust/cargo 工具链 | 文档注明前置依赖 | P3 |

> 以上均为**非阻塞**项，不影响 M0–M3 已验收能力；已记录进本文档与相关手册的「已知限制」。

---

## 7. 审计产物

- 本报告：`docs/archive/audit-report.md`
- 系统手册：`docs/content/human/system-manual.md`
- 开发手册：`docs/content/human/developer-manual.md`
- 文档站导航已同步（`docs/assets/app.js` MANIFEST）
