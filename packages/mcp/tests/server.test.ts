/**
 * MCP Server 单元测试：
 *  - 不真起 stdio 传输（避免测试卡住）
 *  - 直接 import server.ts 会 connect stdio — 改为只 import catalog.ts
 *
 * 这里只验证：list tools / list resources / list prompts 的 schema 数据
 * 这些数据是从 SDK constants 派生的，写个 server 端常量导出以便测
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { STARTER_TOOL_NAMES, STARTER_RESOURCE_URIS, STARTER_PROMPT_NAMES } from '../src/catalog.js';

describe('catalog', () => {
  it('exposes 17 tools (Agent Settings: full startup control)', () => {
    assert.equal(STARTER_TOOL_NAMES.length, 17);
    // 基础 5
    assert.ok(STARTER_TOOL_NAMES.includes('scan_startup_items'));
    assert.ok(STARTER_TOOL_NAMES.includes('list_startup_items'));
    assert.ok(STARTER_TOOL_NAMES.includes('enable_startup_item'));
    assert.ok(STARTER_TOOL_NAMES.includes('disable_startup_item'));
    assert.ok(STARTER_TOOL_NAMES.includes('set_delay'));
    // 详情 + 优先级
    assert.ok(STARTER_TOOL_NAMES.includes('show_startup_item'));
    assert.ok(STARTER_TOOL_NAMES.includes('set_priority'));
    // DAG 依赖
    assert.ok(STARTER_TOOL_NAMES.includes('add_dependency'));
    assert.ok(STARTER_TOOL_NAMES.includes('remove_dependency'));
    assert.ok(STARTER_TOOL_NAMES.includes('list_dependencies'));
    // 批量 / 撤销
    assert.ok(STARTER_TOOL_NAMES.includes('apply_preset'));
    assert.ok(STARTER_TOOL_NAMES.includes('undo_last_change'));
    // 调度 / 诊断
    assert.ok(STARTER_TOOL_NAMES.includes('schedule_run'));
    assert.ok(STARTER_TOOL_NAMES.includes('doctor'));
    assert.ok(STARTER_TOOL_NAMES.includes('io_status'));
    assert.ok(STARTER_TOOL_NAMES.includes('service_status'));
    assert.ok(STARTER_TOOL_NAMES.includes('timeline'));
  });
  it('exposes 3 resources (items + timeline + doctor)', () => {
    assert.equal(STARTER_RESOURCE_URIS.length, 3);
    assert.ok(STARTER_RESOURCE_URIS.includes('starter://items'));
    assert.ok(STARTER_RESOURCE_URIS.includes('starter://timeline'));
    assert.ok(STARTER_RESOURCE_URIS.includes('starter://doctor'));
  });
  it('exposes 3 prompts (optimize / diagnose / safe_disable)', () => {
    assert.equal(STARTER_PROMPT_NAMES.length, 3);
    assert.ok(STARTER_PROMPT_NAMES.includes('optimize_for_io'));
    assert.ok(STARTER_PROMPT_NAMES.includes('diagnose_slow_boot'));
    assert.ok(STARTER_PROMPT_NAMES.includes('safe_disable_plan'));
  });
});
