# @starter/cli

> 命令行入口。`starter scan / list / enable / set-delay / serve-mcp ...`

详细命令清单见仓库根 `docs/PRD.md` 附录 A。

## 开发

```bash
npm install
npm run build         # 编译到 dist/
npm run dev           # 监听模式，ts-node + esbuild
npm test              # 跑 node:test
npm run typecheck
```

## 安装到全局（开发期）

```bash
npm run build
npm link
starter hello --name paxon
```
