# Starter — Windows 启动项管理器

> Modern Windows startup manager with **IO-aware scheduling**, **CLI**, and **MCP server** (LLM Agent interface).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/peitsan/starter/blob/master/LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://github.com/peitsan/starter/blob/master/.nvmrc)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-blue.svg)](https://conventionalcommits.org)

Starter 是一个 **Windows 启动项管理软件**。与系统自带的「任务管理器 → 启动」相比，它能解决 3 类典型痛点：

| 痛点 | Starter 的方案 |
| --- | --- |
| 多盘 IO 冲突导致开机卡死 | **F6 IO 感知节流** ⭐ 磁盘繁忙自动暂停下一批启动项 |
| 想让某些软件晚点起 / 排队起 | **F3 延迟启动 + F4 DAG 依赖 + F5 并发控制** |
| 想要 LLM 直接帮我改启动项 | **F12 MCP Server** —— Cursor / Claude Desktop 一键接入 |

> 🤖 你是 AI / LLM 用户？直接切到右上角 **Agent** 模式，或看 [Agent 指南](/agent/guide) —— 专为 LLM 代理优化的 30 秒快速上手。

## ✨ 核心特性

- 📊 **启动项可视化**：注册表 / 启动文件夹 / 计划任务 / 服务，全在一张表里
- ⏱ **延迟 / 顺序 / 依赖**：拖拽排序，DAG 依赖图，并发数限制
- 🛑 **IO 感知节流**：磁盘队列长度 + 活动时间双阈值，动态暂停/续跑
- 🖥 **现代化 UI**：React Native + Fluent UI，目标 Win11 Mica 材质
- 🤖 **LLM Agent 接入**：MCP Server（stdio / SSE），自然语言就能调所有配置
- 🔒 **可审计**：所有写操作进入 `op_log`，关键项硬保护，UAC 提权代办

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

更多命令、配置项、故障排查见 [PRD 附录 A](prd)。

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

## 🔗 链接

- **仓库**：<https://github.com/peitsan/starter>
- **Release**：<https://github.com/peitsan/starter/releases/tag/v0.1.0>
- **许可证**：[MIT](https://github.com/peitsan/starter/blob/master/LICENSE) © 2025 Peican Lin (Paxon)
