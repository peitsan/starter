# CLI 命令行

> 安装后全局命令 `starter`。所有命令接受 `--json` 输出稳定 schema（带 `ok: true|false` 字段）。

## 命令一览

```bash
starter scan                                  # 重新扫描所有启动项
starter list --search OneDrive                # 列表（--source / --enabled / --search）
starter show <id>                             # 单项详情 + 依赖边
starter enable <id> --yes                     # 启用
starter disable <id> --yes                    # 禁用
starter set-delay <id> 30000                  # 延迟 30 秒（毫秒）
starter set-priority <id> 1                   # 优先级 0-5
starter doctor                                # 自检（数量/config/平台）
starter --json <any>                          # 任何命令加 --json 机器可读
```

## 示例

### 扫描并查看

```bash
starter scan
starter list
starter list --source HKCU_Run
starter list --risk recommend_off
```

### 修改

```bash
# 禁用 OneDrive（需先找到 id）
starter list --search OneDrive
starter disable <id> --yes

# 设置延迟 30 秒
starter set-delay <id> 30000

# 设置优先级
starter set-priority <id> 1
```

### 自检

```bash
starter doctor
```

## --json 输出

任何命令追加 `--json` 即输出机器可读 JSON，便于脚本与 Agent 消费：

```bash
starter list --json
starter scan --json
```

输出统一包含 `ok: true|false` 字段；失败时附加 `reason`。

## 开发模式（仓库内）

未全局安装时，从仓库内运行：

```bash
pnpm -w @starter/cli run build
node packages/cli/dist/index.js <cmd> ...
```
