# @starter/mcp

> MCP Server，让 LLM Agent（Cursor / Claude Desktop / DSH）能调起 Starter 的全部配置。

## 启动

```bash
npm run build
node dist/index.js              # 默认 stdio 传输
```

## 接入 Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "starter": {
      "command": "node",
      "args": ["C:/Starter/packages/mcp/dist/index.js"]
    }
  }
}
```

详细 schema 见根目录 [`docs/content/human/prd.md`](../../docs/content/human/prd.md) 附录 A。
