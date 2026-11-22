/* ============================================================
   radarSvg.js — 通用雷达图
   支持：单层 / 面具虚实叠层 / 双人叠加
   ============================================================ */

import { svg, svgText, clamp, round } from '../core/utils.js';

/**
 * @param {Array<{id,label,value,color?}>} axes
 * @param {Object} opts
 *   width, series: [{ name, values: number[], color, dashed, fill, width }]
 *   colorText, colorMuted, colorBorder, bg
 */
export function radarSvg(axes, opts = {}) {
  const n = axes.length;
  if (n < 3) return svg('svg', { viewBox: '0 0 10 10' });

  const W = opts.width || 560;
  const H = opts.height || Math.round(W * 0.92);
  const endPadTop = 30;
  const cx = W / 2;
  const cy = H / 2 + (opts.offsetY || 0);
  const R = Math.min(W, H) * (opts.radiusRatio || 0.32);

  const cText = opts.colorText || '#1E2220';
  const cMuted = opts.colorMuted || '#8B8F89';
  const cBorder = opts.colorBorder || '#E4DFD4';
  const bg = opts.bg || '#FCFBF8';

  const root = svg('svg', {
    viewBox: `${-34} ${-endPadTop} ${W + 68} ${H + endPadTop + 34}`,
    width: '100%',
    role: 'img',
    'aria-label': opts.ariaLabel || '多维雷达图',
  });

  const g = svg('g', {});
  root.appendChild(g);

  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i, f) => [cx + Math.cos(angle(i)) * R * f, cy + Math.sin(angle(i)) * R * f];

  // ---- 网格 ----
  const rings = opts.rings || [0.25, 0.5, 0.75, 1];
  rings.forEach((f, idx) => {
    const poly = Array.from({ length: n }, (_, i) => pt(i, f).join(',')).join(' ');
    g.appendChild(svg('polygon', {
      points: poly,
      fill: idx === rings.length - 1 ? opts.gridFill || 'none' : 'none',
      stroke: cBorder,
      'stroke-width': idx === rings.length - 1 ? 1 : 0.7,
      opacity: idx === rings.length - 1 ? 0.95 : 0.55,
    }));
  });

  // ---- 轴线 ----
  for (let i = 0; i < n; i += 1) {
    const [x, y] = pt(i, 1);
    g.appendChild(svg('line', {
      x1: cx, y1: cy, x2: x, y2: y,
      stroke: cBorder, 'stroke-width': 0.7, opacity: 0.7,
    }));
  }

  // ---- 数据层 ----
  const series = opts.series || [];
  series.forEach((s, si) => {
    const color = s.color || '#8C4A32';
    const pts = axes.map((a, i) => {
      const v = clamp(Number(s.values?.[i]) || 0, 0, 100);
      return pt(i, v / 100);
    });
    const poly = pts.map((p) => p.join(',')).join(' ');

    if (s.fill !== false) {
      g.appendChild(svg('polygon', {
        points: poly,
        fill: color,
        'fill-opacity': s.fillOpacity ?? (si === 0 ? 0.12 : 0.08),
        stroke: 'none',
      }));
    }

    g.appendChild(svg('polygon', {
      points: poly,
      fill: 'none',
      stroke: color,
      'stroke-width': s.width || 1.6,
      'stroke-dasharray': s.dashed ? '4 4' : 'none',
      'stroke-linejoin': 'round',
    }));

    pts.forEach((p, i) => {
      const dot = svg('circle', {
        cx: p[0], cy: p[1], r: s.dashed ? 2.2 : 2.8,
        fill: bg, stroke: color, 'stroke-width': 1.4,
      });
      // 悬浮 / 轻触提示：维度名 + 精确分数 + 档位
      dot.setAttribute('class', 'radar-dot');
      const ax = axes[i] || {};
      const val = Number(s.values?.[i]);
      if (Number.isFinite(val)) {
        const title = svg('title', {});
        title.textContent = `${ax.label || ax.id || ''} · ${round(val, 1)}${
          s.name && series.length > 1 ? `（${s.name}）` : ''
        }`;
        dot.appendChild(title);
      }
      g.appendChild(dot);
    });
  });

  // ---- 轴标签 ----
  const fs = opts.labelSize || (n > 10 ? 9 : 10.5);
  axes.forEach((a, i) => {
    const f = 1.13;
    const [x, y] = pt(i, f);
    const cos = Math.cos(angle(i));
    const sin = Math.sin(angle(i));
    const anchor = Math.abs(cos) < 0.22 ? 'middle' : cos > 0 ? 'start' : 'end';
    const dy = sin > 0.6 ? 10 : sin < -0.6 ? -2 : 4;

    const label = a.short || a.label;
    const labelNode = svgText(label, {
      x, y: y + dy,
      'text-anchor': anchor,
      'font-size': fs,
      'font-family': "'Noto Sans SC','PingFang SC',sans-serif",
      fill: a.color || cMuted,
      'letter-spacing': '0.04em',
    });
    if (Number.isFinite(a.value)) {
      const t = svg('title', {});
      t.textContent = `${a.label || a.id || ''} · ${round(a.value, 1)}`;
      labelNode.appendChild(t);
    }
    g.appendChild(labelNode);

    if (opts.showValues && Number.isFinite(a.value)) {
      g.appendChild(svgText(`${round(a.value, 0)}`, {
        x, y: y + dy + (sin < -0.6 ? -12 : 12),
        'text-anchor': anchor,
        'font-size': fs - 1.5,
        'font-family': "'Noto Serif SC',Georgia,serif",
        fill: cText,
        'font-variant-numeric': 'tabular-nums',
        opacity: 0.7,
      }));
    }
  });

  return root;
}

/* ------------------------------------------------------------
   面具虚实叠层雷达：外显自评（虚）vs 暗线底色（实）
   ------------------------------------------------------------ */
export function maskRadar(axes, opts = {}) {
  return radarSvg(axes, {
    ...opts,
    series: [
      {
        name: opts.surfaceName || '表层面具',
        values: axes.map((a) => a.masked ?? a.value),
        color: opts.surfaceColor || '#A8894F',
        dashed: true,
        fill: false,
        width: 1.4,
      },
      {
        name: opts.depthName || '潜意识底色',
        values: axes.map((a) => a.value),
        color: opts.depthColor || '#8C4A32',
        fill: true,
        fillOpacity: 0.1,
        width: 1.8,
      },
    ],
  });
}

/* ------------------------------------------------------------
   双人叠加雷达
   ------------------------------------------------------------ */
export function dualRadar(axesA, valuesB, opts = {}) {
  return radarSvg(axesA, {
    ...opts,
    series: [
      {
        name: opts.nameA || 'A',
        values: axesA.map((a) => a.value),
        color: opts.colorA || '#8C4A32',
        fillOpacity: 0.1,
        width: 1.7,
      },
      {
        name: opts.nameB || 'B',
        values: valuesB,
        color: opts.colorB || '#3B4D70',
        fillOpacity: 0.1,
        width: 1.7,
      },
    ],
  });
}
