/**
 * 平台 → Scanner 工厂
 *  - win32 → WindowsScanner
 *  - darwin / linux → 暂 throw（后续 PR 补 LaunchAgent / .desktop 实现）
 */
import type { Scanner } from './types.js';
import { WindowsScanner } from './windows.js';

export function detectScanner(): Scanner {
  switch (process.platform) {
    case 'win32':
      return new WindowsScanner();
    case 'darwin':
      throw new Error('macOS scanner not implemented yet (tracked in docs/PRD.md §7)');
    case 'linux':
      throw new Error('Linux scanner not implemented yet (tracked in docs/PRD.md §7)');
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}
