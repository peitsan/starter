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
  // 通过 getTauri() 包装（Tauri 2.x 注入 window.__TAURI__）
  assert.match(js, /getTauri\(\)/);
  assert.match(js, /isTauriReady\(\)/);
  assert.match(js, /__TAURI__/);
  // invoke call sites
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

test('main.js uses i18n t() throughout', () => {
  const js = readFileSync(join(distDir, 'main.js'), 'utf8');
  assert.match(js, /import\s*\{\s*t\s*,\s*setLang/);
  // columns/settings/empty 在 HTML 用 data-i18n，JS 调 t() 处理动态部分
  assert.match(js, /t\(['"]items\.risk\./);
  assert.match(js, /t\(['"]items\.state\./);
  assert.match(js, /t\(['"]items\.toast\./);
  assert.match(js, /t\(['"]items\.meta\./);
  assert.match(js, /t\(['"]items\.loading['"]/);
  assert.match(js, /t\(['"]timeline\./);
  assert.match(js, /t\(['"]buttons\./);
  assert.match(js, /t\(['"]common\.loading['"]/);
  // applyI18n + lang switcher
  assert.match(js, /applyI18n\(\)/);
  assert.match(js, /langSelect\.addEventListener\(['"]change['"]/);
});

test('index.html has data-i18n for items.empty and settings labels', () => {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  assert.match(html, /data-i18n="items\.empty"/);
  assert.match(html, /data-i18n="settings\.title"/);
  assert.match(html, /data-i18n="settings\.diskIo"/);
  assert.match(html, /data-i18n="settings\.windowsService"/);
  assert.match(html, /data-i18n="settings\.doctor"/);
  assert.match(html, /data-i18n="settings\.quickActions"/);
});
test('i18n module + 2 lang files exist', () => {
  const i18n = readFileSync(join(distDir, 'i18n.js'), 'utf8');
  assert.match(i18n, /export function t\b/);
  assert.match(i18n, /export function setLang\b/);
  assert.match(i18n, /export function initLang\b/);
  assert.match(i18n, /export function applyI18n\b/);
  assert.match(i18n, /zh-CN/);
  assert.match(i18n, /DEFAULT_LANG\s*=\s*['"]zh-CN['"]/);
  for (const f of ['zh-CN.js', 'en.js']) {
    const p = join(distDir, 'lang', f);
    assert.equal(existsSync(p), true, `${f} missing`);
  }
});

test('lang zh-CN has 简体中文 for tabs', () => {
  const zh = readFileSync(join(distDir, 'lang', 'zh-CN.js'), 'utf8');
  assert.match(zh, /tabs:\s*\{/);
  assert.match(zh, /items:\s*['"]启动项['"]/);
  assert.match(zh, /timeline:\s*['"]时间线['"]/);
  assert.match(zh, /settings:\s*['"]设置['"]/);
});

test('lang en has English for tabs', () => {
  const en = readFileSync(join(distDir, 'lang', 'en.js'), 'utf8');
  assert.match(en, /tabs:\s*\{/);
  assert.match(en, /items:\s*['"]Items['"]/);
  assert.match(en, /timeline:\s*['"]Timeline['"]/);
  assert.match(en, /settings:\s*['"]Settings['"]/);
});

test('index.html has data-i18n on all visible strings', () => {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  // 关键元素都有 data-i18n
  assert.match(html, /data-i18n="tabs\.items"/);
  assert.match(html, /data-i18n="tabs\.timeline"/);
  assert.match(html, /data-i18n="tabs\.settings"/);
  assert.match(html, /data-i18n="items\.columns\.name"/);
  assert.match(html, /data-i18n-attr="placeholder:search\.placeholder"/);
  // lang selector
  assert.match(html, /<select id="lang-select"/);
  assert.match(html, /<option value="zh-CN">/);
  assert.match(html, /<option value="en">/);
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
