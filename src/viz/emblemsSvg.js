/* ============================================================
   emblemsSvg.js — 十六卷专属几何纹章
   · 单线、极简、无填充色块；只用 currentColor 描边
   · 大厅卡片右上角作低透明度水印，卷首仪式页居中展示
   · viewBox 统一 64×64，线宽按 strokeWidth 参数缩放
   ============================================================ */

import { svg } from '../core/utils.js';

const S = 64;
const C = S / 2;

/** 环形刻度：n 条，r1→r2 */
function ticks(n, r1, r2, opacity = 0.5, len = 0.6) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    out.push(svg('line', {
      x1: C + Math.cos(a) * r1,
      y1: C + Math.sin(a) * r1,
      x2: C + Math.cos(a) * r2,
      y2: C + Math.sin(a) * r2,
      opacity: i % Math.round(n / 4 || 1) === 0 ? opacity * 1.7 : opacity * len,
    }));
  }
  return out;
}

/** 正多边形顶点 */
function poly(n, r, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = (Math.PI * 2 * i) / n + rot;
    pts.push([C + Math.cos(a) * r, C + Math.sin(a) * r]);
  }
  return pts;
}

const d = (pts, close = true) => pts
  .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`)
  .join(' ') + (close ? ' Z' : '');

/* ------------------------------------------------------------
   十六枚纹章
   ------------------------------------------------------------ */

const EMBLEMS = {
  /* Vol.01 光影圣殿 —— 双翼天平 */
  vol1: () => [
    svg('path', { d: `M${C} 12v40`, opacity: 0.9 }),
    svg('path', { d: `M${C - 17} 20h34` }),
    svg('path', { d: `M${C - 17} 20l-7 12h14 Z`, opacity: 0.75 }),
    svg('path', { d: `M${C + 17} 20l-7 12h14 Z`, opacity: 0.75 }),
    svg('circle', { cx: C, cy: 20, r: 2.4, opacity: 0.55 }),
    svg('path', { d: `M${C - 9} 52h18`, opacity: 0.8 }),
    svg('circle', { cx: C, cy: 44, r: 6.5, opacity: 0.32 }),
    svg('path', { d: `M${C - 6} 44a6 6 0 0 1 12 0`, opacity: 0.5 }),
  ],

  /* Vol.02 性格底色 —— 五棱环 */
  vol2: () => [
    svg('path', { d: d(poly(5, 22)) }),
    svg('path', { d: d(poly(5, 22, -Math.PI / 2 + Math.PI / 5)) , opacity: 0.42 }),
    ...poly(5, 15).map(([x, y]) => svg('circle', { cx: x, cy: y, r: 1.7, opacity: 0.8 })),
    svg('circle', { cx: C, cy: C, r: 4.4, opacity: 0.5 }),
  ],

  /* Vol.03 博弈暗面 —— 日蚀光暗环 */
  vol3: () => [
    svg('circle', { cx: C, cy: C, r: 21 }),
    svg('path', { d: `M${C} 11a21 21 0 0 1 0 42a13 21 0 0 0 0 -42Z`, opacity: 0.45 }),
    ...ticks(24, 23.5, 27, 0.42),
    svg('path', { d: `M${C} 11v42`, opacity: 0.3 }),
  ],

  /* Vol.04 三观罗盘 —— 三层同心罗盘 */
  vol4: () => [
    svg('circle', { cx: C, cy: C, r: 22 }),
    svg('circle', { cx: C, cy: C, r: 14, opacity: 0.6 }),
    svg('circle', { cx: C, cy: C, r: 6.5, opacity: 0.35 }),
    svg('path', { d: `M${C} 8v8M${C} 48v8M8 ${C}h8M48 ${C}h8`, opacity: 0.85 }),
    svg('path', { d: `M${C - 9} 32l9-16 9 16-9 5Z`, opacity: 0.55 }),
  ],

  /* Vol.05 思维棱镜 —— 三棱折射 */
  vol5: () => [
    svg('path', { d: d(poly(3, 23)) }),
    svg('path', { d: `M${C - 12} 16.5L4 8M${C} 43L4 52M${C + 12} 16.5L60 8`, opacity: 0.5 }),
    svg('path', { d: `M${C - 7} 33h14`, opacity: 0.35 }),
  ],

  /* Vol.06 欲望引擎 —— 六芒引擎 */
  vol6: () => [
    svg('path', { d: d(poly(6, 22)) }),
    svg('path', { d: d(poly(6, 22, Math.PI / 6)), opacity: 0.45 }),
    svg('circle', { cx: C, cy: C, r: 5, opacity: 0.8 }),
    ...poly(6, 22).map(([x, y]) => svg('circle', { cx: x, cy: y, r: 1.4, opacity: 0.7 })),
  ],

  /* Vol.07 亲密防线 —— 双环相扣 */
  vol7: () => [
    svg('circle', { cx: C - 8, cy: C, r: 14 }),
    svg('circle', { cx: C + 8, cy: C, r: 14, opacity: 0.55 }),
    svg('path', { d: `M${C} 6v52`, opacity: 0.25 }),
    svg('path', { d: `M${C - 8} 18v28M${C + 8} 18v28`, opacity: 0.3 }),
  ],

  /* Vol.08 高压剧场 —— 莫比乌斯折环 */
  vol8: () => [
    svg('path', { d: `M16 ${C - 12}c10 -14 32 -14 32 0s-22 14 -32 0`, opacity: 0.9 }),
    svg('path', { d: `M48 ${C + 12}c-10 14 -32 14 -32 0`, opacity: 0.45 }),
    svg('path', { d: `M16 ${C - 12}L48 ${C + 12}M48 ${C - 12}L16 ${C + 12}`, opacity: 0.28 }),
    svg('circle', { cx: C, cy: C, r: 2.2, opacity: 0.75 }),
  ],

  /* Vol.09 认知星盘 —— 八辐星盘 */
  vol9: () => [
    svg('circle', { cx: C, cy: C, r: 21, opacity: 0.55 }),
    svg('path', { d: d(poly(8, 21), true), opacity: 0.85 }),
    ...poly(8, 21).map(([x, y]) => svg('line', {
      x1: C, y1: C, x2: x, y2: y, opacity: 0.26,
    })),
    svg('circle', { cx: C, cy: C, r: 3.2, opacity: 0.9 }),
    ...ticks(32, 24, 26.5, 0.34),
  ],

  /* Vol.10 秩序与混沌 —— 九宫格 */
  vol10: () => {
    const out = [];
    const g = 13;
    for (let i = 0; i < 9; i += 1) {
      const x = C - g + (i % 3) * g;
      const y = C - g + Math.floor(i / 3) * g;
      const isCenter = i === 4;
      out.push(svg('rect', {
        x: x - g / 2, y: y - g / 2, width: g, height: g,
        opacity: isCenter ? 0.85 : 0.34,
      }));
      if (i % 2 === 0) out.push(svg('circle', { cx: x, cy: y, r: 1.5, opacity: 0.8 }));
    }
    return out;
  },

  /* Vol.11 哲人底色 —— 十二面体投影 */
  vol11: () => [
    svg('path', { d: d(poly(6, 22, -Math.PI / 2)) }),
    svg('path', { d: d(poly(6, 22, -Math.PI / 2 + Math.PI / 6)), opacity: 0.4 }),
    svg('path', { d: d(poly(6, 9, -Math.PI / 2)) , opacity: 0.7 }),
    ...poly(6, 22, -Math.PI / 2).map(([x, y], i) => {
      const [x2, y2] = poly(6, 9, -Math.PI / 2)[i];
      return svg('line', { x1: x, y1: y, x2, y2, opacity: 0.24 });
    }),
  ],

  /* Vol.12 底层执念 —— 九重螺旋 */
  vol12: () => {
    const out = [];
    for (let k = 1; k <= 4; k += 1) {
      const r = 4 + k * 4.6;
      out.push(svg('circle', {
        cx: C, cy: C, r,
        opacity: k === 4 ? 0.85 : 0.45 / k + 0.18,
        'stroke-dasharray': k % 2 === 0 ? '3 4' : 'none',
      }));
    }
    out.push(svg('path', { d: `M${C} ${C - 4}v-8`, opacity: 0.9 }));
    out.push(svg('circle', { cx: C, cy: C, r: 1.8, opacity: 0.9 }));
    return out;
  },

  /* Vol.13 童年剧本 —— 折纸方盒 */
  vol13: () => [
    svg('path', { d: d([[C, 10], [C + 20, 20], [C + 20, 44], [C, 54], [C - 20, 44], [C - 20, 20]]) }),
    svg('path', { d: `M${C - 20} 20L${C} 30L${C + 20} 20M${C} 30v24`, opacity: 0.65 }),
    svg('path', { d: `M${C - 20} 44L${C} 34L${C + 20} 44`, opacity: 0.32 }),
  ],

  /* Vol.14 财富潜意识 —— 环形漏斗 */
  vol14: () => [
    svg('path', { d: `M14 14h36L36 ${C + 4}H28Z` }),
    svg('path', { d: `M${C - 4} ${C + 4}v22h8V${C + 4}`, opacity: 0.6 }),
    ...ticks(12, 30, 33, 0.3),
    svg('path', { d: `M22 20h20`, opacity: 0.45 }),
  ],

  /* Vol.15 冲突剧场 —— 双锋交角 */
  vol15: () => [
    svg('path', { d: `M12 14L52 26`, opacity: 0.9 }),
    svg('path', { d: `M52 14L12 26`, opacity: 0.55 }),
    svg('path', { d: `M${C} 30v22`, opacity: 0.4 }),
    svg('path', { d: `M20 40l12 12 12-12`, opacity: 0.8 }),
    svg('circle', { cx: C, cy: 26, r: 3, opacity: 0.7 }),
  ],

  /* Vol.16 神经边缘 —— 双频波形 */
  vol16: () => [
    svg('path', {
      d: `M6 ${C - 8}q6 -10 12 0t12 0t12 0t12 0`,
      opacity: 0.85,
    }),
    svg('path', {
      d: `M6 ${C + 8}q9 12 18 0t18 0t16 0`,
      opacity: 0.45,
      'stroke-dasharray': '2 3',
    }),
    svg('path', { d: `M6 ${C}h52`, opacity: 0.2 }),
  ],
};

/* ------------------------------------------------------------
   渲染
   ------------------------------------------------------------ */

/**
 * @param {string} volId  'vol1' … 'vol16'
 * @param {Object} opt { size, strokeWidth, color, opacity, title }
 * @returns {SVGElement}
 */
export function emblemSvg(volId, opt = {}) {
  const draw = EMBLEMS[volId] || EMBLEMS.vol1;
  const node = svg('svg', {
    viewBox: `0 0 ${S} ${S}`,
    class: opt.class || 'emblem',
    role: opt.title ? 'img' : 'presentation',
    'aria-label': opt.title || undefined,
    'aria-hidden': opt.title ? undefined : 'true',
    width: opt.size || undefined,
    height: opt.size || undefined,
  });

  if (opt.color) node.style.color = opt.color;
  if (Number.isFinite(opt.opacity)) node.style.opacity = String(opt.opacity);

  const g = svg('g', {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': opt.strokeWidth || 1.1,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });

  for (const child of draw()) g.appendChild(child);
  node.appendChild(g);
  return node;
}

export const EMBLEM_IDS = Object.keys(EMBLEMS);

export default emblemSvg;
