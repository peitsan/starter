import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, ensureAuthToken, startHttpServer } from '../src/config.js';

describe('loadConfig', () => {
  it('uses overrides', () => {
    const c = loadConfig({ port: 9999, dataDir: join(tmpdir(), 'starter-test-cfg') });
    assert.equal(c.port, 9999);
    assert.ok(c.dataDir.endsWith('starter-test-cfg'));
  });
  it('creates data dir', () => {
    const p = join(tmpdir(), `starter-cfg-${Date.now()}`);
    if (existsSync(p)) rmSync(p, { recursive: true });
    assert.equal(existsSync(p), false);
    loadConfig({ dataDir: p });
    assert.equal(existsSync(p), true);
    rmSync(p, { recursive: true });
  });
});

describe('ensureAuthToken', () => {
  it('generates and persists a token', () => {
    const p = join(tmpdir(), `starter-token-${Date.now()}.txt`);
    const t1 = ensureAuthToken(p);
    assert.match(t1, /^[0-9a-f]{64}$/);
    const t2 = ensureAuthToken(p);
    assert.equal(t1, t2);
    rmSync(p);
  });
});

describe('startHttpServer', () => {
  it('responds /health without auth', async () => {
    const p = join(tmpdir(), `starter-http-${Date.now()}`);
    const cfg = loadConfig({ port: 0, dataDir: p });
    const token = ensureAuthToken(cfg.authTokenPath);
    let resolved = 0;
    const server = startHttpServer({
      config: cfg,
      authToken: token,
      handle: async (m) => {
        resolved = resolved + 1;
        return { method: m };
      },
    });
    await new Promise<void>((r) => server.on('listening', () => r()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const port = addr.port;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
    // rpc needs auth
    const res401 = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', body: '{}' });
    assert.equal(res401.status, 401);
    // rpc with auth
    const res200 = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'ping' }),
    });
    assert.equal(res200.status, 200);
    const out = (await res200.json()) as { ok: boolean; result: { method: string } };
    assert.equal(out.ok, true);
    assert.equal(out.result.method, 'ping');
    assert.equal(resolved, 1);
    server.close();
    rmSync(p, { recursive: true });
  });
  it('400 on invalid json', async () => {
    const p = join(tmpdir(), `starter-http-bad-${Date.now()}`);
    const cfg = loadConfig({ port: 0, dataDir: p });
    const token = ensureAuthToken(cfg.authTokenPath);
    const server = startHttpServer({
      config: cfg,
      authToken: token,
      handle: async () => ({}),
    });
    await new Promise<void>((r) => server.on('listening', () => r()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const port = addr.port;
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{ not json',
    });
    assert.equal(res.status, 400);
    server.close();
    rmSync(p, { recursive: true });
  });
  it('500 on handler throw', async () => {
    const p = join(tmpdir(), `starter-http-err-${Date.now()}`);
    const cfg = loadConfig({ port: 0, dataDir: p });
    const token = ensureAuthToken(cfg.authTokenPath);
    const server = startHttpServer({
      config: cfg,
      authToken: token,
      handle: async () => {
        throw new Error('boom');
      },
    });
    await new Promise<void>((r) => server.on('listening', () => r()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const port = addr.port;
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'x' }),
    });
    assert.equal(res.status, 500);
    const out = (await res.json()) as { ok: boolean; error: string };
    assert.equal(out.ok, false);
    assert.match(out.error, /boom/);
    server.close();
    rmSync(p, { recursive: true });
  });
});
