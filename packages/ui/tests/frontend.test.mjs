// Starter UI — frontend asset 验证
// 跑 node 验证 index.html / main.js 存在 + 可解析

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

test('dist directory exists with required files', () => {
  assert.equal(existsSync(distDir), true, `dist dir missing: ${distDir}`);
  const entries = readdirSync(distDir);
  assert.ok(entries.includes('index.html'), 'index.html missing');
  assert.ok(entries.includes('main.js'), 'main.js missing');
});

test('index.html references main.js', () => {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  assert.match(html, /<script[^>]+src=["']\.\/main\.js["']/);
});

test('main.js uses Tauri invoke API', () => {
  const js = readFileSync(join(distDir, 'main.js'), 'utf8');
  assert.match(js, /window\.__TAURI__\.core/);
  assert.match(js, /invoke\(['"]list_items['"]/);
  assert.match(js, /invoke\(['"]enable_item['"]/);
  assert.match(js, /invoke\(['"]disable_item['"]/);
  assert.match(js, /invoke\(['"]set_delay['"]/);
  assert.match(js, /invoke\(['"]scan_items['"]/);
  assert.match(js, /invoke\(['"]timeline['"]/);
  assert.match(js, /invoke\(['"]io_status['"]/);
  assert.match(js, /invoke\(['"]service_status['"]/);
});

test('index.html has 3 tabs (items/timeline/settings)', () => {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  assert.match(html, /data-tab="items"/);
  assert.match(html, /data-tab="timeline"/);
  assert.match(html, /data-tab="settings"/);
  assert.match(html, /id="timeline-svg"/);
  assert.match(html, /id="io-status"/);
  assert.match(html, /id="service-status"/);
});

test('main.js has gantt drawing + tab switching + tray events', () => {
  const js = readFileSync(join(distDir, 'main.js'), 'utf8');
  assert.match(js, /function drawGantt/);
  assert.match(js, /function switchTab/);
  assert.match(js, /listen\(['"]tray-timeline['"]/);
  assert.match(js, /listen\(['"]tray-io['"]/);
});

test('tauri config references correct frontend', () => {
  const cfg = JSON.parse(
    readFileSync(join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );
  assert.equal(cfg.build.frontendDist, '../dist');
  assert.equal(cfg.app.windows[0].label, 'main');
  assert.equal(cfg.app.windows[0].visible, false);
  assert.ok(cfg.app.trayIcon, 'tray icon missing');
});

test('cargo manifest declares required deps', () => {
  const toml = readFileSync(join(__dirname, '..', 'src-tauri', 'Cargo.toml'), 'utf8');
  assert.match(toml, /tauri\s*=\s*\{[^}]*version\s*=\s*"2"/);
  assert.match(toml, /tray-icon/);
  assert.match(toml, /reqwest/);
  assert.match(toml, /tokio/);
});

test('icon files exist', () => {
  const iconsDir = join(__dirname, '..', 'src-tauri', 'icons');
  for (const f of ['32x32.png', '128x128.png', 'icon.png', 'icon.ico']) {
    const p = join(iconsDir, f);
    assert.equal(existsSync(p), true, `${f} missing`);
    const sz = statSync(p).size;
    assert.ok(sz > 0, `${f} is empty`);
  }
});
