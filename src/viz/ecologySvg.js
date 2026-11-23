/* ============================================================
   ecologySvg.js — 关系生态位雷达（N 边形对比，N = 生态位数）
   ============================================================ */

import { svg, svgText, clamp } from '../core/utils.js';

/**
 * @param {Array<{id,name,value}>} list  全部生态位得分（按 ECOLOGIES 顺序）
 * @param {Object} opt { width, color, colorText, colorMuted, colorBorder, bg, bestId }
 */
export function ecologySvg(list, opt = {}) {
  /* 上限放到 8：再多雷达图就糊了，但第 7 个不该被悄悄切掉 */
  const items = (list || []).slice(0, 8);
  const n = items.length;
  if (n < 3) return svg('svg', { viewBox: '0 0 10 10' });

  const W = opt.width || 560;
  const H = Math.round(W * 0.86);
  const cx = W / 2;
  const cy = H / 2 + 6;
  const R = Math.min(W, H) * 0.33;

  const cMain = opt.color || '#9A7B45';
  const cText = opt.colorText || '#171918';
  const cMuted = opt.colorMuted || '#6E736E';
  const cBorder = opt.colorBorder || 'rgba(23,25,24,0.11)';
  const bg = opt.bg || '#FFFFFF';

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    role: 'img',
    'aria-label': '关系生态位雷达图',
  });

  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i, f) => [cx + Math.cos(angle(i)) * R * f, cy + Math.sin(angle(i)) * R * f];

  /* 网格 */
  [0.25, 0.5, 0.75, 1].forEach((f) => {
    const pts = Array.from({ length: n }, (_, i) => pt(i, f).join(',')).join(' ');
    root.appendChild(svg('polygon', {
      points: pts,
      fill: f === 1 ? 'none' : 'none',
      stroke: cBorder,
      'stroke-width': f === 1 ? 1 : 0.7,
      opacity: f === 1 ? 0.95 : 0.5,
    }));
  });

  /* 轴线 */
  for (let i = 0; i < n; i += 1) {
    const [x, y] = pt(i, 1);
    root.appendChild(svg('line', {
      x1: cx, y1: cy, x2: x, y2: y, stroke: cBorder, 'stroke-width': 0.7, opacity: 0.6,
    }));
  }

  /* 数据面 */
  const dataPts = items.map((it, i) => pt(i, clamp(it.value, 0, 100) / 100));
  root.appendChild(svg('polygon', {
    points: dataPts.map((p) => p.join(',')).join(' '),
    fill: cMain,
    'fill-opacity': 0.14,
    stroke: cMain,
    'stroke-width': 1.8,
    'stroke-linejoin': 'round',
  }));

  dataPts.forEach((p, i) => {
    const isBest = items[i].id === opt.bestId;
    root.appendChild(svg('circle', {
      cx: p[0],
      cy: p[1],
      r: isBest ? 4.6 : 3,
      fill: isBest ? cMain : bg,
      stroke: cMain,
      'stroke-width': 1.6,
    }));
  });

  /* 轴标签 + 数值 */
  items.forEach((it, i) => {
    const [x, y] = pt(i, 1.19);
    const cos = Math.cos(angle(i));
    const sin = Math.sin(angle(i));
    const anchor = Math.abs(cos) < 0.25 ? 'middle' : cos > 0 ? 'start' : 'end';
    const dy = sin > 0.55 ? 12 : sin < -0.55 ? -4 : 4;
    const isBest = it.id === opt.bestId;

    root.appendChild(svgText(it.name, {
      x,
      y: y + dy,
      'text-anchor': anchor,
      'font-size': 11,
      'font-family': "'Noto Sans SC','PingFang SC',sans-serif",
      fill: isBest ? cMain : cMuted,
      'font-weight': isBest ? 600 : 400,
      'letter-spacing': '0.04em',
    }));

    root.appendChild(svgText(String(Math.round(it.value)), {
      x,
      y: y + dy + (sin < -0.55 ? -14 : 14),
      'text-anchor': anchor,
      'font-size': 12,
      'font-family': "'Noto Serif SC',Georgia,serif",
      fill: isBest ? cMain : cText,
      'font-variant-numeric': 'tabular-nums',
      opacity: isBest ? 1 : 0.72,
    }));
  });

  return root;
}
