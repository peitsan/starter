/**
 * MCP Server 单元测试：
 *  - 不真起 stdio 传输（避免测试卡住）
 *  - 直接 import server.ts 会 connect stdio — 改为只 import 一个无副作用模块
 *
 * 这里只验证：list tools / list resources / list prompts 的 schema 数据
 * 这些数据是从 SDK constants 派生的，写个 server 端常量导出以便测
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { STARTER_TOOL_NAMES, STARTER_RESOURCE_URIS, STARTER_PROMPT_NAMES } from '../src/catalog.js';

describe('catalog', () => {
  it('exposes 5 tools (PRD F12 DoD)', () => {
    assert.equal(STARTER_TOOL_NAMES.length, 5);
    assert.ok(STARTER_TOOL_NAMES.includes('scan_startup_items'));
    assert.ok(STARTER_TOOL_NAMES.includes('list_startup_items'));
    assert.ok(STARTER_TOOL_NAMES.includes('enable_startup_item'));
    assert.ok(STARTER_TOOL_NAMES.includes('disable_startup_item'));
    assert.ok(STARTER_TOOL_NAMES.includes('set_delay'));
  });
  it('exposes 1 resource (PRD F12 DoD)', () => {
    assert.equal(STARTER_RESOURCE_URIS.length, 1);
    assert.ok(STARTER_RESOURCE_URIS.includes('starter://items'));
  });
  it('exposes 1 prompt (PRD F12 DoD)', () => {
    assert.equal(STARTER_PROMPT_NAMES.length, 1);
    assert.ok(STARTER_PROMPT_NAMES.includes('optimize_for_io'));
  });
});
