# 错误码

| Code | 含义 |
| --- | --- |
| `E_NOT_FOUND` | id 不存在 |
| `E_PROTECTED` | critical 项不可禁用 |
| `E_ELEVATION` | HKLM 写需要管理员（v0.1 暂不支持） |
| `E_ARGS` | 参数错误 |
| `E_GENERIC` | 其他 |
| `E_SCAN` / `E_LIST` 等 | 各命令的特定错误 |

## 退出码约定

- `ok=true` 表示成功
- `ok=false` 时附加 `reason` 字段说明原因

```json
{ "ok": false, "reason": "protected" }
```

## 常见错误场景

| 场景 | 返回 |
| --- | --- |
| 禁用 Microsoft Defender / SecurityHealth | `E_PROTECTED` |
| HKLM 项写操作无管理员权限 | `E_ELEVATION_REQUIRED` |
| `add_dependency` 检测到循环 | `cycle_detected` |
| 传了不存在的 id | `E_NOT_FOUND` |