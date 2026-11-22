/* ============================================================
   VolumeHub.js — 卷宗大厅（v4.2 · 双季十六卷）
   · 双辑切换：本源八卷 / 破圈深水八卷 / 全部
   · 十六卷卡片矩阵（专属几何纹章水印 + 中文维度短标签 + 火漆状态章）
   · 五阶渐进解锁进度盘
   · 昵称、导入/导出存档码、双人对比入口
   ============================================================ */

import { el, go, clamp, round, toast } from '../core/utils.js';
import { save, hasProgress, answeredCount, importJSON, reset } from '../core/storage.js';
import { emblemSvg } from '../viz/emblemsSvg.js';
import {
  openNicknameDialog, openImportDialog, openSoulDialog, confirmDialog,
} from './Dialogs.js';

/** 五阶渐进解锁 —— 与文档 1.1 对齐 */
const STAGES = [
  { key: 'lv1', need: 1, name: '单维透视', desc: '单卷报告 · 四面镜 · 9:16 海报' },
  { key: 'lv2', need: 3, name: '交叉读心', desc: '跨卷化学反应引擎激活' },
  { key: 'lv3', need: 5, name: '面具显影', desc: '常态 / 高压叠层与面具校准' },
  { key: 'lv4', need: 8, name: '宇宙大成', desc: '核心八卷闭环 · 全息白皮书' },
  { key: 'lv5', need: 16, name: '破圈全启', desc: '十六卷全通 · 终极典藏版' },
];

/* ------------------------------------------------------------
   进度盘
   ------------------------------------------------------------ */

function progressDial(doneCount, total) {
  const size = 168;
  const r = 74;
  const C = 2 * Math.PI * r;
  const frac = clamp(doneCount / Math.max(1, total), 0, 1);
  const segs = Math.max(8, total);

  const wrap = el('div', { class: 'dial' });
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      n.setAttribute(k, String(v));
    }
    return n;
  };

  s.appendChild(mk('circle', {
    cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--border)', 'stroke-width': 1,
  }));

  // 刻度环
  const tickCount = segs * 4;
  for (let i = 0; i < tickCount; i += 1) {
    const a = (Math.PI * 2 * i) / tickCount - Math.PI / 2;
    const r1 = r + 8;
    const r2 = r + (i % 4 === 0 ? 13 : 10.5);
    s.appendChild(mk('line', {
      x1: size / 2 + Math.cos(a) * r1,
      y1: size / 2 + Math.sin(a) * r1,
      x2: size / 2 + Math.cos(a) * r2,
      y2: size / 2 + Math.sin(a) * r2,
      stroke: 'var(--border)',
      'stroke-width': 0.7,
      opacity: i % 4 === 0 ? 0.9 : 0.45,
    }));
  }

  const arc = mk('circle', {
    cx: size / 2, cy: size / 2, r,
    fill: 'none',
    stroke: 'var(--gold)',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-dasharray': `${C}`,
    'stroke-dashoffset': `${C}`,
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
  });
  s.appendChild(arc);

  for (let i = 0; i < segs; i += 1) {
    const a = (Math.PI * 2 * i) / segs - Math.PI / 2;
    const rr = r - 1;
    const x = size / 2 + Math.cos(a) * rr;
    const y = size / 2 + Math.sin(a) * rr;
    const on = i < doneCount;
    s.appendChild(mk('circle', {
      cx: x, cy: y,
      r: on ? 3.2 : 2,
      fill: on ? 'var(--gold)' : 'var(--bg-card)',
      stroke: on ? 'var(--gold)' : 'var(--border-strong)',
      'stroke-width': 1,
    }));
  }

  wrap.appendChild(s);

  const center = el('div', { class: 'dial__center' }, [
    el('div', { class: 'dial__value', text: `${doneCount}` }),
    el('div', { class: 'dial__unit', text: `OF ${total} VOLUMES` }),
  ]);
  wrap.appendChild(center);

  requestAnimationFrame(() => {
    arc.style.transition = 'stroke-dashoffset 1200ms cubic-bezier(0.22,0.61,0.36,1)';
    arc.style.strokeDashoffset = `${C * (1 - frac)}`;
  });

  return wrap;
}

/* ------------------------------------------------------------
   卷卡片
   ------------------------------------------------------------ */

function volumeCard(vol, { state, dimMap, onOpen }) {
  const done = state.completedVolumes.includes(vol.volume_id);
  const started = hasProgress(state, vol.volume_id);
  const ansCount = answeredCount(state, vol.volume_id);
  const total = vol.questions.length;
  const pct = round((ansCount / total) * 100, 1);

  const status = done ? 'done' : started ? 'progress' : 'sealed';
  const statusText = done ? '已归档' : started ? `已答 ${ansCount}/${total}` : '未启封';

  const card = el('button', {
    class: 'vol-card',
    type: 'button',
    style: { '--vc': vol.theme_color },
    dataset: { state: status },
    onclick: () => onOpen(vol.volume_id),
  });

  card.appendChild(el('span', { class: 'vol-card__edge' }));

  // 专属几何纹章：右上角低透明度水印
  const emblem = emblemSvg(vol.volume_id, {
    class: 'vol-card__emblem',
    strokeWidth: 1.05,
  });
  card.appendChild(emblem);

  // 大号卷号
  card.appendChild(el('span', {
    class: 'vol-card__numeral',
    text: String(vol.index).padStart(2, '0'),
  }));

  card.appendChild(el('div', { class: 'vol-card__top' }, [
    el('span', { class: 'vol-card__no', text: `VOL ${String(vol.index).padStart(2, '0')}` }),
    el('span', { class: 'vol-card__state', dataset: { s: status }, text: statusText }),
  ]));

  card.appendChild(el('h3', { class: 'vol-card__title', text: vol.title }));
  card.appendChild(el('p', { class: 'vol-card__sub', text: vol.subtitle }));

  // 维度一律走中文短标签，绝不暴露英文 id
  const named = (vol.dimensions || []).map((d) => dimMap[d]?.name).filter(Boolean);
  if (named.length) {
    card.appendChild(el('p', {
      class: 'vol-card__dims',
      text: named.slice(0, 3).join(' · ')
        + (named.length > 3 ? ` 等 ${named.length} 维` : ''),
    }));
  }

  const foot = el('div', { class: 'vol-card__foot' }, [
    el('span', { class: 'vol-card__meta', text: `${total} 题 · 约 ${vol.estimated_minutes} 分钟` }),
    el('span', {
      class: 'vol-card__cta',
      text: done ? '查看报告' : started ? '继续作答' : '启封',
    }),
  ]);
  card.appendChild(foot);

  if (started && !done) {
    const bar = el('div', { class: 'vol-card__bar' });
    const fill = el('i');
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
  }

  return card;
}

/* ------------------------------------------------------------
   分辑标签
   ------------------------------------------------------------ */

const SERIES = [
  { id: 'core', name: '第一辑 · 本源八卷', latin: 'Core Series' },
  { id: 'expansion', name: '第二辑 · 破圈深水', latin: 'Expansion Series' },
  { id: 'all', name: '全部十六卷', latin: 'Complete' },
];

function seriesTabs(active, counts, onPick) {
  const bar = el('div', { class: 'series-tabs', role: 'tablist' });
  SERIES.forEach((s) => {
    const n = counts[s.id] || 0;
    const btn = el('button', {
      class: `series-tab${active === s.id ? ' is-on' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': String(active === s.id),
      onclick: () => onPick(s.id),
    }, [
      el('span', { class: 'series-tab__name', text: s.name }),
      el('span', { class: 'series-tab__latin', text: s.latin }),
      el('span', { class: 'series-tab__count', text: `${n}` }),
    ]);
    bar.appendChild(btn);
  });
  return bar;
}

/* ------------------------------------------------------------
   主渲染
   ------------------------------------------------------------ */

export function renderHub(root, ctx) {
  const { App, DATA, VOL_IDS, recompute } = ctx;
  const VOLUMES_INDEX = Object.fromEntries(VOL_IDS.map((v) => [v, DATA.volumes[v].index]));
  const state = App.state;
  const total = VOL_IDS.length;
  const doneCount = state.completedVolumes.filter((v) => VOL_IDS.includes(v)).length;

  const coreIds = VOL_IDS.filter((v) => DATA.volumes[v].index <= 8);
  const expIds = VOL_IDS.filter((v) => DATA.volumes[v].index > 8);
  const coreDone = coreIds.filter((v) => state.completedVolumes.includes(v)).length;
  const expDone = expIds.filter((v) => state.completedVolumes.includes(v)).length;

  // 分辑记忆
  const SERIES_KEY = 'human-atlas::hubSeries';
  let activeSeries = 'core';
  try { activeSeries = localStorage.getItem(SERIES_KEY) || (expIds.length ? 'core' : 'all'); } catch { /* ignore */ }
  if (!['core', 'expansion', 'all'].includes(activeSeries)) activeSeries = 'core';
  if (activeSeries === 'expansion' && !expIds.length) activeSeries = 'core';

  root.classList.add('view');

  // 把当前分辑的基调注入 --accent-vol，暗色射灯渐变会跟着变
  document.documentElement.style.setProperty(
    '--accent-vol',
    getComputedStyle(document.documentElement).getPropertyValue('--vol1').trim() || '#a64b35',
  );

  /* ---------- 主视觉 ---------- */
  const hero = el('section', { class: 'hub-hero' });
  const left = el('div', { class: 'hub-hero__main' });

  left.appendChild(el('div', { class: 'hub-hero__kicker' }, [
    el('span', { class: 'line' }),
    el('span', { class: 'eyebrow', text: 'THE HUMAN ATLAS · V4.4' }),
  ]));

  left.appendChild(el('h1', {
    class: 'hub-hero__title',
    html: '十六卷档案<br><span>一份关于你自己的<br class="br-narrow">长期观测记录</span>',
  }));

  left.appendChild(el('p', {
    class: 'hub-hero__lede',
    text: '这里没有正确答案，也没有好坏之分。每一卷都在几种同样体面的选择里，看你会偏向哪一边——然后把偏向翻译成两样东西：你在清醒时的高光，以及你在耗竭时的失控。',
  }));

  const qTotal = Object.values(DATA.volumes).reduce((a, v) => a + v.questions.length, 0);
  const facts = el('dl', { class: 'hub-facts' });
  [
    ['题库', `${qTotal} 个真实情境`],
    ['维度', `${DATA.dimOrder.length} 条可追踪的心理轴`],
    ['起步', '任一单卷约 4–6 分钟'],
  ].forEach(([k, v]) => {
    facts.appendChild(el('div', { class: 'hub-facts__row' }, [
      el('dt', { text: k }),
      el('dd', { text: v }),
    ]));
  });
  left.appendChild(facts);

  const nextUnfinished = VOL_IDS.find((v) => !state.completedVolumes.includes(v));
  const nextUnstarted = VOL_IDS.find((v) => !hasProgress(state, v));
  const target = nextUnfinished || nextUnstarted || VOL_IDS[0];

  const primaryLabel = !doneCount
    ? '开始第一卷'
    : nextUnfinished
      ? `继续 · 第 ${VOLUMES_INDEX[target]} 卷`
      : '全部完成 · 重做一卷';

  left.appendChild(el('div', { class: 'hub-hero__actions' }, [
    el('button', {
      class: 'btn btn--solid',
      type: 'button',
      text: primaryLabel,
      onclick: () => go(nextUnfinished ? `#/vol/${target}` : `#/vol/${VOL_IDS[0]}`),
    }),
    doneCount > 0
      ? el('a', { class: 'btn', href: '#/report', text: '查看已有的报告' })
      : el('a', { class: 'btn btn--ghost', href: '#/quiz/vol1', text: '直接开始答题' }),
    el('a', { class: 'btn btn--ghost', href: '#/express', text: '28 题极速版' }),
  ]));

  hero.appendChild(left);

  /* ---------- 右侧进度面板 ---------- */
  const side = el('aside', { class: 'hub-hero__side' });
  const panel = el('div', { class: 'progress-panel' });

  panel.appendChild(progressDial(doneCount, total));

  const stages = el('div', { class: 'dial-stages' });
  STAGES.forEach((st) => {
    const on = st.need <= total && doneCount >= st.need;
    const row = el('div', { class: `dial-stage${on ? ' is-on' : ''}` }, [
      el('span', { class: 'dial-stage__dot' }),
      el('span', { class: 'dial-stage__name', text: st.name }),
      el('span', { class: 'dial-stage__req', text: `${Math.min(st.need, total)}/${total}` }),
    ]);
    row.title = st.desc;
    stages.appendChild(row);
  });
  panel.appendChild(stages);

  side.appendChild(panel);
  hero.appendChild(side);
  root.appendChild(hero);

  /* ---------- 分辑统计 ---------- */
  const seriesStats = el('div', { class: 'series-stats' }, [
    el('div', { class: 'series-stat' }, [
      el('span', { class: 'series-stat__k', text: '第一辑 · 本源八卷' }),
      el('span', { class: 'series-stat__v', text: `${coreDone} / ${coreIds.length}` }),
    ]),
    el('div', { class: 'series-stat' }, [
      el('span', { class: 'series-stat__k', text: '第二辑 · 破圈深水' }),
      el('span', { class: 'series-stat__v', text: `${expDone} / ${expIds.length}` }),
    ]),
  ]);
  root.appendChild(seriesStats);

  /* ---------- 分辑切换 ---------- */
  root.appendChild(seriesTabs(activeSeries, {
    core: coreIds.length,
    expansion: expIds.length,
    all: total,
  }, (id) => {
    activeSeries = id;
    try { localStorage.setItem(SERIES_KEY, id); } catch { /* ignore */ }
    go('#/');
  }));

  /* ---------- 卷宗矩阵 ---------- */
  const shown = activeSeries === 'core' ? coreIds
    : activeSeries === 'expansion' ? expIds
      : VOL_IDS;

  const head = el('div', { class: 'section-head' }, [
    el('h2', { text: activeSeries === 'core' ? '本源八卷' : activeSeries === 'expansion' ? '破圈深水八卷' : '全部卷宗' }),
    el('div', {
      class: 'section-head__hint',
      text: state.nickname
        ? `已归档于「${state.nickname}」。可任意顺序启封，进度会自动保存。`
        : '可任意顺序启封。每完成一题即时保存，刷新页面可无缝续测。',
    }),
  ]);
  root.appendChild(head);

  const grid = el('div', { class: 'vol-grid stagger' });
  if (!shown.length) {
    grid.appendChild(el('div', { class: 'hub-empty' }, [
      el('p', { text: '第二辑的八卷正在排版中。' }),
      el('p', { class: 'hub-empty__sub', text: '本源八卷已可独立闭环，先从这里开始。' }),
    ]));
  }
  shown.forEach((vid) => {
    const vol = DATA.volumes[vid];
    if (!vol) return;
    grid.appendChild(volumeCard(vol, {
      state,
      dimMap: DATA.dimMap,
      onOpen: (id) => {
        const isDone = state.completedVolumes.includes(id);
        const started = hasProgress(state, id);
        if (isDone) go(`#/report/${id}`);
        else if (started) go(`#/quiz/${id}`);
        else go(`#/vol/${id}`);
      },
    }));
  });
  root.appendChild(grid);

  /* ---------- 工具条 ---------- */
  const tools = el('div', { class: 'hub-tools' });

  const tool = (icon, title, desc, onClick) => el('button', {
    class: 'tool-card', type: 'button', onclick: onClick,
  }, [
    el('span', { class: 'tool-card__ico', html: icon }),
    el('div', {}, [
      el('h4', { text: title }),
      el('p', { text: desc }),
    ]),
  ]);

  tools.appendChild(tool(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 20v-6a8 8 0 0 1 16 0v6"/><circle cx="12" cy="7" r="3.2"/></svg>',
    state.nickname ? `署名：${state.nickname}` : '设置署名',
    '这份档案会以这个名字归档，仅存于本机。',
    () => openNicknameDialog(state, () => { save(state, { immediate: true }); go('#/'); }),
  ));

  tools.appendChild(tool(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>',
    '导入存档码',
    '粘贴 HA4- 短码或 JSON 备份，跨设备续测。',
    () => openImportDialog({
      importSoulCode: ctx.importSoulCode,
      importJSONText: (text) => {
        const r = importJSON(text);
        if (r.ok) {
          const merged = { ...App.state };
          merged.completedVolumes = Array.from(new Set([
            ...(App.state.completedVolumes || []),
            ...(r.state.completedVolumes || []),
          ]));
          merged.answersByVolume = { ...(r.state.answersByVolume || {}), ...(App.state.answersByVolume || {}) };
          merged.inProgress = { ...(r.state.inProgress || {}), ...(App.state.inProgress || {}) };
          merged.nickname = App.state.nickname || r.state.nickname || '';
          App.state = merged;
          save(App.state, { immediate: true });
          recompute();
        }
        return r;
      },
      onDone: () => go('#/'),
    }),
  ));

  tools.appendChild(tool(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7.5 9h9M7.5 13h9M7.5 17h5"/></svg>',
    '生成存档码',
    '把当前进度压成一段可分享的短字符串。',
    () => {
      const code = ctx.soulCode();
      openSoulDialog(code, App.state, total);
    },
  ));

  tools.appendChild(tool(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8.5" cy="12" r="4.5"/><circle cx="15.5" cy="12" r="4.5"/></svg>',
    '双人对比室',
    '两人共同完成卷宗的交集，六大关系生态位合盘。',
    () => go('#/compare'),
  ));

  tools.appendChild(tool(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
    '印象盲盒',
    '12 题让好友盲猜你，生成乔哈里窗四象限。',
    () => go('#/johari'),
  ));

  tools.appendChild(tool(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="8" r="2.6"/><circle cx="17" cy="8" r="2.6"/><circle cx="12" cy="17" r="2.6"/><path d="M9 9.6l2 5M15 9.6l-2 5M9.6 8h4.8"/></svg>',
    '群像星图',
    '3–6 人小队生态位、缘分矩阵与共同短板。',
    () => go('#/squad'),
  ));

  root.appendChild(tools);

  /* ---------- 快速入口 ---------- */
  if (doneCount > 0) {
    const act = el('div', {
      style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '30px' },
    }, [
      el('a', { class: 'btn btn--solid', href: '#/report', text: '打开全息报告' }),
      doneCount >= 3
        ? el('a', { class: 'btn', href: '#/compare', text: '双人对比' })
        : el('span', {
          class: 'chip',
          style: { alignSelf: 'center', padding: '8px 14px' },
          text: `完成 ${3 - doneCount} 卷后激活跨卷读心`,
        }),
      el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: '重置全部进度',
        onclick: () => confirmDialog({
          title: '重置全部进度',
          sub: '这会清除本机保存的所有作答与报告，且无法恢复。建议先生成一份存档码。',
          confirmText: '确认重置',
          danger: true,
          onConfirm: () => {
            App.state = reset();
            recompute({ silent: false });
            go('#/');
            toast('已重置全部进度');
          },
        }),
      }),
    ]);
    root.appendChild(act);
  }

  /* ---------- Spotlight 追光：只在支持 hover 的指针设备上启用 ---------- */
  const canHover = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (canHover) {
    grid.addEventListener('pointermove', (e) => {
      const card = e.target.closest('.vol-card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
      card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    }, { passive: true });
  }

  /* ---------- 版权说明 ---------- */
  root.appendChild(el('footer', { class: 'colophon' }, [
    el('span', { text: 'THE HUMAN ATLAS · 纯前端本地运算，无任何数据上传' }),
    el('span', { text: `数据版本 v${DATA.dimensions.version} · ${DATA.dimOrder.length} 维 · ${qTotal} 题` }),
  ]));
}
