# Contributing to Starter

感谢你愿意参与！本文档约定仓库的协作流程。

## 1. 行为准则

请友善、专业、就事论事地讨论问题。

## 2. 我能怎么帮忙

- 🐛 **报 Bug**：[GitHub Issues](https://github.com/peitsan/starter/issues)，
  带上 Windows 版本、复现步骤、相关日志（`starter doctor` 输出）。
- 💡 **提 Feature**：先在 Issue 里讨论，再开 PR。
- 📝 **改文档**：`docs/` 下的任何错误都欢迎直接 PR。
- 💻 **写代码**：从 `good first issue` 或 `help wanted` 标签开始。

## 3. 开发环境

```bash
# 必备：Node 22、Git 2.40+、Windows 10/11
nvm use
npm install
```

## 4. 工作流

1. **Fork & Clone**。
2. 从 `master` 拉新分支：
   ```bash
   git switch -c feat/<short-topic>     # 新功能
   git switch -c fix/<short-topic>      # bug 修复
   git switch -c docs/<short-topic>     # 文档
   git switch -c chore/<short-topic>    # 杂项
   ```
3. **Commit**：严格 [Conventional Commits](https://www.conventionalcommits.org/)。
   ```bash
   git add .
   npm run commit    # 交互式 commitizen，自动校验
   # 或直接：
   git commit -m "feat(cli): add `starter scan` command"
   ```
4. **Pre-commit** 会自动跑 `prettier --write` + `eslint --fix`（只对暂存文件）。
5. **Pre-push** 会跑 `npm run typecheck`。
6. **Push & PR**：
   ```bash
   git push -u origin feat/<short-topic>
   ```
   在 GitHub 上开 PR，目标分支 `master`。

## 5. Commit 规范

```
<type>(<scope>): <subject>     # 必填，subject 中文 / 英文均可
<BLANK LINE>
<body>                          # 可选，72 字符/行
<BLANK LINE>
<footer>                        # 可选，BREAKING CHANGE: ... / Closes #123
```

`type` 必须是 `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert` 之一。

> **BREAKING CHANGE** 写在 footer，CI 会自动判 major 版本升级。

## 6. 版本与发布

- `master` 分支保护：PR 必须过 CI 才能合并。
- 发布人（目前仅 `peitsan`）在本地跑：
  ```bash
  git switch master && git pull
  npm run release         # = release-it，会自动：
                          #   1. 计算新版本号
                          #   2. 跑 lint/test
                          #   3. 更新 CHANGELOG.md
                          #   4. commit + 打 tag
                          #   5. 推 master + tag
                          #   6. 创建 GitHub Release（draft）
  ```
- 完整流程见 [`docs/content/human/prd.md` §11 发布计划](docs/content/human/prd.md)。

## 7. 代码规范

- **TS**：`strict` 全开，能用类型推断就别写 `any`。
- **ESLint**：`no-console` 默认 warn（允许 `console.warn / .error / .info`）。
- **Prettier**：行宽 100，单引号，trailing comma。
- **测试**：`node --test` 即可，无第三方测试框架。覆盖率不在 MVP 强制要求。

## 8. License

提交即同意按 [MIT](LICENSE) 协议贡献。
