/* ============================================================
   ExpressView.js — 极速模式：入口页 + 简报页
   ============================================================ */

import { el, go, round, toast, copyText } from '../core/utils.js';
import { save, encodeSoulCode } from '../core/storage.js';
import { computeAll, tierOf } from '../core/scoring.js';
import { mirrorFor, topGifts, topShadows } from '../core/synthesizer.js';
import { emblemSvg } from '../viz/emblemsSvg.js';
import {
  EXPRESS_BUCKET, buildExpressVolume, seedFromVolumes, commitExpress,
  expressProgress, expressDimCoverage,
} from '../core/express.js';

/* ------------------------------------------------------------
   入口页
   ------------------------------------------------------------ */

export function renderExpressIntro(root, ctx) {
  const { App, DATA, go: nav } = ctx;
  const state = App.state;
  const vol = buildExpressVolume(DATA, DATA.express);
  const { answered, total } = expressProgress(state, vol);
  const { count: dimCount } = expressDimCoverage(vol);

  root.classList.add('view');
  const wrap = el('div', { class: 'express-result' });
  root.appendChild(wrap);

  const hero = el('div', { class: 'express-hero' });
  hero.appendChild(el('div', { class: 'express-hero__kicker', text: 'Express · 初见微光' }));
  hero.appendChild(el('h1', { text: vol.title }));
  hero.appendChild(el('p', { text: vol.intro }));
  wrap.appendChild(hero);

  const stats = el('dl', { class: 'express-stats' });
  [
    ['题目', `${total}`],
    ['预计', `约 ${vol.estimated_minutes} 分钟`],
    ['覆盖维度', `${dimCount}`],
    ['来源卷宗', '16 卷'],
  ].forEach(([k, v]) => {
    stats.appendChild(el('div', { class: 'express-stat' }, [
      el('dt', { text: k }),
      el('dd', { text: v }),
    ]));
  });
  wrap.appendChild(stats);

  const actions = el('div', { class: 'express-actions' }, [
    el('button', {
      class: 'btn btn--solid',
      type: 'button',
      text: answered > 0 ? `继续（已答 ${answered}/${total}）` : '开始 28 题',
      onclick: () => {
        seedFromVolumes(state, vol);
        save(state, { immediate: true });
        nav(`#/express/quiz`);
      },
    }),
    el('a', { class: 'btn btn--ghost', href: '#/', text: '返回大厅' }),
  ]);
  wrap.appendChild(actions);

  wrap.appendChild(el('p', {
    class: 'notice',
    style: { marginTop: '22px' },
    html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/></svg><span>这 28 题是从十六卷里挑出来的高区分度题，不重复造题。做过的题会自动同步到原卷，之后做完整卷时不会再让你答第二遍。</span>`,
  }));
}

/* ------------------------------------------------------------
   简报页
   ------------------------------------------------------------ */

export function renderExpressResult(root, ctx) {
  const { App, DATA, recompute, soulCode, go: nav } = ctx;
  const state = App.state;
  const vol = buildExpressVolume(DATA, DATA.express);

  // 把虚拟桶的答案写回真实卷，然后重算
  const moved = commitExpress(state, vol);
  if (moved) {
    save(state, { immediate: true });
    recompute({ silent: true });
  }

  const answers = state.answersByVolume || {};
  const answeredCount = vol.questions.filter((q) => {
    const src = answers[q._srcVol]?.[q.id];
    return src && src.value !== undefined;
  }).length;

  root.classList.add('view');
  const wrap = el('div', { class: 'express-result' });
  root.appendChild(wrap);

  const hero = el('div', { class: 'express-hero' });
  hero.appendChild(el('div', { class: 'express-hero__kicker', text: 'Express · 初见微光简报' }));
  hero.appendChild(el('h1', { text: '这就是刚才那 28 题的你' }));
  hero.appendChild(el('p', {
    text: answeredCount < vol.questions.length
      ? `已完成 ${answeredCount}/${vol.questions.length} 题。以下是基于目前作答的速写，不是完整档案。`
      : '这是速写，不是判决书。28 题只能勾出轮廓，完整的十六卷才能画出细节。',
  }));
  wrap.appendChild(hero);

  /* ---------- 得分 ---------- */
  const dims = (vol.dimensions || [])
    .map((d) => ({ id: d, score: state.computedScores?.[d] }))
    .filter((d) => Number.isFinite(d.score));

  const gifts = topGifts(Object.fromEntries(dims.map((d) => [d.id, d.score])), DATA.mirrors, 3);
  const shadows = topShadows(Object.fromEntries(dims.map((d) => [d.id, d.score])), DATA.mirrors, 3);

  const stats = el('dl', { class: 'express-stats' });
  [
    ['已作答', `${answeredCount} / ${vol.questions.length}`],
    ['已测维度', `${dims.length}`],
    ['社会面具', Number.isFinite(state.maskIndex) ? `${round(state.maskIndex, 0)}` : '—'],
    ['完成卷宗', `${(state.completedVolumes || []).length} / 16`],
  ].forEach(([k, v]) => {
    stats.appendChild(el('div', { class: 'express-stat' }, [
      el('dt', { text: k }),
      el('dd', { text: v }),
    ]));
  });
  wrap.appendChild(stats);

  /* ---------- 王牌天赋 / 阴影预警 ---------- */
  if (gifts.length) {
    const card = el('div', { class: 'chart-card', style: { marginBottom: '18px' } });
    card.appendChild(el('div', { class: 'chart-card__head' }, [
      el('h3', { text: '这张速写里最亮的三处' }),
      el('span', { class: 'chart-card__note', text: '按绝对分与个人内部尖峰综合排序' }),
    ]));
    const body = el('div', { class: 'chart-card__body' });
    gifts.forEach((g) => {
      body.appendChild(el('div', {
        style: {
          padding: '14px 0',
          borderBottom: '1px solid var(--border-hair)',
        },
      }, [
        el('div', {
          style: {
            display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'baseline',
          },
        }, [
          el('b', { style: { fontFamily: 'var(--font-serif)', fontSize: '15px' }, text: g.gift_title }),
          el('span', {
            style: {
              fontSize: '11px', color: 'var(--gold)', fontVariantNumeric: 'tabular-nums',
            },
            text: `${round(g.strength ?? 0, 0)}`,
          }),
        ]),
        el('p', {
          style: {
            margin: '6px 0 0', fontSize: '12.5px', lineHeight: '1.85', color: 'var(--text-secondary)',
          },
          text: g.gift_desc,
        }),
      ]));
    });
    card.appendChild(body);
    wrap.appendChild(card);
  }

  if (shadows.length) {
    const card = el('div', { class: 'chart-card', style: { marginBottom: '18px' } });
    card.appendChild(el('div', { class: 'chart-card__head' }, [
      el('h3', { text: '同一个形状的另一面' }),
      el('span', { class: 'chart-card__note', text: '不是缺点，是力量用过头的样子' }),
    ]));
    const body = el('div', { class: 'chart-card__body' });
    shadows.forEach((s) => {
      body.appendChild(el('div', {
        style: { padding: '12px 0', borderBottom: '1px solid var(--border-hair)' },
      }, [
        el('b', { style: { fontFamily: 'var(--font-serif)', fontSize: '14px' }, text: s.shadow_title }),
        el('p', {
          style: {
            margin: '5px 0 0', fontSize: '12.5px', lineHeight: '1.85', color: 'var(--text-secondary)',
          },
          text: s.shadow_desc,
        }),
      ]));
    });
    card.appendChild(body);
    wrap.appendChild(card);
  }

  /* ---------- 维度速览 ---------- */
  if (dims.length) {
    const card = el('div', { class: 'chart-card', style: { marginBottom: '18px' } });
    card.appendChild(el('div', { class: 'chart-card__head' }, [
      el('h3', { text: '已测维度速览' }),
      el('span', { class: 'chart-card__note', text: `${dims.length} 维` }),
    ]));
    const body = el('div', { class: 'chart-card__body' });
    const rows = [...dims].sort((a, b) => b.score - a.score).slice(0, 12);
    rows.forEach((d) => {
      const m = mirrorFor(d.id, d.score, DATA.mirrors);
      const tier = tierOf(d.score);
      body.appendChild(el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 56px 64px',
          gap: '12px',
          alignItems: 'center',
          padding: '9px 0',
          borderBottom: '1px solid var(--border-hair)',
        },
      }, [
        el('span', {
          style: { fontSize: '12.5px', color: 'var(--text-primary)' },
          text: DATA.dimMap[d.id]?.name || d.id,
        }),
        el('span', {
          style: {
            fontSize: '13px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)',
          },
          text: String(round(d.score, 0)),
        }),
        el('span', {
          style: { fontSize: '10.5px', letterSpacing: '0.06em', color: 'var(--text-tertiary)', textAlign: 'right' },
          text: tier.name,
        }),
      ]));
    });
    card.appendChild(body);
    wrap.appendChild(card);
  }

  /* ---------- 存档码 ---------- */
  const codeBox = el('div', { class: 'code-box', text: '' });
  const codeCard = el('div', { class: 'chart-card', style: { marginBottom: '18px' } });
  codeCard.appendChild(el('div', { class: 'chart-card__head' }, [
    el('h3', { text: '把这 28 题带走' }),
    el('span', { class: 'chart-card__note', text: 'HA4- 存档码' }),
  ]));
  const codeBody = el('div', { class: 'chart-card__body' });
  try {
    const code = encodeSoulCode(state, DATA.dimOrder);
    codeBox.textContent = code;
  } catch {
    codeBox.textContent = '（生成失败，请刷新重试）';
  }
  codeBody.appendChild(codeBox);
  const btnRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, [
    el('button', {
      class: 'btn btn--sm btn--solid',
      type: 'button',
      text: '复制存档码',
      onclick: async () => {
        const ok = await copyText(codeBox.textContent);
        toast(ok ? '已复制，发给朋友即可合盘' : '复制失败，请手动选择');
      },
    }),
    el('a', {
      class: 'btn btn--sm',
      href: '#/compare',
      text: '去合盘对比',
    }),
  ]);
  codeBody.appendChild(btnRow);
  codeCard.appendChild(codeBody);
  wrap.appendChild(codeCard);

  /* ---------- 下一步 ---------- */
  wrap.appendChild(el('div', { class: 'express-actions' }, [
    el('a', { class: 'btn btn--solid', href: '#/', text: '进大厅做完整卷宗' }),
    el('a', { class: 'btn', href: '#/compare', text: '双人对比' }),
    el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: '重做这 28 题',
      onclick: () => {
        delete state.answersByVolume[EXPRESS_BUCKET];
        delete state.inProgress[EXPRESS_BUCKET];
        save(state, { immediate: true });
        nav('#/express');
      },
    }),
  ]));

  wrap.appendChild(el('p', {
    class: 'colophon',
    style: { marginTop: '26px' },
    text: 'EXPRESS · 28 题速写 · 全部计算在本地完成，无任何数据上传',
  }));
}
