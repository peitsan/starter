# GitHub Pages 启用指南（给 Paxon）

> 一次性配置，30 秒搞定。

## 1. 启用 Pages

打开 https://github.com/peitsan/starter/settings/pages

**Source** 选 **"GitHub Actions"**

不用选 branch 也不用选 folder —— workflow 已经写好会自动 deploy。

![Pages setting](https://docs.github.com/assets/images/help/pages/pages-source-dropdown.png)

## 2. 等 1-2 分钟

打开 https://github.com/peitsan/starter/actions 看 "Deploy GitHub Pages" workflow 跑。

跑成功后 https://peitsan.github.io/starter/ 就有内容了。

## 3. 验证

访问 https://peitsan.github.io/starter/ 应该看到：

- 首页（`docs/index.md`）— 文档目录
- Agent Guide（`docs/AGENT_GUIDE.md`）
- README / MRD / PRD / DEV_LOG

---

## 故障排查

| 现象 | 原因 | 修法 |
|---|---|---|
| Actions 显示 403 | Pages 没启用 | 重做步骤 1 |
| 404 Not Found | 部署失败 | 看 Actions 日志 |
| 页面样式乱 | Jekyll 在处理 | 已加 `.nojekyll` 文件，应不出现 |
| 看不到 workflow run | 没 push 上去 | `git push` 后等 1 分钟刷新 |
