/* ============================================================
   LabView.js — 个人深度实验室（Phase 3 的三个模块）
   · sandboxSection   压力变形沙盒（交互滑杆 + 实时形变雷达）
   · parliamentSection 内在议会（双声部对话）
   · timelineSection   时间胶囊（双层对照 + 变化 Top 5）
   ============================================================ */

import { el, round, toast } from '../core/utils.js';
import { radarSvg } from '../viz/radarSvg.js';
import {
  pressureSandbox, stageOf, ENERGY_STAGES, innerParliament, timelineDiff,
} from '../core/lab.js';
import { decodeSoulCode, initialSnapshotOf } from '../core/storage.js';

/* ------------------------------------------------------------
   小工具
   ------------------------------------------------------------ */

const labHead = (no, title, hint) => el('div', { class: 'rsec__head' }, [
  el('span', { class: 'rsec__no', text: no }),
  el('h2', { text: title }),
  hint ? el('p', { text: hint }) : null,
]);

/* ------------------------------------------------------------
   雷达共用：挑一组有信息量的维度
   ------------------------------------------------------------ */

const RADAR_PICKS = [
  ['sin_pride', '自尊'],
  ['virtue_humility', '谦逊'],
  ['mot_autonomy', '自主'],
  ['mot_security', '安全'],
  ['big5_order', '秩序'],
  ['hsp_sensory', '敏惑'],
  ['big5_assert', '表达'],
  ['light_kant', '原则'],
  ['dark_mach', '谋略'],
  ['att_anxiety', '焦虑'],
];

function pickAxes(scores, max = 8) {
  const out = [];
  for (const [id, label] of RADAR_PICKS) {
    if (Number.isFinite(scores?.[id])) out.push({ id, label, value: scores[id] });
    if (out.length >= max) break;
  }
  if (out.length < 3) return [];
  return out;
}

/* ============================================================
   1 · 压力变形沙盒
   ============================================================ */

export function sandboxSection({ scores, colors }) {
  const axes = pickAxes(scores);
  if (axes.length < 3) return null;

  const sec = el('section', { class: 'rsec', id: 'r-sandbox' });

  sec.appendChild(labHead('05', '压力变形沙盒', '拖动滑杆，看同一套特质在不同电量下会长成什么形状'));

  /* ---- 说明 ---- */
  sec.appendChild(el('p', {
    class: 'sandbox__lead',
    text: '下面这张雷达会随滑杆实时变形。往左是耗竭，暗面维度会涨、明面维度会退；往右是充沛，反过来。'
      + '它不是预测，是一个可解释的线性模型：满偏移最多移动 16 分。',
  }));

  /* ---- 滑杆 + 舞台 ---- */
  const stageBox = el('div', { class: 'sandbox' });
  sec.appendChild(stageBox);

  const control = el('div', { class: 'sandbox__control' });

  const valueTag = el('div', { class: 'sandbox__value' });
  const sliderWrap = el('div', { class: 'sandbox__slider' });

  const input = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: '50',
    class: 'sandbox__range',
    'aria-label': '内在能量模拟',
  });
  sliderWrap.appendChild(input);

  /* 刻度牌必须与滑杆同向：0 在左 = 极度耗竭，100 在右 = 充沛顺境。
     ENERGY_STAGES 本身已按 电量从低到高 排列，直接用即可，不要再 reverse。 */
  const ticks = el('div', { class: 'sandbox__ticks' });
  ENERGY_STAGES.forEach((st) => {
    ticks.appendChild(el('span', {
      class: 'sandbox__tick',
      text: st.name,
    }));
  });
  sliderWrap.appendChild(ticks);

  control.appendChild(valueTag);
  control.appendChild(sliderWrap);

  const stageCard = el('div', { class: 'sandbox__stage' });
  control.appendChild(stageCard);

  stageBox.appendChild(control);

  const canvas = el('div', { class: 'sandbox__canvas' });
  stageBox.appendChild(canvas);

  const deltaList = el('div', { class: 'sandbox__delta' });
  stageBox.appendChild(deltaList);

  /* ---- 渲染 ---- */
  function render(energy) {
    const sim = pressureSandbox(scores, energy);
    const stage = stageOf(energy);

    valueTag.innerHTML = '';
    valueTag.appendChild(el('b', { text: String(Math.round(energy)) }));
    valueTag.appendChild(el('i', { text: stage.name }));

    stageCard.innerHTML = '';
    stageCard.appendChild(el('h4', { text: stage.headline }));
    stageCard.appendChild(el('p', { text: stage.body }));

    canvas.innerHTML = '';
    const simAxes = axes.map((a) => ({
      ...a,
      value: Number.isFinite(sim.scores[a.id]) ? sim.scores[a.id] : a.value,
    }));

    canvas.appendChild(radarSvg(simAxes, {
      width: 480,
      colorText: colors.text,
      colorMuted: colors.muted,
      colorBorder: colors.border,
      bg: colors.card,
      series: [
        {
          name: '日常常态',
          values: axes.map((a) => a.value),
          color: colors.faint,
          dashed: true,
          fillOpacity: 0.03,
          width: 1.1,
        },
        {
          name: stage.name,
          values: simAxes.map((a) => a.value),
          color: energy < 45 ? colors.sin : energy > 60 ? colors.virtue : colors.gold,
          fillOpacity: 0.14,
        },
      ],
      showValues: false,
      labelSize: 10.5,
      ariaLabel: '压力变形沙盒雷达',
    }));

    deltaList.innerHTML = '';
    const moved = [...sim.rising, ...sim.falling]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 6);

    if (!moved.length) {
      deltaList.appendChild(el('p', {
        class: 'sandbox__hint',
        text: '这就是你的日常常态，没有偏移。',
      }));
    } else {
      moved.forEach(([dim, d]) => {
        deltaList.appendChild(el('div', {
          class: `sandbox__chip is-${d > 0 ? 'up' : 'down'}`,
        }, [
          el('span', { text: colors.dimName(dim) }),
          el('b', { text: `${d > 0 ? '+' : ''}${round(d, 1)}` }),
        ]));
      });
    }

    /* 耗竭态的红色警示 */
    const warnBox = sec.querySelector('.sandbox__warn');
    if (warnBox) warnBox.remove();

    if (sim.warnings.length && energy < 42) {
      const w = el('div', { class: 'sandbox__warn' });
      w.appendChild(el('b', { text: '此刻最需要拉响的刹车' }));
      sim.warnings.forEach((x) => {
        w.appendChild(el('p', {
          text: `${colors.dimName(x.dim)} 被推到 ${x.value}——这个高度通常是耗竭带来的，不是你本来的样子。`,
        }));
      });
      stageBox.appendChild(w);
    }
  }

  input.addEventListener('input', () => render(Number(input.value)));

  /* 三档快捷按钮 */
  const presets = el('div', { class: 'sandbox__presets' });
  [
    ['充沛顺境', 88],
    ['日常常态', 50],
    ['极度耗竭', 12],
  ].forEach(([label, v]) => {
    presets.appendChild(el('button', {
      class: 'btn btn--sm',
      type: 'button',
      text: label,
      onclick: () => {
        input.value = String(v);
        render(v);
      },
    }));
  });
  stageBox.appendChild(presets);

  render(Number(input.value));
  return sec;
}

/* ============================================================
   2 · 内在议会
   ============================================================ */

export function parliamentSection({ scores }) {
  const pairs = innerParliament(scores, 3);
  if (!pairs.length) return null;

  const sec = el('section', { class: 'rsec', id: 'r-parliament' });

  sec.appendChild(labHead('06', '内在议会', '同时偏高、却在互相拉扯的那几组驱动力'));

  sec.appendChild(el('p', {
    class: 'sandbox__lead',
    text: '下面每一组，都是你身上两股同时为真的力量。它们不是你不够坚定，是两件事对你都很重要。',
  }));

  pairs.forEach((p, idx) => {
    const card = el('div', { class: 'parliament' });

    card.appendChild(el('div', { class: 'parliament__top' }, [
      el('span', { class: 'parliament__no', text: `0${idx + 1}` }),
      el('h3', { text: p.title }),
      el('span', { class: 'parliament__intensity', text: `张力 ${p.intensity}` }),
    ]));

    const voices = el('div', { class: 'parliament__voices' });

    voices.appendChild(el('div', { class: 'voice voice--a' }, [
      el('div', { class: 'voice__head' }, [
        el('span', { class: 'voice__dot' }),
        el('span', { class: 'voice__score', text: String(p.aScore) }),
      ]),
      el('p', { class: 'voice__text', text: p.voiceA }),
    ]));

    voices.appendChild(el('div', { class: 'voice voice--b' }, [
      el('div', { class: 'voice__head' }, [
        el('span', { class: 'voice__dot' }),
        el('span', { class: 'voice__score', text: String(p.bScore) }),
      ]),
      el('p', { class: 'voice__text', text: p.voiceB }),
    ]));

    card.appendChild(voices);

    card.appendChild(el('div', { class: 'parliament__verdict' }, [
      el('b', { text: '议会调解' }),
      el('p', { text: p.verdict }),
    ]));

    card.appendChild(el('div', { class: 'parliament__tip' }, [
      el('b', { text: '可执行' }),
      el('p', { text: p.tip }),
    ]));

    sec.appendChild(card);
  });

  return sec;
}

/* ============================================================
   3 · 时间胶囊
   ============================================================ */

export function timelineSection({ state, scores, colors, dimMap }) {
  const sec = el('section', { class: 'rsec', id: 'r-timeline' });

  sec.appendChild(labHead('07', '时间胶囊', '把过去的自己调出来，放在同一张图上'));

  /* 候选来源：1) 各卷的初印象快照 2) 手动粘贴的历史存档码 */
  const snaps = [];
  const initial = state.initialSnapshot || {};
  for (const [volId, snap] of Object.entries(initial)) {
    if (!snap?.scores) continue;
    snaps.push({
      key: `snap:${volId}`,
      label: `${volId.toUpperCase()} 初印象 · ${new Date(snap.sealedAt).toISOString().slice(0, 10)}`,
      scores: snap.scores,
      at: snap.sealedAt,
    });
  }

  const body = el('div', { class: 'timeline' });

  const status = el('p', { class: 'sandbox__hint', text: '' });
  const resultBox = el('div', { class: 'timeline__result' });

  const inputRow = el('div', { class: 'timeline__input' });
  const ta = el('textarea', {
    class: 'field field--code',
    rows: '3',
    placeholder: '粘贴一份历史 HA4- 存档码（可选）',
  });
  inputRow.appendChild(ta);
  inputRow.appendChild(el('button', {
    class: 'btn btn--sm btn--solid',
    type: 'button',
    text: '对照',
    onclick: () => {
      const raw = ta.value.trim();
      if (!raw) { toast('先粘贴一份存档码'); return; }
      const res = decodeSoulCode(raw, state.__dimOrder || []);
      if (!res.ok) { toast(res.error || '解码失败'); return; }
      renderDiff(res.state.computedScores, res.state.stamp || '历史存档');
    },
  }));
  body.appendChild(inputRow);

  /* 初印象快捷按钮 */
  if (snaps.length) {
    const chips = el('div', { class: 'timeline__chips' });
    snaps.slice(0, 4).forEach((s) => {
      chips.appendChild(el('button', {
        class: 'btn btn--sm btn--ghost',
        type: 'button',
        text: s.label,
        onclick: () => renderDiff(s.scores, s.label),
      }));
    });
    body.appendChild(chips);
  } else {
    body.appendChild(el('p', {
      class: 'sandbox__hint',
      text: '还没有初印象快照。每卷第一次完成时会自动封存一份，重测之后就能在这里对照。',
    }));
  }

  body.appendChild(status);
  body.appendChild(resultBox);

  function renderDiff(pastScores, label) {
    const diff = timelineDiff(pastScores, scores, dimMap);
    resultBox.innerHTML = '';

    if (!diff.rows.length) {
      resultBox.appendChild(el('p', { class: 'sandbox__hint', text: '两份数据没有重叠维度，无法对照。' }));
      return;
    }

    status.textContent = `对照：${label} · ${diff.rows.length} 个重叠维度`;

    /* 双层雷达 */
    const axes = pickAxes(scores, 8).filter((a) => Number.isFinite(pastScores[a.id]));
    if (axes.length >= 3) {
      const radarBox = el('div', { class: 'timeline__radar' });
      radarBox.appendChild(radarSvg(
        axes.map((a) => ({ ...a, value: pastScores[a.id] })),
        {
          width: 480,
          colorText: colors.text,
          colorMuted: colors.muted,
          colorBorder: colors.border,
          bg: colors.card,
          series: [
            {
              name: '过去',
              values: axes.map((a) => pastScores[a.id]),
              color: colors.faint,
              dashed: true,
              fillOpacity: 0.03,
              width: 1.1,
            },
            {
              name: '此刻',
              values: axes.map((a) => scores[a.id]),
              color: colors.gold,
              fillOpacity: 0.13,
            },
          ],
          labelSize: 10.5,
          ariaLabel: '时间胶囊双层雷达',
        },
      ));
      resultBox.appendChild(radarBox);
    }

    /* 变化 Top 5 */
    const list = el('div', { class: 'timeline__list' });
    diff.top5.forEach((r) => {
      const dir = r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'flat';
      list.appendChild(el('div', { class: 'timeline__row' }, [
        el('span', { class: 'timeline__name', text: r.name }),
        el('span', { class: 'timeline__past', text: String(Math.round(r.past)) }),
        el('span', { class: 'timeline__arrow', text: '→' }),
        el('span', { class: 'timeline__now', text: String(Math.round(r.now)) }),
        el('span', { class: `timeline__delta is-${dir}`, text: `${r.delta > 0 ? '+' : ''}${r.delta}` }),
      ]));
    });
    resultBox.appendChild(list);

    resultBox.appendChild(el('p', { class: 'timeline__verdict', text: diff.verdict }));
  }

  sec.appendChild(body);
  return sec;
}
