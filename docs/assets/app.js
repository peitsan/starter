/* ============================================================
   Starter Docs — SPA logic
   - Hash routing: #/<mode>/<page>
   - Human / Agent mode toggle
   - Sidebar navigation per mode
   - Markdown rendering (marked + highlight.js) with copy buttons
   - Theme (light/dark) + version selector
   ============================================================ */
(function () {
  'use strict';

  // ---- Content manifest -------------------------------------------------
  // Each mode has its own nav tree. Page keys map to a markdown file under
  // content/<mode>/<page>.md  (files live next to this app in /docs/content).
  const MANIFEST = {
    human: {
      label: 'Human',
      icon: '👤',
      groups: [
        {
          title: '入门',
          items: [
            { key: 'overview', label: '项目概览', icon: '🏠' },
            { key: 'quick-start', label: '快速开始', icon: '🚀' },
            { key: 'features', label: '核心特性', icon: '✨' },
          ],
        },
        {
          title: '指南',
          items: [
            { key: 'architecture', label: '架构设计', icon: '🏗' },
            { key: 'cli', label: 'CLI 命令行', icon: '⌨️' },
            { key: 'mcp', label: '接入 LLM Agent', icon: '🤖' },
            { key: 'roadmap', label: '路线图', icon: '🗺' },
          ],
        },
        {
          title: '参考',
          items: [
            { key: 'dev-log', label: '开发日志', icon: '📓' },
            { key: 'prd', label: 'PRD', icon: '📄' },
            { key: 'mrd', label: 'MRD', icon: '📊' },
          ],
        },
      ],
    },
    agent: {
      label: 'Agent',
      icon: '🤖',
      groups: [
        {
          title: 'Agent 快速上手',
          items: [
            { key: 'guide', label: 'Agent 指南', icon: '🧭' },
            { key: 'quick-start', label: '30 秒上手', icon: '⚡' },
          ],
        },
        {
          title: 'MCP / API',
          items: [
            { key: 'mcp-tools', label: '工具一览', icon: '🛠' },
            { key: 'api', label: 'MCP API 参考', icon: '🔌' },
            { key: 'resources', label: '资源 & Prompts', icon: '🗂' },
          ],
        },
        {
          title: '参考',
          items: [
            { key: 'errors', label: '错误码', icon: '🚨' },
            { key: 'scenarios', label: '常见场景', icon: '💡' },
            { key: 'constraints', label: '约束 & 安全', icon: '🔒' },
          ],
        },
      ],
    },
  };

  // ---- DOM refs ----------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const contentEl = $('#markdown');
  const loadingEl = $('#loading');
  const sidebarNav = $('#sidebar-nav');
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  const menuToggle = $('#menu-toggle');
  const themeToggle = $('#theme-toggle');
  const versionSelect = $('#version-select');

  // ---- State -------------------------------------------------------------
  let mode = 'human';
  let page = 'overview';
  const supported = (m) => MANIFEST[m] !== undefined;

  function currentPath() {
    return `content/${mode}/${page}.md`;
  }

  // ---- Routing -----------------------------------------------------------
  function parseHash() {
    const raw = decodeURIComponent(window.location.hash || '');
    const parts = raw.replace(/^#\/?/, '').split('/').filter(Boolean);
    // Support #/human/overview, #/overview, #/
    if (parts.length >= 2 && supported(parts[0])) {
      mode = parts[0];
      page = parts[1];
    } else if (parts.length >= 1 && supported(parts[0])) {
      mode = parts[0];
      page = 'overview';
    } else if (parts.length >= 1) {
      mode = 'human';
      page = parts[0];
    } else {
      mode = 'human';
      page = 'overview';
    }
    // fallback if page unknown
    if (!pageInMode(mode, page)) page = 'overview';
  }

  function pageInMode(m, key) {
    return MANIFEST[m].groups.some((g) => g.items.some((i) => i.key === key));
  }

  function go(m, p) {
    window.location.hash = `#/${m}/${p}`;
  }

  // ---- Sidebar -----------------------------------------------------------
  function renderSidebar() {
    const groups = MANIFEST[mode].groups;
    sidebarNav.innerHTML = '';
    for (const group of groups) {
      const gt = document.createElement('div');
      gt.className = 'nav-group';
      gt.textContent = group.title;
      sidebarNav.appendChild(gt);
      for (const item of group.items) {
        const a = document.createElement('a');
        a.className = 'nav-link' + (item.key === page ? ' active' : '');
        a.href = `#/${mode}/${item.key}`;
        a.innerHTML = `<span class="nav-icon">${item.icon}</span>${item.label}`;
        sidebarNav.appendChild(a);
      }
    }
  }

  function setActiveNav() {
    sidebarNav.querySelectorAll('.nav-link').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === `#/${mode}/${page}`);
    });
  }

  // ---- Markdown rendering ------------------------------------------------
  function initMarked() {
    const renderer = new marked.Renderer();

    // Language badge + copy button on code blocks
    const originalCode = renderer.code.bind(renderer);
    renderer.code = function (code, infostring, escaped) {
      const lang = (infostring || '').split(/\s+/)[0] || '';
      const header = document.createElement('div');
      header.className = 'code-header';
      const langLabel = document.createElement('span');
      langLabel.textContent = lang ? lang.toUpperCase() : 'CODE';
      const copy = document.createElement('button');
      copy.className = 'copy-btn';
      copy.textContent = '复制';
      copy.onclick = function () {
        navigator.clipboard.writeText(code).then(() => {
          copy.textContent = '✓ 已复制';
          setTimeout(() => (copy.textContent = '复制'), 1500);
        });
      };
      header.appendChild(langLabel);
      header.appendChild(copy);
      const pre = document.createElement('pre');
      pre.innerHTML = originalCode(code, infostring, escaped);
      // highlight after insert
      requestAnimationFrame(() => {
        pre.querySelectorAll('code').forEach((c) => {
          if (lang && window.hljs && hljs.getLanguage(lang)) {
            try { c.innerHTML = hljs.highlight(c.textContent, { language: lang }).value; c.className = `hljs language-${lang}`; } catch (e) {}
          }
        });
      });
      return header.outerHTML + pre.outerHTML;
    };

    marked.setOptions({
      renderer,
      gfm: true,
      breaks: false,
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function loadContent() {
    loadingEl.style.display = 'block';
    contentEl.innerHTML = '';
    try {
      const res = await fetch(currentPath(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const md = await res.text();
      const html = marked.parse(md);
      const banner = MANIFEST[mode].label;
      contentEl.innerHTML =
        `<div class="mode-banner ${mode}">${mode === 'human' ? '👤' : '🤖'} 当前为 <b>${banner}</b> 模式文档${mode === 'agent' ? ' — 面向 LLM / AI 代理优化' : ' — 面向人类读者'}</div>` +
        html;
      // highlight already handled inside renderer
    } catch (err) {
      contentEl.innerHTML =
        `<div class="mode-banner ${mode}">${MANIFEST[mode].label} 模式</div>` +
        `<h1>内容加载失败</h1><p>无法加载 <code>${escapeHtml(currentPath())}</code>。</p>` +
        `<p>错误：${escapeHtml(String(err))}</p>`;
    } finally {
      loadingEl.style.display = 'none';
    }
  }

  // ---- Theme -------------------------------------------------------------
  function initTheme() {
    let theme = localStorage.getItem('starter-theme') || 'light';
    applyTheme(theme);
    themeToggle.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('starter-theme', theme);
    const light = $('#hljs-light');
    const dark = $('#hljs-dark');
    if (light) light.disabled = theme === 'dark';
    if (dark) dark.disabled = theme !== 'dark';
  }

  // ---- Version selector --------------------------------------------------
  function initVersion() {
    const saved = localStorage.getItem('starter-version');
    if (saved) versionSelect.value = saved;
    versionSelect.addEventListener('change', () => {
      localStorage.setItem('starter-version', versionSelect.value);
      // single version content today; reload to keep URL clean
      location.reload();
    });
  }

  // ---- Mode buttons ------------------------------------------------------
  function initModeButtons() {
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-mode');
        if (m === mode) return;
        go(m, 'overview');
      });
    });
  }

  function syncModeUI() {
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      const on = btn.getAttribute('data-mode') === mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  // ---- Mobile sidebar ----------------------------------------------------
  function initMobile() {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('show');
    });
    backdrop.addEventListener('click', closeSidebar);
    sidebar.addEventListener('click', (e) => {
      if (e.target.closest('.nav-link')) closeSidebar();
    });
    function closeSidebar() {
      sidebar.classList.remove('open');
      backdrop.classList.remove('show');
    }
  }

  // ---- Boot --------------------------------------------------------------
  function boot() {
    initMarked();
    initTheme();
    initVersion();
    initModeButtons();
    initMobile();

    parseHash();
    renderSidebar();
    syncModeUI();
    loadContent();

    window.addEventListener('hashchange', () => {
      parseHash();
      renderSidebar();
      syncModeUI();
      setActiveNav();
      loadContent();
      window.scrollTo(0, 0);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
