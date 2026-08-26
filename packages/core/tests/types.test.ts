import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { SCHEMA_VERSION } from '../src/index.js';

describe('core types', () => {
  it('exposes schema version v1', () => {
    assert.equal(SCHEMA_VERSION, 'v1');
  });
});
