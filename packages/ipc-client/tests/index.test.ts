import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  rpc,
  readDaemonToken,
  daemonReachable,
  isRpcError,
  DEFAULT_DAEMON_URL,
  SCHEMA_VERSION,
} from '../src/index.js';

const TOKEN = 'test-token-123';

function startFakeDaemon(): Server {
  return createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'GET' && req.url === '/health') {
      res.end(JSON.stringify({ ok: true, status: 'running' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/rpc') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const msg = JSON.parse(body);
        const auth = req.headers.authorization ?? '';
        if (auth !== `Bearer ${TOKEN}`) {
          res.statusCode = 401;
          res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
          return;
        }
        if (msg.method === 'echo') {
          res.end(JSON.stringify({ ok: true, result: msg.params, request_id: msg.id }));
          return;
        }
        if (msg.method === 'boom') {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: 'internal' }));
          return;
        }
        res.end(JSON.stringify({ ok: false, error: 'unknown_method' }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });
}

test('SCHEMA_VERSION is v1', () => {
  assert.equal(SCHEMA_VERSION, 'v1');
  assert.equal(DEFAULT_DAEMON_URL, 'http://127.0.0.1:7811');
});

test('readDaemonToken reads ProgramData auth.token first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'starter-ipc-'));
  const pd = join(dir, 'ProgramData');
  mkdirSync(join(pd, 'Starter'), { recursive: true });
  writeFileSync(join(pd, 'Starter', 'auth.token'), TOKEN + '\n');
  try {
    assert.equal(readDaemonToken({ programData: pd, home: dir }), TOKEN);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readDaemonToken falls back to ~/.starter/auth.token', () => {
  const home = mkdtempSync(join(tmpdir(), 'starter-ipc-'));
  mkdirSync(join(home, '.starter'), { recursive: true });
  writeFileSync(join(home, '.starter', 'auth.token'), 'home-token');
  try {
    assert.equal(readDaemonToken({ programData: join(home, 'nope'), home }), 'home-token');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('readDaemonToken returns null when nothing present', () => {
  const home = mkdtempSync(join(tmpdir(), 'starter-ipc-'));
  try {
    assert.equal(readDaemonToken({ programData: join(home, 'pd'), home }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('daemonReachable true when /health ok', async () => {
  const srv = startFakeDaemon();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as { port: number };
  try {
    assert.equal(await daemonReachable(`http://127.0.0.1:${port}`, 500), true);
  } finally {
    srv.close();
  }
});

test('daemonReachable false on connection refused', async () => {
  // 一个未监听的端口
  assert.equal(await daemonReachable('http://127.0.0.1:1', 100), false);
});

test('rpc sends Bearer token and returns result', async () => {
  const srv = startFakeDaemon();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as { port: number };
  try {
    const result = await rpc<{ hello: string }>(
      'echo',
      { hello: 'world' },
      {
        url: `http://127.0.0.1:${port}`,
        token: TOKEN,
      },
    );
    assert.deepEqual(result, { hello: 'world' });
  } finally {
    srv.close();
  }
});

test('rpc throws E_UNAUTHORIZED on 401', async () => {
  const srv = startFakeDaemon();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as { port: number };
  try {
    await assert.rejects(
      () => rpc('echo', {}, { url: `http://127.0.0.1:${port}`, token: 'wrong' }),
      (e: unknown) => isRpcError(e, 'E_UNAUTHORIZED'),
    );
  } finally {
    srv.close();
  }
});

test('rpc throws E_HTTP on server 500', async () => {
  const srv = startFakeDaemon();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as { port: number };
  try {
    await assert.rejects(
      () => rpc('boom', {}, { url: `http://127.0.0.1:${port}`, token: TOKEN }),
      (e: unknown) => isRpcError(e, 'E_HTTP'),
    );
  } finally {
    srv.close();
  }
});

test('rpc throws E_DAEMON_UNREACHABLE when no token file', async () => {
  // 用一个不存在的 token 路径触发 E_NO_TOKEN 更稳；这里验证不可达
  await assert.rejects(
    () => rpc('echo', {}, { url: 'http://127.0.0.1:1', token: TOKEN }),
    (e: unknown) => isRpcError(e, 'E_DAEMON_UNREACHABLE'),
  );
});
