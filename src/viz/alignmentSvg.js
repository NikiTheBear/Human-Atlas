/* ============================================================
   alignmentSvg.js — D&D 阵营九宫格（3 × 3）

   两个轴各切三档，交叉出九种阵营：
     纵轴 dd_good :  善良 / 中立 / 冷硬
     横轴 dd_order:  守序 / 中立 / 混乱

   与 matrixSvg 的四象限区别：
     · 四象限只有 2 × 2 = 4 格，中间那一档无处安放
     · 九宫格把「中立」单独成一档，落点也能落在中列 / 中行
   ============================================================ */

import { svg, svgText, clamp, round } from '../core/utils.js';

/* ------------------------------------------------------------
   九种阵营定义
   ------------------------------------------------------------ */

export const ALIGNMENTS = [
  /* 上排：善良 */
  {
    key: 'lg', row: 0, col: 0, name: '守序善良', latin: 'Lawful Good', desc: '规则即承诺',
  },
  {
    key: 'ng', row: 0, col: 1, name: '中立善良', latin: 'Neutral Good', desc: '能帮就帮',
  },
  {
    key: 'cg', row: 0, col: 2, name: '混乱善良', latin: 'Chaotic Good', desc: '良心高于条文',
  },
  /* 中排：中立 */
  {
    key: 'ln', row: 1, col: 0, name: '守序中立', latin: 'Lawful Neutral', desc: '按程序办事',
  },
  {
    key: 'tn', row: 1, col: 1, name: '绝对中立', latin: 'True Neutral', desc: '不站任何一边',
  },
  {
    key: 'cn', row: 1, col: 2, name: '混乱中立', latin: 'Chaotic Neutral', desc: '只看当下',
  },
  /* 下排：冷硬 */
  {
    key: 'le', row: 2, col: 0, name: '守序冷硬', latin: 'Lawful Evil', desc: '契约就是全部',
  },
  {
    key: 'ne', row: 2, col: 1, name: '中立冷硬', latin: 'Neutral Evil', desc: '各人自扫门前雪',
  },
  {
    key: 'ce', row: 2, col: 2, name: '混乱冷硬', latin: 'Chaotic Evil', desc: '只看结果',
  },
];

export const ORDER_BANDS = [
  { key: 'lawful', name: '守序', latin: 'Lawful' },
  { key: 'neutral', name: '中立', latin: 'Neutral' },
  { key: 'chaotic', name: '混乱', latin: 'Chaotic' },
];

export const GOOD_BANDS = [
  { key: 'good', name: '善良', latin: 'Good' },
  { key: 'neutral', name: '中立', latin: 'Neutral' },
  { key: 'evil', name: '冷硬', latin: 'Evil' },
];

/**
 * 分数 → 档位索引（0 守序 / 1 中立 / 2 混乱）
 *
 * 用精确三等分而不是 62/38：
 * 九宫格是三列等宽，若分档阈值与格子边界不一致，
 * 37 分会被判进「混乱」却画在距左边界 37% 的位置，
 * 看上去更像中间那一档 —— 用户一眼就会觉得判错了。
 */
export const BAND_EDGE = 100 / 3;

export function bandOf(value) {
  const v = Number.isFinite(value) ? value : 50;
  if (v >= BAND_EDGE * 2) return 0;
  if (v <= BAND_EDGE) return 2;
  return 1;
}

/**
 * 由 dd_order / dd_good 定位到九宫格中的某一格。
 * @returns {{ alignment, orderBand, goodBand, col, row }}
 */
export function alignmentFrom(order, good) {
  const oBand = bandOf(order);
  const gBand = bandOf(good);
  const a = ALIGNMENTS.find((x) => x.row === gBand && x.col === oBand) || ALIGNMENTS[4];
  return {
    alignment: a,
    orderBand: ORDER_BANDS[oBand],
    goodBand: GOOD_BANDS[gBand],
    col: oBand,
    row: gBand,
  };
}

/* ------------------------------------------------------------
   绘制
   ------------------------------------------------------------ */

/**
 * @param {Object} o { order: 0–100, good: 0–100 }
 * @param {Object} opt
 *   width, color, colorText, colorMuted, colorBorder, bg, showDesc
 */
export function alignmentSvg(o = {}, opt = {}) {
  const W = opt.width || 540;
  const padL = 64;
  const padR = 26;
  const padT = 38;
  const padB = 12;   // 底部不再画轴文字，收掉空白

  const iw = W - padL - padR;
  const cellW = iw / 3;

  /* 单元格高度固定，整图高度由它推出来 */
  const cellH = opt.cellHeight || 118;
  const ih = cellH * 3;
  const H = padT + ih + padB;

  const cMain = opt.color || '#9A7B45';
  const cText = opt.colorText || '#171918';
  const cMuted = opt.colorMuted || '#6E736E';
  const cBorder = opt.colorBorder || 'rgba(23,25,24,0.11)';
  const bg = opt.bg || '#FFFFFF';

  const order = clamp(Number.isFinite(o.order) ? o.order : 50, 0, 100);
  const good = clamp(Number.isFinite(o.good) ? o.good : 50, 0, 100);
  const hit = alignmentFrom(order, good);

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    role: 'img',
    'aria-label': `阵营九宫格，落点 ${hit.alignment.name}`,
  });

  /* ---- 底板 ---- */
  root.appendChild(svg('rect', {
    x: padL, y: padT, width: iw, height: ih,
    fill: cMain, 'fill-opacity': 0.018,
    stroke: cBorder, 'stroke-width': 1,
  }));

  /* ---- 九格 ---- */
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const a = ALIGNMENTS.find((x) => x.row === r && x.col === c);
      const x = padL + c * cellW;
      const y = padT + r * cellH;
      const isHit = a.key === hit.alignment.key;

      if (isHit) {
        root.appendChild(svg('rect', {
          x: x + 1, y: y + 1, width: cellW - 2, height: cellH - 2,
          fill: cMain, 'fill-opacity': 0.1,
          stroke: cMain, 'stroke-width': 1.4,
          rx: 2,
        }));
      }

      /* 分隔线（内部） */
      if (c > 0) {
        root.appendChild(svg('line', {
          x1: x, y1: padT, x2: x, y2: padT + ih,
          stroke: cBorder, 'stroke-width': 1,
          'stroke-dasharray': '2 4',
        }));
      }
      if (r > 0) {
        root.appendChild(svg('line', {
          x1: padL, y1: y, x2: padL + iw, y2: y,
          stroke: cBorder, 'stroke-width': 1,
          'stroke-dasharray': '2 4',
        }));
      }

      const cx = x + cellW / 2;

      root.appendChild(svgText(a.name, {
        x: cx, y: y + cellH * 0.26,
        'text-anchor': 'middle',
        'font-size': 13,
        'font-family': "'Noto Serif SC','Songti SC',Georgia,serif",
        'letter-spacing': 1.2,
        fill: isHit ? cMain : cText,
        'font-weight': isHit ? 600 : 500,
      }));

      root.appendChild(svgText(a.latin, {
        x: cx, y: y + cellH * 0.26 + 14,
        'text-anchor': 'middle',
        'font-size': 8.6,
        'letter-spacing': 1.1,
        fill: isHit ? cMain : cMuted,
        opacity: isHit ? 0.9 : 0.66,
      }));

      if (opt.showDesc !== false) {
        root.appendChild(svgText(a.desc, {
          x: cx, y: y + cellH * 0.26 + 28,
          'text-anchor': 'middle',
          'font-size': 8.4,
          fill: cMuted,
          opacity: 0.72,
        }));
      }
    }
  }

  /* ---- 列标题（横轴：守序 / 中立 / 混乱） ---- */
  ORDER_BANDS.forEach((b, i) => {
    const cx = padL + cellW * (i + 0.5);
    const active = hit.col === i;
    root.appendChild(svgText(b.name, {
      x: cx, y: padT - 16,
      'text-anchor': 'middle',
      'font-size': 10.5,
      'font-family': "'Noto Serif SC','Songti SC',Georgia,serif",
      'letter-spacing': 3,
      fill: active ? cMain : cMuted,
      opacity: active ? 1 : 0.75,
    }));
  });

  /* ---- 行标题（纵轴：善良 / 中立 / 冷硬），放在格子外侧 ---- */
  GOOD_BANDS.forEach((b, i) => {
    const cy = padT + cellH * (i + 0.5);
    const active = hit.row === i;
    root.appendChild(svgText(b.name, {
      x: padL - 14,
      y: cy + 4,
      'text-anchor': 'end',
      'font-size': 10.5,
      'font-family': "'Noto Serif SC','Songti SC',Georgia,serif",
      'letter-spacing': 2,
      fill: active ? cMain : cMuted,
      opacity: active ? 1 : 0.75,
    }));
  });

  /* ---- 落点 ----
     两个坑都要躲开：
     1. 方向：D&D 标准排布「守序在左、混乱在右」，dd_order 高分是守序，
        所以 x 必须反向映射。
     2. 分档与格子对齐：分档边界 66.7 / 33.3 就是格子边界本身，
        所以 cellPos() 与 bandOf() 用的是同一组数字，任何分数都落在自己档位里。 */
  /* 分数 → 0–3 的连续位置。三等分，与 bandOf 的边界完全一致，
     并让每段端点内缩 0.6%，避免正好落在分割线上被判到相邻格。 */
  const cellPos = (v) => {
    const x = clamp(v, 0, 100);
    const E = BAND_EDGE;
    if (x >= 2 * E) return Math.min(0.994, (100 - x) / E);          // 100→0, 66.7→1
    if (x > E) return 1 + Math.min(0.994, (2 * E - x) / E);         // 66.7→1, 33.3⁺→2
    return 2 + Math.min(0.994, (E - x) / E);                        // 33.3→2, 0→3
  };

  const px = padL + (iw / 3) * cellPos(order);

  /* 纵向压到格子下半部（0.56–0.94）：
     格子上方 0–55% 留给了「格名 / 英文 / 副题」三行文字，
     落点若画在中心就会压在字上（上一版就撞了「绝对中立」）。 */
  const rowFrac = cellPos(good) - hit.row;           // 0–1，格内相对位置
  const py = padT + cellH * (hit.row + 0.56 + 0.38 * rowFrac);

  root.appendChild(svg('circle', { cx: px, cy: py, r: 12, fill: cMain, opacity: 0.1 }));
  root.appendChild(svg('circle', { cx: px, cy: py, r: 6.5, fill: cMain, opacity: 0.2 }));
  root.appendChild(svg('circle', {
    cx: px, cy: py, r: 3.4, fill: cMain, stroke: bg, 'stroke-width': 1.6,
  }));

  return root;
}

export default alignmentSvg;
