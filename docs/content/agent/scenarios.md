# 常见场景（自然语言 → 工具调用链）

> 8 个典型请求，以及 agent 应该如何响应。

## 1. "扫一下我电脑的启动项"

```text
→ call scan_startup_items
```

## 2. "把所有 IO 高的启动项延迟 60 秒"

```text
→ call list_startup_items(filter=risk=recommend_off)
→ 对每条 call set_delay(id, 60000)
→ 或 apply_preset([{match:"xxx", delay_ms:60000}])
```

## 3. "OneDrive 必须第一个起，VS Code 等它完成再起"

```text
→ call add_dependency(id=vs-code-id, depends_on=onedrive-id)
```

## 4. "把 XXX 关掉"

```text
→ call list_startup_items(search=XXX) 拿 id
→ call disable_startup_item(id)
```

## 5. "我启动太慢了，帮我优化"

```text
→ call get_prompt(diagnose_slow_boot) 看建议
→ 根据建议批量调 apply_preset
```

## 6. "反悔，撤销我上次的改动"

```text
→ call undo_last_change(limit=3)
```

## 7. "现在磁盘 IO 怎么样？"

```text
→ call io_status / read starter://doctor
```

## 8. "模拟跑一次调度看效果"

```text
→ call schedule_run(simulated_ms=3000)
→ read starter://timeline
```