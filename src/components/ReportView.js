/* ============================================================
   ReportView.js — 全息报告
   模块 1 灵魂封面 / 2 双面镜 / 3 可视化 / 4 跨卷与双态
   模块 5 分卷档案 / 6 使用说明书 / 7 导出工作室
   ============================================================ */

import { el, go, round, clamp, toast, downloadText, formatDate } from '../core/utils.js';
import {
  mirrorFor, topGifts, topShadows, buildHolographicReport, reportDepth,
  resolveEffectiveComputed,
} from '../core/synthesizer.js';
import { buildVolumeTypology } from '../core/typology.js';
import {
  sandboxSection, parliamentSection, timelineSection,
} from './LabView.js';
import { pressureSandbox } from '../core/lab.js';
import { tierOf, maskTierOf, layeredScores } from '../core/scoring.js';
import { butterflySvg, BUTTERFLY_PAIRS } from '../viz/butterflySvg.js';
import { radarSvg, maskRadar } from '../viz/radarSvg.js';
import { spectrumSvg } from '../viz/spectrumSvg.js';
import { quadrantSvg, attachmentStyle } from '../viz/quadrantSvg.js';
import { triadSvg } from '../viz/triadSvg.js';
import { jungStackSvg, jungTypeHint } from '../viz/jungStackSvg.js';
import { matrixSvg, neuroOf, NEURO_QUADRANTS } from '../viz/matrixSvg.js';
import { alignmentSvg, alignmentFrom, ALIGNMENTS } from '../viz/alignmentSvg.js';
import {
  downloadPoster, downloadDualStatePoster, downloadMarkdown, copyMarkdown, copyAIPrompt, buildAIPrompt,
} from './Exporter.js';
import {
  exportJSON, encodeSoulCode, initialSnapshotOf, retakeVolume, hasInitialSnapshot, importJSON,
  mergeImportedState,
} from '../core/storage.js';
import {
  extractBehavioralEvidence, buildStructuredPrompt, BYOK_PRESETS,
  loadByokConfig, saveByokConfig, clearByokKey, streamOpenAICompatible,
} from '../core/dossierCore.js';
import { confirmDialog, openSoulDialog, openImportDialog } from './Dialogs.js';

const meanOf = (ids, map) => {
  const vals = ids.map((i) => map[i]).filter((v) => Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};

/* ------------------------------------------------------------
   主题色读取
   ------------------------------------------------------------ */

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (k) => cs.getPropertyValue(k).trim();
  return {
    text: g('--text-primary'),
    sub: g('--text-secondary'),
    faint: g('--text-tertiary'),
    border: g('--border'),
    gold: g('--gold'),
    card: g('--bg-card'),
    page: g('--bg-page'),
    vol1: g('--vol1'),
    vol2: g('--vol2'),
    vol3: g('--vol3'),
    vol4: g('--vol4'),
    vol5: g('--vol5'),
    vol6: g('--vol6'),
    vol7: g('--vol7'),
    vol8: g('--vol8'),
    vol9: g('--vol9'),
    vol10: g('--vol10'),
    vol11: g('--vol11'),
    vol12: g('--vol12'),
    vol13: g('--vol13'),
    vol14: g('--vol14'),
    vol15: g('--vol15'),
    vol16: g('--vol16'),
  };
}

/* ------------------------------------------------------------
   小工具
   ------------------------------------------------------------ */

function sec(no, title, hint) {
  return el('div', { class: 'rsec__head' }, [
    el('span', { class: 'rsec__no', text: no }),
    el('h2', { text: title }),
    hint ? el('p', { text: hint }) : null,
  ]);
}

function gauge(label, value, note) {
  return el('div', { class: 'gauge' }, [
    el('div', { class: 'gauge__label', text: label }),
    el('div', { class: 'gauge__value' }, [String(value), note ? el('small', { text: note }) : null]),
  ]);
}

/* ------------------------------------------------------------
   双面镜卡片（可翻转）
   ------------------------------------------------------------ */

function mirrorCard(m) {
  const card = el('button', {
    class: 'mirror-card',
    type: 'button',
    style: { '--mc': m.side === 'high' ? 'var(--gold)' : 'var(--vol2)' },
    'aria-label': `${m.name} 双面镜，点击翻转`,
  });

  const inner = el('div', { class: 'mirror-card__inner' });

  const front = el('div', { class: 'mirror-face mirror-face--front' }, [
    el('div', { class: 'mirror-face__top' }, [
      el('span', { class: 'mirror-face__tag', text: 'GIFT · 优势面' }),
      el('span', { class: 'mirror-face__score', text: `${round(m.score, 0)}` }),
    ]),
    el('h3', { text: m.gift_title }),
    el('div', { class: 'mirror-face__dim', text: `${m.name} · ${m.tier.name}` }),
    el('div', { class: 'mirror-face__body', text: m.gift_desc }),
    el('div', { class: 'mirror-face__foot', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 12a8 8 0 1 1 2.4 5.7"/><path d="M4 17v-5h5"/></svg><span>点击翻转 · 查看劣势面与炼金处方</span>' }),
  ]);

  const back = el('div', { class: 'mirror-face mirror-face--back' }, [
    el('div', { class: 'mirror-face__top' }, [
      el('span', { class: 'mirror-face__tag', text: 'SHADOW · 劣势面' }),
      el('span', { class: 'mirror-face__score', text: m.label }),
    ]),
    el('h3', { text: m.shadow_title }),
    el('div', { class: 'mirror-face__dim', text: '能量过载时的显影' }),
    el('div', { class: 'mirror-face__body', text: m.shadow_desc }),
    el('div', { class: 'mirror-face__foot' }, [
      el('div', { class: 'alchemy', html: `<b>炼金处方</b><br>${m.alchemy_tip}` }),
    ]),
  ]);

  inner.appendChild(front);
  inner.appendChild(back);
  card.appendChild(inner);

  card.addEventListener('click', () => card.classList.toggle('is-flipped'));

  return card;
}

/* ------------------------------------------------------------
   维度明细表
   ------------------------------------------------------------ */

function dimTable(dims, MIRRORS) {
  const rows = dims
    .filter((d) => MIRRORS[d.id])
    .map((d) => ({ ...d, m: MIRRORS[d.id] }));

  const table = el('table', { class: 'dim-table' });

  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: '维度' }),
      el('th', { text: '分数' }),
      el('th', { text: '' }),
      el('th', { text: '档位' }),
      el('th', { text: '当前显影' }),
    ]),
  ]));

  const tbody = el('tbody');
  rows.forEach((r) => {
    const tier = tierOf(r.score);
    const m = mirrorFor(r.id, r.score, MIRRORS);
    const bar = el('div', { class: 'score-bar', style: { '--mc': m?.side === 'high' ? 'var(--gold)' : 'var(--vol2)' } }, [
      (() => { const i = el('i'); i.style.width = `${clamp(r.score, 0, 100)}%`; return i; })(),
    ]);

    tbody.appendChild(el('tr', {}, [
      el('td', {}, [
        el('div', { class: 'dim-table__name', text: m?.name || r.id }),
        el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', letterSpacing: '0.06em' }, text: m?.side === 'high' ? '高分侧' : '低分侧' }),
      ]),
      el('td', { class: 'dim-table__score', text: `${round(r.score, 0)}` }),
      el('td', { style: { width: '38%' } }, [bar]),
      el('td', {}, [
        el('span', { class: 'tier-badge', dataset: { t: String(tier.id) }, text: tier.name }),
      ]),
      el('td', { style: { fontSize: '11.5px', color: 'var(--text-secondary)' }, text: m ? (m.side === 'high' ? m.gift_title : m.label) : '' }),
    ]));
  });

  table.appendChild(tbody);
  return table;
}

/* ------------------------------------------------------------
   报告内导航
   ------------------------------------------------------------ */

function reportNav(items) {
  const nav = el('div', { class: 'report-nav' });
  items.forEach((it, i) => {
    nav.appendChild(el('button', {
      class: i === 0 ? 'is-on' : '',
      type: 'button',
      text: it.label,
      onclick: (e) => {
        nav.querySelectorAll('button').forEach((b) => b.classList.remove('is-on'));
        e.currentTarget.classList.add('is-on');
        const target = document.getElementById(it.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }));
  });
  return nav;
}

/* ------------------------------------------------------------
   板块折叠（v5.2.3）
   ------------------------------------------------------------ */

/**
 * 长板块默认收起。
 *
 * 实测全息报告总高 10385px / 视口 728px ≈ 14.3 屏，
 * 其中「分卷深度档案」单块就占 15630px（8 卷时），
 * 首屏之后有大段内容把用户往下推，却没有任何可折叠。
 *
 * 只折叠三块低优先级板块（分卷档案 / 使用说明书 / 导出），
 * 双面镜、跨卷、沙盒、议会这些「主菜」保持展开 ——
 * 默认折叠会把核心价值藏起来。
 */
function foldableSection(section, { summary, defaultOpen = false } = {}) {
  const body = el('div', { class: 'rfold__body' });
  /* 把所有已挂到 section 上的子节点搬进 body（保留 __head 标题） */
  const head = section.querySelector('.rsec__head');
  const moving = [];
  for (const node of Array.from(section.children)) {
    if (node !== head) moving.push(node);
  }
  moving.forEach((n) => body.appendChild(n));

  const btn = el('button', {
    class: 'rfold__toggle',
    type: 'button',
    'aria-expanded': defaultOpen ? 'true' : 'false',
  }, [
    el('span', { class: 'rfold__label', text: summary }),
    el('span', { class: 'rfold__chev', text: '⌄' }),
  ]);

  const wrap = el('div', { class: `rfold${defaultOpen ? ' is-open' : ''}` }, [
    btn,
    el('div', { class: 'rfold__inner' }, [body]),
  ]);

  btn.addEventListener('click', () => {
    const open = wrap.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  if (head) head.appendChild(btn);
  else section.insertBefore(wrap, section.firstChild);
  if (head) section.appendChild(wrap);
  else { /* wrap 已插入 */ }

  return section;
}

/* ------------------------------------------------------------
   图表解锁占位条
   ------------------------------------------------------------ */

/**
 * 某张图缺维度时的紧凑占位条。
 *
 * 为什么不用 `?? 50` 补点：补出来的点不是「中性」，是「假的」。
 * 15 维里有 3 维没测，蝶形图会歪成另一只蝴蝶；
 * 用户看到的形状是编的，但TA不知道哪几行是编的。
 * 占位条明确说清缺几个维度、要完成哪一卷，比假图诚实。
 */
function chartLockCard({ title, note, need, missing, total }) {
  const box = el('div', { class: 'chart-lock' });
  box.appendChild(el('div', { class: 'chart-lock__head' }, [
    el('h3', { text: title }),
    el('span', { class: 'chart-lock__note', text: note }),
  ]));
  box.appendChild(el('p', {
    class: 'chart-lock__msg',
    text: `${need} 后解锁 · 还缺 ${missing} / ${total} 个维度`,
  }));
  return box;
}

/* ------------------------------------------------------------
   空态：档案尚未启封
   ------------------------------------------------------------ */

/**
 * 没有任何已测维度时的空态卡。
 *
 * 为什么需要它：报告主体有 9 个板块、10 张图表、65 条跨卷规则。
 * 在空状态下强行渲染，只会得到「全 50 的假图谱 + 0/65 的空壳表格」——
 * 用户看到的第一屏是一份看起来有内容、其实全是占位数的假报告。
 * 这里宁可什么都不画，只给三条明确的下一步。
 */
function renderEmptyDossier(root, ctx) {
  const { App, DATA, importSoulCode } = ctx;

  /* 28 题覆盖多少维度：从 DATA 现算，不写死。
     算法与 core/express.js 的 buildExpressVolume() 一致（收集 options/effects/items）。 */
  const expressIds = new Set(DATA.express?.questions || []);
  const expressDimSet = new Set();
  for (const vol of Object.values(DATA.volumes || {})) {
    for (const q of vol.questions || []) {
      if (!expressIds.has(q.id)) continue;
      for (const o of q.options || []) Object.keys(o.effects || {}).forEach((d) => expressDimSet.add(d));
      Object.keys(q.effects || {}).forEach((d) => expressDimSet.add(d));
      for (const it of q.items || []) if (it.dim) expressDimSet.add(it.dim);
      for (const v of q.values || []) Object.keys(v.effects || {}).forEach((d) => expressDimSet.add(d));
    }
  }
  const EXPRESS_DIM_COUNT = expressDimSet.size;

  root.classList.add('view');
  const wrap = el('div', { class: 'report report--empty' });
  root.appendChild(wrap);

  const card = el('div', { class: 'empty-dossier' });

  /* 印章式标记 */
  const seal = el('div', { class: 'empty-dossier__seal' });
  seal.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true">'
    + '<circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="0.8"/>'
    + '<circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3"/>'
    + '<path d="M24 10v28M13 24h22" stroke="currentColor" stroke-width="0.7"/>'
    + '<circle cx="24" cy="24" r="4" fill="none" stroke="currentColor" stroke-width="0.8"/>'
    + '</svg>';
  card.appendChild(seal);

  card.appendChild(el('div', { class: 'empty-dossier__kicker', text: 'DOSSIER · UNSEALED' }));
  card.appendChild(el('h1', { class: 'empty-dossier__title', text: '档案尚未启封' }));
  card.appendChild(el('p', {
    class: 'empty-dossier__lead',
    text: '这份报告由你的作答推导，不是通用模板。还没有任何维度被测量，所以现在画出来的每一条曲线都会是编的。',
  }));

  /* 三条出路 */
  const paths = el('div', { class: 'empty-dossier__paths' });

  paths.appendChild(el('a', { class: 'empty-path', href: '#/express' }, [
    el('span', { class: 'empty-path__no', text: '01' }),
    el('span', { class: 'empty-path__body' }, [
      el('b', { text: '4 分钟极速初见' }),
      el('span', { text: `${DATA.express?.questions?.length || 28} 题，覆盖 ${EXPRESS_DIM_COUNT} 个维度，立刻拿到一份简报` }),
    ]),
    el('span', { class: 'empty-path__arrow', text: '→' }),
  ]));

  paths.appendChild(el('a', { class: 'empty-path', href: '#/' }, [
    el('span', { class: 'empty-path__no', text: '02' }),
    el('span', { class: 'empty-path__body' }, [
      el('b', { text: '前往十六卷宗大厅' }),
      el('span', { text: '按自己的顺序启封，完成任意一卷就有完整报告' }),
    ]),
    el('span', { class: 'empty-path__arrow', text: '→' }),
  ]));

  /* 第三个是按钮而不是链接：它要开对话框，并且要能立刻重渲染 */
  const importBtn = el('button', {
    class: 'empty-path empty-path--btn',
    type: 'button',
  }, [
    el('span', { class: 'empty-path__no', text: '03' }),
    el('span', { class: 'empty-path__body' }, [
      el('b', { text: '导入已有存档码' }),
      el('span', { text: '粘贴 HA4- 短码，把别的设备上的进度搬过来' }),
    ]),
    el('span', { class: 'empty-path__arrow', text: '↑' }),
  ]);

  importBtn.addEventListener('click', () => {
    openImportDialog({
      importSoulCode,
      importJSONText: (text) => {
        const r = importJSON(text);
        if (r.ok) {
          App.state = mergeImportedState(App.state, r.state);
          window.HumanAtlas?.recompute?.();
        }
        return r;
      },
      onDone: () => {
        window.HumanAtlas?.recompute?.();
        /* hash 没变时浏览器不会自己触发 hashchange，这里手动补一次重渲染。
           recompute 现在走双源融合，导入的分不会再被空作答池洗掉，
           所以这次重渲染会直接进入报告主体，而不是继续停在空态。 */
        window.dispatchEvent(new Event('hashchange'));
        const dims = Object.values(App.state.computedScores || {}).filter(Number.isFinite).length;
        if (dims > 0) toast(`已载入 ${dims} 个维度`);
      },
    });
  });

  paths.appendChild(importBtn);
  card.appendChild(paths);

  /* 底部一句：说清这份系统的边界 */
  card.appendChild(el('p', {
    class: 'empty-dossier__foot',
    text: `共 ${VOL_IDS_LABEL(DATA)} 卷 · ${Object.keys(DATA.dimMap).length} 个维度 · 全部数据只存在这台设备上`,
  }));

  wrap.appendChild(card);
}

/** 卷数：从 DATA 里数，不写死 */
function VOL_IDS_LABEL(DATA) {
  return Object.keys(DATA.volumes || {}).length;
}

/* ------------------------------------------------------------
   主渲染
   ------------------------------------------------------------ */

export function renderReport(root, ctx) {
  const { App, DATA, volId, recompute, VOL_IDS = [] } = ctx;
  const state = App.state;
  const C = themeColors();

  /* ---------- 双源融合 ----------
     HA4- 存档码只带分数、不带 answersByVolume。如果直接用 state.computedScores，
     导入后只要 recompute 跑过一次就可能被空作答池洗成 0 维 —— 报告页就被
     空态门禁拦成『档案尚未启封』。这里先算融合态，所有下游一律看 eff。 */
  const eff = resolveEffectiveComputed(state, DATA);
  const effectiveScores = eff.scores;
  const hasEffective = Object.keys(effectiveScores).length > 0;

  /* 丢掉旧 state 里已经失效的分，把融合后的分喂给下游（报告 / 单卷报告 / 导出）。 */
  const effState = hasEffective
    ? {
      ...state,
      computedScores: effectiveScores,
      zScores: eff.zScores,
      maskIndex: eff.mask?.value ?? state.maskIndex,
      maskDetail: eff.maskDetail || state.maskDetail || null,
      topValues: eff.topValues,
      pressureStyle: eff.pressure || state.pressureStyle || null,
    }
    : state;

  // 单卷报告
  if (volId && DATA.volumes[volId]) {
    renderVolumeReport(root, { ...ctx, effectiveState: effState, effective: eff }, volId);
    return;
  }

  /* ---------- 空态门禁 ----------
     只要测出的维度为 0，就绝不进入报告主体。
     之前这里只判 completedVolumes.length，但当用户从存档码导入
     「有维度分、completedVolumes 为空」的档案，或者在中途重置过进度时，
     会出现「有分数但没完成卷」的半空状态 —— 报告照样往下渲染，
     于是所有图表用 ?? 50 补出全 50 的假点、跨卷规则输出 0/65 的空壳。
     现在以【双源融合后的已测维度数】为唯一门禁。 */
  const measuredDims = Object.keys(effectiveScores)
    .filter((d) => Number.isFinite(effectiveScores[d]));
  const completed = state.completedVolumes || [];

  if (!measuredDims.length) {
    renderEmptyDossier(root, ctx);
    return;
  }

  const report = buildHolographicReport(effState, DATA);
  const depth = reportDepth(completed.length);
  const archPack = report.archetype || null;
  const arch = archPack?.eligible === false ? null : archPack?.best;
  const archRunner = archPack?.eligible === false ? null : archPack?.runnerUp;
  const isComposite = Boolean(archPack?.isComposite && archRunner);

  root.classList.add('view');
  root.appendChild(el('div', { class: 'report', style: { '--vc': 'var(--gold)' } }));

  const wrap = root.firstElementChild;
  const nickname = state.nickname || '';

  /* ============ 模块 1 · 灵魂封面 ============ */
  const cover = el('div', { class: 'report-cover' });
  cover.appendChild(el('div', { class: 'cover-top' }, [
    el('div', { class: 'cover-vol' }, [
      el('span', { text: 'THE HUMAN ATLAS' }),
      el('span', { style: { opacity: 0.5 }, text: '·' }),
      el('span', { text: `${depth.name} · ${completed.length}/${VOL_IDS.length}` }),
    ]),
    el('div', { style: { fontSize: '10.5px', letterSpacing: '0.16em', color: 'var(--text-tertiary)' }, text: formatDate(state.updatedAt) }),
  ]));

  /* 主标题：复合原型时写成「主原型 × 副原型底色」 */
  const archTitle = arch
    ? (isComposite ? `${arch.name} × ${archRunner.name}底色` : arch.name)
    : '你的人性档案';

  cover.appendChild(el('div', {
    style: {
      fontSize: '10px',
      letterSpacing: '0.3em',
      textTransform: 'uppercase',
      color: 'var(--gold)',
      marginBottom: '12px',
    },
    text: arch ? (arch.latin || '') : '',
  }));

  cover.appendChild(el('h1', { class: 'cover-title', text: archTitle }));

  /* 专业心理学结构副标 */
  if (arch && arch.psych_tag) {
    cover.appendChild(el('p', { class: 'cover-psych', text: arch.psych_tag }));
  }

  /* 契合度 + 锚定维度数 */
  if (arch) {
    const anchorN = arch.hitCount || arch.hits?.length || 0;
    cover.appendChild(el('div', { class: 'cover-metrics' }, [
      el('span', { class: 'cover-metric' }, [
        el('b', { text: `${Math.round(arch.fit)}%` }),
        el('i', { text: '契合度' }),
      ]),
      el('span', { class: 'cover-metric' }, [
        el('b', { text: `${anchorN}` }),
        el('i', { text: '项核心特质锚定' }),
      ]),
      el('span', { class: 'cover-metric' }, [
        el('b', { text: `${Math.round((arch.coverage || 0) * 100)}%` }),
        el('i', { text: '维度覆盖' }),
      ]),
    ]));
  } else {
    cover.appendChild(el('p', {
      class: 'cover-psych',
      text: '已完成卷宗还不足以支撑跨卷原型判定。继续完成 1–2 卷后，这里会给出主原型与副原型底色。',
    }));
  }

  if (nickname) {
    cover.appendChild(el('div', {
      style: { fontSize: '11px', letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: '16px' },
      text: `${nickname} · 私人档案`,
    }));
  }

  if (arch) {
    cover.appendChild(el('div', { class: 'cover-keywords' }, (arch.keywords || []).map((k) => el('span', { class: 'kw', text: k }))));
    cover.appendChild(el('p', { class: 'cover-verdict', text: arch.verdict }));
    if (isComposite) {
      cover.appendChild(el('p', {
        style: {
          margin: '6px 0 0', fontSize: '11.5px', color: 'var(--text-tertiary)', letterSpacing: '0.04em',
        },
        text: `副原型「${archRunner.name}」只差 ${Math.round(arch.fit - archRunner.fit)} 分，底色同样成立。`,
      }));
    }
  }

  const lightDark = computeLightDark(report.scores);
  /* 面具读报告对象里的融合值（effState.maskIndex），不直接读 App.state ——
     导入的档可能只有 maskIndex 没有作答，重算前后会短暂不一致。 */
  const maskNum = report.mask?.value;
  const maskV = Number.isFinite(maskNum) ? Math.round(maskNum) : '—';
  const maskTier = Number.isFinite(maskNum) ? maskTierOf(maskNum) : null;

  cover.appendChild(el('div', { class: 'gauges' }, [
    gauge('光暗能量比', lightDark.text, lightDark.note),
    gauge('社会面具厚度', maskV, maskTier ? ` · ${maskTier.name}` : ''),
    gauge('测评完成度', `${completed.length}`, ` / ${VOL_IDS.length} 卷`),
    gauge('跨卷规则命中', `${report.cross.length}`, ` / ${DATA.crossRules.length}`),
  ]));

  if (maskTier) {
    cover.appendChild(el('p', {
      style: {
        marginTop: '16px', fontSize: '11.5px', lineHeight: '1.9', color: 'var(--text-tertiary)',
      },
      text: `${maskTier.name} · ${maskTier.desc}`,
    }));
  }

  /* 行为遥测聚光灯：暴露“犹豫 / 反复改选 / 极速盲选”反自陈证据 */
  const behavioral = extractBehavioralEvidence(effState, DATA.volumes, { limit: 3 });
  if (behavioral.hasTelemetry) {
    const spot = el('div', { class: 'telemetry-spotlight' });
    const metrics = [
      `阅读基线 ~${behavioral.baselineMsPerChar || '—'} ms/字`,
      `采集 ${behavioral.measuredCount}/${behavioral.totalAnswered} 题`,
    ];
    if (behavioral.changedCount > 0) metrics.push(`当场改选 ${behavioral.changedCount} 题`);
    if (behavioral.blindCount > 0) metrics.push(`极速直觉/盲选 ${behavioral.blindCount} 题`);

    spot.appendChild(el('div', { class: 'telemetry-spotlight__head' }, [
      el('span', { class: 'telemetry-spotlight__kicker', text: '作答行为遥测 · 反自陈取证' }),
      el('div', { class: 'telemetry-spotlight__stats' }, metrics.map((m) => el('span', { class: 'telemetry-pill', text: m }))),
    ]));

    if (behavioral.spotlight.length) {
      const list = el('div', { class: 'telemetry-spotlight__list' });
      behavioral.spotlight.forEach((item) => {
        const badges = [];
        if (item.ratio >= 1.5) badges.push(`停留 ${item.ratio}×`);
        if (item.changes > 0) badges.push(`改选 ${item.changes} 次`);
        if (!badges.length) badges.push(`${(item.ms / 1000).toFixed(1)}s`);

        list.appendChild(el('div', { class: 'telemetry-spotlight__item' }, [
          el('div', { class: 'telemetry-spotlight__meta' }, [
            el('span', { class: 'telemetry-badge', text: badges.join(' · ') }),
            el('span', { class: 'telemetry-vol', text: item.volTitle }),
          ]),
          el('div', { class: 'telemetry-spotlight__q', text: `「${item.prompt}」` }),
          el('div', {
            class: 'telemetry-spotlight__a',
            text: `最终选择：${item.choice}（停留 ${(item.ms / 1000).toFixed(1)}s${item.changes ? ` / 摇摆 ${item.changes} 次` : ''}）`,
          }),
        ]));
      });
      spot.appendChild(list);
    } else {
      spot.appendChild(el('p', {
        class: 'telemetry-spotlight__empty',
        text: '你的作答节奏非常均匀，未检出显著超基线纠结或反复改选题。',
      }));
    }
    cover.appendChild(spot);
  } else if (effState.imported && completed.length) {
    cover.appendChild(el('div', { class: 'telemetry-spotlight telemetry-spotlight--muted' }, [
      el('span', {
        class: 'telemetry-spotlight__empty',
        text: '当前档来自 HA4 分享码：仅含维度得分，不含单题作答耗时与改选遥测；本机答题会自动记录行为犹豫曲线。',
      }),
    ]));
  }

  wrap.appendChild(cover);

  /* ============ 章节导航 ============ */
  const sections = [
    { id: 'r-dash', label: '可视化仪表盘' },
    { id: 'r-mirror', label: '双面镜' },
    { id: 'r-cross', label: '跨卷读心' },
    { id: 'r-dual', label: '双态推演' },
    { id: 'r-sandbox', label: '压力沙盒' },
    { id: 'r-parliament', label: '内在议会' },
    { id: 'r-timeline', label: '时间胶囊' },
    { id: 'r-archives', label: '分卷档案' },
    { id: 'r-manual', label: '使用说明书' },
    { id: 'r-export', label: '导出' },
  ];
  wrap.appendChild(reportNav(sections));

  /* ============ 模块 3 · 可视化仪表盘 ============ */
  const dash = el('section', { class: 'rsec', id: 'r-dash' });
  dash.appendChild(sec('01', '多维可视化', '所有图表均由原生 SVG 绘制，无第三方图表库'));

  /* 蝶形图门禁：14 个维度（7 美德 + 7 原罪）必须全部测出。
     少一个就用 ?? 50 补点的话，那一行会变成一条贴中轴的假直线，
     整个蝶翼形状因此失真。宁可不画，给一条解锁提示。 */
  const butterflyDims = BUTTERFLY_PAIRS.flatMap((p) => [p.virtue, p.sin]);
  const missingButterfly = butterflyDims.filter((d) => !Number.isFinite(report.scores[d]));
  if (missingButterfly.length) {
    dash.appendChild(chartLockCard({
      title: '七美德 × 七原罪 · 双翼蝶形',
      note: 'Vol.1',
      need: '完成 Vol.1 光影圣殿',
      missing: missingButterfly.length,
      total: butterflyDims.length,
    }));
  } else {
    const bcard = el('div', { class: 'chart-card' });
    bcard.appendChild(el('div', { class: 'chart-card__head' }, [
      el('h3', { text: '七美德 × 七原罪 · 双翼蝶形' }),
      el('span', { class: 'chart-card__note', text: '中轴为 50，左右展开幅度即该极的显影强度' }),
    ]));
    const bb = el('div', { class: 'chart-card__body' });
    bb.appendChild(butterflySvg(report.scores, {
      width: 760,
      colorVirtue: C.vol2,
      colorSin: C.vol1,
      colorText: C.text,
      colorMuted: C.faint,
      colorBorder: C.border,
      bg: C.card,
    }));
    bcard.appendChild(bb);
    dash.appendChild(bcard);
    dash.appendChild(el('div', { style: { height: '18px' } }));
  }

  // 雷达 + 光谱
  const grid2 = el('div', { class: 'chart-grid-2' });

  const radarAxes = [
    { id: 'big5_open', label: '探索', color: C.vol2 },
    { id: 'big5_order', label: '秩序' },
    { id: 'big5_industry', label: '韧性' },
    { id: 'big5_assert', label: '表达' },
    { id: 'big5_compassion', label: '共情' },
    { id: 'big5_rumination', label: '反刍' },
    { id: 'big5_alert', label: '警觉' },
    { id: 'big5_social', label: '社交' },
  ].filter((a) => Number.isFinite(report.scores[a.id]));

  if (radarAxes.length >= 4) {
    const rcard = el('div', { class: 'chart-card' });
    rcard.appendChild(el('div', { class: 'chart-card__head' }, [
      el('h3', { text: '大五人格 · 八维轮廓' }),
      el('span', { class: 'chart-card__note', text: 'Vol.2' }),
    ]));
    const rb = el('div', { class: 'chart-card__body' });
    rb.appendChild(radarSvg(radarAxes.map((a) => ({ ...a, value: report.scores[a.id] })), {
      width: 520,
      colorText: C.text,
      colorMuted: C.faint,
      colorBorder: C.border,
      bg: C.card,
      series: [{
        name: 'Big Five',
        values: radarAxes.map((a) => report.scores[a.id]),
        color: C.vol2,
        fillOpacity: 0.12,
      }],
      showValues: true,
    }));
    rcard.appendChild(rb);
    grid2.appendChild(rcard);
  }

  // 三观光谱
  const polarDims = [
    { id: 'wv_nature', name: '人性预设', neg: '审慎防备', pos: '善意信任' },
    { id: 'wv_causal', name: '因果归因', neg: '顺应随机', pos: '长期掌控' },
    { id: 'wv_social', name: '社会逻辑', neg: '现实博弈', pos: '契约规则' },
    { id: 'lv_happiness', name: '幸福取向', neg: '体验主义', pos: '实现主义' },
    { id: 'lv_suffering', name: '苦难态度', neg: '拒绝内耗', pos: '意义转化' },
    { id: 'lv_anchor', name: '存在锚点', neg: '向外建构', pos: '向内自洽' },
  ].filter((d) => Number.isFinite(report.scores[d.id]));

  if (polarDims.length) {
    const scard = el('div', { class: 'chart-card' });
    scard.appendChild(el('div', { class: 'chart-card__head' }, [
      el('h3', { text: '三观双极光谱' }),
      el('span', { class: 'chart-card__note', text: 'Vol.4 · 中轴为 50' }),
    ]));
    const sb = el('div', { class: 'chart-card__body' });
    const list = el('div', { class: 'spec-list' });
    polarDims.forEach((d) => {
      const row = el('div', { class: 'spec-item' }, [
        el('div', { class: 'spec-item__name', text: d.name }),
        (() => {
          const box = el('div', { class: 'spec-svg' });
          box.appendChild(spectrumSvg({
            id: d.id,
            name: d.name,
            negLabel: d.neg,
            posLabel: d.pos,
            value: report.scores[d.id],
            color: C.gold,
          }, {
            width: 520,
            colorText: C.text,
            colorMuted: C.faint,
            colorBorder: C.border,
            bg: C.card,
            negColor: C.vol2,
            posColor: C.vol1,
          }));
          return box;
        })(),
      ]);
      list.appendChild(row);
    });
    sb.appendChild(list);
    scard.appendChild(sb);
    grid2.appendChild(scard);
  }

  // 面具虚实叠层雷达：要 Vol.8 的高压题把暗线维度测出来
  {
    const layers = layeredScores(state, DATA);
    const hasLayer = layers.keys.length >= 4;
    if (!hasLayer) {
      grid2.appendChild(chartLockCard({
        title: '面具虚实叠层',
        note: 'Vol.8',
        need: '完成 Vol.8 高压剧场',
        missing: Math.max(0, 4 - layers.keys.length),
        total: 4,
      }));
    } else {
      const picks = layers.keys
        .slice()
        .sort((a, b) => Math.abs(layers.surface[a] - layers.depth[a]) - Math.abs(layers.surface[b] - layers.depth[b]))
        .reverse()
        .slice(0, 8);

      const lcard = el('div', { class: 'chart-card' });
      lcard.appendChild(el('div', { class: 'chart-card__head' }, [
        el('h3', { text: '面具虚实叠层' }),
        el('span', { class: 'chart-card__note', text: `撕裂度 ${layers.gMirror} · 差异最大的八条轴` }),
      ]));
      const lb = el('div', { class: 'chart-card__body' });
      lb.appendChild(maskRadar(
        picks.map((d) => ({
          id: d,
          label: DATA.dimMap[d]?.name.slice(0, 4) || d,
          value: layers.depth[d],
          masked: layers.surface[d],
        })),
        {
          width: 520,
          colorText: C.text,
          colorMuted: C.faint,
          colorBorder: C.border,
          bg: C.card,
          surfaceColor: C.gold,
          depthColor: C.vol1,
          labelSize: 10.5,
        },
      ));
      lb.appendChild(el('div', { class: 'chart-legend' }, [
        el('span', { style: { color: C.gold }, html: '<i class="dash"></i>表显自评' }),
        el('span', { style: { color: C.vol1 }, html: '<i></i>暗线底色' }),
      ]));
      lb.appendChild(el('p', {
        style: { fontSize: '12px', lineHeight: '1.95', color: 'var(--text-secondary)', marginTop: '12px' },
        text: '虚线是你温和状态下的自评轮廓，实线是你在高压与暗箱情境下露出的底色。两层之间被撑开的面积，就是面具的厚度。',
      }));
      lcard.appendChild(lb);
      grid2.appendChild(lcard);
    }
  }

  // 依恋四象限：两个轴都测出来才画
  {
    const an = report.scores.att_anxiety;
    const av = report.scores.att_avoidance;
    const ok = Number.isFinite(an) && Number.isFinite(av);
    if (!ok) {
      grid2.appendChild(chartLockCard({
        title: '依恋坐标 · 四象限',
        note: 'Vol.7',
        need: '完成 Vol.7 亲密防线',
        missing: [an, av].filter((v) => !Number.isFinite(v)).length,
        total: 2,
      }));
    } else {
      const style = attachmentStyle(an, av);
      const qcard = el('div', { class: 'chart-card' });
      qcard.appendChild(el('div', { class: 'chart-card__head' }, [
        el('h3', { text: `依恋坐标 · ${style.name}` }),
        el('span', { class: 'chart-card__note', text: 'Vol.7' }),
      ]));
      const qb = el('div', { class: 'chart-card__body' });
      qb.appendChild(quadrantSvg({ anxiety: an, avoidance: av }, {
        width: 460,
        color: C.vol7,
        colorText: C.text,
        colorMuted: C.faint,
        colorBorder: C.border,
        bg: C.card,
        safeColor: C.vol2,
      }));
      qb.appendChild(el('p', {
        style: { fontSize: '12.5px', lineHeight: '1.95', color: 'var(--text-secondary)', marginTop: '14px' },
        text: style.desc,
      }));
      qcard.appendChild(qb);
      grid2.appendChild(qcard);
    }
  }

  // 思维棱镜光谱
  const cogDims = [
    { id: 'cog_global', name: '全局 / 细节', neg: '细节实证', pos: '全局抽象' },
    { id: 'cog_diverge', name: '发散 / 收敛', neg: '收敛风控', pos: '发散破局' },
    { id: 'cog_logic', name: '逻辑 / 直觉', neg: '直觉共振', pos: '逻辑抽离' },
    { id: 'cog_ambiguity', name: '模糊 / 确定', neg: '确定性偏好', pos: '高模糊容忍' },
    { id: 'cog_independent', name: '独立 / 共识', neg: '共识校准', pos: '独立反叛' },
    { id: 'cog_speed', name: '快 / 慢决策', neg: '慢决策求全', pos: '快决策迭代' },
  ].filter((d) => Number.isFinite(report.scores[d.id]));

  if (cogDims.length) {
    const ccard = el('div', { class: 'chart-card' });
    ccard.appendChild(el('div', { class: 'chart-card__head' }, [
      el('h3', { text: '思维棱镜 · 六道棱面' }),
      el('span', { class: 'chart-card__note', text: 'Vol.5' }),
    ]));
    const cb = el('div', { class: 'chart-card__body' });
    const list = el('div', { class: 'spec-list' });
    cogDims.forEach((d) => {
      const row = el('div', { class: 'spec-item' }, [
        el('div', { class: 'spec-item__name', text: d.name }),
        (() => {
          const box = el('div', { class: 'spec-svg' });
          box.appendChild(spectrumSvg({
            id: d.id, name: d.name, negLabel: d.neg, posLabel: d.pos,
            value: report.scores[d.id], color: C.vol5,
          }, {
            width: 520, colorText: C.text, colorMuted: C.faint, colorBorder: C.border,
            bg: C.card, negColor: C.faint, posColor: C.vol5,
          }));
          return box;
        })(),
      ]);
      list.appendChild(row);
    });
    cb.appendChild(list);
    ccard.appendChild(cb);
    grid2.appendChild(ccard);
  }

  // 欲望引擎雷达
  const motAxes = [
    { id: 'mot_autonomy', label: '主权' },
    { id: 'mot_mastery', label: '跨越' },
    { id: 'mot_belonging', label: '羁绊' },
    { id: 'mot_security', label: '秩序' },
    { id: 'mot_purpose', label: '意义' },
    { id: 'mot_hedonism', label: '丰盈' },
  ].filter((a) => Number.isFinite(report.scores[a.id]));

  if (motAxes.length >= 4) {
    const mcard = el('div', { class: 'chart-card' });
    mcard.appendChild(el('div', { class: 'chart-card__head' }, [
      el('h3', { text: '六大欲望引擎' }),
      el('span', { class: 'chart-card__note', text: 'Vol.6 · 含 100 点筹码分配' }),
    ]));
    const mb = el('div', { class: 'chart-card__body' });
    mb.appendChild(radarSvg(motAxes.map((a) => ({ ...a, value: report.scores[a.id] })), {
      width: 520,
      colorText: C.text, colorMuted: C.faint, colorBorder: C.border, bg: C.card,
      series: [{
        name: 'Motors',
        values: motAxes.map((a) => report.scores[a.id]),
        color: C.gold,
        fillOpacity: 0.12,
      }],
      showValues: true,
      labelSize: 11,
    }));
    mcard.appendChild(mb);
    grid2.appendChild(mcard);
  }

  dash.appendChild(grid2);
  wrap.appendChild(dash);

  /* ============ 模块 2 · 双面镜 ============ */
  const mirrorSec = el('section', { class: 'rsec', id: 'r-mirror' });
  mirrorSec.appendChild(sec('02', '优势面 × 劣势面 · 双面镜', '点击任一卡片翻转，查看同一股力量的反面与炼金处方'));

  const giftBlock = el('div', { style: { marginBottom: '12px', fontSize: '10.5px', letterSpacing: '0.18em', color: 'var(--gold)' }, text: 'SIGNATURE GIFTS · 王牌天赋' });
  mirrorSec.appendChild(giftBlock);

  const giftGrid = el('div', { class: 'mirror-grid' });
  (report.gifts || []).slice(0, 4).forEach((g) => giftGrid.appendChild(mirrorCard(g)));
  mirrorSec.appendChild(giftGrid);

  if (report.shadows?.length) {
    mirrorSec.appendChild(el('div', { style: { margin: '30px 0 14px', fontSize: '10.5px', letterSpacing: '0.18em', color: 'var(--vol1)' }, text: 'SHADOW ALERTS · 阴影预警' }));
    const shadowGrid = el('div', { class: 'mirror-grid' });
    report.shadows.slice(0, 3).forEach((s) => shadowGrid.appendChild(mirrorCard(s)));
    mirrorSec.appendChild(shadowGrid);
  }

  wrap.appendChild(mirrorSec);

  /* ============ 模块 4a · 跨卷读心 ============ */
  const crossSec = el('section', { class: 'rsec', id: 'r-cross' });
  crossSec.appendChild(sec('03', '跨卷化学反应', `已触发 ${report.cross.length} / ${DATA.crossRules.length} 条黄金规则`));

  /* 章节头部的计数也要按门禁改写：0 卷时显示「已触发 0 / 65」
     会让用户以为系统跑过一遍并且没命中，其实根本没开始算。 */
  if (completed.length < 3) {
    crossSec.replaceChild(
      sec('03', '跨卷化学反应', '完成至少 3 卷后解锁跨卷化学反应'),
      crossSec.firstElementChild,
    );
    crossSec.appendChild(el('div', { class: 'empty' }, [
      el('h3', { text: '还差一点' }),
      el('p', { text: `跨卷读心需要至少完成 3 卷。你目前完成 ${completed.length} 卷，再完成 ${3 - completed.length} 卷即可激活。` }),
      el('a', { class: 'btn', href: '#/', text: '继续启封' }),
    ]));
  } else if (!report.cross.length) {
    /* 走到这里说明真的算过了、且一条没命中 —— 这时候「分布均衡」才是可信结论 */
    crossSec.appendChild(el('div', { class: 'empty' }, [
      el('h3', { text: `已完成 ${completed.length} 卷，${DATA.crossRules.length} 条规则都没有交汇` }),
      el('p', { text: `跨卷引擎完整跑过 ${DATA.crossRules.length} 条规则，你的维度组合一条都没有命中。这通常意味着各项特质分布比较均衡，没有形成极端拉扯的结构。` }),
    ]));
  } else {
    report.cross.forEach((c) => {
      const card = el('div', { class: 'cross-card' });
      card.appendChild(el('div', { class: 'cross-card__top' }, [
        el('h3', { text: c.title }),
        el('span', { class: 'cross-card__tag', text: c.tag }),
        el('span', { class: 'cross-card__id', text: c.id }),
      ]));
      card.appendChild(el('p', { class: 'cross-card__insight', text: c.insight }));
      card.appendChild(el('div', {
        class: 'cross-card__advice',
        html: `<b>行动建议</b>${c.advice}`,
      }));
      const hits = el('div', { class: 'dim-hits' });
      (c.hits || []).forEach((h) => {
        const name = h.name || DATA.dimMap[h.dim]?.name || h.dim;
        hits.appendChild(el('span', { class: 'dim-hit', text: `${name} ${round(h.score, 0)}` }));
      });
      card.appendChild(hits);
      crossSec.appendChild(card);
    });
  }
  wrap.appendChild(crossSec);

  /* ============ 模块 4b · 双态推演 ============ */
  const dualSec = el('section', { class: 'rsec', id: 'r-dual' });
  dualSec.appendChild(sec('04', '顺境舒展 × 高压退行', completed.length >= 5 ? '压力显影已解锁' : '完成 5 卷可精确校准'));

  const dual = report.dual;
  const dsGrid = el('div', { class: 'dual-state' });

  const giftBox = el('div', { class: 'dual-state--gift' });
  giftBox.appendChild(el('h4', { html: '<i></i><span>顺境 · 舒展态</span>' }));
  giftBox.appendChild(el('p', { text: dual.flourish }));
  dsGrid.appendChild(giftBox);

  const shadowBox = el('div', { class: 'dual-state--shadow' });
  shadowBox.appendChild(el('h4', { html: '<i></i><span>高压 · 退行态</span>' }));
  shadowBox.appendChild(el('p', { text: dual.underPressure }));
  dsGrid.appendChild(shadowBox);

  dualSec.appendChild(dsGrid);

  if (dual.style) {
    dualSec.appendChild(el('div', { style: { marginTop: '16px', display: 'grid', gap: '12px' } }, [
      el('div', { class: 'cross-card' }, [
        el('div', { class: 'cross-card__top' }, [
          el('h3', { text: `退行方向 · ${dual.style.name}` }),
          el('span', { class: 'cross-card__tag', text: 'Vol.8 高压剧场' }),
        ]),
        el('p', { class: 'cross-card__insight', text: dual.style.pattern }),
        el('div', { class: 'cross-card__advice', html: `<b>触发点</b>${dual.style.trigger}<br><br><b>刹车处方</b>${dual.style.brake}` }),
      ]),
    ]));
  }
  const dualSandbox = pressureSandbox(report.scores || {}, 15);
  dualSec.appendChild(el('div', { class: 'dual-export-row' }, [
    el('span', { class: 'dual-export-row__hint', text: '把顺境与耗竭两面导成一张高对比战报卡' }),
    el('button', {
      type: 'button',
      class: 'btn btn--sm btn--ghost',
      text: '导出双态战报图 PNG',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '绘制中…';
        try {
          const name = await downloadDualStatePoster(report, {
            theme: App.theme,
            nickname,
            sandbox: dualSandbox,
            dimMap: DATA.dimMap,
          });
          toast(`已保存 ${name}`);
        } catch (err) {
          console.error(err);
          toast('双态战报图生成失败');
        }
        btn.textContent = '导出双态战报图 PNG';
        btn.disabled = false;
      },
    }),
  ]));
  wrap.appendChild(dualSec);

  /* ============ 实验室 · 压力沙盒 / 内在议会 / 时间胶囊 ============ */
  const labColors = {
    text: C.text,
    muted: C.faint,
    border: C.border,
    card: C.card,
    gold: C.gold,
    sin: C.vol1,
    virtue: C.vol2,
    faint: C.faint,
    dimName: (id) => DATA.dimMap[id]?.name || id,
  };

  const sandbox = sandboxSection({ scores: report.scores, colors: labColors });
  if (sandbox) wrap.appendChild(sandbox);

  const parliament = parliamentSection({ scores: report.scores });
  if (parliament) wrap.appendChild(parliament);

  const timeline = timelineSection({
    state,
    scores: report.scores,
    colors: labColors,
    dimMap: DATA.dimMap,
    dimOrder: DATA.dimOrder,
  });
  if (timeline) wrap.appendChild(timeline);

  /* ============ 模块 5 · 分卷档案 ============ */
  const archSec = el('section', { class: 'rsec', id: 'r-archives' });
  archSec.appendChild(sec('05', '分卷深度档案', `${completed.length} / ${VOL_IDS.length} 卷已归档 · 共 ${DATA.dimOrder.length} 个维度`));

  /* 只渲染「这一卷真的测出了维度」的卷宗。
     之前是遍历 completedVolumes，遇到「卷被标记完成但分数里没有它的维度」
     （导入存档码、或中途清过 computedScores）就会输出一张只有表头、
     0 行数据的空表格。 */
  const archivable = completed.filter((vid) => {
    const vol = DATA.volumes[vid];
    if (!vol) return false;
    return (vol.dimensions || []).some((d) => Number.isFinite(report.scores[d]));
  });

  if (!archivable.length) {
    archSec.replaceChild(
      sec('05', '分卷深度档案', '还没有任何一卷测出维度'),
      archSec.firstElementChild,
    );
    archSec.appendChild(el('div', { class: 'empty' }, [
      el('h3', { text: '还没有可归档的卷宗' }),
      el('p', { text: '完成任意一卷后，这里会按卷列出该卷测出的全部维度与分数。' }),
    ]));
  }

  archivable.forEach((vid) => {
    const vol = DATA.volumes[vid];
    if (!vol) return;
    const dims = (vol.dimensions || [])
      .filter((d) => Number.isFinite(report.scores[d]))
      .map((d) => ({ id: d, score: report.scores[d] }));

    const box = el('div', {
      style: {
        marginBottom: '26px',
        padding: '22px 24px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-card)',
        borderLeft: `2px solid ${vol.theme_color}`,
      },
    });

    const head = el('div', {
      style: { display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' },
    }, [
      el('span', { style: { fontSize: '10px', letterSpacing: '0.2em', color: vol.theme_color }, text: `VOL.${String(vol.index).padStart(2, '0')}` }),
      el('h3', { style: { fontSize: '17px', letterSpacing: '0.1em' }, text: vol.title }),
      el('span', { style: { fontSize: '11px', color: 'var(--text-tertiary)', letterSpacing: '0.06em' }, text: vol.subtitle }),
      el('a', {
        href: `#/report/${vid}`,
        style: { marginLeft: 'auto', fontSize: '11px', letterSpacing: '0.1em', color: 'var(--text-secondary)' },
        text: '查看单卷报告 →',
      }),
    ]);
    box.appendChild(head);
    box.appendChild(dimTable(dims, DATA.mirrors));
    archSec.appendChild(box);
  });

  if (completed.length < VOL_IDS.length) {
    archSec.appendChild(el('div', { class: 'empty' }, [
      el('h3', { text: `还有 ${VOL_IDS.length - completed.length} 卷未启封` }),
      el('p', { text: `每一卷都会补上一块此前缺失的拼图。全部完成时，${DATA.dimOrder.length} 维图谱才会真正闭合。` }),
      el('a', { class: 'btn', href: '#/', text: '前往卷宗大厅' }),
    ]));
  }
  foldableSection(archSec, { summary: '展开分卷深度档案' });
  wrap.appendChild(archSec);

  /* ============ 模块 6 · 使用说明书 ============ */
  const manualSec = el('section', { class: 'rsec', id: 'r-manual' });
  manualSec.appendChild(sec('06', '人生使用说明书', '基于当前已测维度的生态位推演'));

  const mg = el('div', { class: 'manual-grid' });

  const mk = (title, items, icon) => {
    const c = el('div', { class: 'manual-card' });
    c.appendChild(el('div', { class: 'manual-card__ico', html: icon }));
    c.appendChild(el('h4', { text: title }));
    if (Array.isArray(items) && items.length) {
      const ul = el('ul');
      items.forEach((t) => ul.appendChild(el('li', { text: t })));
      c.appendChild(ul);
    } else {
      c.appendChild(el('p', { text: '完成更多卷宗后，这里会自动补全。' }));
    }
    return c;
  };

  mg.appendChild(mk('最契合的事业生态位', report.manual.occupation, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>'));
  mg.appendChild(mk('灵魂同频的伴侣 / 挚友', report.manual.partner, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9Z"/></svg>'));
  mg.appendChild(mk('绝对避雷的人际毒药', report.manual.toxic, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="9"/><path d="M8 8l8 8M16 8l-8 8"/></svg>'));
  mg.appendChild(mk('专属行动处方', report.manual.actions, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 3v18M5 8h14M5 16h14"/></svg>'));

  if (report.manual.pressureBrake) {
    mg.appendChild(mk('高压时刻的唯一刹车', [report.manual.pressureBrake], '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'));
  }

  if (report.values?.length) {
    const vc = el('div', { class: 'manual-card' });
    vc.appendChild(el('div', { class: 'manual-card__ico', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 3l2.6 6h6.4l-5.2 4 2 6.4L12 15.8 6.2 19.4l2-6.4L3 9h6.4Z"/></svg>' }));
    vc.appendChild(el('h4', { text: '核心价值排序' }));
    const ul = el('ul');
    report.values.forEach((v, i) => ul.appendChild(el('li', { text: `${i + 1}. ${v.name} — ${v.desc}` })));
    vc.appendChild(ul);
    mg.appendChild(vc);
  }

  manualSec.appendChild(mg);
  foldableSection(manualSec, { summary: '展开人生使用说明书' });
  wrap.appendChild(manualSec);

  /* ============ 模块 7 · 导出工作室 ============ */
  const expSec = el('section', { class: 'rsec', id: 'r-export' });
  expSec.appendChild(sec('07', '导出工作室', '四种格式，全部在本地生成'));

  const expGrid = el('div', { class: 'manual-grid' });

  const expCard = (title, desc, buttons) => {
    const c = el('div', { class: 'manual-card' });
    c.appendChild(el('h4', { text: title }));
    c.appendChild(el('p', { text: desc }));
    const row = el('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' } });
    buttons.forEach((b) => row.appendChild(b));
    c.appendChild(row);
    return c;
  };

  const reportForExport = {
    ...report,
    dimRows: DATA.dimOrder
      .filter((d) => Number.isFinite(report.scores[d]))
      .map((d) => ({
        id: d,
        name: DATA.dimMap[d]?.name || d,
        volume: DATA.dimMap[d]?.volume || '',
        score: round(report.scores[d], 0),
        tier: tierOf(report.scores[d]),
      })),
  };

  expGrid.appendChild(expCard(
    '社交精简卡 · PNG',
    '1080 × 1920 双主题海报：象牙典藏版 / 暗夜黑金版。',
    [
      el('button', {
        class: 'btn btn--sm btn--solid',
        type: 'button',
        text: '象牙典藏版',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.textContent = '绘制中…';
          btn.disabled = true;
          try {
            const name = await downloadPoster(reportForExport, {
              long: false, theme: 'light', nickname,
            });
            toast(`已保存 ${name}`);
          } catch (err) {
            console.error(err);
            toast('海报生成失败');
          }
          btn.textContent = '象牙典藏版';
          btn.disabled = false;
        },
      }),
      el('button', {
        class: 'btn btn--sm',
        type: 'button',
        text: '暗夜黑金版',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.textContent = '绘制中…';
          btn.disabled = true;
          try {
            const name = await downloadPoster(reportForExport, {
              long: false, theme: 'dark', nickname,
            });
            toast(`已保存 ${name}`);
          } catch (err) {
            console.error(err);
            toast('海报生成失败');
          }
          btn.textContent = '暗夜黑金版';
          btn.disabled = false;
        },
      }),
    ],
  ));

  expGrid.appendChild(expCard(
    '双态对比战报 · PNG',
    '1080 × 1620 顺境舒展态 vs 高压退行态（含低电量失衡位移轨迹）。',
    [
      el('button', {
        class: 'btn btn--sm btn--solid',
        type: 'button',
        text: '象牙双态卡',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = '绘制中…';
          try {
            const name = await downloadDualStatePoster(reportForExport, {
              theme: 'light', nickname, sandbox: dualSandbox, dimMap: DATA.dimMap,
            });
            toast(`已保存 ${name}`);
          } catch (err) {
            console.error(err);
            toast('双态战报图生成失败');
          }
          btn.textContent = '象牙双态卡';
          btn.disabled = false;
        },
      }),
      el('button', {
        class: 'btn btn--sm',
        type: 'button',
        text: '黑金双态卡',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = '绘制中…';
          try {
            const name = await downloadDualStatePoster(reportForExport, {
              theme: 'dark', nickname, sandbox: dualSandbox, dimMap: DATA.dimMap,
            });
            toast(`已保存 ${name}`);
          } catch (err) {
            console.error(err);
            toast('双态战报图生成失败');
          }
          btn.textContent = '黑金双态卡';
          btn.disabled = false;
        },
      }),
    ],
  ));

  expGrid.appendChild(expCard(
    '全景长图 · PNG',
    '1080 × 2800，包含跨卷读心与价值排序的完整档案。',
    [el('button', {
      class: 'btn btn--sm',
      type: 'button',
      text: '生成长图',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.textContent = '绘制中…';
        btn.disabled = true;
        try {
          const name = await downloadPoster(reportForExport, {
            long: true, theme: App.theme, nickname,
          });
          toast(`已保存 ${name}`);
        } catch (err) {
          console.error(err);
          toast('长图生成失败');
        }
        btn.textContent = '生成长图';
        btn.disabled = false;
      },
    })],
  ));

  expGrid.appendChild(expCard(
    '杂志级白皮书 · PDF',
    'A4 分页排版，含全部矢量图表。在打印面板中选择「存储为 PDF」。',
    [el('button', {
      class: 'btn btn--sm',
      type: 'button',
      text: '打印 / 导出 PDF',
      onclick: () => {
        setTimeout(() => window.print(), 200);
      },
    })],
  ));

  expGrid.appendChild(expCard(
    '结构化复盘笔记 · MD',
    '可直接导入 Notion / Obsidian，或作为长期心理背景提示词。',
    [
      el('button', {
        class: 'btn btn--sm',
        type: 'button',
        text: '下载',
        onclick: () => {
          const name = downloadMarkdown(reportForExport, { nickname });
          toast(`已保存 ${name}`);
        },
      }),
      el('button', {
        class: 'btn btn--sm btn--ghost',
        type: 'button',
        text: '复制',
        onclick: () => copyMarkdown(reportForExport, { nickname }),
      }),
    ],
  ));

  expGrid.appendChild(expCard(
    '灵魂存档 · HA4 短码',
    '仅含得分向量、面具指数与价值排序，可用于跨设备与双人对比。',
    [el('button', {
      class: 'btn btn--sm',
      type: 'button',
      text: '生成存档码',
      onclick: () => {
        openSoulDialog(encodeSoulCode(state, DATA.dimOrder), state);
      },
    })],
  ));

  expGrid.appendChild(expCard(
    'AI 深度精读密文',
    '一键复制结构化分析师 Prompt（全维得分 + Z 尖峰 + 面具三分量 + 三道犹豫题原文），粘给任意大模型即可开始 30 分钟深谈。',
    [
      el('button', {
        class: 'btn btn--sm btn--solid',
        type: 'button',
        text: '复制密文',
        onclick: () => copyAIPrompt(reportForExport, {
          nickname,
          answersByVolume: state.answersByVolume || {},
          telemetry: state.telemetry || {},
          volumes: DATA.volumes,
          mask: effState.maskDetail || null,
          topValues: report.values || [],
        }),
      }),
      el('button', {
        class: 'btn btn--sm btn--ghost',
        type: 'button',
        text: '下载 .md',
        onclick: () => {
          const text = buildAIPrompt(reportForExport, {
            nickname,
            answersByVolume: state.answersByVolume || {},
            telemetry: state.telemetry || {},
            volumes: DATA.volumes,
            mask: effState.maskDetail || null,
            topValues: report.values || [],
          });
          downloadText(`human-atlas-ai-prompt-${Date.now()}.md`, text, 'text/markdown;charset=utf-8');
          toast('密文已下载');
        },
      }),
    ],
  ));

  expGrid.appendChild(expCard(
    '完整备份 · JSON',
    '包含每题作答与遥测数据，可用于跨年演化对比。',
    [el('button', {
      class: 'btn btn--sm btn--ghost',
      type: 'button',
      text: '下载 JSON',
      onclick: () => {
        const json = exportJSON(state);
        downloadText(`human-atlas-backup-${Date.now()}.json`, json, 'application/json;charset=utf-8');
        toast('备份已下载');
      },
    })],
  ));

  expSec.appendChild(expGrid);

  /* 可选：浏览器直连 AI 深谈面板（BYOK / 本地 Ollama，默认零联网） */
  expSec.appendChild(buildByokPanel({
    report: reportForExport,
    nickname,
    answersByVolume: state.answersByVolume || {},
    telemetry: state.telemetry || {},
    volumes: DATA.volumes,
    mask: effState.maskDetail || null,
    topValues: report.values || [],
  }));

  // 打印页脚
  expSec.appendChild(el('div', {
    class: 'print-colophon',
    text: 'THE HUMAN ATLAS · 本报告由本地浏览器生成，所有作答均未离开你的设备',
  }));

  foldableSection(expSec, { summary: '展开导出工作室' });
  wrap.appendChild(expSec);

  /* ---------- 底部 ---------- */
  wrap.appendChild(el('div', { class: 'report-actions' }, [
    el('a', { class: 'btn btn--ghost', href: '#/', text: '← 返回卷宗大厅' }),
    el('a', { class: 'btn btn--ghost', href: '#/compare', text: '双人对比' }),
    el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: '重新计算',
      onclick: () => { recompute({ silent: false }); go('#/report'); toast('已重新计算'); },
    }),
  ]));

  wrap.appendChild(disclaimer());
}

/* ------------------------------------------------------------
   浏览器直连 AI 深谈（BYOK / Ollama）
   ------------------------------------------------------------ */

function buildByokPanel({
  report, nickname, answersByVolume, telemetry, volumes, mask, topValues,
}) {
  const cfg = loadByokConfig();
  let controller = null;
  let generated = '';

  const panel = el('div', { class: 'byok-panel', id: 'byok-panel' });
  panel.appendChild(el('div', { class: 'byok-panel__head' }, [
    el('div', {}, [
      el('div', { class: 'byok-panel__title', text: '可选 · 浏览器直连 AI 深谈（自带 Key / 本地 Ollama）' }),
      el('p', {
        class: 'byok-panel__note',
        text: '默认完全零联网；仅在你点击「开始深谈」时，直接向你填写的 OpenAI 兼容接口发送上方的确定性密文。API Key 默认只存在当前标签页内存（sessionStorage），关闭即清。',
      }),
    ]),
  ]));

  const urlInput = el('input', {
    class: 'byok-input',
    type: 'url',
    value: cfg.baseUrl,
    placeholder: 'https://api.deepseek.com/v1 或 http://localhost:11434/v1',
  });
  const modelInput = el('input', {
    class: 'byok-input',
    type: 'text',
    value: cfg.model,
    placeholder: 'deepseek-chat / gpt-4o-mini / qwen2.5:14b',
  });
  const keyInput = el('input', {
    class: 'byok-input',
    type: 'password',
    value: cfg.apiKey,
    autocomplete: 'off',
    placeholder: '填入你的 API Key（本地 Ollama 可留空）',
  });
  const rememberCheck = el('input', {
    type: 'checkbox',
    checked: cfg.rememberKey,
  });
  const focusInput = el('textarea', {
    class: 'byok-textarea',
    rows: 2,
    placeholder: '（可选）写一个你当下最纠结的现实问题：例如「为什么我总在关系深入前想逃？」',
  });

  const persist = () => saveByokConfig({
    baseUrl: urlInput.value,
    model: modelInput.value,
    apiKey: keyInput.value,
    rememberKey: rememberCheck.checked,
  });
  [urlInput, modelInput, keyInput, rememberCheck].forEach((inp) => {
    inp.addEventListener('change', persist);
  });

  // 预设切换
  const presets = el('div', { class: 'byok-presets' }, [
    el('span', { class: 'byok-presets__label', text: '快速预设：' }),
    ...BYOK_PRESETS.map((p) => el('button', {
      type: 'button',
      class: 'btn btn--sm btn--ghost byok-preset',
      text: p.label,
      onclick: () => {
        urlInput.value = p.baseUrl;
        modelInput.value = p.model;
        persist();
        toast(`已填入 ${p.label} 预设`);
      },
    })),
    el('button', {
      type: 'button',
      class: 'btn btn--sm btn--ghost',
      text: '清除已存 Key',
      onclick: () => {
        clearByokKey();
        keyInput.value = '';
        rememberCheck.checked = false;
        toast('本地保存的 Key 已清除');
      },
    }),
  ]);
  panel.appendChild(presets);

  const form = el('div', { class: 'byok-form' }, [
    el('label', { class: 'byok-field' }, [
      el('span', { text: 'API Base URL' }),
      urlInput,
    ]),
    el('label', { class: 'byok-field' }, [
      el('span', { text: '模型名称（Model）' }),
      modelInput,
    ]),
    el('label', { class: 'byok-field byok-field--wide' }, [
      el('span', { text: 'API Key（浏览器本地发送，不经过本站服务器）' }),
      keyInput,
    ]),
    el('label', { class: 'byok-check' }, [
      rememberCheck,
      el('span', { text: '将 Key 保存在本机 localStorage（仅私人设备建议勾选）' }),
    ]),
    el('label', { class: 'byok-field byok-field--wide' }, [
      el('span', { text: '附加现实追问（可选）' }),
      focusInput,
    ]),
  ]);
  panel.appendChild(form);

  const statusLine = el('div', { class: 'byok-status', text: '' });
  const outputBox = el('pre', { class: 'byok-output', style: { display: 'none' }, text: '' });
  const copyReplyBtn = el('button', {
    type: 'button',
    class: 'btn btn--sm btn--ghost',
    text: '复制深谈结果',
    disabled: true,
    onclick: async () => {
      if (!generated) return;
      try {
        await navigator.clipboard.writeText(generated);
        toast('已复制深谈全文');
      } catch {
        downloadText(`human-atlas-ai-reply-${Date.now()}.md`, generated, 'text/markdown;charset=utf-8');
        toast('已下载深谈文本');
      }
    },
  });
  const stopBtn = el('button', {
    type: 'button',
    class: 'btn btn--sm btn--ghost',
    text: '停止生成',
    disabled: true,
    onclick: () => {
      if (controller) controller.abort();
    },
  });
  const runBtn = el('button', {
    type: 'button',
    class: 'btn btn--sm btn--gold',
    text: '开始流式深谈',
    onclick: async () => {
      persist();
      const base = urlInput.value.trim();
      const mod = modelInput.value.trim();
      const key = keyInput.value.trim();
      const isLocal = /localhost|127\.0\.0\.1/.test(base);
      if (!base || !mod) {
        statusLine.textContent = '请先填写 API Base URL 与模型名称。';
        return;
      }
      if (!isLocal && !key) {
        statusLine.textContent = '远程接口需要填写 API Key（若使用本地 Ollama 请点击上方「Ollama 本地」预设）。';
        return;
      }

      const prompt = buildStructuredPrompt(report, {
        nickname,
        answersByVolume,
        telemetry,
        volumes,
        mask,
        topValues,
        focusQuestion: focusInput.value,
      });

      controller = new AbortController();
      generated = '';
      outputBox.style.display = 'block';
      outputBox.textContent = '';
      runBtn.disabled = true;
      stopBtn.disabled = false;
      copyReplyBtn.disabled = true;
      statusLine.textContent = `正在直连 ${mod}，流式解析中…`;

      try {
        generated = await streamOpenAICompatible({
          baseUrl: base,
          apiKey: key,
          model: mod,
          signal: controller.signal,
          messages: [
            {
              role: 'system',
              content: '你是一位克制、犀利、基于心理测量数据与作答犹豫证据进行分析的深度咨询师。不要阿谀奉承，不要输出星座鸡汤，严格围绕具体分数、矛结构与可验证微行动给出中文回应。',
            },
            { role: 'user', content: prompt },
          ],
          onToken: (_, full) => {
            generated = full;
            outputBox.textContent = full;
          },
        });
        statusLine.textContent = `已完成（${generated.length} 字）· 所有内容仅保留在当前页面`;
        copyReplyBtn.disabled = !generated;
      } catch (err) {
        if (err?.name === 'AbortError') {
          statusLine.textContent = `已手动停止（已生成 ${generated.length} 字）`;
          copyReplyBtn.disabled = !generated;
        } else {
          const msg = err?.message || String(err);
          statusLine.textContent = `请求失败：${msg}（注意部分服务商限制浏览器直连跨域 CORS，可改用本地 Ollama 或一键复制上方密文粘贴到网页对话）`;
        }
      } finally {
        controller = null;
        runBtn.disabled = false;
        stopBtn.disabled = true;
      }
    },
  });

  panel.appendChild(el('div', { class: 'byok-actions' }, [
    runBtn, stopBtn, copyReplyBtn,
  ]));
  panel.appendChild(statusLine);
  panel.appendChild(outputBox);

  return panel;
}

/* ------------------------------------------------------------
   免责声明
   ------------------------------------------------------------ */

/**
 * 这不是诊断工具。
 *
 * 报告里有「图式」「暗黑三角」「依恋类型」这类带临床色彩的词，
 * 虽然措辞一直克制，但如果没有一句明确边界，用户可能把它当成评估结论。
 * 心理测评类产品的标准做法是显式声明，这里补上。
 */
function disclaimer() {
  return el('div', { class: 'report-disclaimer' }, [
    el('b', { text: '关于这份报告的边界' }),
    el('p', {
      text: '它是一面镜子，不是一份诊断。所有结论来自你在这个工具里的作答，'
        + '用于自我探索与关系理解，不构成医疗建议，也不能替代专业心理咨询或精神科评估。',
    }),
    el('p', {
      text: '如果你正在经历持续的情绪困扰、睡眠问题，或关系中的痛苦已经影响到日常生活，'
        + '请优先寻求持证心理咨询师或精神科医生的帮助 —— 那比任何一份自动生成的报告都更有用。',
    }),
  ]);
}

/* ------------------------------------------------------------
   单卷报告
   ------------------------------------------------------------ */

function renderVolumeReport(root, ctx, volId) {
  const { App, DATA, VOL_IDS, effectiveState, effective } = ctx;
  const state = effectiveState || App.state;
  const vol = DATA.volumes[volId];
  const P = themeColors();
  const ans = state.answersByVolume?.[volId] || {};

  /* 分数底盘：融合后的 state.computedScores。
     导入存档码后 answersByVolume 为空，靠右上角三个 gauge 与下方维度明细
     必须能看到导入的分 —— 否则 `#/report/vol1` 会渲染成一张空壳。 */
  const scoreSource = state.computedScores && Object.keys(state.computedScores).length
    ? state.computedScores
    : (effective?.scores || {});

  const dims = (vol.dimensions || [])
    .map((d) => ({ id: d, score: scoreSource?.[d] }))
    .filter((d) => Number.isFinite(d.score));

  /* 该卷一个可渲染维度都没有时，同样走空态而不是空白页。 */
  if (!dims.length) {
    renderEmptyDossier(root, ctx);
    return;
  }

  const mirrors = {};
  dims.forEach((d) => {
    const m = mirrorFor(d.id, d.score, DATA.mirrors);
    if (m) mirrors[d.id] = m;
  });

  const zMap = {};
  for (const d of dims.map((x) => x.id)) {
    const z = state.zScores?.[d];
    if (Number.isFinite(z)) zMap[d] = z;
  }
  const hasZ = Object.keys(zMap).length > 0 ? zMap : null;

  const giftList = topGifts(Object.fromEntries(dims.map((d) => [d.id, d.score])), DATA.mirrors, 3, hasZ);
  const shadowList = topShadows(Object.fromEntries(dims.map((d) => [d.id, d.score])), DATA.mirrors, 3, hasZ);

  root.classList.add('view');
  const wrap = el('div', { class: 'report', style: { '--vc': vol.theme_color } });
  root.appendChild(wrap);

  /* ---------- 封面 ---------- */
  const cover = el('div', { class: 'report-cover' });
  cover.appendChild(el('div', { class: 'cover-top' }, [
    el('div', { class: 'cover-vol' }, [
      el('span', { text: `VOL. ${String(vol.index).padStart(2, '0')}` }),
      el('span', { style: { opacity: 0.5 }, text: '·' }),
      el('span', { text: vol.subtitle }),
    ]),
    el('div', { style: { fontSize: '10.5px', letterSpacing: '0.16em', color: 'var(--text-tertiary)' }, text: formatDate(state.updatedAt) }),
  ]));

  /* 主标题：本卷专属分型（不是 36 个跨卷原型）
     卷名降为上方的小字副标，分型成为封面主角。 */
  const scoreMap = Object.fromEntries(dims.map((d) => [d.id, d.score]));
  // 分型引擎用的是同一份分数；这里给个别名，避免后面重复声明造成 TDZ
  const typoScoreMap = scoreMap;
  const typo = buildVolumeTypology(volId, typoScoreMap, zMap, DATA.dimMap, {
    pressure: state.pressureStyle || null,
    mask: state.maskIndex,
  });

  cover.appendChild(el('div', {
    style: {
      fontSize: '11px',
      letterSpacing: '0.22em',
      color: 'var(--text-tertiary)',
      marginBottom: '10px',
    },
    text: vol.title,
  }));

  cover.appendChild(el('h1', {
    class: 'cover-title',
    text: typo ? typo.title : vol.title,
  }));

  if (typo && typo.tag) {
    cover.appendChild(el('p', {
      class: 'cover-psych',
      text: typo.tag,
    }));
  }

  if (state.nickname) {
    cover.appendChild(el('div', {
      style: { fontSize: '11px', letterSpacing: '0.2em', color: 'var(--text-tertiary)', marginBottom: '16px' },
      text: `${state.nickname} · 私人档案`,
    }));
  }

  if (giftList.length) {
    cover.appendChild(el('div', { class: 'cover-keywords' }, giftList.map((g) => el('span', { class: 'kw', text: g.gift_title }))));
    cover.appendChild(el('p', {
      class: 'cover-verdict',
      text: `在这一卷的坐标里，你最亮的形态是「${giftList[0].gift_title}」。同时，${shadowList.length ? `「${shadowList[0].shadow_title}」是你需要留意的反面。` : '你的分布相对均衡，没有明显的极端化倾向。'}`,
    }));
  }

  const answeredCount = vol.questions.filter((q) => ans[q.id] && !ans[q.id].draft && ans[q.id].value !== undefined).length;
  cover.appendChild(el('div', { class: 'gauges' }, [
    gauge('本卷完成度', `${answeredCount}`, ` / ${vol.questions.length} 题`),
    gauge('维度数', `${dims.length}`, ''),
    gauge('社会面具厚度', Number.isFinite(state.maskIndex) ? Math.round(state.maskIndex) : '—', ''),
    gauge('全卷进度', `${(state.completedVolumes || []).length}`, ` / ${VOL_IDS.length} 卷`),
  ]));

  wrap.appendChild(cover);

  /* ---------- 本卷图谱 ---------- */
  const chartOpt = {
    colorText: P.text,
    colorMuted: P.faint,
    colorBorder: P.border,
    bg: P.card,
  };

  const chartCard = (title, note) => {
    const box = el('div', { class: 'chart-card', style: { marginBottom: '26px' } });
    box.appendChild(el('div', { class: 'chart-card__head' }, [
      el('h3', { text: title }),
      el('span', { class: 'chart-card__note', text: note }),
    ]));
    const body = el('div', { class: 'chart-card__body' });
    box.appendChild(body);
    wrap.appendChild(box);
    return body;
  };


  if (volId === 'vol1') {
    const body = chartCard('七美德 × 七原罪 · 双翼蝶形', '左翼为秩序，右翼为驱力');
    body.appendChild(butterflySvg(scoreMap, {
      width: 720,
      colorVirtue: P.vol2,
      colorSin: P.vol1,
      ...chartOpt,
    }));
  }

  if (volId === 'vol2') {
    const body = chartCard('大五人格 · 十子维轮廓', 'Vol.2 · 外部自评视角');
    body.appendChild(radarSvg(dims.map((d) => ({
      id: d.id,
      label: DATA.dimMap[d.id]?.name.slice(0, 4) || d.id,
      value: d.score,
    })), {
      width: 520,
      ...chartOpt,
      series: [{ name: 'Big Five', values: dims.map((d) => d.score), color: P.vol2, fillOpacity: 0.12 }],
      showValues: true,
      labelSize: 10.5,
    }));
  }

  if (volId === 'vol3') {
    const body = chartCard('光明三角 × 黑暗三角', '两枚三角形的填充面积即该侧强度');
    body.appendChild(triadSvg(scoreMap, {
      width: 560,
      colorLight: P.vol2,
      colorDark: P.vol1,
      ...chartOpt,
    }));

    // 认知 / 情感共情（若维度存在）
    if (dims.some((d) => d.id === 'emp_cognitive') || dims.some((d) => d.id === 'emp_affective')) {
      body.appendChild(el('p', {
        style: { fontSize: '12px', lineHeight: '1.9', color: 'var(--text-secondary)', marginTop: '14px' },
        text: '当认知共情显著高于情感共情时，通常意味着你能精准读懂他人的情绪，但不会跟着一起起伏——这是「暗黑共情者」的典型结构。',
      }));
    }
  }

  if (volId === 'vol4') {
    const body = chartCard('三观 · 九维双极光谱', '中轴为 50，两端为对立极');
    const list = el('div', { class: 'spec-list' });
    const polar = [
      ['wv_nature', '人性预设', '审慎防备', '善意信任'],
      ['wv_causal', '因果归因', '顺应随机', '长期掌控'],
      ['wv_social', '社会逻辑', '现实博弈', '契约规则'],
      ['lv_happiness', '幸福取向', '体验主义', '实现主义'],
      ['lv_suffering', '苦难态度', '拒绝内耗', '意义转化'],
      ['lv_anchor', '存在锚点', '向外建构', '向内自洽'],
      ['val_moral', '道德算法', '结果优先', '原则底线'],
      ['val_boundary', '边界重心', '归属稳定', '自由独立'],
      ['val_standard', '评判标尺', '效率务实', '真诚公平'],
    ].filter(([id]) => Number.isFinite(scoreMap[id]));

    polar.forEach(([id, name, neg, pos]) => {
      const row = el('div', { class: 'spec-item' }, [
        el('div', { class: 'spec-item__name', text: name }),
        (() => {
          const box = el('div', { class: 'spec-svg' });
          box.appendChild(spectrumSvg({
            id, name, negLabel: neg, posLabel: pos,
            value: scoreMap[id], color: P.vol4,
          }, {
            ...chartOpt,
            negColor: P.faint,
            posColor: P.vol4,
            bg: P.card,
          }));
          return box;
        })(),
      ]);
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  if (volId === 'vol5') {
    const body = chartCard('思维棱镜 · 六道棱面', '中轴为 50，两端为两种加工方式');
    const list = el('div', { class: 'spec-list' });
    const cog = [
      ['cog_global', '全局 / 细节', '细节实证', '全局抽象'],
      ['cog_diverge', '发散 / 收敛', '收敛风控', '发散破局'],
      ['cog_logic', '逻辑 / 直觉', '直觉共振', '逻辑抽离'],
      ['cog_ambiguity', '模糊 / 确定', '确定性偏好', '高模糊容忍'],
      ['cog_independent', '独立 / 共识', '共识校准', '独立反叛'],
      ['cog_speed', '快 / 慢决策', '慢决策求全', '快决策迭代'],
    ].filter(([id]) => Number.isFinite(scoreMap[id]));

    cog.forEach(([id, name, neg, pos]) => {
      const row = el('div', { class: 'spec-item' }, [
        el('div', { class: 'spec-item__name', text: name }),
        (() => {
          const box = el('div', { class: 'spec-svg' });
          box.appendChild(spectrumSvg({
            id, name, negLabel: neg, posLabel: pos,
            value: scoreMap[id], color: P.vol5,
          }, {
            ...chartOpt,
            negColor: P.faint,
            posColor: P.vol5,
            bg: P.card,
          }));
          return box;
        })(),
      ]);
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  if (volId === 'vol6') {
    const body = chartCard('六大欲望引擎', 'Vol.6 · 含 100 点筹码分配');
    body.appendChild(radarSvg(dims.map((d) => ({
      id: d.id,
      label: DATA.dimMap[d.id]?.name.slice(0, 4) || d.id,
      value: d.score,
    })), {
      width: 520,
      ...chartOpt,
      series: [{ name: 'Motors', values: dims.map((d) => d.score), color: P.gold, fillOpacity: 0.12 }],
      showValues: true,
      labelSize: 11,
    }));

    // 若做过筹码题，补一条条形排序
    const budgetQ = vol.questions.find((q) => q.type === 'budget_100');
    const budgetAns = budgetQ ? ans[budgetQ.id]?.value : null;
    if (budgetQ && budgetAns && typeof budgetAns === 'object') {
      const list = el('div', { class: 'spec-list', style: { marginTop: '18px' } });
      const sorted = [...budgetQ.items]
        .map((it) => ({ ...it, pts: Number(budgetAns[it.key] ?? 0) }))
        .sort((a, b) => b.pts - a.pts);
      sorted.forEach((it) => {
        const row = el('div', { class: 'spec-item' }, [
          el('div', { class: 'spec-item__name', text: it.label }),
          (() => {
            const box = el('div', { class: 'spec-svg' });
            box.appendChild(spectrumSvg({
              id: it.key,
              name: it.label,
              negLabel: '0 点',
              posLabel: '100 点',
              value: it.pts,
              color: P.gold,
            }, {
              ...chartOpt,
              negColor: P.faint,
              posColor: P.gold,
              bg: P.card,
            }));
            return box;
          })(),
        ]);
        list.appendChild(row);
      });
      body.appendChild(el('div', {
        style: { fontSize: '10px', letterSpacing: '0.18em', color: 'var(--text-tertiary)', margin: '20px 0 12px' },
        text: '筹码实际分配',
      }));
      body.appendChild(list);
    }
  }

  if (volId === 'vol7') {
    const an = scoreMap.att_anxiety;
    const av = scoreMap.att_avoidance;
    const style = attachmentStyle(an, av);
    const body = chartCard(`依恋坐标 · ${style.name}`, 'X 轴回避，Y 轴焦虑');
    body.appendChild(quadrantSvg({ anxiety: an, avoidance: av }, {
      width: 440,
      color: P.vol7,
      ...chartOpt,
      safeColor: P.vol2,
    }));
    body.appendChild(el('p', {
      style: { fontSize: '12.5px', lineHeight: '1.95', color: 'var(--text-secondary)', marginTop: '14px' },
      text: style.desc,
    }));

    // 六大防御机制横向光谱
    const defs = [
      ['def_intellectual', '理智化'],
      ['def_detach', '情感隔离'],
      ['def_sublimate', '升华转化'],
      ['def_attack', '先发反击'],
      ['def_fawn', '讨好安抚'],
      ['def_project', '反向投射'],
    ].filter(([id]) => Number.isFinite(scoreMap[id]));

    if (defs.length) {
      const list = el('div', { class: 'spec-list', style: { marginTop: '18px' } });
      defs.forEach(([id, name]) => {
        const row = el('div', { class: 'spec-item' }, [
          el('div', { class: 'spec-item__name', text: name }),
          (() => {
            const box = el('div', { class: 'spec-svg' });
            box.appendChild(spectrumSvg({
              id, name, negLabel: '很少使用', posLabel: '几乎默认',
              value: scoreMap[id], color: P.vol7,
            }, {
              ...chartOpt,
              negColor: P.faint,
              posColor: P.vol7,
              bg: P.card,
            }));
            return box;
          })(),
        ]);
        list.appendChild(row);
      });
      body.appendChild(el('div', {
        style: { fontSize: '10px', letterSpacing: '0.18em', color: 'var(--text-tertiary)', margin: '20px 0 12px' },
        text: '六大防御机制使用倾向',
      }));
      body.appendChild(list);
    }
  }

  if (volId === 'vol8') {
    // 面具虚实叠层：本卷整体作答 vs 前七卷明线
    const maskV = Number.isFinite(state.maskIndex) ? round(state.maskIndex, 0) : null;
    const body = chartCard('高压剧场 · 面具校准', maskV === null ? 'Vol.8' : `面具厚度 ${maskV}`);

    const pressure = state.pressureStyle;
    if (pressure && pressure.distribution) {
      const list = el('div', { class: 'spec-list' });
      const names = {
        burst: '爆发火 · 攻击外化',
        cutoff: '断联冰 · 彻底关闭',
        cold: '黑化刃 · 冰冷计算',
        collapse: '坍塌雾 · 自我耗竭',
      };
      Object.entries(pressure.distribution)
        .sort((a, b) => b[1] - a[1])
        .forEach(([k, v]) => {
          const row = el('div', { class: 'spec-item' }, [
            el('div', { class: 'spec-item__name', text: names[k] || k }),
            (() => {
              const box = el('div', { class: 'spec-svg' });
              box.appendChild(spectrumSvg({
                id: k, name: names[k] || k,
                negLabel: '0%', posLabel: '100%',
                value: v, color: P.vol8,
              }, {
                ...chartOpt,
                negColor: P.faint,
                posColor: P.vol8,
                bg: P.card,
              }));
              return box;
            })(),
          ]);
          list.appendChild(row);
        });
      body.appendChild(el('div', {
        style: { fontSize: '10px', letterSpacing: '0.18em', color: 'var(--text-tertiary)', marginBottom: '12px' },
        text: '高压退行态分布',
      }));
      body.appendChild(list);
    }

    // 面具三分量
    if (state.maskDetail) {
      const md = state.maskDetail;
      const parts = [
        ['社会期许偏移', md.dsd],
        ['犹豫修饰度', md.hlat],
        ['镜像撕裂度', md.mirror],
      ].filter(([, v]) => Number.isFinite(v));

      if (parts.length) {
        const list = el('div', { class: 'spec-list', style: { marginTop: '18px' } });
        parts.forEach(([label, v]) => {
          const row = el('div', { class: 'spec-item' }, [
            el('div', { class: 'spec-item__name', text: label }),
            (() => {
              const box = el('div', { class: 'spec-svg' });
              box.appendChild(spectrumSvg({
                id: label, name: label, negLabel: '低', posLabel: '高',
                value: v, color: P.vol1,
              }, {
                ...chartOpt,
                negColor: P.faint,
                posColor: P.vol1,
                bg: P.card,
              }));
              return box;
            })(),
          ]);
          list.appendChild(row);
        });
        body.appendChild(el('div', {
          style: { fontSize: '10px', letterSpacing: '0.18em', color: 'var(--text-tertiary)', margin: '20px 0 12px' },
          text: '面具厚度三分量',
        }));
        body.appendChild(list);
      }
    }
  }

  /* ---------- Vol.09–Vol.16 图表 ---------- */
  if (volId === 'vol9') {
    const body = chartCard('荣格八维 · 认知功能栈', '前四位是剧本主角，后四位是疲倦时的接管人');
    body.appendChild(jungStackSvg(scoreMap, {
      ...chartOpt,
      color: P.vol9 || P.gold,
    }));
    const hint = jungTypeHint(scoreMap);
    if (hint) {
      body.appendChild(el('p', {
        style: { marginTop: '14px', fontSize: '11.5px', letterSpacing: '0.06em', color: 'var(--text-tertiary)' },
        text: `你的功能栈前缀：${hint}`,
      }));
    }
  }

  if (volId === 'vol10') {
    const order = scoreMap.dd_order;
    const good = scoreMap.dd_good;
    const hit = alignmentFrom(order, good);
    const body = chartCard(
      '阵营九宫格 · 秩序 × 良善',
      hit ? `落点：${hit.alignment.name}` : '九宫格坐标',
    );

    body.appendChild(alignmentSvg({ order, good }, {
      ...chartOpt,
      width: 560,
      color: P.vol10 || P.gold,
      showDesc: true,
    }));

    if (hit) {
      const cap = el('div', { class: 'matrix-caption' });
      cap.appendChild(el('h4', { text: `${hit.alignment.name} · ${hit.alignment.latin}` }));
      cap.appendChild(el('p', {
        text: `${hit.alignment.desc}。落在「${hit.orderBand.name} / ${hit.goodBand.name}」这一格。`
          + '坐标只是语言，不是判决书——同一套原则，在顺境里是风骨，在耗竭时可能变成硬壳。',
      }));
      body.appendChild(cap);

      /* 九格全览：把自己那一格标出来，其余八格作为参照 */
      const grid = el('div', { class: 'align-chips' });
      ALIGNMENTS.forEach((a) => {
        grid.appendChild(el('span', {
          class: `align-chip${a.key === hit.alignment.key ? ' is-on' : ''}`,
          text: a.name,
        }));
      });
      body.appendChild(grid);
    }
  }

  if (volId === 'vol16') {
    const hsp = meanOf(['hsp_sensory', 'hsp_emotional'], scoreMap);
    const hss = meanOf(['hss_novelty', 'hss_intensity'], scoreMap);
    const q = neuroOf(hsp, hss);
    const body = chartCard('神经边缘 · HSP × HSS', q ? `落点：${q.name}` : '二维坐标');
    body.appendChild(matrixSvg({
      x: hss,
      y: hsp,
      xLabel: '刺激寻求 ← →',
      yLabel: '感官敏锐 ← →',
      xLo: '低寻求',
      xHi: '高寻求',
      yLo: '低敏',
      yHi: '高敏',
      quadrants: NEURO_QUADRANTS,
      active: q?.key,
      pointLabel: q?.name,
    }, {
      ...chartOpt,
      width: 480,
      color: P.vol16 || P.gold,
      ariaLabel: 'HSP 与 HSS 四象限',
    }));
    if (q) {
      const cap = el('div', { class: 'matrix-caption' });
      cap.appendChild(el('h4', { text: q.name }));
      cap.appendChild(el('p', { text: `${q.desc}。高敏与高寻求并不互斥——很多人是「既想冲又怕吵」的矛盾体。` }));
      body.appendChild(cap);
    }

    // 四维光谱补充
    const list = el('div', { class: 'spec-list', style: { marginTop: '20px' } });
    [
      ['hsp_sensory', '感官敏锐度', '迟钝耐受', '细微信号也扎人'],
      ['hsp_emotional', '情绪敏锐度', '情绪绝缘', '情绪穿透力强'],
      ['hss_novelty', '新奇寻求', '熟悉即安心', '未知即兴奋'],
      ['hss_intensity', '强度寻求', '低强度长跑', '高强度冲刺'],
    ].filter(([id]) => Number.isFinite(scoreMap[id])).forEach(([id, name, neg, pos]) => {
      const row = el('div', { class: 'spec-item' }, [
        el('div', { class: 'spec-item__name', text: name }),
        (() => {
          const box = el('div', { class: 'spec-svg' });
          box.appendChild(spectrumSvg({
            id, name, negLabel: neg, posLabel: pos, value: scoreMap[id], color: P.vol16 || P.gold,
          }, { ...chartOpt, negColor: P.faint, posColor: P.vol16 || P.gold, bg: P.card }));
          return box;
        })(),
      ]);
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  if (volId === 'vol11' || volId === 'vol12' || volId === 'vol13' || volId === 'vol14' || volId === 'vol15') {
    const meta = {
      vol11: ['哲人底色 · 十四维倾向', '哲学底色 / 道德基础'],
      vol12: ['底层执念 · 恐惧轴强度', '九型 + 三副型'],
      vol13: ['童年剧本 · 图式烈度', '十大图式'],
      vol14: ['财富潜意识 · 脚本与时间观', '四大脚本 / 五种时间观'],
      vol15: ['冲突剧场 · 五种模式与三态', 'TKI + PAC'],
    }[volId];
    const body = chartCard(meta[0], meta[1]);
    const list = el('div', { class: 'spec-list' });
    dims
      .slice()
      .sort((a, b) => b.score - a.score)
      .forEach((d) => {
        const name = DATA.dimMap[d.id]?.name || d.id;
        const row = el('div', { class: 'spec-item' }, [
          el('div', { class: 'spec-item__name', text: name }),
          (() => {
            const box = el('div', { class: 'spec-svg' });
            box.appendChild(spectrumSvg({
              id: d.id, name, negLabel: '低', posLabel: '强', value: d.score, color: vol.theme_color,
            }, { ...chartOpt, negColor: P.faint, posColor: vol.theme_color, bg: P.card }));
            return box;
          })(),
        ]);
        list.appendChild(row);
      });
    body.appendChild(list);
  }

  /* ---------- 初印象对照（仅重测后出现） ---------- */
  const snap = initialSnapshotOf(state, volId);
  if (snap && snap.scores) {
    const body = chartCard('初印象 × 修正态', `封存于 ${formatDate(snap.sealedAt)}`);
    const common = dims.filter((d) => Number.isFinite(snap.scores[d.id]));
    if (common.length >= 3) {
      body.appendChild(radarSvg(common.map((d) => ({
        id: d.id,
        label: DATA.dimMap[d.id]?.name.slice(0, 4) || d.id,
        value: d.score,
      })), {
        width: 520,
        ...chartOpt,
        series: [
          {
            name: '初印象 · 本能态',
            values: common.map((d) => snap.scores[d.id]),
            color: P.faint, dashed: true, fillOpacity: 0.04, width: 1.1,
          },
          {
            name: '修正态 · 现在',
            values: common.map((d) => d.score),
            color: vol.theme_color, fillOpacity: 0.12,
          },
        ],
        showValues: false,
        labelSize: 10.5,
        ariaLabel: '初印象与修正态双层雷达',
      }));
    }

    const drift = common
      .map((d) => ({ id: d.id, name: DATA.dimMap[d.id]?.name || d.id, was: snap.scores[d.id], now: d.score }))
      .map((r) => ({ ...r, delta: round(r.now - r.was, 1) }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const list = el('div', { class: 'snapshot-list' });
    drift.slice(0, 6).forEach((r) => {
      const dir = r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'flat';
      list.appendChild(el('div', { class: 'snapshot-row' }, [
        el('span', { class: 'snapshot-row__name', text: r.name }),
        el('span', { class: 'snapshot-row__was', text: String(round(r.was, 0)) }),
        el('span', { class: 'snapshot-row__arrow', text: '→' }),
        el('span', { class: 'snapshot-row__now', text: String(round(r.now, 0)) }),
        el('span', {
          class: `snapshot-row__delta is-${dir}`,
          text: `${r.delta > 0 ? '+' : ''}${r.delta}`,
        }),
      ]));
    });
    body.appendChild(list);
    body.appendChild(el('p', {
      style: { marginTop: '14px', fontSize: '11.5px', lineHeight: '1.9', color: 'var(--text-secondary)' },
      text: '初印象更接近你还没开始自我观察时的本能反应；修正态里往往混进了「我希望自己是那样」的成分。两者都真实，差值本身才是重点。',
    }));
  }

  /* ---------- 双面镜 ---------- */
  const msec = el('section', { class: 'rsec' });
  msec.appendChild(sec('01', '优势面 × 劣势面', '点击卡片翻转'));
  const grid = el('div', { class: 'mirror-grid' });
  const shown = dims.slice(0, 12);
  shown.forEach((d) => {
    const m = mirrors[d.id];
    if (m) grid.appendChild(mirrorCard(m));
  });
  msec.appendChild(grid);

  if (dims.length > shown.length) {
    msec.appendChild(el('p', {
      style: {
        marginTop: '16px', fontSize: '11.5px', letterSpacing: '0.06em', color: 'var(--text-tertiary)',
      },
      text: `另有 ${dims.length - shown.length} 个维度的完整四面镜见下方「维度明细」表。`,
    }));
  }
  wrap.appendChild(msec);

  /* ---------- 维度明细 ---------- */
  const dsec = el('section', { class: 'rsec' });
  dsec.appendChild(sec('02', '本卷维度明细', `共 ${dims.length} 个可追踪维度`));
  dsec.appendChild(dimTable(dims, DATA.mirrors));
  wrap.appendChild(dsec);

  /* ---------- 作答明细 ---------- */
  const qsec = el('section', { class: 'rsec' });
  qsec.appendChild(sec('03', '你的作答留痕', '可在下一轮重测时对照'));
  const qbox = el('div', { style: { border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', overflow: 'hidden' } });
  vol.questions.forEach((q, i) => {
    const a = ans[q.id];
    if (!a) return;
    const row = el('div', {
      style: {
        padding: '14px 18px',
        borderBottom: i < vol.questions.length - 1 ? '1px solid var(--border-hair)' : 'none',
        fontSize: '12px',
        lineHeight: '1.8',
      },
    }, [
      el('div', { style: { display: 'flex', gap: '10px', alignItems: 'baseline', marginBottom: '4px' } }, [
        el('span', { style: { fontSize: '9.5px', letterSpacing: '0.16em', color: 'var(--text-tertiary)' }, text: `Q${String(i + 1).padStart(2, '0')}` }),
        el('span', { style: { flex: 1, color: 'var(--text-primary)' }, text: q.prompt.slice(0, 52) + (q.prompt.length > 52 ? '…' : '') }),
      ]),
      el('div', { style: { color: 'var(--text-secondary)', paddingLeft: '32px' }, text: formatAnswer(q, a.value) }),
    ]);
    qbox.appendChild(row);
  });
  qsec.appendChild(qbox);
  wrap.appendChild(qsec);

  /* ---------- 操作 ---------- */
  wrap.appendChild(el('div', { class: 'report-actions' }, [
    el('a', { class: 'btn btn--ghost', href: '#/', text: '← 返回大厅' }),
    el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: hasInitialSnapshot(state, volId) ? '重测（封存初印象）' : '重新作答此卷',
      onclick: () => {
        const hasSnap = hasInitialSnapshot(state, volId);
        confirmDialog({
          title: hasSnap ? '封存初印象并重测' : '重新作答此卷',
          sub: hasSnap
            ? '你的第一次作答会被封存为「初印象 · 本能态」，重测结果将与它并列展示。两者的差异往往比分数本身更有信息量。'
            : '这会清空本卷的作答记录，重新从第一题开始。',
          confirmText: hasSnap ? '封存并重测' : '清空并重测',
          danger: !hasSnap,
          onConfirm: () => {
            retakeVolume(state, volId, vol.dimensions || []);
            recompute({ silent: true });
            toast('已清空本卷作答');
            go(`#/quiz/${volId}`);
          },
        });
      },
    }),
    el('a', { class: 'btn btn--ghost', href: '#/report', text: '全息报告' }),
    el('button', {
      class: 'btn',
      type: 'button',
      text: '导出本卷 PNG',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '绘制中…';
        try {
          const single = {
            archetype: { best: { name: vol.title, latin: vol.subtitle, keywords: giftList.map((g) => g.gift_title), verdict: `本卷聚焦：${vol.subtitle}。这是你的人性档案中的第 ${vol.index} 卷。` } },
            scores: Object.fromEntries(dims.map((d) => [d.id, d.score])),
            gifts: giftList,
            shadows: shadowList,
            cross: [],
            values: [],
            dual: null,
            manual: null,
            mask: { value: state.maskIndex },
            completed: state.completedVolumes,
          };
          const name = await downloadPoster(single, {
            long: false, theme: App.theme, nickname: state.nickname,
          });
          toast(`已保存 ${name}`);
        } catch (err) {
          console.error(err);
          toast('导出失败');
        }
        btn.disabled = false;
        btn.textContent = '导出本卷 PNG';
      },
    }),
    el('button', {
      class: 'btn btn--gold',
      type: 'button',
      text: '生成存档码',
      onclick: () => openSoulDialog(encodeSoulCode(state, DATA.dimOrder), state),
    }),
  ]));

  wrap.appendChild(el('div', {
    class: 'print-colophon',
    text: `THE HUMAN ATLAS · VOL.${String(vol.index).padStart(2, '0')} · 本地生成`,
  }));

  wrap.appendChild(el('p', {
    class: 'report-disclaimer is-lite',
    text: '本报告用于自我探索，不是心理诊断，不构成医疗建议，也不能替代专业心理咨询。',
  }));
}

/* ------------------------------------------------------------
   辅助
   ------------------------------------------------------------ */

function formatAnswer(q, value) {
  if (value === undefined || value === null) return '未作答';
  if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
    const o = (q.options || []).find((x) => x.key === value);
    return o ? `${o.key}. ${o.text}` : String(value);
  }
  if (q.type === 'stealth_scale') {
    return `${value} / 7 — ${value >= 4 ? (q.scale?.right || '偏右') : (q.scale?.left || '偏左')}`;
  }
  if (q.type === 'budget_100') {
    return Object.entries(value || {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => {
        const it = (q.items || []).find((x) => x.key === k);
        return `${it?.label || k} ${v}`;
      })
      .join(' · ') || '未分配';
  }
  if (q.type === 'pyramid_top3') {
    return (value || [])
      .map((k, i) => {
        const it = (q.values || []).find((x) => x.key === k);
        return `${i + 1}. ${it?.label || k}`;
      })
      .join(' · ');
  }
  return String(value);
}

/**
 * 光暗能量比。
 *
 * 旧实现输出 `49 : 100` —— 看起来像两个独立分数，也很像算错了，
 * 因为一般的 `A : B` 会被默认理解为占比（相加 100）。
 * 现在改成「光 49% / 暗 51%」：两数相加恒为 100，一眼能读，
 * 同时给出「接近均衡 / 明显偏光 / 明显偏暗」的档位词。
 */
function computeLightDark(scores) {
  const lightKeys = ['light_humanism', 'light_kant', 'light_faith', 'virtue_humility', 'virtue_charity', 'virtue_kindness', 'virtue_patience', 'virtue_temperance', 'virtue_diligence', 'virtue_chastity'];
  const darkKeys = ['dark_mach', 'dark_narc', 'dark_psycho', 'sin_pride', 'sin_greed', 'sin_envy', 'sin_wrath', 'sin_sloth', 'sin_lust', 'sin_gluttony'];
  const l = lightKeys.map((k) => scores[k]).filter(Number.isFinite);
  const d = darkKeys.map((k) => scores[k]).filter(Number.isFinite);
  if (!l.length || !d.length) return { text: '—', note: '' };

  const lm = l.reduce((a, b) => a + b, 0) / l.length;
  const dm = d.reduce((a, b) => a + b, 0) / d.length;
  const sum = lm + dm;
  if (sum <= 0.5) return { text: '光 50% / 暗 50%', note: ' · 无数据' };

  const lp = Math.round((lm / sum) * 100);
  const dp = 100 - lp;
  const note = lp >= 58 ? ' · 偏光' : dp >= 58 ? ' · 偏暗' : ' · 接近均衡';
  return { text: `光 ${lp}% / 暗 ${dp}%`, note };
}
