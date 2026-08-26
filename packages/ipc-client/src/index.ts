/**
 * @starter/ipc-client — 通过本机 HTTP 调 daemon（127.0.0.1:7811 + Bearer token）
 *
 * 架构（PRD A.4 + RFC-001 §4.7）：
 *   - CLI / MCP 的写操作统一走 daemon，让主进程统一审计 + 持有 UAC。
 *   - 读操作可直连 SQLite（由各端自行决定），本 client 只负责写路径的 RPC。
 *
 * token 读取顺序：
 *   1. 显式传入的 token
 *   2. STARTER_DAEMON_TOKEN env
 *   3. %ProgramData%\Starter\auth.token（daemon 写入）
 *   4. ~/.starter/auth.token（兼容旧路径）
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const DEFAULT_DAEMON_URL = 'http://127.0.0.1:7811';
export const SCHEMA_VERSION = 'v1' as const;

export interface RpcRequest {
  method: string;
  params?: unknown;
  id?: string;
}

export interface RpcError {
  ok: false;
  code?: string;
  message: string;
  request_id?: string;
}

/** 从候选路径读 token；全部不存在返回 null */
export function readDaemonToken(overrides?: {
  programData?: string;
  home?: string;
}): string | null {
  const pd = overrides?.programData ?? process.env.ProgramData;
  const home = overrides?.home ?? homedir();
  const candidates = [
    pd ? join(pd, 'Starter', 'auth.token') : null,
    join(home, '.starter', 'auth.token'),
  ].filter((p): p is string => p !== null);

  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const t = readFileSync(p, 'utf8').trim();
        if (t) return t;
      }
    } catch {
      // 读不到就试下一个
    }
  }
  return null;
}

/** daemon 是否可达（GET /health，200ms 超时） */
export async function daemonReachable(
  url: string = DEFAULT_DAEMON_URL,
  timeoutMs = 200,
): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      return body?.ok === true;
    }
    return false;
  } catch {
    return false;
  }
}

/** 调用 daemon RPC。失败（连接/鉴权/服务端错误）抛 RpcError */
export async function rpc<T = unknown>(
  method: string,
  params?: unknown,
  opts?: { url?: string; token?: string },
): Promise<T> {
  const url = opts?.url ?? DEFAULT_DAEMON_URL;
  const token = opts?.token ?? process.env.STARTER_DAEMON_TOKEN ?? readDaemonToken();
  if (!token) {
    throw rpcError('E_NO_TOKEN', 'daemon auth token not found (start daemon once to generate it)');
  }
  const body: RpcRequest = { method, params: params ?? {}, id: randomUUID() };

  let res: Response;
  try {
    res = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    throw rpcError(
      'E_DAEMON_UNREACHABLE',
      `daemon unreachable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (res.status === 401) {
    throw rpcError('E_UNAUTHORIZED', 'daemon rejected token (401)');
  }
  if (!res.ok) {
    throw rpcError('E_HTTP', `daemon http ${res.status}`);
  }

  const json = (await res.json().catch(() => null)) as {
    ok: boolean;
    result?: T;
    error?: string;
    request_id?: string;
  } | null;

  if (!json || json.ok !== true) {
    throw rpcError('E_RPC', json?.error ?? 'unknown rpc error');
  }
  return json.result as T;
}

function rpcError(code: string, message: string): Error & RpcError {
  const e = new Error(message) as Error & RpcError;
  e.ok = false;
  e.code = code;
  return e;
}

/** 判错：rpc() 抛出的错误是否带某个 code */
export function isRpcError(e: unknown, code: string): boolean {
  return e instanceof Error && (e as Error & RpcError).code === code;
}
