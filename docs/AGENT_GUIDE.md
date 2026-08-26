# Starter — AI Agent 快速上手

> **写给 LLM agent 看的项目使用文档**。读这份文档就能调起 Starter 的全部能力。

---

## 1. 这是什么

**Starter** 是一个 Windows 启动项管理软件。它能：
- 扫描所有开机自启的进程（注册表 + 启动文件夹）
- 启/停某个启动项
- 给启动项设延迟（DAG 依赖图）
- 监控磁盘 IO，盘炸了自动暂停下一批启动
- 通过 **MCP 协议**让 LLM 直接控制

**核心差异化**：磁盘 IO 感知的启动调度 — 你硬盘 I/O 高时自动不塞新启动项。

---

## 2. 三种使用方式

| 方式 | 适用 |
|---|---|
| **MCP 接入**（推荐） | Cursor / Claude Desktop / DSH 内的 agent |
| **CLI 命令行** | 写脚本 / 自动化 |
| **直接调 SDK** | 嵌入到自己的 Node.js 项目 |

---

## 3. MCP 接入（最快）

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

接入后你有 **5 个 tool + 1 个 resource + 1 个 prompt**。

### 3.1 工具清单

| Tool 名称 | 作用 | 必填参数 |
|---|---|---|
| `scan_startup_items` | 重新扫描所有启动项并入库 | – |
| `list_startup_items` | 列表查询 | – |
| `enable_startup_item` | 启用（写注册表，HKCU 立即生效；HKLM 需提权） | `id` |
| `disable_startup_item` | 禁用 | `id` |
| `set_delay` | 设延迟（0 = 立即，24h 上限） | `id`, `delay_ms` |

**可选参数**（`list_startup_items`）：`source` / `enabled` / `risk` / `search`

### 3.2 Resource

- `starter://items` — 所有启动项的完整 JSON

### 3.3 Prompt

- `optimize_for_io` — 自动基于当前配置生成优化建议

### 3.4 自然语言调用的 6 个典型场景

```
1. "扫一下我电脑的启动项"
   → call scan_startup_items

2. "把所有 IO 高的启动项延迟 60 秒"
   → call list_startup_items(filter=risk=recommend_off)
   → 对每条 call set_delay(id, 60000)

3. "OneDrive 必须第一个起，VS Code 等它完成再起"
   → call add_dependency（待 v0.2）

4. "把 XXX 关掉"
   → call list_startup_items(search=XXX) 拿 id
   → call disable_startup_item(id)

5. "我启动太慢了，帮我优化"
   → call get_prompt(optimize_for_io) 看建议
   → 根据建议批量调 set_delay

6. "现在磁盘 IO 怎么样？"
   → read starter://items 看最近一次扫描结果
   → 调本机 PerformanceCounter（如需）
```

### 3.5 重要约束

- **critical 项不可禁用**（Microsoft Defender / SecurityHealth）→ 返回 `E_PROTECTED`
- **HKLM 项禁用需要管理员权限** → 返回 `E_ELEVATION_REQUIRED`（v0.1 暂未实装守护进程）
- 所有写操作进入 SQLite `op_log` 表，可审计
- 退出码：`ok=true` 表示成功，`ok=false` 加 `reason` 字段

---

## 4. CLI 命令行

安装后全局命令 `starter`：

```bash
starter scan                                  # 重新扫描
starter list --search OneDrive                # 列表（支持 --source / --enabled / --search）
starter show <id>                             # 详情
starter enable <id> --yes                     # 启用
starter disable <id> --yes                    # 禁用
starter set-delay <id> 30000                  # 延迟 30 秒
starter set-priority <id> 1                   # 优先级 0-5
starter doctor                                # 自检
starter --json <any>                          # 任何命令加 --json 输出机器可读
```

**所有命令接受 `--json` 输出稳定 schema**（带 `ok: true|false` 字段）。

---

## 5. 直接调 SDK（Node.js）

```ts
import { Controller, detectScanner, Scheduler, WindowsIoSource } from '@starter/core';

// 1. 创建一个 controller（自动开 db + 检测 scanner）
const ctrl = new Controller({ scanner: detectScanner() });

// 2. 扫一遍入库
const { total, inserted, updated } = await ctrl.scan();
console.log(`scanned ${total} items`);

// 3. 列表
const items = ctrl.list({ enabled: true });

// 4. 改延迟
ctrl.setDelay('fp_xxx', 60000);

// 5. 模拟一次调度（带 IO 节流）
const sched = new Scheduler({
  items: ctrl.list(),
  deps: new Map(),  // 依赖图
  ioSource: new WindowsIoSource(),
  queueThreshold: 2,
  busyThresholdPct: 80,
  confirmMs: 3000,
  concurrentMax: 4,
});
const result = await sched.run();
console.log(`paused ${result.paused_count} times`);
```

---

## 6. 关键概念

| 术语 | 含义 |
|---|---|
| **fingerprint** | 启动项的稳定 id（基于 source + source_path + name 哈希） |
| **source** | `HKCU_Run` / `HKLM_Run` / `HKCU_RunOnce` / `HKLM_RunOnce` / `StartupFolder` / `CommonStartupFolder` |
| **risk** | `critical`（不可关）/ `normal`（推荐保留）/ `recommend_off`（可关） |
| **delay_ms** | 登录后多久才允许启动 |
| **priority** | 0-5，对应 Windows 进程优先级 |
| **op_log** | 所有写操作的审计日志 |
| **schema_version** | 数据 schema 版本，当前 `v1` |

---

## 7. 常见错误码

| Code | 含义 |
|---|---|
| `E_NOT_FOUND` | id 不存在 |
| `E_PROTECTED` | critical 项不可禁用 |
| `E_ELEVATION` | HKLM 写需要管理员（v0.1 暂不支持） |
| `E_ARGS` | 参数错误 |
| `E_GENERIC` | 其他 |
| `E_SCAN` / `E_LIST` 等 | 各命令的特定错误 |

---

## 8. 仓库 / 数据位置

- **代码**：`G:\Starter\packages\{core,cli,mcp,ipc-client}`
- **用户数据**：`%USERPROFILE%\.starter\starter.db`（SQLite）
- **GitHub**：https://github.com/peitsan/starter
- **Release**：https://github.com/peitsan/starter/releases/tag/v0.1.0
- **PRD / MRD**：`docs/PRD.md` `docs/MRD.md`
- **开发日志**：`docs/DEV_LOG.md`

---

## 9. 注意事项

1. **不要关 critical 项**（会破坏系统安全）
2. **修改注册表前先 scan + show 确认**（避免误操作）
3. **HKLM 项当前只能读不能写**（v0.2 才支持）
4. **延迟单位是毫秒**（不是秒）
5. **5s+ 延迟的项需要先 `set_delay` 再让 Starter 接管**（系统不读我们的 SQLite）
6. **真正的延迟启动**需要在登录时由守护进程拉起 — v0.1 调度是**模拟**的（写 `startup_run_event` 表）；真起进程等 v0.2
7. **要审计时**：`SELECT * FROM op_log ORDER BY id DESC LIMIT 20`

---

## 10. 一句话总结

> 调 `scan_startup_items` 拿数据 → 用 `list_startup_items` 查 → 用 `set_delay` / `enable_*` / `disable_*` 改 → 完事。
