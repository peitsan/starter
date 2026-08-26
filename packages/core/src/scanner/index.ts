// @starter/core scanner — public entry
export * from './types.js';
export { parseCommand, fingerprint } from './command.js';
export { WindowsScanner, parseRegQuery } from './windows.js';
export { detectScanner } from './detect.js';
