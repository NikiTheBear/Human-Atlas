/* ============================================================
   matrixSvg.js — 通用 2×2 四象限坐标图
   用于：Vol.10 阵营九宫格（秩序×良善）、Vol.16 HSP×HSS 神经边缘
   ============================================================ */

import { svg, svgText, clamp, round } from '../core/utils.js';

/**
 * @param {Object} o
 *   x: 0–100（右高）、y: 0–100（上高）
 *   xLabel / yLabel: 轴名
 *   quadrants: [{ x: 'hi'|'lo', y: 'hi'|'lo', name, desc }]
 *   active: 当前命中的象限 key（可选）
 * @param {Object} opt
 *   width, color, colorText, colorMuted, colorBorder, bg, pointLabel
 */
export function matrixSvg(o = {}, opt = {}) {
  const W = opt.width || 480;
  const H = opt.height || Math.round(W * 0.94);
  const padL = 68;
  const padR = 26;
  const padT = 30;
  const padB = 64;
  const iw = W - padL - padR;
  const ih = H - padT - padB;

  const cText = opt.colorText || '#1E2220';
  const cMuted = opt.colorMuted || '#8B8F89';
  const cBorder = opt.colorBorder || '#E4DFD4';
  const bg = opt.bg || '#FCFBF8';
  const cMain = opt.color || '#A8894F';

  const px = clamp(Number.isFinite(o.x) ? o.x : 50, 0, 100);
  const py = clamp(Number.isFinite(o.y) ? o.y : 50, 0, 100);

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    role: 'img',
    'aria-label': opt.ariaLabel || `${o.xLabel || 'X'} × ${o.yLabel || 'Y'} 四象限`,
  });

  // 底板
  root.appendChild(svg('rect', { x: 0, y: 0, width: W, height: H, fill: bg }));
  root.appendChild(svg('rect', {
    x: padL, y: padT, width: iw, height: ih,
    fill: cMain, 'fill-opacity': 0.022,
    stroke: cBorder, 'stroke-width': 1,
  }));

  // 中轴
  const mx = padL + iw / 2;
  const my = padT + ih / 2;

  root.appendChild(svg('line', {
    x1: mx, y1: padT, x2: mx, y2: padT + ih,
    stroke: cBorder, 'stroke-width': 1, 'stroke-dasharray': '3 4',
  }));
  root.appendChild(svg('line', {
    x1: padL, y1: my, x2: padL + iw, y2: my,
    stroke: cBorder, 'stroke-width': 1, 'stroke-dasharray': '3 4',
  }));

  // 四等分刻度
  [0.25, 0.75].forEach((f) => {
    root.appendChild(svg('line', {
      x1: padL + iw * f, y1: padT, x2: padL + iw * f, y2: padT + ih,
      stroke: cBorder, 'stroke-width': 0.6, opacity: 0.45,
    }));
    root.appendChild(svg('line', {
      x1: padL, y1: padT + ih * f, x2: padL + iw, y2: padT + ih * f,
      stroke: cBorder, 'stroke-width': 0.6, opacity: 0.45,
    }));
  });

  // 象限名
  (o.quadrants || []).forEach((q) => {
    const cx = padL + iw * (q.x === 'lo' ? 0.25 : 0.75);
    const cy = padT + ih * (q.y === 'lo' ? 0.75 : 0.25);
    const isActive = o.active && q.key === o.active;
    if (isActive) {
      root.appendChild(svg('rect', {
        x: cx - iw * 0.24, y: cy - ih * 0.22, width: iw * 0.48, height: ih * 0.44,
        fill: cMain, 'fill-opacity': 0.07, rx: 2,
      }));
    }
    root.appendChild(svgText(q.name || '', {
      x: cx, y: cy - 5,
      'text-anchor': 'middle',
      fill: isActive ? cMain : cMuted,
      'font-size': 11.5,
      'font-weight': isActive ? 600 : 400,
      'letter-spacing': 1.2,
      'font-family': "var(--font-serif), 'Songti SC', serif",
    }));
    if (q.desc) {
      root.appendChild(svgText(q.desc, {
        x: cx, y: cy + 12,
        'text-anchor': 'middle',
        fill: cMuted,
        'font-size': 8.6,
        opacity: 0.78,
        'letter-spacing': 0.4,
      }));
    }
  });

  /* 轴文字统一挪到画布外侧：
       横轴两端名放格子正下方（与列标题同向），轴名再往下一行；
       纵轴两端名放格子左侧（格子外），轴名竖排在更外侧。
     旧版把 yHi/yLo 画在格子内部左上/左下角，会和象限名撞在一起，
     同时横轴名和两端名共用 y 区间，出现重叠。 */
  if (o.xLo || o.xHi) {
    root.appendChild(svgText(o.xLo || '', {
      x: padL + 2, y: padT + ih + 18,
      'text-anchor': 'start', fill: cMuted, 'font-size': 9, opacity: 0.7,
      'letter-spacing': 0.8,
    }));
    root.appendChild(svgText(o.xHi || '', {
      x: padL + iw - 2, y: padT + ih + 18,
      'text-anchor': 'end', fill: cMuted, 'font-size': 9, opacity: 0.7,
      'letter-spacing': 0.8,
    }));
  }

  if (o.xLabel) {
    root.appendChild(svgText(o.xLabel, {
      x: padL + iw / 2, y: padT + ih + 34,
      'text-anchor': 'middle', fill: cMuted, 'font-size': 9, opacity: 0.5,
      'letter-spacing': 1.2,
    }));
  }

  if (o.yHi || o.yLo) {
    root.appendChild(svgText(o.yHi || '', {
      x: padL - 10, y: padT + 12,
      'text-anchor': 'end', fill: cMuted, 'font-size': 9, opacity: 0.7,
    }));
    root.appendChild(svgText(o.yLo || '', {
      x: padL - 10, y: padT + ih - 4,
      'text-anchor': 'end', fill: cMuted, 'font-size': 9, opacity: 0.7,
    }));
  }

  if (o.yLabel) {
    const yl = svgText(o.yLabel, {
      x: 12, y: padT + ih / 2,
      'text-anchor': 'middle', fill: cMuted, 'font-size': 9, opacity: 0.5,
      'letter-spacing': 1.2,
    });
    yl.setAttribute('transform', `rotate(-90 12 ${padT + ih / 2})`);
    root.appendChild(yl);
  }

  // 落点
  const cx = padL + (iw * px) / 100;
  const cy = padT + ih * (1 - py / 100);

  root.appendChild(svg('circle', { cx, cy, r: 20, fill: cMain, opacity: 0.09 }));
  root.appendChild(svg('circle', { cx, cy, r: 12, fill: cMain, opacity: 0.16 }));
  root.appendChild(svg('circle', { cx, cy, r: 4.6, fill: cMain, stroke: bg, 'stroke-width': 1.8 }));

  root.appendChild(svgText(`${round(px, 0)}`, {
    x: cx, y: cy - 26, 'text-anchor': 'middle', fill: cMain, 'font-size': 9.5, opacity: 0.85,
  }));

  if (o.pointLabel) {
    root.appendChild(svgText(o.pointLabel, {
      x: cx + 14, y: cy + 4, 'text-anchor': 'start', fill: cText, 'font-size': 10.5,
      'font-family': "var(--font-serif), 'Songti SC', serif",
    }));
  }

  return root;
}

/* ------------------------------------------------------------
   预设：阵营九宫格 & 神经边缘四象限
   ------------------------------------------------------------ */

/* 象限摆放必须与坐标轴方向一致：
     x 高 = 秩序（右），x 低 = 混沌（左）
     y 高 = 善良（上），y 低 = 冷硬（下）
   旧版把守序放在 x:'lo'，与 xLo='混沌' 正好相反，
   导致「落点在左半边却点亮右半边的名字」。 */
export const ALIGNMENT_QUADRANTS = [
  { key: 'lg', x: 'hi', y: 'hi', name: '守序善良', desc: '规则即承诺' },
  { key: 'cg', x: 'lo', y: 'hi', name: '混乱善良', desc: '良心高于条文' },
  { key: 'le', x: 'hi', y: 'lo', name: '守序冷硬', desc: '契约就是全部' },
  { key: 'ce', x: 'lo', y: 'lo', name: '混乱冷硬', desc: '只看结果' },
];

export function alignmentOf(order, good) {
  const o = Number.isFinite(order) ? order : 50;
  const g = Number.isFinite(good) ? good : 50;
  if (o >= 50 && g >= 50) return ALIGNMENT_QUADRANTS[0];
  if (o < 50 && g >= 50) return ALIGNMENT_QUADRANTS[1];
  if (o >= 50 && g < 50) return ALIGNMENT_QUADRANTS[2];
  return ALIGNMENT_QUADRANTS[3];
}

export const NEURO_QUADRANTS = [
  { key: 'hb', x: 'lo', y: 'hi', name: '高敏 · 低寻求', desc: '深海型：细节极清，需要安静' },
  { key: 'hh', x: 'hi', y: 'hi', name: '高敏 · 高寻求', desc: '矛盾体：既想冲又想躲' },
  { key: 'lb', x: 'lo', y: 'lo', name: '低敏 · 低寻求', desc: '稳态型：滤噪强，节奏平' },
  { key: 'lh', x: 'hi', y: 'lo', name: '低敏 · 高寻求', desc: '引擎型：耐受高，越闹越清醒' },
];

export function neuroOf(hsp, hss) {
  const a = Number.isFinite(hsp) ? hsp : 50;
  const b = Number.isFinite(hss) ? hss : 50;
  if (a >= 50 && b < 50) return NEURO_QUADRANTS[0];
  if (a >= 50 && b >= 50) return NEURO_QUADRANTS[1];
  if (a < 50 && b < 50) return NEURO_QUADRANTS[2];
  return NEURO_QUADRANTS[3];
}

export default matrixSvg;
