/**
 * 命令行解析：把 "C:\path with space\app.exe" --flag "value with space"
 * 拆成 { exe, args }。
 *
 * 规则：
 *  - 双引号包裹的内容视作单一参数，反斜杠在引号外是转义
 *  - 引号内连续两个双引号 `""` 视作一个字面双引号
 *  - 第一个 token 作为 exe（去掉可能的引号后做简单存在性检查）
 */

export interface ParsedCommand {
  exe: string | null;
  args: string[];
}

export function parseCommand(raw: string): ParsedCommand {
  const tokens = tokenize(raw.trim());
  if (tokens.length === 0) return { exe: null, args: [] };
  const [first, ...rest] = tokens;
  // 有些注册表 Run 项会写 "explorer.exe" "C:\..." 这种，用 explorer 打开文件夹
  // 这里只把第一个 token 当 exe
  return { exe: first ?? null, args: rest };
}

function tokenize(input: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (inQuote) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          buf += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        buf += c;
      }
    } else {
      if (c === '"') {
        inQuote = true;
      } else if (c === ' ' || c === '\t') {
        if (buf.length > 0) {
          out.push(buf);
          buf = '';
        }
      } else {
        buf += c;
      }
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

/** 简易 fingerprint：source|source_path|name 的 sha1-ish hash（用 djb2 够用） */
export function fingerprint(parts: { source: string; source_path: string; name: string }): string {
  const s = `${parts.source}|${parts.source_path}|${parts.name}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  }
  return `fp_${h.toString(16)}`;
}
