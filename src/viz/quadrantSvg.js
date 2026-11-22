/* ============================================================
   quadrantSvg.js — 依恋双轴四象限坐标图
   X 轴：回避（低 → 高）；Y 轴：焦虑（低 → 高）
   ============================================================ */

import { svg, svgText, clamp, round } from '../core/utils.js';

export const ATTACHMENT_STYLES = {
  secure: {
    id: 'secure',
    name: '安全型',
    desc: '既能靠近，也能独处。你不需要反复确认对方在不在，也不会因为距离而崩塌。',
  },
  anxious: {
    id: 'anxious',
    name: '焦虑纠缠型',
    desc: '你对关系的信号极其敏感，一点距离就会触发确认的冲动，渴望被坚定地选择。',
  },
  avoidant: {
    id: 'avoidant',
    name: '回避疏离型',
    desc: '你需要大量属于自己的空间，靠得太近会本能地想退，独立是你的安全感来源。',
  },
  fearful: {
    id: 'fearful',
    name: '恐惧矛盾型',
    desc: '你既渴望深度连接，又害怕真正靠近。想被抱住，也想随时能跑掉。',
  },
};

export function attachmentStyle(anxiety, avoidance) {
  const a = Number.isFinite(anxiety) ? anxiety : 50;
  const v = Number.isFinite(avoidance) ? avoidance : 50;
  if (a < 52 && v < 52) return ATTACHMENT_STYLES.secure;
  if (a >= 52 && v < 52) return ATTACHMENT_STYLES.anxious;
  if (a < 52 && v >= 52) return ATTACHMENT_STYLES.avoidant;
  return ATTACHMENT_STYLES.fearful;
}

/**
 * @param {Object} o { anxiety, avoidance, partner?: {anxiety, avoidance, name} }
 */
export function quadrantSvg(o = {}, opt = {}) {
  const W = opt.width || 460;
  const H = opt.height || Math.round(W * 0.96);
  const padL = 46;
  const padR = 22;
  const padT = 24;
  const padB = 40;
  const iw = W - padL - padR;
  const ih = H - padT - padB;

  const cText = opt.colorText || '#1E2220';
  const cMuted = opt.colorMuted || '#8B8F89';
  const cBorder = opt.colorBorder || '#E4DFD4';
  const bg = opt.bg || '#FCFBF8';
  const cMain = opt.color || '#6D5472';
  const cPartner = opt.partnerColor || '#3B4D70';

  const ax = clamp(Number.isFinite(o.avoidance) ? o.avoidance : 50, 0, 100);
  const ay = clamp(Number.isFinite(o.anxiety) ? o.anxiety : 50, 0, 100);

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    role: 'img',
    'aria-label': '依恋四象限坐标图',
  });

  const g = svg('g', {});
  root.appendChild(g);

  const px = (v) => padL + (iw * v) / 100;
  const py = (v) => padT + ih - (ih * v) / 100;

  // 安全缓冲区光晕（左下，低焦虑低回避）
  const safe = svg('circle', {
    cx: px(22), cy: py(22), r: Math.min(iw, ih) * 0.24,
    fill: opt.safeColor || '#4A6B5D', opacity: 0.07,
  });
  g.appendChild(safe);
  g.appendChild(svg('circle', {
    cx: px(22), cy: py(22), r: Math.min(iw, ih) * 0.24,
    fill: 'none', stroke: opt.safeColor || '#4A6B5D', 'stroke-width': 0.8,
    'stroke-dasharray': '3 4', opacity: 0.5,
  }));

  // 象限背景格
  g.appendChild(svg('rect', { x: padL, y: padT, width: iw / 2, height: ih / 2, fill: 'none' }));
  g.appendChild(svg('rect', { x: padL + iw / 2, y: padT, width: iw / 2, height: ih / 2, fill: 'none' }));
  g.appendChild(svg('rect', { x: padL, y: padT + ih / 2, width: iw / 2, height: ih / 2, fill: 'none' }));
  g.appendChild(svg('rect', { x: padL + iw / 2, y: padT + ih / 2, width: iw / 2, height: ih / 2, fill: 'none' }));

  // 外框
  g.appendChild(svg('rect', {
    x: padL, y: padT, width: iw, height: ih,
    fill: 'none', stroke: cBorder, 'stroke-width': 1,
  }));

  // 中轴
  g.appendChild(svg('line', {
    x1: padL + iw / 2, y1: padT, x2: padL + iw / 2, y2: padT + ih,
    stroke: cBorder, 'stroke-width': 0.9, 'stroke-dasharray': '3 4',
  }));
  g.appendChild(svg('line', {
    x1: padL, y1: padT + ih / 2, x2: padL + iw, y2: padT + ih / 2,
    stroke: cBorder, 'stroke-width': 0.9, 'stroke-dasharray': '3 4',
  }));

  // 轴标题
  g.appendChild(svgText('回避 →', {
    x: W - padR, y: H - 12, 'text-anchor': 'end',
    'font-size': 9.5, 'letter-spacing': '0.16em',
    'font-family': "'Noto Sans SC','PingFang SC',sans-serif", fill: cMuted,
  }));
  g.appendChild(svgText('焦虑 ↑', {
    x: padL - 8, y: padT - 9, 'text-anchor': 'start',
    'font-size': 9.5, 'letter-spacing': '0.16em',
    'font-family': "'Noto Sans SC','PingFang SC',sans-serif", fill: cMuted,
  }));

  // 象限标签
  const ql = [
    { t: '焦虑纠缠', x: padL + 10, y: padT + 16, a: 'start' },
    { t: '恐惧矛盾', x: padL + iw - 10, y: padT + 16, a: 'end' },
    { t: '安全型', x: padL + 10, y: padT + ih - 10, a: 'start' },
    { t: '回避疏离', x: padL + iw - 10, y: padT + ih - 10, a: 'end' },
  ];
  ql.forEach((q) => {
    g.appendChild(svgText(q.t, {
      x: q.x, y: q.y, 'text-anchor': q.a,
      'font-size': 9, 'letter-spacing': '0.1em',
      'font-family': "'Noto Sans SC','PingFang SC',sans-serif",
      fill: cMuted, opacity: 0.75,
    }));
  });

  // 刻度
  [25, 50, 75].forEach((v) => {
    g.appendChild(svg('line', { x1: px(v), y1: padT + ih, x2: px(v), y2: padT + ih + 3, stroke: cBorder, 'stroke-width': 1 }));
    g.appendChild(svgText(`${v}`, {
      x: px(v), y: padT + ih + 14, 'text-anchor': 'middle',
      'font-size': 8, 'font-family': "'Noto Sans SC',sans-serif", fill: cMuted,
    }));
    g.appendChild(svg('line', { x1: padL - 3, y1: py(v), x2: padL, y2: py(v), stroke: cBorder, 'stroke-width': 1 }));
    g.appendChild(svgText(`${v}`, {
      x: padL - 7, y: py(v) + 3, 'text-anchor': 'end',
      'font-size': 8, 'font-family': "'Noto Sans SC',sans-serif", fill: cMuted,
    }));
  });

  // 伴侣点（可选）
  if (o.partner && Number.isFinite(o.partner.anxiety) && Number.isFinite(o.partner.avoidance)) {
    const bx = px(clamp(o.partner.avoidance, 0, 100));
    const by = py(clamp(o.partner.anxiety, 0, 100));
    g.appendChild(svg('line', {
      x1: px(ax), y1: py(ay), x2: bx, y2: by,
      stroke: cBorder, 'stroke-width': 1, 'stroke-dasharray': '2 4',
    }));
    g.appendChild(svg('circle', { cx: bx, cy: by, r: 9, fill: cPartner, opacity: 0.12 }));
    g.appendChild(svg('circle', { cx: bx, cy: by, r: 4.4, fill: cPartner, stroke: bg, 'stroke-width': 1.5 }));
    g.appendChild(svgText(o.partner.name || 'B', {
      x: bx + 12, y: by + 3.5,
      'font-size': 9.5, 'font-family': "'Noto Sans SC',sans-serif",
      fill: cPartner, 'letter-spacing': '0.08em',
    }));
  }

  // 主点
  const mx = px(ax);
  const my = py(ay);
  g.appendChild(svg('circle', { cx: mx, cy: my, r: 14, fill: cMain, opacity: 0.1 }));
  g.appendChild(svg('circle', { cx: mx, cy: my, r: 7, fill: cMain, opacity: 0.2 }));
  g.appendChild(svg('circle', { cx: mx, cy: my, r: 4.6, fill: cMain, stroke: bg, 'stroke-width': 1.6 }));

  if (opt.label !== false) {
    g.appendChild(svgText(o.name || '你', {
      x: mx + 12, y: my + 3.5,
      'font-size': 9.5, 'font-family': "'Noto Sans SC',sans-serif",
      fill: cMain, 'letter-spacing': '0.08em',
    }));
  }

  return root;
}
