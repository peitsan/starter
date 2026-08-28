# Starter

> Modern Windows startup manager with **IO-aware scheduling**, **CLI**, and **MCP server** (LLM Agent interface).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/Node-%E2%89%A520-green)](.nvmrc)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-blue.svg)](https://conventionalcommits.org)
[![Release: release-it](https://img.shields.io/badge/Release-release--it-orange)](https://github.com/release-it/release-it)

> 🤖 **AI agent / LLM user?** Read the [**Agent Guide**](docs/content/agent/guide.md) instead — it's a quick start written for LLM agents (MCP tools, common scenarios, error codes).
> 🌍 **Human-friendly docs** (this README, MRD, PRD, dev log) are auto-published at **<https://peitsan.github.io/starter/>** via GitHub Pages.

Starter 是一个 **Windows 启动项管理软件**。与系统自带的「任务管理器 → 启动」相比，它能解决 3 类
典型痛点：

| 痛点                        | Starter 的方案                                         |
| --------------------------- | ------------------------------------------------------ |
| 多盘 IO 冲突导致开机卡死    | **F6 IO 感知节流** ⭐ 磁盘繁忙自动暂停下一批启动项     |
| 想让某些软件晚点起 / 排队起 | **F3 延迟启动 + F4 DAG 依赖 + F5 并发控制**            |
| 想要 LLM 直接帮我改启动项   | **F12 MCP Server** —— Cursor / Claude Desktop 一键接入 |

## ✨ 特性

- 📊 **启动项可视化**：注册表 / 启动文件夹 / 计划任务 / 服务，全在一张表里
- ⏱ **延迟 / 顺序 / 依赖**：拖拽排序，DAG 依赖图，并发数限制
- 🛑 **IO 感知节流**：磁盘队列长度 + 活动时间双阈值，动态暂停/续跑
- 🖥 **现代化 UI**：React Native + Fluent UI，目标 Win11 Mica 材质
- 🤖 **LLM Agent 接入**：MCP Server（stdio / SSE），自然语言就能调所有配置
- 🔒 **可审计**：所有写操作进入 `op_log`，关键项硬保护，UAC 提权代办

## 🏗 架构

```
┌─────────────────────────────────────────────────────────────┐
│  LLM Agent (Cursor / Claude Desktop / DSH)                  │
└──────────────────┬──────────────────────────────────────────┘
                   │ MCP (stdio / SSE)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  @starter/mcp      MCP Server（Node.js，纯 JS）              │
└──────────────────┬──────────────────────────────────────────┘
                   │ 本机 HTTP 127.0.0.1:7811 + Bearer Token
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  @starter/cli      CLI 入口（Node.js）                       │
└──────────────────┬──────────────────────────────────────────┘
                   │ 直接读 SQLite / 走 IPC
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  @starter/core     领域模型、SQLite、调度引擎                │
│  原生主进程（已提权）── 注册表 / WMI / 进程 / IO 监控          │
└─────────────────────────────────────────────────────────────┘
                   ▲
                   │ 复用 .NET / C# 桥接（react-native-windows 侧）
┌──────────────────┴──────────────────────────────────────────┐
│  @starter/ui       React Native (react-native-windows) 桌面  │
└─────────────────────────────────────────────────────────────┘
```

## 📦 仓库结构（Monorepo / npm workspaces）

```
.
├── docs/
│   ├── index.html       # 文档站（SPA：#/human/… 人类版、#/agent/… Agent 版）
│   ├── content/         # 文档站内容源（human/ + agent/）
│   │   ├── human/       # PRD/MRD/手册/CLI/MCP/开发日志等
│   │   └── agent/       # Agent 指南/工具一览/MCP API/错误码等
│   └── archive/         # 历史文档（审计报告/RFC/旧计划等）
├── packages/
│   ├── core/           # 领域模型、SQLite、调度引擎（DAG + IO watchdog）
│   ├── cli/            # starter 命令行入口
│   ├── mcp/            # MCP Server（让 LLM Agent 接入）
│   └── ipc-client/     # HTTP client（CLI/MCP → 已提权主进程）
├── .editorconfig
├── .gitattributes
├── .gitignore
├── .nvmrc              # 锁 Node 22
├── .npmrc
├── .prettierrc.json
├── eslint.config.mjs   # ESLint 9 flat config（共享基线）
├── tsconfig.base.json
├── commitlint.config.cjs
├── .lintstagedrc.json
├── .husky/             # pre-commit / commit-msg / pre-push
├── package.json        # 根（workspaces + release-it）
└── README.md
```

## 🚀 快速开始

```bash
# 1. 装依赖
nvm use                 # 切到 Node 22
npm install

# 2. CLI smoke test
npm -w @starter/cli run build
node packages/cli/dist/index.js hello --name paxon

# 3. MCP Server（启动 stdio 模式）
npm -w @starter/mcp run build
node packages/mcp/dist/index.js
```

更多命令、配置项、故障排查见 [`docs/content/human/prd.md`](docs/content/human/prd.md) 附录 A。

## 🤖 接入 LLM Agent

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

之后你就能在 Cursor 里说：

> "扫一下我电脑的启动项，把 IO 高的延迟 60 秒，OneDrive 必须第一个起"

Agent 会自己调 `scan_startup_items` → 分析 → `set_delay` → `add_dependency` → 全部审计留痕。

## 🛠 开发规范

- **提交信息**：严格 [Conventional Commits](https://www.conventionalcommits.org/)，
  由 `commitlint` 在 commit-msg 阶段强制检查。
- **代码风格**：[Prettier](https://prettier.io) + [ESLint 9 flat config](https://eslint.org)，
  提交前 `lint-staged` 自动 `prettier --write` + `eslint --fix`。
- **TypeScript**：`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`。
- **版本**：[Semantic Versioning](https://semver.org/)，`release-it` + `conventional-changelog`
  自动从 commit history 推断下个版本号、生成 `CHANGELOG.md`、打 tag、推 GitHub Release。
- **分支策略**：`master` 是稳定分支，长期分支用 `release/x.y`，新功能在 `feat/<topic>`。

## 📜 路线图

- [x] **v0.0.x** 项目骨架（CI / Husky / lint / 6 个 workspace 包占位）
- [x] **v0.1.0** MVP：F1 扫描 / F2 启停 / F3 延迟 / F4 依赖 / F5 并发 / F6 IO 节流 + F11 CLI + F12 MCP 基础
- [x] **v0.2.0** F7 时间线 / F10 托盘 / daemon 服务 / Tauri 壳 / MCP 完整（27 tool / 6 resource / 5 prompt）
- [ ] **v0.3.0** F8 进程优先级
- [ ] **v1.0.0** 计划任务/服务扫描、UI 打磨、代码签名

详见 [`docs/content/human/prd.md`](docs/content/human/prd.md) 与 [`docs/content/human/system-manual.md`](docs/content/human/system-manual.md)。

## 🙏 致谢

- 灵感与 UI 风格：[Glow-Shimmering/dsh-launcher](https://github.com/Glow-Shimmering/dsh-launcher)
- 调度思路：[syx594/DelayedStartupToolPro](https://github.com/syx594/DelayedStartupToolPro)
- 协议：[Model Context Protocol](https://modelcontextprotocol.io/)

## 📄 License

[MIT](LICENSE) © 2025 Peican Lin (Paxon)
