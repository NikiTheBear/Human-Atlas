/* ============================================================
   jungStackSvg.js — 荣格八维认知功能栈图
   横条 + 功能位标注：主导 / 辅助 / 第三 / 阴影（第 5–8）
   ============================================================ */

import { el, clamp, round } from '../core/utils.js';

const ORDER = ['jung_te', 'jung_ti', 'jung_fe', 'jung_fi', 'jung_ne', 'jung_ni', 'jung_se', 'jung_si'];

const META = {
  jung_te: { name: 'Te 外倾思维', short: 'Te', group: 'judge', dir: 'extra' },
  jung_ti: { name: 'Ti 内倾思维', short: 'Ti', group: 'judge', dir: 'intro' },
  jung_fe: { name: 'Fe 外倾情感', short: 'Fe', group: 'feel', dir: 'extra' },
  jung_fi: { name: 'Fi 内倾情感', short: 'Fi', group: 'feel', dir: 'intro' },
  jung_ne: { name: 'Ne 外倾直觉', short: 'Ne', group: 'intuit', dir: 'extra' },
  jung_ni: { name: 'Ni 内倾直觉', short: 'Ni', group: 'intuit', dir: 'intro' },
  jung_se: { name: 'Se 外倾感觉', short: 'Se', group: 'sense', dir: 'extra' },
  jung_si: { name: 'Si 内倾感觉', short: 'Si', group: 'sense', dir: 'intro' },
};

const POSITION_NAMES = ['主导功能', '辅助功能', '第三功能', '盲点 / 阴影位'];

/**
 * @param {Object} scores  { jung_te: 74, ... }
 * @param {Object} opt  { color, colorText, colorMuted, colorBorder, bg, width }
 * @returns {HTMLElement}
 */
export function jungStackSvg(scores = {}, opt = {}) {
  const cMain = opt.color || '#2F5266';
  const cText = opt.colorText || '#1E2220';
  const cMuted = opt.colorMuted || '#8B8F89';
  const cBorder = opt.colorBorder || '#E4DFD4';

  const present = ORDER.filter((d) => Number.isFinite(scores[d]));
  const wrap = el('div', { class: 'jung-stack', role: 'img', 'aria-label': '荣格八维认知功能栈' });

  if (!present.length) {
    wrap.appendChild(el('p', {
      style: { fontSize: '12px', color: cMuted, margin: '0' },
      text: '本卷完成后显示认知功能栈。',
    }));
    return wrap;
  }

  const ranked = [...present].sort((a, b) => scores[b] - scores[a]);
  const top4 = ranked.slice(0, 4);

  // 功能位标尺
  const head = el('div', { class: 'jung-stack__head' });
  head.appendChild(el('span', { text: '首席四功能' }));
  head.appendChild(el('span', { text: '阴影四功能（第 5–8）' }));
  wrap.appendChild(head);

  const main = el('div', { class: 'jung-stack__main' });
  top4.forEach((id, i) => {
    const m = META[id] || { name: id, short: id };
    const v = clamp(round(scores[id], 0), 0, 100);
    const bar = el('div', { class: `jung-row jung-row--p${i + 1}` });
    bar.appendChild(el('div', { class: 'jung-row__pos', text: POSITION_NAMES[i] || `第${i + 1}` }));
    bar.appendChild(el('div', { class: 'jung-row__name', text: m.name }));
    const track = el('div', { class: 'jung-row__track' });
    const fill = el('i');
    fill.style.width = `${v}%`;
    fill.style.background = cMain;
    track.appendChild(fill);
    bar.appendChild(track);
    bar.appendChild(el('div', { class: 'jung-row__score', text: String(v) }));
    main.appendChild(bar);
  });
  wrap.appendChild(main);

  const rest = ranked.slice(4);
  if (rest.length) {
    const shadow = el('div', { class: 'jung-stack__shadow' });
    rest
      .sort((a, b) => scores[a] - scores[b])
      .forEach((id, i) => {
        const m = META[id] || { name: id, short: id };
        const v = clamp(round(scores[id], 0), 0, 100);
        const row = el('div', { class: 'jung-shadow-row' });
        row.appendChild(el('span', { class: 'jung-shadow-row__pos', text: `第${5 + i}` }));
        row.appendChild(el('span', { class: 'jung-shadow-row__name', text: m.name }));
        row.appendChild(el('span', { class: 'jung-shadow-row__score', text: String(v) }));
        const bar = el('span', { class: 'jung-shadow-row__bar' });
        const f = document.createElement('i');
        f.style.width = `${v}%`;
        f.style.background = cMuted;
        bar.appendChild(f);
        row.appendChild(bar);
        shadow.appendChild(row);
      });
    wrap.appendChild(shadow);
    wrap.appendChild(el('p', {
      class: 'jung-stack__note',
      style: { color: cMuted },
      text: '阴影功能不是缺点。它们在你放松、疲倦或被逼到墙角时，会突然接管指挥权。',
    }));
  }

  // 四组对照小注
  wrap.appendChild(el('div', { class: 'jung-stack__legend' }, [
    el('span', { text: '判断轴：T / F' }),
    el('span', { text: '知觉轴：N / S' }),
    el('span', { text: '朝向：e 外倾 / i 内倾' }),
  ]));

  void cText;
  void cBorder;
  return wrap;
}

/** 归纳出「功能栈四字缩写」，如 Ni-Te-Fi-Se */
export function jungTypeHint(scores = {}) {
  const present = ORDER.filter((d) => Number.isFinite(scores[d]));
  if (present.length < 2) return null;
  const ranked = [...present].sort((a, b) => scores[b] - scores[a]);
  return ranked.slice(0, 3).map((d) => META[d]?.short || d).join('–');
}

export const JUNG_META = META;
export const JUNG_ORDER = ORDER;
