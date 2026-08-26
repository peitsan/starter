# 资源 & Prompts

## 资源（starter://，6 个）

| URI | 内容 | 何时读 |
|---|---|---|
| `starter://items` | 全部启动项（含 delay/priority/enabled） | 需要完整快照时 |
| `starter://timeline` | 最近一次 run 的事件 | 想看调度效果时 |
| `starter://doctor` | 自检报告 | 想确认环境健康时 |
| `starter://config` | 全局配置（含默认来源） | 想查看当前配置时 |
| `starter://io` | 当前磁盘 IO 采样 | 想诊断 IO 瓶颈时 |
| `starter://runs/latest` | 最近一次 run 摘要 + 事件 | 综合查看最近调度 |

## Prompts（5 个）

| 名称 | 用途 |
|---|---|
| `optimize_for_io` | 基于当前配置生成低 IO 优化建议（含具体 tool 调用链） |
| `diagnose_slow_boot` | 慢启动瓶颈分析 |
| `safe_disable_plan` | 安全禁用计划（跳过 Microsoft/驱动类） |
| `find_bloat` | 找臃肿项（高延迟可禁项） |
| `dependency_audit` | 依赖图审计（环/孤点/长链） |

## 典型用法

```text
# 拿到低 IO 优化建议后执行
get_prompt(optimize_for_io)  →  读建议
apply_preset(建议中的 rules, yes:true)
simulate_dry_run()           →  验证
timeline                     →  看效果
```