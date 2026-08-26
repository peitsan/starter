# 快速开始

> 从零开始把 Starter 跑起来，并在你的 AI 编辑器里接入它的全部能力。

## 环境要求

- **Node.js ≥ 20**（推荐 22，见 [`.nvmrc`](https://github.com/peitsan/starter/blob/master/.nvmrc)）
- **pnpm ≥ 9**
- Windows 10 / 11（核心能力依赖 Windows 注册表与 WMI）

## 1. 克隆并安装

```bash
git clone git@github.com:peitsan/starter.git
cd starter

nvm use        # 切到 Node 22
pnpm install   # 安装全部 workspace 依赖
```

> 首次安装会编译 `better-sqlite3`，请耐心等待。

## 2. 构建并冒烟测试

```bash
pnpm -r build

# CLI 冒烟测试
node packages/cli/dist/index.js hello --name paxon
# 输出: Hello paxon!
```

## 3. 扫描你的启动项

```bash
node packages/cli/dist/index.js scan
node packages/cli/dist/index.js list
```

> 会扫描注册表 `Run`/`RunOnce` + 启动文件夹，并把结果写入本机 SQLite 数据库。

## 4. 启动 MCP Server（接入 AI）

```bash
node packages/mcp/dist/index.js
```

然后在 **Cursor** / **Claude Desktop** 的 MCP 配置里加：

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

## 5. 用自然语言操作

接入后你就能在编辑器里说：

- "扫一下我电脑的启动项"
- "把所有 IO 高的启动项延迟 60 秒"
- "OneDrive 必须第一个起，VS Code 等它完成再起"
- "把 Steam 关掉"

Agent 会自己调用对应的 MCP 工具，全程写入审计日志，可随时撤销。

## 常见问题

| 问题 | 解决 |
| --- | --- |
| `ERR_PNPM_FETCH_404 @starter/ipc-client` | pnpm 9 把 workspace 内部包当外部包拉取。确认 `pnpm-workspace.yaml` 的 `packages` 范围正确，内部依赖用 `workspace:*` 协议 |
| HKLM 项写操作被拒 | 需要管理员权限（返回 `elevation_required`） |
| 改延迟没生效 | 系统不读我们的 SQLite；`5s+` 延迟的项需要先 `set_delay` 再让 Starter 接管 |
