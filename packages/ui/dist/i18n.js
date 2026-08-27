// 极简 i18n：dict + t(key, vars?)
// 用法：
//   import { t, setLang, getLang, listLangs } from './i18n.js'
//   t('items.title')                         // "启动项" or "Items"
//   t('meta.itemCount', { n: 36 })           // "36 项" or "36 items"
//   setLang('zh-CN') / 'en'
//   getLang() → 'zh-CN' | 'en'
//   listLangs() → [{ code, label }]

import en from './lang/en.js';
import zhCN from './lang/zh-CN.js';

const DICTS = { en, 'zh-CN': zhCN };
const SUPPORTED = ['zh-CN', 'en'];
const DEFAULT_LANG = 'zh-CN';
const STORAGE_KEY = 'starter.lang';

let current = DEFAULT_LANG;

function detectBrowserLang() {
  const nav = typeof navigator !== 'undefined' ? navigator.language : DEFAULT_LANG;
  if (!nav) return DEFAULT_LANG;
  // 精确匹配
  if (DICTS[nav]) return nav;
  // zh-* → zh-CN（目前只有简体）
  if (nav.toLowerCase().startsWith('zh')) return 'zh-CN';
  // en-* → en
  if (nav.toLowerCase().startsWith('en')) return 'en';
  return DEFAULT_LANG;
}

function loadSaved() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && DICTS[v]) return v;
  } catch {
    // localStorage 可能不可用（隐私模式）
  }
  return null;
}

export function getLang() { return current; }
export function listLangs() {
  return [
    { code: 'zh-CN', label: '简体中文' },
    { code: 'en', label: 'English' },
  ];
}

export function setLang(code) {
  if (!DICTS[code]) return false;
  current = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* */ }
  return true;
}

export function initLang(saved) {
  const v = saved ?? loadSaved() ?? detectBrowserLang();
  if (DICTS[v]) current = v;
  return current;
}

// 翻译：t('a.b.c', { name: 'x' })
// 支持 {{name}} 占位符
export function t(key, vars) {
  const parts = key.split('.');
  let v = DICTS[current];
  for (const p of parts) {
    if (v == null) return key;
    v = v[p];
  }
  if (typeof v !== 'string') return key;
  if (!vars) return v;
  return v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''));
}

// 把 data-i18n 元素全部翻译
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    const v = t(k);
    if (v && v !== k) el.textContent = v;
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    const spec = el.getAttribute('data-i18n-attr'); // e.g. "title:items.title;placeholder:search.placeholder"
    for (const pair of spec.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (!attr || !key) continue;
      const v = t(key);
      if (v && v !== key) el.setAttribute(attr, v);
    }
  });
  // html lang attr
  document.documentElement.setAttribute('lang', current);
}
