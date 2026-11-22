/* ============================================================
   main.js — 应用启动 / Hash 路由 / 全局状态
   ============================================================ */

import {
  DIMENSIONS, VOLUMES, MIRRORS, ARCHETYPES, CROSS_RULES, PAIR_RULES,
  DIM_ORDER, DIM_MAP, EXPRESS,
} from './data/bundle.js';

import {
  load, save, reset, loadTheme, saveTheme, encodeSoulCode, decodeSoulCode,
} from './core/storage.js';

import { computeAll, maskIndex } from './core/scoring.js';
import { el, qs, go, parseHash } from './core/utils.js';

import { renderHub } from './components/VolumeHub.js';
import { renderQuiz } from './components/QuizRunner.js';
import { renderReport } from './components/ReportView.js';
import { renderCompare } from './components/CompareView.js';
import { renderExpressIntro, renderExpressResult } from './components/ExpressView.js';
import { buildExpressVolume, seedFromVolumes } from './core/express.js';

/* ------------------------------------------------------------
   数据装配
   ------------------------------------------------------------ */

export const DATA = {
  dimensions: DIMENSIONS,
  volumes: VOLUMES,
  mirrors: MIRRORS,
  archetypes: ARCHETYPES,
  crossRules: CROSS_RULES,
  pairRules: PAIR_RULES,
  dimOrder: DIM_ORDER,
  dimMap: DIM_MAP,
  values: DIMENSIONS.values || [],
  pressureStyles: DIMENSIONS.pressureStyles || [],
  express: EXPRESS,
};

export const VOL_IDS = Object.keys(VOLUMES).sort((a, b) => VOLUMES[a].index - VOLUMES[b].index);

/* ------------------------------------------------------------
   全局状态
   ------------------------------------------------------------ */

export const App = {
  state: load(),
  theme: loadTheme(),
  route: '',
};

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  App.theme = theme;
  saveTheme(theme);
  const btn = qs('#theme-toggle');
  if (btn) {
    btn.setAttribute('aria-label', theme === 'dark' ? '切换到光之纸境' : '切换到暗夜档案馆');
    btn.innerHTML = theme === 'dark'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="4.4"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M20.2 14.6A8.4 8.4 0 1 1 9.4 3.8a6.6 6.6 0 0 0 10.8 10.8Z"/></svg>`;
  }
}

/* ------------------------------------------------------------
   计分刷新
   ------------------------------------------------------------ */

export function recompute({ silent = true } = {}) {
  const s = App.state;

  // 逐卷算分并写回
  const all = computeAll(s, DATA);
  s.computedScores = {};
  for (const d of DIM_ORDER) {
    const v = all.scores[d];
    if (Number.isFinite(v)) s.computedScores[d] = v;
  }

  // 个人内部相对尖峰：报告的「王牌天赋 / 阴影预警」按 |Z| 排序时才用得到
  s.zScores = {};
  for (const d of DIM_ORDER) {
    const z = all.zScores?.[d];
    if (Number.isFinite(z)) s.zScores[d] = z;
  }

  const mask = maskIndex(s, DATA);
  s.maskIndex = mask.value === null ? null : mask.value;
  s.maskDetail = mask;

  // Top3 价值
  s.topValues = all.topValues || [];

  // 压力退行态
  s.pressureStyle = all.pressure || null;

  save(s, { immediate: silent });
  return all;
}

/* ------------------------------------------------------------
   存档码
   ------------------------------------------------------------ */

export function soulCode() {
  return encodeSoulCode(App.state, DIM_ORDER);
}

export function importSoulCode(text, { merge = true } = {}) {
  const res = decodeSoulCode(text, DIM_ORDER);
  if (!res.ok) return res;

  const incoming = res.state;
  if (!merge) {
    App.state = { ...App.state, ...incoming };
  } else {
    const s = App.state;
    s.nickname = s.nickname || incoming.nickname;
    s.completedVolumes = Array.from(new Set([...(s.completedVolumes || []), ...(incoming.completedVolumes || [])]));
    s.computedScores = { ...(incoming.computedScores || {}), ...(s.computedScores || {}) };
    s.maskIndex = Number.isFinite(s.maskIndex) ? s.maskIndex : incoming.maskIndex;
    if (!s.topValues?.length) s.topValues = incoming.topValues || [];
    save(s, { immediate: true });
  }
  recompute({ silent: true });
  return { ok: true, state: App.state };
}

/* ------------------------------------------------------------
   外壳
   ------------------------------------------------------------ */

const BRAND_MARK = `<svg class="brand__mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="0.8" opacity="0.45"/>
  <circle cx="16" cy="16" r="9.5" stroke="currentColor" stroke-width="0.6" opacity="0.28"/>
  <path d="M16 2v28M2 16h28" stroke="currentColor" stroke-width="0.5" opacity="0.22"/>
  <circle cx="16" cy="16" r="3.6" stroke="currentColor" stroke-width="1"/>
  <path d="M16 7.5v2M16 22.5v2M7.5 16h2M22.5 16h2" stroke="currentColor" stroke-width="0.9"/>
</svg>`;

function mountShell() {
  const app = qs('#app');
  app.innerHTML = '';

  const masthead = el('header', { class: 'masthead' });
  const inner = el('div', { class: 'masthead__inner' });

  const brand = el('a', {
    class: 'brand',
    href: '#/',
    'aria-label': '返回卷宗大厅',
  });
  brand.innerHTML = `${BRAND_MARK}
    <span class="brand__name">人性全息图谱</span>
    <span class="brand__latin">The Human Atlas</span>`;
  inner.appendChild(brand);

  const nav = el('nav', { class: 'masthead__nav', 'aria-label': '主导航' });

  const navItems = [
    { href: '#/', label: '卷宗大厅', key: 'hub' },
    { href: '#/report', label: '全息报告', key: 'report' },
    { href: '#/compare', label: '双人对比', key: 'compare' },
  ];

  navItems.forEach((it) => {
    nav.appendChild(el('a', {
      class: 'nav-btn nav-btn--text',
      href: it.href,
      dataset: { nav: it.key },
    }, [el('span', { class: 'nav-btn__label', text: it.label })]));
  });

  const themeBtn = el('button', {
    class: 'theme-toggle',
    id: 'theme-toggle',
    type: 'button',
    onclick: () => applyTheme(App.theme === 'dark' ? 'light' : 'dark'),
  });
  nav.appendChild(themeBtn);

  inner.appendChild(nav);
  masthead.appendChild(inner);
  app.appendChild(masthead);

  const main = el('main', { id: 'view-root', class: 'page' });
  app.appendChild(main);

  applyTheme(App.theme);

  // 键盘快捷键：T 切换主题
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.key === 't' || e.key === 'T') {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      applyTheme(App.theme === 'dark' ? 'light' : 'dark');
    }
  });
}

export function setActiveNav(key) {
  document.querySelectorAll('[data-nav]').forEach((n) => {
    if (n.dataset.nav === key) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });
}

/* ------------------------------------------------------------
   路由
   ------------------------------------------------------------ */

function render(route) {
  const root = qs('#view-root');
  if (!root) return;
  document.body.classList.remove('is-immersive');
  root.innerHTML = '';
  root.className = 'page';

  const { parts } = route;
  const head = parts[0] || '';

  if (head === '' || head === 'hub') {
    setActiveNav('hub');
    renderHub(root, { App, DATA, VOL_IDS, recompute, soulCode, importSoulCode, go });
    return;
  }

  if (head === 'vol' && parts[1]) {
    setActiveNav('hub');
    root.className = 'page page--narrow';
    renderQuiz(root, { App, DATA, volId: parts[1], mode: 'intro', recompute, go });
    return;
  }

  // 极速模式：入口 / 答题 / 简报
  if (head === 'express') {
    document.body.classList.remove('is-immersive');
    if (parts[1] === 'quiz') {
      root.className = 'page page--narrow page--immersive';
      document.body.classList.add('is-immersive');
      const vol = buildExpressVolume(DATA, DATA.express);
      // 只把虚拟卷挂进 DATA，App.state 保持同一个引用 ——
      // 否则 renderQuiz 里的 save() 会写入一份副本，进度就存不回来了。
      const dataWithExpress = { ...DATA, volumes: { ...DATA.volumes, [vol.volume_id]: vol } };
      seedFromVolumes(App.state, vol);
      renderQuiz(root, {
        App,
        DATA: dataWithExpress,
        volId: vol.volume_id,
        mode: 'run',
        recompute,
        go,
      });
      return;
    }
    if (parts[1] === 'result') {
      root.className = 'page';
      renderExpressResult(root, { App, DATA, recompute, soulCode, go });
      return;
    }
    root.className = 'page';
    renderExpressIntro(root, { App, DATA, go });
    return;
  }

  if (head === 'quiz' && parts[1]) {
    setActiveNav('hub');
    root.className = 'page page--narrow page--immersive';
    // 沉浸模式：收起顶栏冗余入口，答题区独占整屏
    document.body.classList.add('is-immersive');
    renderQuiz(root, { App, DATA, volId: parts[1], mode: 'run', recompute, go });
    return;
  }
  document.body.classList.remove('is-immersive');

  if (head === 'report') {
    setActiveNav('report');
    root.className = 'page';
    renderReport(root, { App, DATA, volId: parts[1] || null, VOL_IDS, recompute, soulCode, go });
    return;
  }

  if (head === 'compare') {
    setActiveNav('compare');
    root.className = 'page';
    renderCompare(root, { App, DATA, VOL_IDS, soulCode, importSoulCode, go });
    return;
  }

  // fallback
  go('#/');
}

function onRouteChange() {
  App.route = location.hash || '#/';
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  render(parseHash());
}

/* ------------------------------------------------------------
   启动
   ------------------------------------------------------------ */

export function boot() {
  mountShell();

  // 首次启动：确保分数与当前存档一致
  if (Object.keys(App.state.answersByVolume || {}).length) {
    try { recompute({ silent: true }); } catch (e) { console.warn('[boot] recompute failed', e); }
  }

  if (!location.hash) {
    location.replace('#/');
  }

  window.addEventListener('hashchange', onRouteChange);
  onRouteChange();

  // 导出钩子，供控制台/测试使用
  window.HumanAtlas = {
    App, DATA, recompute, soulCode, importSoulCode,
    reset: () => { App.state = reset(); recompute(); go('#/'); },
  };
}

boot();
