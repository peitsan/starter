/**
 * @starter/daemon — Windows Service 入口
 *
 * 架构：
 *   - 装成 Windows Service（node-windows），SYSTEM 跑 → HKLM 写无需 UAC
 *   - 内部开 HTTP server 127.0.0.1:7811（仅 loopback）
 *   - Bearer Token 鉴权（首次启动写到 %ProgramData%\Starter\auth.token）
 *   - 复用 @starter/core 的 Controller 业务逻辑
 *
 * 启动方式：
 *   - 服务模式：sc start StarterDaemon
 *   - 控制台模式：node dist/index.js console（开发用）
 *   - 装/卸：node dist/index.js install / uninstall
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';

export const SERVICE_NAME = 'StarterDaemon';
export const SERVICE_DISPLAY = 'Starter Startup Manager Daemon';
export const DEFAULT_PORT = 7811;
export const DEFAULT_HOST = '127.0.0.1';

/** Daemon 数据目录：%ProgramData%\Starter\ (Windows) 或 ~/.starter/daemon/ (其他) */
export function dataDir(): string {
  if (platform() === 'win32') {
    const pd = process.env.ProgramData ?? 'C:\\ProgramData';
    return join(pd, 'Starter');
  }
  return join(process.env.HOME ?? '.', '.starter', 'daemon');
}

export interface DaemonConfig {
  port: number;
  host: string;
  dataDir: string;
  authTokenPath: string;
  dbPath: string;
  logPath: string;
}

export function loadConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const dir = overrides.dataDir ?? dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return {
    port: overrides.port ?? Number(process.env.STARTER_DAEMON_PORT ?? DEFAULT_PORT),
    host: overrides.host ?? process.env.STARTER_DAEMON_HOST ?? DEFAULT_HOST,
    dataDir: dir,
    authTokenPath: join(dir, 'auth.token'),
    dbPath: join(dir, 'starter.db'),
    logPath: join(dir, 'daemon.log'),
  };
}

/** 读或创建一次性 auth token */
export function ensureAuthToken(path: string): string {
  if (existsSync(path)) {
    return readFileSync(path, 'utf8').trim();
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(path, token, { mode: 0o600 });
  return token;
}

/** HTTP 工具：读 body */
async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ ...data, request_id: randomUUID() }));
}

/** Bearer token 校验 */
function checkAuth(req: IncomingMessage, expected: string): boolean {
  const auth = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return !!m && m[1] === expected;
}

export interface DaemonDeps {
  config: DaemonConfig;
  authToken: string;
  /** 处理 JSON-RPC 风格 method（每个 method 对应 core 一个能力） */
  handle: (method: string, params: unknown) => Promise<unknown>;
}

export function startHttpServer(deps: DaemonDeps): ReturnType<typeof createServer> {
  const { config, authToken, handle } = deps;
  const server = createServer(async (req, res) => {
    try {
      // health check（无需 auth）
      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, { ok: true, status: 'running', version: '0.2.0' });
        return;
      }
      // 鉴权
      if (!checkAuth(req, authToken)) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      // 单 endpoint POST /rpc
      if (req.method !== 'POST' || req.url !== '/rpc') {
        sendJson(res, 404, { ok: false, error: 'not_found' });
        return;
      }
      const body = await readBody(req);
      let msg: { method: string; params?: unknown; id?: string };
      try {
        msg = JSON.parse(body) as { method: string; params?: unknown; id?: string };
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid_json' });
        return;
      }
      if (!msg.method || typeof msg.method !== 'string') {
        sendJson(res, 400, { ok: false, error: 'method_required' });
        return;
      }
      const result = await handle(msg.method, msg.params ?? {});
      sendJson(res, 200, { ok: true, result, id: msg.id ?? null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 500, { ok: false, error: msg });
    }
  });
  server.listen(config.port, config.host, () => {
    process.stdout.write(`[starter-daemon] http://${config.host}:${config.port} ready\n`);
  });
  return server;
}

/** CLI 模式：install / uninstall / console */
export async function runCli(argv: string[]): Promise<void> {
  const cmd = argv[2];
  if (cmd === 'console' || cmd === undefined) {
    // 控制台模式（开发用）
    const config = loadConfig();
    const authToken = ensureAuthToken(config.authTokenPath);
    const { createController } = await import('./controller.js');
    const ctrl = createController({ config });
    const server = startHttpServer({
      config,
      authToken,
      handle: (method, params) => ctrl.handle(method, params as Record<string, unknown>),
    });
    const shutdown = (): void => {
      server.close();
      ctrl.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }
  if (platform() !== 'win32') {
    process.stderr.write('install/uninstall only on Windows\n');
    process.exit(1);
  }
  // 走 node-windows 装/卸
  const { install, uninstall } = await import('./service.js');
  if (cmd === 'install') {
    await install();
    return;
  }
  if (cmd === 'uninstall') {
    await uninstall();
    return;
  }
  if (cmd === 'start' || cmd === 'stop') {
    const { start, stop } = await import('./service.js');
    if (cmd === 'start') await start();
    else await stop();
    return;
  }
  if (cmd === 'schedule-run' || cmd === 'schedule_run') {
    // 单次跑：被 schtasks ONLOGON 触发
    const config = loadConfig();
    const { createController } = await import('./controller.js');
    const ctrl = createController({ config });
    const dryRun = process.env.STARTER_DRY_RUN === '1';
    const r = await ctrl.handle('schedule_run', {
      concurrent_max: 4,
      simulated_ms: dryRun ? 3000 : 0,
      tick_ms: 200,
    });
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    ctrl.close();
    return;
  }
  if (cmd === 'register-logon' || cmd === 'unregister-logon') {
    const m = await import('./service.js');
    if (cmd === 'register-logon') m.registerLogonTask();
    else m.unregisterLogonTask();
    return;
  }
  process.stderr.write(`unknown command: ${cmd}\n`);
  process.exit(2);
}
