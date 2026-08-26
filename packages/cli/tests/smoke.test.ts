import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

describe('cli smoke', () => {
  it('placeholder passes', () => {
    assert.equal(1 + 1, 2);
  });
});
