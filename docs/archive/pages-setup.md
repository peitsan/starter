# GitHub Pages 启用 + PAT 权限指南（给 Paxon）

> 必须 2 步（总计 2 分钟），我都做不了（fine-grained PAT 默认权限不够）。
> 一次性配置，以后全自动。

## 1. 调整 PAT 权限（1 分钟）

打开 https://github.com/settings/tokens ，找到你给我用的 PAT（`github_pat_11AUOOKSY09wfUK4gJfNpw...` 开头那个），点 Edit：

### Repository permissions（必须勾）：

- ✅ **Contents**: Read and write
- ✅ **Workflows**: Read and write
- ✅ **Pages**: Read and write
- ✅ **Metadata**: Read-only（默认就有）

点 **Save** 保存。

## 2. 启用 GitHub Pages（30 秒）

打开 https://github.com/peitsan/starter/settings/pages

**Source** 选 **"GitHub Actions"**

直接保存。

## 3. 触发 workflow（30 秒）

只要把代码 push 上去，workflow 就自动跑。

我先 push 一下当前的 commit：