import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Dag } from '../src/index.js';
import type { StartupItemRow } from '../src/index.js';

function row(id: string, delay = 0): StartupItemRow {
  return {
    id,
    name: id,
    command: 'cmd',
    source: 'HKCU_Run',
    source_path: 'p',
    enabled: 1,
    delay_ms: delay,
    priority: 3,
    risk: 'normal',
    vendor: null,
    updated_at: 0,
  };
}

describe('Dag.validate', () => {
  it('ok on no deps', () => {
    const r = Dag.validate([row('A'), row('B')], new Map());
    assert.equal(r.ok, true);
  });
  it('detects cycle', () => {
    const deps = new Map([
      ['A', ['B']],
      ['B', ['A']],
    ]);
    const r = Dag.validate([row('A'), row('B')], deps);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.cycle.length > 0);
      assert.ok(r.cycle.includes('A') && r.cycle.includes('B'));
    }
  });
  it('detects 3-cycle', () => {
    const deps = new Map([
      ['A', ['B']],
      ['B', ['C']],
      ['C', ['A']],
    ]);
    const r = Dag.validate([row('A'), row('B'), row('C')], deps);
    assert.equal(r.ok, false);
  });
  it('ok on linear chain', () => {
    const deps = new Map([
      ['A', ['B']],
      ['B', ['C']],
    ]);
    const r = Dag.validate([row('A'), row('B'), row('C')], deps);
    assert.equal(r.ok, true);
  });
});

describe('Dag.readyNodes', () => {
  it('returns nodes with no deps', () => {
    const dag = new Dag([row('A'), row('B')], new Map());
    const ready = dag.readyNodes(0);
    assert.equal(ready.length, 2);
  });
  it('blocks on not-done deps', () => {
    const dag = new Dag([row('A'), row('B')], new Map([['B', ['A']]]));
    const ready = dag.readyNodes(0);
    assert.equal(ready.length, 1);
    assert.equal(ready[0]?.item.id, 'A');
  });
  it('releases B after A done', () => {
    const dag = new Dag([row('A'), row('B')], new Map([['B', ['A']]]));
    assert.equal(dag.readyNodes(0).length, 1);
    dag.setStatus('A', 'done');
    const ready = dag.readyNodes(0);
    assert.equal(ready.length, 1);
    assert.equal(ready[0]?.item.id, 'B');
  });
  it('respects delay_ms', () => {
    const dag = new Dag([row('A', 5000), row('B')], new Map());
    assert.equal(dag.readyNodes(0).length, 1); // only B
    assert.equal(dag.readyNodes(4999).length, 1);
    assert.equal(dag.readyNodes(5000).length, 2);
  });
  it('treats missing dep as blocking', () => {
    const dag = new Dag([row('A')], new Map([['A', ['ghost']]]));
    assert.equal(dag.readyNodes(0).length, 0);
  });
});

describe('Dag.allTerminal', () => {
  it('false while any pending/running', () => {
    const dag = new Dag([row('A'), row('B')], new Map());
    assert.equal(dag.allTerminal(), false);
    dag.setStatus('A', 'done');
    assert.equal(dag.allTerminal(), false);
    dag.setStatus('B', 'done');
    assert.equal(dag.allTerminal(), true);
  });
});
