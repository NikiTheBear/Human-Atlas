/* ============================================================
   spectrumSvg.js — 双极倾向光谱条
   中轴为 50，两侧为对立极。
   使用 HTML 承载文字（保证不随 SVG 缩放变形），SVG 只绘制轨道与指示点。
   ============================================================ */

import { svg, clamp, round } from '../core/utils.js';

/**
 * @param {Object} o { id, name, negLabel, posLabel, value, color }
 * @param {Object} opt { negColor, posColor, colorMuted, colorBorder, bg }
 * @returns {HTMLElement}
 */
export function spectrumSvg(o, opt = {}) {
  const v = clamp(Number.isFinite(o.value) ? o.value : 50, 0, 100);
  const color = o.color || opt.color || '#A8894F';
  const cBorder = opt.colorBorder || '#E4DFD4';
  const cMuted = opt.colorMuted || '#8B8F89';
  const bg = opt.bg || '#FCFBF8';
  const negColor = opt.negColor || '#4A6B5D';
  const posColor = opt.posColor || '#8C4A32';

  const wrap = document.createElement('div');
  wrap.className = 'spectrum';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${o.name || ''} 双极光谱，${v}`);

  /* ---------- 轨道 ---------- */
  const trackBox = document.createElement('div');
  trackBox.className = 'spectrum__track';

  const W = 320;
  const H = 26;
  const trackY = 14;
  const gid = `sp-${(o.id || Math.random().toString(36).slice(2, 8))}`;

  const s = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'none',
    class: 'spectrum__svg',
  });

  const defs = svg('defs', {});
  const grad = svg('linearGradient', { id: gid, x1: '0', y1: '0', x2: '1', y2: '0' });
  grad.appendChild(svg('stop', { offset: '0%', 'stop-color': negColor, 'stop-opacity': '0.55' }));
  grad.appendChild(svg('stop', { offset: '50%', 'stop-color': cBorder, 'stop-opacity': '0.28' }));
  grad.appendChild(svg('stop', { offset: '100%', 'stop-color': posColor, 'stop-opacity': '0.55' }));
  defs.appendChild(grad);
  s.appendChild(defs);

  // 底轨
  s.appendChild(svg('rect', {
    x: 0, y: trackY, width: W, height: 2, rx: 1, fill: cBorder,
  }));
  // 渐变染层
  s.appendChild(svg('rect', {
    x: 0, y: trackY, width: W, height: 2, rx: 1, fill: `url(#${gid})`,
  }));

  // 中心与两端刻度
  [0, 0.5, 1].forEach((f) => {
    s.appendChild(svg('line', {
      x1: W * f, y1: trackY - 5, x2: W * f, y2: trackY + 7,
      stroke: cBorder, 'stroke-width': 1,
    }));
  });

  // 指示点
  const x = (W * v) / 100;
  s.appendChild(svg('circle', { cx: x, cy: trackY, r: 9, fill: color, opacity: 0.12 }));
  s.appendChild(svg('circle', { cx: x, cy: trackY, r: 4, fill: color, stroke: bg, 'stroke-width': 1.6 }));

  trackBox.appendChild(s);
  wrap.appendChild(trackBox);

  /* ---------- 数值 ---------- */
  const val = document.createElement('div');
  val.className = 'spectrum__value';
  val.style.color = color;
  val.style.left = `${v}%`;
  val.style.transform = 'translateX(-50%)';
  val.textContent = String(round(v, 0));
  wrap.appendChild(val);

  /* ---------- 两极标签 ---------- */
  const poles = document.createElement('div');
  poles.className = 'spectrum__poles';
  const neg = document.createElement('span');
  neg.textContent = o.negLabel || '低';
  const pos = document.createElement('span');
  pos.textContent = o.posLabel || '高';
  pos.style.textAlign = 'right';
  poles.appendChild(neg);
  poles.appendChild(pos);
  wrap.appendChild(poles);

  return wrap;
}

/** 批量列表（带名称列） */
export function spectrumList(items, opt = {}) {
  const frag = document.createDocumentFragment();
  items.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'spec-item';

    const name = document.createElement('div');
    name.className = 'spec-item__name';
    name.textContent = it.name;

    const box = document.createElement('div');
    box.className = 'spec-svg';
    box.appendChild(spectrumSvg(it, { ...opt, color: it.color || opt.color || '#A8894F' }));

    row.appendChild(name);
    row.appendChild(box);
    frag.appendChild(row);
  });
  return frag;
}
