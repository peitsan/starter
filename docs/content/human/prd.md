# 产品需求文档（PRD）

**项目代号**：Starter
**文档版本**：v0.1
**撰写日期**：2025-XX-XX
**作者**：Paxon
**基于**：MRD v0.1
**范围**：MVP（v0.1.0）

---

## 0. 文档说明

本文档是 **MVP** 的产品需求。每一节按「**用户故事 → 验收标准 → 边界/规则**」展开，便于开发与自测。

术语约定：
- **启动项**：开机登录后被系统自动拉起的进程 / 任务 / 服务。
- **调度**：本软件对启动项的 **延迟、顺序、依赖、并发、IO 节流** 等控制。
- **批次**：按调度配置将启动项分组，每组起一个或多个，组与组之间满足依赖/IO 条件后才起下一组。

---

## 1. 功能总览（MVP）

| 编号 | 模块 | 优先级 | 状态 |
|---|---|---|---|
| F1 | 启动项扫描与展示 | P0 | 待开发 |
| F2 | 启/停单个启动项 | P0 | 待开发 |
| F3 | 延迟启动 | P0 | 待开发 |
| F4 | 启动顺序 / DAG 依赖 | P0 | 待开发 |
| F5 | 并发数控制 | P0 | 待开发 |
| F6 | IO 感知节流 | P0 | 待开发 |
| F7 | 启动时间线可视化 | P1 | 待开发 |
| F8 | CPU/进程优先级 | P1 | 待开发 |
| F9 | 配置导入/导出 | P1 | 待开发 |
| F10 | 系统托盘 + 开机自启 | P1 | 待开发 |
| F11 | **CLI 命令行** | P1 | 待开发 |
| F12 | **MCP Server（LLM Agent 接口）** | P1 | 待开发 |

---

## 2. 功能详述

### F1. 启动项扫描与展示

**用户故事**：
> 作为用户，我打开软件后能直接看到「我电脑里所有自启的东西」，不用再去注册表翻。

**包含来源**：
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- `HKLM\Software\Microsoft\Windows\CurrentVersion\Run`
- `HKCU/HKLM\...\RunOnce`（一次性）
- 启动文件夹（`shell:startup` / `shell:common startup`）
- 计划任务（`\Microsoft\Windows\` 下 `Logon` / `Startup` 触发器）
- 标记为「自动」的服务（可选，默认关闭，避免误伤）

**列表字段**：
- 名称
- 命令（可执行文件路径 + 参数）
- 来源（注册表项 / 启动文件夹 / 计划任务 / 服务）
- 启用 / 禁用状态
- 厂商（读取 PE 资源）
- 风险标签（关键项 / 推荐保留 / 可关）

**交互**：
- 支持 **搜索**（按名称、命令、厂商）。
- 支持 **筛选**（按来源、按状态）。
- 支持 **刷新**（手动 + 开机时自动一次）。

**验收**：
- 启动后 **< 3 秒** 完成首次扫描（200 条以内）。
- 列表分页或虚拟滚动，UI 不卡。

---

### F2. 启/停单个启动项

**用户故事**：
> 我想关掉某个开机自启，右键/开关就行，不用去注册表。

**规则**：
- 操作需 **UAC 提权**（修改 `HKLM` 或计划任务时）。
- **关键项**（如杀软、系统服务）默认 **不可禁用**，需二次确认。
- 操作后立即 **写回注册表/计划任务** 并 **回显新状态**。
- 提供「**撤销**」最近 5 次操作（按 Ctrl+Z 风格）。

**验收**：
- 启/停后 **重启资源管理器或重启系统** 生效（提示用户）。
- 操作历史可撤销。

---

### F3. 延迟启动

**用户故事**：
> 我希望一些不那么急的软件（云盘、IM 等）等桌面出来了再起。

**支持类型**：
- 简单延迟：登录后 **N 秒/分钟** 才启动。
- 延迟到指定 **资源空闲**：CPU < X% 且 IO < Y 时启动。

**UI**：
- 单个启动项右侧 **滑块 / 输入框**，默认 0s。
- 预设：0s / 5s / 30s / 1m / 3m / 自定义。

**验收**：
- 延迟时间持久化（SQLite + 导出 JSON）。
- 进程被延迟期间，**目标进程确实未被启动**（抽样验证）。

---

### F4. 启动顺序 / DAG 依赖

**用户故事**：
> 我的 OneDrive 必须等网络通了才起，VS Code 必须等 OneDrive 同步完再起。

**能力**：
- **顺序**：拖拽列表行，调整「相对顺序」。
- **依赖**：A → B（A 启动并就绪后，B 才可启动）。
- 引擎：内部维护一个 **DAG**，调度时按拓扑序执行。

**规则**：
- 禁止 **循环依赖**（检测到时弹窗提示并定位冲突的两项）。
- 依赖项被禁用时，**被依赖项自动改为「无依赖」** 并提示。

**UI**：
- 列表拖拽排序（react-native-draggable-flatlist / dnd-kit 思路）。
- 详情面板可加「依赖于此项」的列表。

**验收**：
- 配置循环依赖时，保存按钮禁用 + 弹错。
- 启动时按 DAG 顺序实际生效（抽样验证 2~3 个）。

---

### F5. 并发数控制

**用户故事**：
> 我希望同一时刻最多 3 个启动项在跑，避免一开始一堆东西抢盘。

**能力**：
- 全局并发上限（默认 4，可调 1~16）。
- 可按 **分组** 设置并发上限（高级用户）。

**引擎**：
- 维护一个 **信号量**（n=并发上限）。
- 启动器在「调度循环」里取一个待启动项 → 抢信号量 → 启动 → 进程退出释放。

**验收**：
- 同一时刻 `Get-Process | count` 不超过设定值（提供诊断日志）。

---

### F6. IO 感知节流 ⭐（核心差异化）

**用户故事**：
> 我硬盘 IO 已经炸了，**别再塞新的启动项了**，等盘闲下来再说。

**能力**：
- 实时监测 **磁盘队列长度** + **磁盘活动时间 %**。
- 阈值：默认「队列长度 ≥ 2」或「活动时间 ≥ 80%」时 **暂停下一批**。
- 冷却：阈值恢复正常 **持续 3 秒** 后才允许下一批。
- 写一个 **Watchdog 线程** 持续监控；调度主循环订阅事件。

**数据源**（MVP）：
- `PerformanceCounter`（`\PhysicalDisk(_Total)\% Idle Time`、队列长度）。
- 采样间隔 500ms。

**UI**：
- 顶部状态条：「磁盘繁忙：8.2% | 队列：0.3 | 当前并发：2/4」实时刷新。
- 暂停发生时，**通知中心** 推一条「因 IO 高，暂停 12 个启动项，3 秒后恢复」。

**验收**：
- 用 fio / 大量复制文件制造 IO 高，观察启动队列 **真的暂停**。
- IO 降下来后 **自动续跑**，且不漏项、不重跑。

---

### F7. 启动时间线可视化

**用户故事**：
> 我想看到「我开机那 60 秒里到底发生了什么」。

**能力**：
- 每次开机/模拟启动后，**记录每个启动项的实际启动时刻、就绪时刻**。
- 主页提供「**本次启动时间线**」视图：横轴是登录后秒数，纵轴是启动项，色块表示「等待→启动→运行中→退出」。
- 鼠标 hover 显示耗时、命令、依赖了谁。

**存储**：
- 每次启动一条 `Run`，最多保留 30 条。

**验收**：
- 视图能正确反映实际日志。
- 启动后 5 秒内可打开看到。

---

### F8. CPU/进程优先级

**用户故事**：
> 我希望某些启动项以 **低优先级** 启动，别一上来就抢 CPU。

**能力**：
- 为启动项设置 **进程优先级**：`Idle` / `BelowNormal` / `Normal` / `AboveNormal` / `High`。
- 实现：拉起进程后 `SetPriorityClass`。

**验收**：
- 设置后用任务管理器验证该进程的优先级。

---

### F9. 配置导入/导出

**用户故事**：
> 我有两台电脑，希望配置能同步。

**能力**：
- 导出 **JSON** 配置文件（含启/停状态、延迟、依赖、并发、IO 阈值）。
- 导入时 **diff** 展示，「仅新增 / 替换 / 合并」三种策略。
- 导入前 **自动备份当前配置**。

**验收**：
- 导出文件可读，结构稳定（带 schema 版本号）。
- 导入可回滚到导入前。

---

### F10. 系统托盘 + 开机自启

**能力**：
- 最小化到系统托盘，右键菜单：「立即优化」「暂停调度」「退出」。
- 首次启动时提示「是否开机自启」（写入 `HKCU\...\Run` 自身的启动项，名字带「(Starter)」便于识别）。

**验收**：
- 关窗不退出；托盘图标右键菜单齐全。
- 自启启用后，下次登录确实有 Starter 进程。

---

## 3. 信息架构 & 页面

```
┌─ 主窗口（Win11 Fluent 风格）────────────────────────────┐
│ 顶栏：搜索  刷新  导入  导出  设置                       │
│ 顶栏状态条：磁盘繁忙 % | 队列 | 并发 N/M | 调度状态      │
├─ 左导航─┬──────────── 内容区 ───────────────────────────┤
│ 启动项  │  列表：名称 | 来源 | 启/停 | 延迟 | 依赖 | ⋯ │
│ 时间线  │  右侧详情：命令、厂商、风险、操作按钮        │
│ 配置    │                                                │
│ 关于    │                                                │
└─────────┴────────────────────────────────────────────────┘
```

**页面清单**：
1. **启动项**：主列表 + 详情。
2. **时间线**：本次启动甘特图。
3. **配置**：并发上限、IO 阈值、分组管理等。
4. **关于**：版本、链接、鸣谢（dsh-launcher / DelayedStartupToolPro）。

---

## 4. 数据模型（SQLite）

```sql
CREATE TABLE startup_item (
  id              TEXT PRIMARY KEY,        -- uuid
  name            TEXT NOT NULL,
  command         TEXT NOT NULL,           -- exe + args
  source          TEXT NOT NULL,           -- 'HKCU_Run' | 'HKLM_Run' | 'StartupFolder' | 'TaskScheduler' | 'Service'
  source_path     TEXT NOT NULL,           -- 注册表路径 / 任务路径 / 文件夹路径
  enabled         INTEGER NOT NULL DEFAULT 1,
  delay_ms        INTEGER NOT NULL DEFAULT 0,
  priority        INTEGER NOT NULL DEFAULT 3,  -- 0=Idle ... 5=High
  risk            TEXT NOT NULL,           -- 'critical' | 'normal' | 'recommend_off'
  vendor          TEXT,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE startup_dependency (
  item_id     TEXT NOT NULL,
  depends_on  TEXT NOT NULL,
  PRIMARY KEY (item_id, depends_on),
  FOREIGN KEY (item_id) REFERENCES startup_item(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on) REFERENCES startup_item(id) ON DELETE CASCADE
);

CREATE TABLE startup_run (
  id          TEXT PRIMARY KEY,
  started_at  INTEGER NOT NULL,             -- 登录时间戳
  finished_at INTEGER
);

CREATE TABLE startup_run_event (
  run_id      TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  scheduled_at INTEGER,                    -- 计划启动时间（相对登录的 ms）
  started_at  INTEGER,                     -- 实际启动时间
  ready_at    INTEGER,                     -- 进程就绪时间
  ended_at    INTEGER,                     -- 进程结束时间（可空，仍在跑）
  status      TEXT NOT NULL                -- 'pending' | 'waiting_io' | 'waiting_dep' | 'running' | 'done' | 'failed' | 'skipped'
);

CREATE TABLE app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                       -- JSON
);
-- 典型 key：
--   'concurrent_max'        -> 4
--   'io_queue_threshold'    -> 2.0
--   'io_busy_threshold_pct' -> 80
--   'io_idle_confirm_ms'    -> 3000
--   'auto_start'            -> true/false
```

---

## 5. 调度引擎设计（关键）

```
┌──────────────────┐    ┌─────────────────┐    ┌────────────────┐
│  Config Loader   │───▶│  Schedule Queue │◀──▶│  IO Watchdog   │
└──────────────────┘    │  (DAG + delay)  │    │  (PerformanceC)│
                        └────────┬────────┘    └────────────────┘
                                 ▼
                        ┌─────────────────┐
                        │  Worker Pool    │   并发上限=N
                        │  ┌──┐┌──┐┌──┐  │
                        │  └──┘└──┘└──┘  │
                        └────────┬────────┘
                                 ▼
                        ┌─────────────────┐
                        │  Process Spawn  │   CreateProcess + SetPriority
                        └────────┬────────┘
                                 ▼
                        ┌─────────────────┐
                        │  Event Recorder │   → SQLite startup_run_event
                        └─────────────────┘
```

**调度循环伪代码**：

```ts
while (true) {
  const ioBusy = ioWatchdog.isBusy();
  const slot = workerPool.tryAcquire();
  const ready = dag.nextReady();              // 拓扑序 + 延迟已到 + 依赖已就绪

  if (ioBusy) {
    queue.pause('io_high');
    sleep(500); continue;
  }
  if (!slot)            { sleep(200); continue; }
  if (!ready)           { sleep(200); continue; }

  spawn(ready, slot);   // 异步，结束自动 release slot
  recorder.mark(ready, 'running');
}
```

---

## 6. 原生桥（react-native-windows 侧）

| 桥模块 | 暴露方法 |
|---|---|
| `StartupScanner` | `scan(): Promise<Item[]>` |
| `StartupController` | `enable(id, on)` / `disable(id)` / `setDelay(id, ms)` / `setPriority(id, p)` / `setDependency(from, to)` |
| `ProcessSpawner` | `spawn(command, args, opts): Promise<{pid, handle}>` / `setPriority(pid, p)` / `waitExit(handle)` |
| `IoMonitor` | `start()` / `stop()` / Event: `onSample({idlePct, queueLen})` |
| `TaskSchedulerBridge` | `listLogon()` / `enable()` / `disable()` |
| `App` | `setAutoStart(on)` / `quit()` / `minimizeToTray()` / `showNotification(...)` |

---

## 7. UI 交互细节

### 7.1 启动项列表

- 默认按「**推荐关闭**」置顶（风险标签驱动）。
- 关键项有 **盾牌/警告图标**，禁用按钮置灰。
- 行内操作：开关、延迟下拉、详情展开。

### 7.2 时间线视图

- 横轴：0~120s，可滚动。
- 纵轴：本次启动涉及的启动项。
- 颜色：绿=已完成 / 蓝=进行中 / 灰=等待中 / 黄=被 IO 暂停 / 红=失败。

### 7.3 通知中心

- Windows Toast。
- 重要事件：IO 暂停、启动完成、导入/导出完成、错误。

---

## 8. 权限与安全

- 默认以 **普通用户** 启动，只读。
- 写操作时按需 **UAC 提权**，且只对必要路径。
- **不联网**（除 GitHub 更新检查外可关）。
- **不写注册表 Run** 推广自身以外的条目。
- 所有操作在 SQLite + 操作日志里留痕，可导出。

---

## 9. 性能预算

| 指标 | 预算 |
|---|---|
| 软件自身内存占用 | < 150 MB |
| CPU 空闲占用 | < 1% |
| 扫描耗时 | < 3s（200 条内） |
| 调度决策延迟 | < 200ms（每 tick） |
| IO 监控开销 | < 0.5% CPU |

---

## 10. 兼容性

- **目标**：Windows 10 21H2+ / Windows 11（22H2+ 优先）。
- **架构**：x64（v1 不考虑 ARM64，但留 API 兼容空间）。
- **.NET**：自带的 .NET 6+ 运行时，或随包安装。

---

## 11. 发布计划

| 版本 | 内容 | 时间 |
|---|---|---|
| v0.1.0 (MVP) | F1~F6 + F9 | 6~8 周（业余节奏） |
| v0.2.0 | + F7 时间线 + F10 托盘 | + 2 周 |
| v0.3.0 | + F8 优先级 | + 1 周 |
| v1.0.0 | 文档完善、UI 打磨、签名 | 待定 |

发布渠道：
- GitHub Releases（含安装包 + 校验和）。
- 后续可考虑 Microsoft Store（需代码签名证书）。

---

## 12. 风险与开放问题

| 风险/问题 | 处理 |
|---|---|
| react-native-windows 在某些 Win11 上安装复杂 | 文档 + 视频教程；提供「绿色版」 |
| IO 监控对 NVMe 与 HDD 表现不同 | 提供「按盘符配置阈值」选项（v1.1） |
| 与杀软的「启动项管理」冲突 | 明确说明本软件定位，避免双重管控冲突 |
| 用户误关系统关键项 | 关键项硬保护 + 二次确认 + 操作日志 |
| 跨平台（macOS）何时做 | 待 MVP 验证后单独立项 |

---

## 13. 引用

- MRD：见 `MRD.md`
- 参考实现：https://github.com/Glow-Shimmering/dsh-launcher
- 参考实现：https://github.com/syx594/DelayedStartupToolPro
- Windows 启动机制：注册表 `Run/RunOnce`、计划任务 Logon 触发器、WMI `Win32_StartupCommand`。
- IO 监控：`System.Diagnostics.PerformanceCounter` / ETW。
- MCP 协议：https://modelcontextprotocol.io/

---

# 附录 A：CLI & MCP（AI Agent 接入）

> 让 LLM Agent 通过 **自然语言** 控制整个 Starter：扫描、启停、调延迟、看 IO、改依赖，全都能干。
> 设计目标：**所有 UI 能做的事，CLI 都能做；所有 CLI 能做的事，AI 都能做。**

## A.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                       LLM Agent（Cursor / Claude / DSH）      │
│   "把我所有 IO 高的启动项延迟 60 秒，OneDrive 必须第一个起"    │
└────────────────┬─────────────────────────────────────────────┘
                 │ MCP 协议（stdio / SSE）
                 ▼
┌──────────────────────────────────────────────────────────────┐
│   starter-mcp  (Node.js / TypeScript，独立的 MCP Server)     │
│   - 暴露 tools / resources / prompts                         │
│   - 走 JSON-RPC 2.0                                          │
└────────────────┬─────────────────────────────────────────────┘
                 │ 本地 HTTP（127.0.0.1:7811）或命名管道
                 ▼
┌──────────────────────────────────────────────────────────────┐
│   starter-cli  (单文件 Node.js 脚本)                         │
│   - 人类可读的子命令：scan / enable / set-delay / ...         │
│   - 也是 MCP Server 的后端实现                                │
└────────────────┬─────────────────────────────────────────────┘
                 │ 文件 SQLite / 注册表 / WMI / 进程 API
                 ▼
┌──────────────────────────────────────────────────────────────┐
│   Windows 启动项 + 调度引擎（Starter 核心）                   │
└──────────────────────────────────────────────────────────────┘
```

**为什么不直接让 MCP Server 操作 Windows？**
- 隔离：MCP Server **纯 JS**，跑在 Node 侧，**不需要管理员权限**也能用只读操作。
- 可审计：所有 CLI/MCP 调用先落到 SQLite 的 `op_log`，出问题能复盘。
- 可复用：CLI 和 MCP 共享同一份命令注册器，**零代码重复**。

---

## A.2 CLI 设计（`starter` 命令）

### A.2.1 命令清单（v1）

```
starter <command> [args] [flags]
```

| 命令 | 用途 | 示例 |
|---|---|---|
| `scan` | 扫描所有启动项 | `starter scan --source run` |
| `list` | 列出已入库的启动项 | `starter list --json` |
| `show <id>` | 看详情 | `starter show 5f3a...` |
| `enable <id>` | 启用 | `starter enable <id> --yes` |
| `disable <id>` | 禁用 | `starter disable <id> --yes` |
| `set-delay <id> <ms>` | 设延迟 | `starter set-delay <id> 30000` |
| `set-priority <id> <p>` | 设进程优先级 | `starter set-priority <id> low` |
| `add-dep <from> <to>` | 加依赖 | `starter add-dep <id-a> <id-b>` |
| `rm-dep <from> <to>` | 删依赖 | `starter rm-dep ...` |
| `config get <key>` | 读全局配置 | `starter config get concurrent_max` |
| `config set <key> <val>` | 写全局配置 | `starter config set io_busy_threshold_pct 85` |
| `io` | 实时 IO 状态 | `starter io --watch` |
| `run now` | 立刻执行一次调度 | `starter run now` |
| `run history` | 看历史启动 | `starter run history --limit 5` |
| `import <file>` | 导入配置 | `starter import config.json` |
| `export <file>` | 导出配置 | `starter export config.json` |
| `doctor` | 自检 | `starter doctor` |
| `serve-mcp` | 启动 MCP Server | `starter serve-mcp --stdio` |
| `version` | 版本 | `starter version` |

### A.2.2 全局 flags

- `--json` / `--format json` → 机器可读
- `--yes` → 跳过二次确认
- `--no-color` → CI 友好
- `--config <path>` → 覆盖 SQLite/配置文件路径
- `--elevated` → 触发 UAC 提权（写 HKLM 时必需）

### A.2.3 输出约定

- 默认 **人类可读**（表格 + 颜色）。
- `--json` 时输出 **稳定 JSON schema**（带 schema 版本 `v1`），供 MCP / 脚本消费。
- 退出码：`0` 成功 / `1` 一般错 / `2` 参数错 / `3` 权限不足 / `4` 资源冲突 / `5` 内部错。

### A.2.4 实现要点

- **Node.js ≥ 20**（已经有 SQLite 内置实验性支持，可直接用 `node:sqlite`）。
- 用 **Commander.js** 或自研微型解析器（避免依赖过重）。
- **零网络依赖**（除可选的 `npm i` 装 commander 外）。
- 子进程模型：
  - 读操作（scan/list/show/io）→ 直接连 SQLite。
  - 写操作（enable/disable/set-*）→ 通过 HTTP/管道调 **Starter 主进程** 写注册表（因为主进程已持有 UAC token）。

---

## A.3 MCP Server 设计（`starter serve-mcp`）

> 严格遵循 [Model Context Protocol](https://modelcontextprotocol.io/) 规范（2025-03-26 版本）。

### A.3.1 传输方式

- **stdio**（默认，Cursor / Claude Desktop 直接 spawn 一个子进程）。
- **SSE**（可选，用于远程或调试，`--transport sse --port 7812`）。

### A.3.2 暴露的 Tools（agent 可调用）

| Tool 名称 | 说明 | 关键参数 |
|---|---|---|
| `scan_startup_items` | 重新扫描 | `source?: "all"|"run"|"task"|"folder"\|"service"` |
| `list_startup_items` | 列出 | `filter?: {enabled?, source?, risk?, search?}` |
| `get_startup_item` | 详情 | `id: string` |
| `enable_startup_item` | 启用 | `id, yes?` |
| `disable_startup_item` | 禁用 | `id, yes?` |
| `set_delay` | 设延迟 | `id, delayMs` |
| `set_priority` | 设进程优先级 | `id, priority: "idle"\|"low"\|"normal"\|"high"` |
| `add_dependency` | 加依赖 | `fromId, toId` |
| `remove_dependency` | 删依赖 | `fromId, toId` |
| `get_config` | 读全局 | `key` |
| `set_config` | 写全局 | `key, value` |
| `get_io_status` | 当前 IO | – |
| `get_run_history` | 历史 | `limit?` |
| `run_now` | 立刻跑一次调度 | – |
| `import_config` | 导入 | `path, mode: "merge"\|"replace"\|"append"` |
| `export_config` | 导出 | `path` |
| `doctor` | 自检 | – |

每个 tool 返回的 JSON schema 都附 `version: "v1"`，未来字段演进时增量增加。

### A.3.3 暴露的 Resources（agent 可读上下文）

| URI | 内容 |
|---|---|
| `starter://items` | 完整启动项列表（带当前状态） |
| `starter://config` | 全局配置 |
| `starter://io` | 最近一次 IO 采样 |
| `starter://runs/latest` | 最近一次启动记录 |
| `starter://doctor` | 自检结果 |

Resources 用 `resources/read` URI 读取，**不产生副作用**。

### A.3.4 暴露的 Prompts（agent 模板）

| Prompt 名称 | 模板 |
|---|---|
| `optimize_for_io` | "分析我当前的启动项，**把 IO 高的全部延迟 60 秒以上**，返回改动清单" |
| `find_bloat` | "找出**我大概率不需要的启动项**（带厂商/风险标签）" |
| `dependency_audit` | "检查所有依赖关系，**找出环依赖和孤立节点**" |
| `cold_start_diagnose` | "看最近一次启动时间线，**告诉我哪 3 个最该优化**" |

Prompts 实际上是把常用任务包装成模板，**agent 调一下**就有上下文。

### A.3.5 安全 & 沙箱

- **只监听 127.0.0.1**（SSE 模式）。
- 写操作（disable/set-*）默认需要 **`--yes` 或对话中显式确认**。
- **MCP Server 不直接动注册表**，所有写操作转给 Starter 主进程，**统一审计**。
- 关键项（`risk=critical`）**禁止**通过 MCP 禁用；返回结构化错误 `code: "E_PROTECTED"`。
- **Op Log**：所有 CLI/MCP 调用写入 `op_log` 表（含调用方、时间、参数、结果）。

---

## A.4 与 Starter 主进程的协作（IPC）

```
┌─ starter.exe (主进程，已提权) ─────────────────────────────┐
│                                                             │
│  - 持有 UAC 权限，可写注册表 / 任务计划                      │
│  - 内置 HTTP server：127.0.0.1:7811                         │
│  - 路径：/v1/items, /v1/items/:id/enable, /v1/io, ...       │
│  - 鉴权：shared secret（在用户目录 .starter/auth.token）     │
│                                                             │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTP + Bearer token
                 ▼
┌─ starter-cli (无权限) / starter-mcp (无权限) ─────────────┐
│                                                             │
│  - 读操作：直连 SQLite                                     │
│  - 写操作：HTTP 调主进程                                    │
│  - 把命令结果统一包成 JSON schema v1                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**好处**：
- CLI/MCP **不需要 UAC**，每次写都让主进程代办。
- 主进程可以**常驻后台**，提供**实时通知**（webhook / SSE）。
- 多份 CLI 进程可以同时操作同一份 SQLite（用 WAL 模式）。

---

## A.5 仓库目录调整

```
G:\Starter\
├── docs/
│   ├── MRD.md
│   └── PRD.md
├── src/                       # 原生核心（注册表 / WMI / IO / 调度引擎）
│   ├── scanner/
│   ├── scheduler/
│   ├── io-watchdog/
│   └── ipc-server/            # 内置 HTTP 127.0.0.1:7811
├── ui/                        # React Native (react-native-windows) 桌面端
│   ├── src/
│   └── package.json
├── cli/                       # ⭐ 新增：Node.js CLI
│   ├── src/
│   │   ├── commands/
│   │   ├── ipc-client.ts
│   │   └── index.ts
│   └── package.json
├── mcp/                       # ⭐ 新增：MCP Server
│   ├── src/
│   │   ├── tools/
│   │   ├── resources/
│   │   ├── prompts/
│   │   └── server.ts
│   └── package.json
├── tests/
│   ├── cli/
│   └── mcp/
└── README.md
```

---

## A.6 验收标准（CLI & MCP）

### A.6.1 CLI 验收

- [ ] `starter scan --json` 输出稳定 schema（含 `schema_version: "v1"`）。
- [ ] `starter disable <id>` 在 SQLite 与注册表上**都生效**（双写校验）。
- [ ] `starter io --watch` 每 500ms 刷新一行。
- [ ] 关键项（`risk=critical`）执行 `disable` 返回**非零退出码 + 友好错误**。
- [ ] 写操作产生 `op_log` 记录。

### A.6.2 MCP 验收

- [ ] 在 **Claude Desktop / Cursor** 的 MCP 配置中加一行即可识别：
  ```json
  { "mcpServers": { "starter": { "command": "starter", "args": ["serve-mcp", "--stdio"] } } }
  ```
- [ ] agent 调用 `list_startup_items` 返回结构化数据。
- [ ] agent 调用 `optimize_for_io` prompt 后能拿到**带建议的上下文**。
- [ ] `doctor` tool 在主进程未启动时返回明确错误（`code: "E_NO_DAEMON"`）。
- [ ] 资源 URI `starter://items` 可被 agent 拉取作为上下文。

### A.6.3 端到端验收（E2E）

写一个 `tests/e2e/agent-loop.test.ts`：
1. 启动一个 mock LLM（脚本里写死的回复）。
2. 模拟用户问：「我启动太慢了，帮我优化」。
3. 断言：agent 至少调用了 `scan_startup_items` + `get_io_status` + 给出了至少 1 个 `set_delay`。
4. 验证：被改的启动项延迟真的写到了 SQLite。

---

## A.7 里程碑（CLI & MCP）

| 阶段 | 周 | 交付 |
|---|---|---|
| M0 | 1 | `starter scan/list/show/config` 4 个只读命令（纯 SQLite） |
| M1 | 1 | `starter enable/disable/set-delay` 走 IPC 调主进程 |
| M2 | 1 | `starter serve-mcp --stdio` + 5 个核心 tool |
| M3 | 1 | 全部 tool + 2 个 prompt + 资源 URI |
| M4 | 1 | E2E 测试 + 文档 + 录个 GIF 演示 |
| M5 | 1 | 发布到 npm：`@starter/cli` `@starter/mcp` |

---

## A.8 引用

- MCP 规范：https://modelcontextprotocol.io/
- MCP TypeScript SDK：https://github.com/modelcontextprotocol/typescript-sdk
- Node 22 `node:sqlite`：https://nodejs.org/api/sqlite.html
- Commander.js（CLI 解析）：https://github.com/tj/commander.js
- 参考：Diskonaut（另一个 IO 感知工具的 UI 思路）。
