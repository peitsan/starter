# 资源 & Prompts

## 资源（starter://）

| URI | 内容 | 何时读 |
| --- | --- | --- |
| `starter://items` | 全部启动项（含 delay/priority/enabled） | 需要完整快照时 |
| `starter://timeline` | 最近一次 run 的事件 | 想看调度效果时 |
| `starter://doctor` | 自检报告 | 想确认环境健康时 |

## Prompts

| 名称 | 用途 |
| --- | --- |
| `optimize_for_io` | 基于当前配置生成低 IO 优化建议（含具体 tool 调用链） |
| `diagnose_slow_boot` | 慢启动瓶颈分析 |
| `safe_disable_plan` | 安全禁用计划（跳过 Microsoft/驱动类） |

## 典型用法

```text
# 拿到低 IO 优化建议后执行
get_prompt(optimize_for_io)  →  读建议
apply_preset(建议中的 rules)
schedule_run({simulated_ms:3000})  →  验证
```