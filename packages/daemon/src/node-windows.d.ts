// node-windows 不带类型 — 简版声明用于 typecheck 通过
// 用法：const svc = new Service({...}); svc.install();
declare module 'node-windows' {
  interface ServiceOptions {
    name: string;
    description?: string;
    script: string;
    env?: Array<{ name: string; value: string }>;
    execPath?: string;
  }
  export class Service {
    constructor(opts: ServiceOptions);
    on(
      event: 'install' | 'uninstall' | 'alreadyinstalled' | 'start' | 'stop',
      cb: () => void,
    ): this;
    on(event: 'error', cb: (err: Error) => void): this;
    install(): void;
    uninstall(): void;
    start(): void;
    stop(): void;
  }
  export class EventLogger {
    constructor(opts?: { source?: string; eventName?: string });
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  }
}
