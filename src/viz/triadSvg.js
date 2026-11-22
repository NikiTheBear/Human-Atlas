/* ============================================================
   triadSvg.js — 光明三角 × 黑暗三角 对照图
   左右两枚等边三角形，顶点分别为三组特质；填充面积即该侧强度。
   用于 Vol.3 单卷报告（此前该卷没有任何图表）。
   ============================================================ */

import { svg, svgText, clamp, round } from '../core/utils.js';

const LIGHT = [
  { dim: 'light_humanism', short: '人本' },
  { dim: 'light_kant', short: '康德' },
  { dim: 'light_faith', short: '信仰' },
];

const DARK = [
  { dim: 'dark_mach', short: '谋略' },
  { dim: 'dark_narc', short: '自恋' },
  { dim: 'dark_psycho', short: '冷酷' },
];

/**
 * @param {Object} scores 维度分数字典
 * @param {Object} opt   { width, colorLight, colorDark, colorText, colorMuted, colorBorder, bg }
 */
export function triadSvg(scores, opt = {}) {
  const W = opt.width || 560;
  const H = Math.round(W * 0.52);

  const cLight = opt.colorLight || '#4A6B5D';
  const cDark = opt.colorDark || '#8C4A32';
  const cText = opt.colorText || '#1E2220';
  const cMuted = opt.colorMuted || '#8B8F89';
  const cBorder = opt.colorBorder || '#E4DFD4';
  const bg = opt.bg || '#FCFBF8';

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    role: 'img',
    'aria-label': '光明三角与黑暗三角对照图',
  });

  const g = svg('g', {});
  root.appendChild(g);

  const R = Math.min(W * 0.2, H * 0.34);
  const centers = [
    { cx: W * 0.27, cy: H * 0.52, items: LIGHT, color: cLight, name: '光明三角', vals: LIGHT.map((d) => clamp(scores[d.dim] ?? 50, 0, 100)) },
    { cx: W * 0.73, cy: H * 0.52, items: DARK, color: cDark, name: '黑暗三角', vals: DARK.map((d) => clamp(scores[d.dim] ?? 50, 0, 100)) },
  ];

  const vertex = (cx, cy, i, f) => {
    // 三角形顶点：上、右下、左下
    const angles = [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6];
    const a = angles[i];
    return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f];
  };

  centers.forEach((c) => {
    // 网格：25 / 50 / 75 / 100
    [0.25, 0.5, 0.75, 1].forEach((f) => {
      const pts = [0, 1, 2].map((i) => vertex(c.cx, c.cy, i, f).join(',')).join(' ');
      g.appendChild(svg('polygon', {
        points: pts,
        fill: 'none',
        stroke: cBorder,
        'stroke-width': f === 1 ? 1 : 0.7,
        opacity: f === 1 ? 0.95 : 0.5,
      }));
    });

    // 中轴
    [0, 1, 2].forEach((i) => {
      const [x, y] = vertex(c.cx, c.cy, i, 1);
      g.appendChild(svg('line', {
        x1: c.cx, y1: c.cy, x2: x, y2: y,
        stroke: cBorder, 'stroke-width': 0.6, opacity: 0.6,
      }));
    });

    // 数据多边形
    const pts = c.vals.map((v, i) => vertex(c.cx, c.cy, i, v / 100).join(',')).join(' ');
    g.appendChild(svg('polygon', {
      points: pts,
      fill: c.color,
      'fill-opacity': 0.14,
      stroke: c.color,
      'stroke-width': 1.6,
      'stroke-linejoin': 'round',
    }));

    // 顶点圆点
    c.vals.forEach((v, i) => {
      const [x, y] = vertex(c.cx, c.cy, i, v / 100);
      g.appendChild(svg('circle', { cx: x, cy: y, r: 3, fill: c.color, stroke: bg, 'stroke-width': 1.4 }));
    });

    // 顶点标签 + 数值
    c.items.forEach((it, i) => {
      const [x, y] = vertex(c.cx, c.cy, i, 1.32);
      const anchor = i === 0 ? 'middle' : i === 1 ? 'start' : 'end';
      const dy = i === 0 ? -2 : 4;
      g.appendChild(svgText(it.short, {
        x, y: y + dy,
        'text-anchor': anchor,
        'font-size': 10,
        'font-family': "'Noto Sans SC','PingFang SC',sans-serif",
        fill: cMuted,
        'letter-spacing': '0.06em',
      }));
      g.appendChild(svgText(`${round(c.vals[i], 0)}`, {
        x, y: y + dy + (i === 0 ? -13 : 13),
        'text-anchor': anchor,
        'font-size': 11,
        'font-family': "'Noto Serif SC',Georgia,serif",
        fill: c.color,
        'font-variant-numeric': 'tabular-nums',
      }));
    });

    // 组名 + 均分
    const avg = round(c.vals.reduce((a, b) => a + b, 0) / c.vals.length, 1);
    g.appendChild(svgText(c.name, {
      x: c.cx, y: H - 26,
      'text-anchor': 'middle',
      'font-size': 10,
      'letter-spacing': '0.18em',
      'font-family': "'Noto Sans SC','PingFang SC',sans-serif",
      fill: cMuted,
    }));
    g.appendChild(svgText(`${avg}`, {
      x: c.cx, y: H - 8,
      'text-anchor': 'middle',
      'font-size': 16,
      'font-family': "'Noto Serif SC',Georgia,serif",
      fill: c.color,
      'font-variant-numeric': 'tabular-nums',
    }));
  });

  // 中央对比刻度
  const lightAvg = centers[0].vals.reduce((a, b) => a + b, 0) / 3;
  const darkAvg = centers[1].vals.reduce((a, b) => a + b, 0) / 3;
  const ratio = darkAvg > 1 ? lightAvg / darkAvg : 9.9;
  g.appendChild(svgText(`${lightAvg.toFixed(0)} : ${darkAvg.toFixed(0)}`, {
    x: W / 2,
    y: H * 0.52,
    'text-anchor': 'middle',
    'font-size': 11,
    'font-family': "'Noto Serif SC',Georgia,serif",
    fill: cText,
    opacity: 0.55,
    'font-variant-numeric': 'tabular-nums',
  }));

  return root;
}

export const TRIAD_LABELS = { LIGHT, DARK, ratioOf: (s) => {
  const l = LIGHT.reduce((a, d) => a + (s[d.dim] ?? 50), 0) / 3;
  const d = DARK.reduce((a, x) => a + (s[x.dim] ?? 50), 0) / 3;
  return { light: round(l, 1), dark: round(d, 1) };
} };
