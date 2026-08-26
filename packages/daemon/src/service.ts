/**
 * Windows Service 装/卸/启/停
 * 用 node-windows 库
 */
import { platform } from 'node:os';
import { join } from 'node:path';
import { SERVICE_NAME, SERVICE_DISPLAY, loadConfig } from './config.js';
import type { Service as NwService } from 'node-windows';
import type * as NwModule from 'node-windows';

async function loadNw(): Promise<typeof NwModule> {
  if (platform() !== 'win32') {
    throw new Error('Windows Service only supported on win32');
  }
  return await import('node-windows');
}

export async function install(): Promise<void> {
  const nw = await loadNw();
  const config = loadConfig();
  const scriptPath = join(process.cwd(), 'dist', 'index.js');
  const svc: NwService = new nw.Service({
    name: SERVICE_NAME,
    description: SERVICE_DISPLAY,
    script: scriptPath,
    env: [
      { name: 'STARTER_DAEMON_PORT', value: String(config.port) },
      { name: 'STARTER_DAEMON_HOST', value: config.host },
    ],
  });
  svc.on('install', () => {
    process.stdout.write(`[starter-daemon] service installed: ${SERVICE_NAME}\n`);
  });
  svc.on('alreadyinstalled', () => {
    process.stdout.write(`[starter-daemon] service already installed\n`);
  });
  svc.on('error', (e: Error) => {
    process.stderr.write(`[starter-daemon] install error: ${e.message}\n`);
  });
  svc.install();
}

export async function uninstall(): Promise<void> {
  const nw = await loadNw();
  const svc: NwService = new nw.Service({ name: SERVICE_NAME, script: '' });
  svc.on('uninstall', () => process.stdout.write(`[starter-daemon] service uninstalled\n`));
  svc.on('error', (e: Error) =>
    process.stderr.write(`[starter-daemon] uninstall error: ${e.message}\n`),
  );
  svc.uninstall();
}

export async function start(): Promise<void> {
  const nw = await loadNw();
  const svc: NwService = new nw.Service({ name: SERVICE_NAME, script: '' });
  svc.on('start', () => process.stdout.write(`[starter-daemon] service started\n`));
  svc.start();
}

export async function stop(): Promise<void> {
  const nw = await loadNw();
  const svc: NwService = new nw.Service({ name: SERVICE_NAME, script: '' });
  svc.on('stop', () => process.stdout.write(`[starter-daemon] service stopped\n`));
  svc.stop();
}

/** Service 模式入口（被 node-windows spawn 时调用） */
export function runAsService(): void {
  // node-windows 会在 install 时把我们的 script 作为 service main
  // 这里只需 require('./index.js') 里的 console 分支逻辑
  // 由 main 入口根据命令行参数分发
  // (node-windows 用 'console' 模式启动 service)
  void import('./index.js');
}
