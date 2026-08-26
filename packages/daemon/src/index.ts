#!/usr/bin/env node
/**
 * Daemon entry
 * - node dist/index.js             → 控制台模式（开发）
 * - node dist/index.js install     → 装成 Windows Service
 * - node dist/index.js uninstall   → 卸
 * - node dist/index.js start|stop  → 启停
 *
 * node-windows 装好 service 后会 spawn 'node dist/index.js'，
 * 我们通过 process.env 内一个标识变量来走 service 模式。
 */
import { runCli } from './config.js';

void runCli(process.argv);
