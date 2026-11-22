/* ============================================================
   butterflySvg.js — 七美德 × 七原罪 双翼蝶形图
   中轴对称：左翼暖青绿延展美德，右翼暗红琥珀延展原罪。
   ============================================================ */

import { svg, svgText, clamp, round } from '../core/utils.js';

const PAIRS = [
  { sin: 'sin_pride', virtue: 'virtue_humility', label: '自尊', s: '傲慢', v: '谦逊' },
  { sin: 'sin_greed', virtue: 'virtue_charity', label: '资源', s: '贪婪', v: '慷慨' },
  { sin: 'sin_lust', virtue: 'virtue_chastity', label: '感官', s: '沉溺', v: '节制' },
  { sin: 'sin_envy', virtue: 'virtue_kindness', label: '比较', s: '嫉妒', v: '欣赏' },
  { sin: 'sin_gluttony', virtue: 'virtue_temperance', label: '代偿', s: '放纵', v: '克制' },
  { sin: 'sin_wrath', virtue: 'virtue_patience', label: '边界', s: '愤怒', v: '宽容' },
  { sin: 'sin_sloth', virtue: 'virtue_diligence', label: '启动', s: '逃避', v: '勤勉' },
];

/**
 * @param {Object} dims  维度分数字典
 * @param {Object} opts  { width, colorVirtue, colorSin, colorText, colorMuted, colorBorder }
 */
export function butterflySvg(dims, opts = {}) {
  const W = opts.width || 720;
  const H = Math.round(W * 0.66);
  const cx = W / 2;
  const cy = H / 2;
  const wingW = cx * 0.82;
  const maxR = cy * 0.84;

  const cV = opts.colorVirtue || '#4A6B5D';
  const cS = opts.colorSin || '#8C4A32';
  const cText = opts.colorText || '#1E2220';
  const cMuted = opts.colorMuted || '#8B8F89';
  const cBorder = opts.colorBorder || '#E4DFD4';

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    role: 'img',
    'aria-label': '七美德与七原罪双翼蝶形图',
  });

  const g = svg('g', {});
  root.appendChild(g);

  const rows = PAIRS.map((p, i) => {
    const t = PAIRS.length === 1 ? 0.5 : i / (PAIRS.length - 1);
    const y = 46 + t * (H - 92);
    const vs = Number.isFinite(dims[p.virtue]) ? dims[p.virtue] : 50;
    const sn = Number.isFinite(dims[p.sin]) ? dims[p.sin] : 50;
    return { ...p, y, vs, sn, t };
  });

  // ---- 中轴 ----
  g.appendChild(svg('line', {
    x1: cx, y1: 26, x2: cx, y2: H - 26,
    stroke: cBorder, 'stroke-width': 1, 'stroke-dasharray': '2 5',
  }));

  // ---- 网格弧 ----
  [0.25, 0.5, 0.75, 1].forEach((f) => {
    const rx = wingW * f;
    [1, -1].forEach((dir) => {
      const path = svg('path', {
        d: `M ${cx} ${cy - maxR * f * 0.82} C ${cx + dir * rx * 0.62} ${cy - maxR * f * 0.66},
            ${cx + dir * rx} ${cy - maxR * f * 0.28}, ${cx + dir * rx} ${cy}
            C ${cx + dir * rx} ${cy + maxR * f * 0.28},
            ${cx + dir * rx * 0.62} ${cy + maxR * f * 0.66}, ${cx} ${cy + maxR * f * 0.82}`,
        fill: 'none',
        stroke: cBorder,
        'stroke-width': 0.8,
        opacity: f === 1 ? 0.9 : 0.55,
      });
      g.appendChild(path);
    });
  });

  // ---- 双翼填充 ----
  const wingPath = (vals, dir) => {
    const pts = vals.map((v, i) => {
      const t = vals.length === 1 ? 0.5 : i / (vals.length - 1);
      const y = 46 + t * (H - 92);
      const x = cx + dir * wingW * (clamp(v, 0, 100) / 100);
      return [x, y];
    });
    let d = `M ${cx} ${cy}`;
    // 上缘到第一个点
    d += ` C ${cx + dir * wingW * 0.2} ${cy - maxR * 0.5}, ${pts[0][0] * 0.6 + cx * 0.4} ${pts[0][1] + 12}, ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i += 1) {
      const [px, py] = pts[i - 1];
      const [x, y] = pts[i];
      const midY = (py + y) / 2;
      d += ` C ${px} ${midY}, ${x} ${midY}, ${x} ${y}`;
    }
    const last = pts[pts.length - 1];
    d += ` C ${last[0] * 0.6 + cx * 0.4} ${last[1] - 12}, ${cx + dir * wingW * 0.2} ${cy + maxR * 0.5}, ${cx} ${cy}`;
    d += ' Z';
    return d;
  };

  const gradV = svg('linearGradient', { id: 'bw-v', x1: '0', y1: '0', x2: '1', y2: '0' });
  gradV.appendChild(svg('stop', { offset: '0%', 'stop-color': cV, 'stop-opacity': '0.34' }));
  gradV.appendChild(svg('stop', { offset: '100%', 'stop-color': cV, 'stop-opacity': '0.05' }));
  const gradS = svg('linearGradient', { id: 'bw-s', x1: '1', y1: '0', x2: '0', y2: '0' });
  gradS.appendChild(svg('stop', { offset: '0%', 'stop-color': cS, 'stop-opacity': '0.34' }));
  gradS.appendChild(svg('stop', { offset: '100%', 'stop-color': cS, 'stop-opacity': '0.05' }));

  const defs = svg('defs', {});
  defs.appendChild(gradV);
  defs.appendChild(gradS);
  root.insertBefore(defs, g);

  g.appendChild(svg('path', {
    d: wingPath(rows.map((r) => r.vs), -1),
    fill: 'url(#bw-v)', stroke: cV, 'stroke-width': 1.4, 'stroke-linejoin': 'round',
  }));
  g.appendChild(svg('path', {
    d: wingPath(rows.map((r) => r.sn), 1),
    fill: 'url(#bw-s)', stroke: cS, 'stroke-width': 1.4, 'stroke-linejoin': 'round',
  }));

  // ---- 节点与标签 ----
  rows.forEach((r) => {
    const xv = cx - wingW * (r.vs / 100);
    const xs = cx + wingW * (r.sn / 100);

    g.appendChild(svg('circle', { cx: xv, cy: r.y, r: 3, fill: cV, stroke: '#fff', 'stroke-width': 1 }));
    g.appendChild(svg('circle', { cx: xs, cy: r.y, r: 3, fill: cS, stroke: '#fff', 'stroke-width': 1 }));

    // 左右短引线 + 文字
    const labelY = r.y + 3.6;
    const leftAnchor = 'end';
    const rightAnchor = 'start';

    g.appendChild(svg('line', {
      x1: xv, y1: r.y, x2: Math.max(8, xv - 8), y2: r.y,
      stroke: cV, 'stroke-width': 0.6, opacity: 0.4,
    }));
    g.appendChild(svg('line', {
      x1: xs, y1: r.y, x2: Math.min(W - 8, xs + 8), y2: r.y,
      stroke: cS, 'stroke-width': 0.6, opacity: 0.4,
    }));

    // 端点：精确分数（上一行维度名由中轴统一标注）
    const lt = svgText(`${round(r.vs, 0)}`, {
      x: Math.max(6, xv - 11),
      y: labelY,
      'text-anchor': leftAnchor,
      'font-size': W > 560 ? 10.5 : 9,
      'font-family': "'Noto Serif SC',Georgia,serif",
      fill: cV,
      'font-variant-numeric': 'tabular-nums',
      opacity: 0.85,
    });
    const ltTitle = svg('title', {});
    ltTitle.textContent = `${r.v} · ${round(r.vs, 1)}`;
    lt.appendChild(ltTitle);
    g.appendChild(lt);

    const rt = svgText(`${round(r.sn, 0)}`, {
      x: Math.min(W - 6, xs + 11),
      y: labelY,
      'text-anchor': rightAnchor,
      'font-size': W > 560 ? 10.5 : 9,
      'font-family': "'Noto Serif SC',Georgia,serif",
      fill: cS,
      'font-variant-numeric': 'tabular-nums',
      opacity: 0.85,
    });
    const rtTitle = svg('title', {});
    rtTitle.textContent = `${r.s} · ${round(r.sn, 1)}`;
    rt.appendChild(rtTitle);
    g.appendChild(rt);

    // 中轴：7 组维度名称（左美德 / 右原罪，用斜杠分开）
    const midLabel = svgText(`${r.v}/${r.s}`, {
      x: cx,
      y: r.y + 3.4,
      'text-anchor': 'middle',
      'font-size': W > 560 ? 9 : 8,
      'font-family': "'Noto Sans SC','PingFang SC',sans-serif",
      fill: cMuted,
      'letter-spacing': '0.02em',
    });
    // 白底托片，压住中轴虚线，保证可读
    const pillW = (W > 560 ? 9 : 8) * 4.2;
    g.appendChild(svg('rect', {
      x: cx - pillW / 2, y: r.y - 6, width: pillW, height: 12,
      fill: opts.bg || '#FCFBF8', opacity: 0.92, rx: 2,
    }));
    g.appendChild(midLabel);
  });

  // ---- 中心徽记 ----
  g.appendChild(svg('circle', { cx, cy, r: 15, fill: opts.bg || '#FCFBF8', stroke: cBorder, 'stroke-width': 1 }));
  g.appendChild(svg('circle', { cx, cy, r: 4.5, fill: 'none', stroke: cText, 'stroke-width': 1 }));
  g.appendChild(svg('line', { x1: cx, y1: cy - 15, x2: cx, y2: cy - 8, stroke: cBorder, 'stroke-width': 1 }));
  g.appendChild(svg('line', { x1: cx, y1: cy + 8, x2: cx, y2: cy + 15, stroke: cBorder, 'stroke-width': 1 }));

  // ---- 标题 ----
  const tv = svgText('美德 · 秩序', {
    x: cx - 34, y: 22, 'text-anchor': 'end',
    'font-size': 9.5, 'letter-spacing': '0.24em',
    'font-family': "'Noto Sans SC','PingFang SC',sans-serif",
    fill: cV,
  });
  const ts = svgText('驱力 · 原罪', {
    x: cx + 34, y: 22, 'text-anchor': 'start',
    'font-size': 9.5, 'letter-spacing': '0.24em',
    'font-family': "'Noto Sans SC','PingFang SC',sans-serif",
    fill: cS,
  });
  g.appendChild(tv);
  g.appendChild(ts);

  // ---- 左右均分 ----
  const mv = round(rows.reduce((a, r) => a + r.vs, 0) / rows.length, 1);
  const ms = round(rows.reduce((a, r) => a + r.sn, 0) / rows.length, 1);

  g.appendChild(svgText(`${mv}`, {
    x: cx - 34, y: H - 8, 'text-anchor': 'end',
    'font-size': 15, 'font-family': "'Noto Serif SC',Georgia,serif",
    fill: cV, 'font-variant-numeric': 'tabular-nums',
  }));
  g.appendChild(svgText(`${ms}`, {
    x: cx + 34, y: H - 8, 'text-anchor': 'start',
    'font-size': 15, 'font-family': "'Noto Serif SC',Georgia,serif",
    fill: cS, 'font-variant-numeric': 'tabular-nums',
  }));

  return root;
}

export const BUTTERFLY_PAIRS = PAIRS;
