/* ============================================================
   Exporter.js — 导出工作室
   · Canvas 2D 离线绘制 1080×1920 精简卡 / 1080×2800 全景长图
   · Markdown 结构化报告
   · JSON 完整备份
   · 打印 PDF（依赖 print.css）
   ============================================================ */

import { downloadBlob, downloadText, copyText, toast, round, formatDate } from '../core/utils.js';
import { buildStructuredPrompt } from '../core/dossierCore.js';

/* ------------------------------------------------------------
   中文字体与文本排版
   ------------------------------------------------------------ */

const FONT_SERIF = `'Noto Serif SC','Songti SC','STSong',Georgia,serif`;
const FONT_SANS = `'Noto Sans SC','PingFang SC','-apple-system','Helvetica Neue',sans-serif`;

const PALETTE = {
  /* 象牙典藏版 */
  light: {
    page: '#FAF8F4',
    card: '#FFFFFF',
    text: '#171918',
    sub: '#525753',
    faint: '#878C86',
    border: 'rgba(23,25,24,0.09)',
    gold: '#9A7B45',
    goldSoft: '#C5A875',
    sin: '#A64B35',
    virtue: '#2B6458',
  },
  /* 暗夜黑金版 */
  dark: {
    page: '#0B0C0E',
    card: '#14161A',
    text: '#F2EFE9',
    sub: '#9CA1AA',
    faint: '#666C76',
    border: 'rgba(242,239,233,0.10)',
    gold: '#D4B47B',
    goldSoft: '#A88C5B',
    sin: '#D67459',
    virtue: '#54A18F',
  },
};

/** 按字符宽度断行（中文逐字、英文按词优先） */
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = String(text ?? '').split('\n');

  for (const para of paragraphs) {
    if (!para) { lines.push(''); continue; }
    let line = '';
    let i = 0;
    while (i < para.length) {
      const ch = para[i];
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        // 英文单词尽量不从中间断
        if (/[A-Za-z0-9]/.test(ch) && /[A-Za-z0-9]$/.test(line)) {
          const cut = line.lastIndexOf(' ');
          if (cut > line.length * 0.5) {
            lines.push(line.slice(0, cut));
            line = line.slice(cut + 1) + ch;
            i += 1;
            continue;
          }
        }
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
      i += 1;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawText(ctx, text, x, y, {
  maxWidth = 900, lineHeight = 44, font = `400 28px ${FONT_SANS}`,
  color = '#1E2220', maxLines = 99, align = 'left',
} = {}) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const lines = wrapText(ctx, text, maxWidth).slice(0, maxLines);
  lines.forEach((ln, i) => {
    ctx.fillText(ln, x, y + i * lineHeight);
  });
  ctx.restore();
  return y + lines.length * lineHeight;
}

function measureLines(ctx, text, maxWidth, font) {
  ctx.save();
  ctx.font = font;
  const n = wrapText(ctx, text, maxWidth).length;
  ctx.restore();
  return n;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hairline(ctx, x1, y, x2, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y + 0.5);
  ctx.lineTo(x2, y + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawBadge(ctx, text, x, y, { color, bg, border, font = `400 22px ${FONT_SANS}`, padX = 18, height = 40 }) {
  ctx.save();
  ctx.font = font;
  const w = ctx.measureText(text).width + padX * 2;
  roundRect(ctx, x, y, w, height, height / 2);
  if (bg) { ctx.fillStyle = bg; ctx.fill(); }
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + height / 2 + 1);
  ctx.restore();
  return w;
}

/* ------------------------------------------------------------
   密度计算（精灵图布局）
   ------------------------------------------------------------ */

function buildSections(report) {
  const { archetype, dual, cross, gifts, shadows, manual, values, mask } = report;
  const secs = [];

  secs.push({ type: 'archetype' });
  if (cross?.length) secs.push({ type: 'cross' });
  if (gifts?.length) secs.push({ type: 'gifts' });
  if (shadows?.length) secs.push({ type: 'shadows' });
  if (dual) secs.push({ type: 'dual' });
  if (manual) secs.push({ type: 'manual' });
  if (values?.length) secs.push({ type: 'values' });
  return secs;
}

/* ------------------------------------------------------------
   Canvas 雷达图（海报里必须有真实图形，不能只有文字条）
   ------------------------------------------------------------ */

function drawRadar(ctx, cx, cy, R, axes, opts = {}) {
  const n = axes.length;
  if (n < 3) return;

  const color = opts.color || '#A8894F';
  const border = opts.border || '#E4DFD4';
  const labelColor = opts.labelColor || '#5A5F5B';
  const font = opts.font || `400 16px ${FONT_SANS}`;
  const valueFont = opts.valueFont || `400 15px ${FONT_SERIF}`;

  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i, f) => [cx + Math.cos(angle(i)) * R * f, cy + Math.sin(angle(i)) * R * f];

  ctx.save();

  // 网格
  [0.25, 0.5, 0.75, 1].forEach((f, idx) => {
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const [x, y] = pt(i, f);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = border;
    ctx.globalAlpha = idx === 3 ? 0.95 : 0.5;
    ctx.lineWidth = idx === 3 ? 1.2 : 0.8;
    ctx.stroke();
  });

  // 轴线
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < n; i += 1) {
    const [x, y] = pt(i, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 数据面
  ctx.beginPath();
  axes.forEach((a, i) => {
    const v = Math.max(0, Math.min(100, Number(a.value) || 0)) / 100;
    const [x, y] = pt(i, v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.16;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 顶点
  axes.forEach((a, i) => {
    const v = Math.max(0, Math.min(100, Number(a.value) || 0)) / 100;
    const [x, y] = pt(i, v);
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  // 标签
  ctx.textAlign = 'left';
  axes.forEach((a, i) => {
    const [x, y] = pt(i, 1.16);
    const cos = Math.cos(angle(i));
    const sin = Math.sin(angle(i));
    ctx.textAlign = Math.abs(cos) < 0.25 ? 'center' : cos > 0 ? 'left' : 'right';
    const dy = sin > 0.5 ? 22 : sin < -0.5 ? -6 : 8;

    ctx.font = font;
    ctx.fillStyle = labelColor;
    ctx.fillText(a.label, x, y + dy);

    ctx.font = valueFont;
    ctx.fillStyle = color;
    ctx.fillText(String(Math.round(a.value)), x, y + dy + (sin < -0.5 ? -20 : 20));
  });

  ctx.restore();
}

/* ------------------------------------------------------------
   共享画布装帧（安全 DPR + 顶部晨光 + Ex-Libris 藏书票双框）
   ------------------------------------------------------------ */

function createPosterFrame({
  width = 1080,
  height = 1920,
  theme = 'light',
  padX = 84,
  headerY = 104,
} = {}) {
  const P = PALETTE[theme] || PALETTE.light;

  // iOS Safari 对单张 canvas 有硬上限（约 4096×4096 或 1677 万像素，
  // 超出后 toDataURL 直接返回空字符串 → 白图）。按「最长边 ≤ 4096 且总面积 ≤ 1600 万」动态降 DPR。
  const SAFE_SIDE = 4096;
  const SAFE_AREA = 16_000_000;
  let dpr = 2;
  while (dpr > 1 && (width * dpr > SAFE_SIDE || height * dpr > SAFE_SIDE
    || width * dpr * height * dpr > SAFE_AREA)) {
    dpr -= 0.25;
  }
  dpr = Math.max(1, dpr);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 背景 + 顶部柔和渐层
  ctx.fillStyle = P.page;
  ctx.fillRect(0, 0, width, height);

  const grad = ctx.createRadialGradient(width * 0.88, 40, 0, width * 0.88, 40, width * 0.9);
  grad.addColorStop(0, theme === 'dark' ? 'rgba(201,169,110,0.10)' : 'rgba(168,137,79,0.09)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height * 0.55);

  const cw = width - padX * 2;
  let y = headerY;

  // 页眉
  ctx.textAlign = 'left';
  ctx.fillStyle = P.faint;
  ctx.font = `400 22px ${FONT_SANS}`;
  ctx.letterSpacing = '4px';
  ctx.fillText('THE HUMAN ATLAS', padX, y);
  ctx.letterSpacing = '0px';

  ctx.textAlign = 'right';
  ctx.font = `400 20px ${FONT_SANS}`;
  ctx.fillStyle = P.faint;
  ctx.fillText(formatDate(Date.now()), width - padX, y);

  y += 26;
  hairline(ctx, padX, y, width - padX, P.border);
  y += 70;

  return { canvas, ctx, P, cw, padX, startY: y };
}

function finishPosterFrame(canvas, ctx, { width, height, padX = 84, P }) {
  const footY = height - 76;
  hairline(ctx, padX, footY - 40, width - padX, P.border);

  ctx.textAlign = 'left';
  ctx.fillStyle = P.faint;
  ctx.font = `400 17px ${FONT_SANS}`;
  ctx.letterSpacing = '3px';
  ctx.fillText('HUMAN-ATLAS · 人性全息图谱', padX, footY);

  ctx.textAlign = 'right';
  ctx.fillText('纯前端本地运算 · 无数据上传', width - padX, footY);
  ctx.letterSpacing = '0px';

  // 双线藏书票边框（Ex-Libris）
  const exOuter = 26;
  const exInner = 33;
  ctx.save();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(exOuter + 0.5, exOuter + 0.5, width - exOuter * 2 - 1, height - exOuter * 2 - 1);
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = P.gold;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(exInner + 0.5, exInner + 0.5, width - exInner * 2 - 1, height - exInner * 2 - 1);
  ctx.globalAlpha = 1;

  const corner = 22;
  ctx.strokeStyle = P.gold;
  ctx.lineWidth = 1.6;
  const cx0 = exOuter;
  const cy0 = exOuter;
  const cx1 = width - exOuter;
  const cy1 = height - exOuter;
  [[cx0, cy0, 1, 1], [cx1, cy0, -1, 1], [cx0, cy1, 1, -1], [cx1, cy1, -1, -1]].forEach(([x, y0, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x + sx * corner, y0);
    ctx.lineTo(x, y0);
    ctx.lineTo(x, y0 + sy * corner);
    ctx.stroke();
  });
  ctx.restore();

  return canvas;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png', 1);
  });
}

/* ------------------------------------------------------------
   海报绘制
   ------------------------------------------------------------ */

export async function drawPoster(report, {
  width = 1080,
  height = 1920,
  theme = 'light',
  long = false,
  nickname = '',
} = {}) {
  const padX = long ? 92 : 84;
  const { canvas, ctx, P, cw, startY } = createPosterFrame({
    width, height, theme, padX, headerY: long ? 96 : 104,
  });
  let y = startY;

  /* ---------- 署名 ---------- */
  if (nickname) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.sub;
    ctx.font = `400 24px ${FONT_SANS}`;
    ctx.fillText(`— ${nickname} 的人性档案`, padX, y);
    y += 54;
  }

  /* ---------- 原型标题 ---------- */
  const arch = report.archetype?.best;
  if (arch) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.gold;
    ctx.font = `400 22px ${FONT_SANS}`;
    ctx.letterSpacing = '5px';
    ctx.fillText('SOUL ARCHETYPE', padX, y);
    ctx.letterSpacing = '0px';
    y += 58;

    ctx.fillStyle = P.text;
    ctx.font = `500 68px ${FONT_SERIF}`;
    ctx.fillText(arch.name, padX, y);
    y += 46;

    ctx.fillStyle = P.faint;
    ctx.font = `400 22px ${FONT_SANS}`;
    ctx.letterSpacing = '4px';
    ctx.fillText(arch.latin.toUpperCase(), padX, y);
    ctx.letterSpacing = '0px';
    y += 44;

    // keywords
    let kx = padX;
    (arch.keywords || []).forEach((k) => {
      const w = drawBadge(ctx, k, kx, y, {
        color: P.gold,
        border: P.goldSoft,
        font: `400 21px ${FONT_SANS}`,
      });
      kx += w + 12;
    });
    y += 66;

    // 判词
    y = drawText(ctx, arch.verdict, padX, y, {
      maxWidth: cw,
      lineHeight: 40,
      font: `400 26px ${FONT_SERIF}`,
      color: P.sub,
      maxLines: long ? 8 : 4,
    });
    y += 40;
  }

  /* ---------- 三仪表 ---------- */
  const lightDark = computeLightDarkRatio(report);
  const gauges = [
    { label: '光暗能量比', value: lightDark, unit: '' },
    { label: '社会面具厚度', value: Number.isFinite(report.mask?.value) ? Math.round(report.mask.value) : '—', unit: '' },
    { label: '测评完成度', value: `${report.completed?.length ?? 0}/${report.totalVolumes ?? 16}`, unit: '卷' },
  ];

  y += 10;
  hairline(ctx, padX, y, width - padX, P.border);
  y += 44;

  const gW = cw / 3;
  gauges.forEach((g, i) => {
    const gx = padX + i * gW;
    ctx.textAlign = 'left';
    ctx.fillStyle = P.faint;
    ctx.font = `400 18px ${FONT_SANS}`;
    ctx.letterSpacing = '2.5px';
    ctx.fillText(g.label, gx, y);
    ctx.letterSpacing = '0px';

    ctx.fillStyle = P.text;
    ctx.font = `500 52px ${FONT_SERIF}`;
    ctx.fillText(`${g.value}`, gx, y + 64);

    if (g.unit) {
      ctx.fillStyle = P.faint;
      ctx.font = `400 22px ${FONT_SANS}`;
      const vw = ctx.measureText(`${g.value}`).width;
      ctx.fillText(g.unit, gx + vw + 6, y + 64);
    }
  });

  y += 100;
  hairline(ctx, padX, y, width - padX, P.border);
  y += 56;

  /* ---------- 核心图谱：真实雷达 ---------- */
  const radarDims = [
    { id: 'big5_open', label: '探索' },
    { id: 'big5_order', label: '秩序' },
    { id: 'big5_assert', label: '表达' },
    { id: 'big5_compassion', label: '共情' },
    { id: 'big5_compliance', label: '妥协' },
    { id: 'big5_rumination', label: '反刍' },
    { id: 'cog_global', label: '抽象' },
    { id: 'cog_speed', label: '决断' },
    { id: 'mot_autonomy', label: '主权' },
    { id: 'mot_belonging', label: '羁绊' },
  ]
    .filter((d) => Number.isFinite(report.scores?.[d.id]))
    .slice(0, long ? 8 : 6)
    .map((d) => ({ label: d.label, value: report.scores[d.id] }));

  if (radarDims.length >= 3 && y < height - 300) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.faint;
    ctx.font = `400 19px ${FONT_SANS}`;
    ctx.letterSpacing = '4px';
    ctx.fillText('SIGNATURE AXES · 核心图谱', padX, y);
    ctx.letterSpacing = '0px';
    y += 30;

    const radarH = long ? 340 : 300;
    const cx = width / 2;
    const cy = y + radarH / 2 + 6;
    const R = radarH * 0.33;

    drawRadar(ctx, cx, cy, R, radarDims, {
      color: P.gold,
      border: P.border,
      labelColor: P.sub,
      font: `400 20px ${FONT_SANS}`,
      valueFont: `400 18px ${FONT_SERIF}`,
    });

    y += radarH + 8;
  }

  /* ---------- 王牌天赋卡 ---------- */
  if (report.gifts?.length) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.faint;
    ctx.font = `400 19px ${FONT_SANS}`;
    ctx.letterSpacing = '4px';
    ctx.fillText('SIGNATURE GIFTS · 王牌天赋', padX, y);
    ctx.letterSpacing = '0px';
    y += 40;

    report.gifts.slice(0, long ? 4 : 2).forEach((g, i) => {
      const cardH = long ? 168 : 152;
      roundRect(ctx, padX, y, cw, cardH, 6);
      ctx.fillStyle = P.card;
      ctx.fill();
      ctx.strokeStyle = P.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      // 左侧色条
      ctx.fillStyle = P.virtue;
      ctx.fillRect(padX, y + 18, 3, cardH - 36);

      ctx.textAlign = 'left';
      ctx.fillStyle = P.faint;
      ctx.font = `400 17px ${FONT_SANS}`;
      ctx.letterSpacing = '2px';
      ctx.fillText(`0${i + 1} · ${g.name}`, padX + 26, y + 38);
      ctx.letterSpacing = '0px';

      ctx.fillStyle = P.text;
      ctx.font = `500 30px ${FONT_SERIF}`;
      ctx.fillText(g.gift_title, padX + 26, y + 78);

      drawText(ctx, g.gift_desc, padX + 26, y + 114, {
        maxWidth: cw - 52,
        lineHeight: 30,
        font: `400 20px ${FONT_SANS}`,
        color: P.sub,
        maxLines: long ? 2 : 1,
      });

      y += cardH + 16;
    });
    y += 24;
  }

  /* ---------- 阴影预警 ---------- */
  if (report.shadows?.length && (long || y < height - 420)) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.faint;
    ctx.font = `400 19px ${FONT_SANS}`;
    ctx.letterSpacing = '4px';
    ctx.fillText('SHADOW ALERTS · 阴影预警', padX, y);
    ctx.letterSpacing = '0px';
    y += 40;

    report.shadows.slice(0, long ? 3 : 1).forEach((s, i) => {
      const cardH = 132;
      roundRect(ctx, padX, y, cw, cardH, 6);
      ctx.fillStyle = P.card;
      ctx.fill();
      ctx.strokeStyle = P.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = P.sin;
      ctx.fillRect(padX, y + 18, 3, cardH - 36);

      ctx.textAlign = 'left';
      ctx.fillStyle = P.faint;
      ctx.font = `400 17px ${FONT_SANS}`;
      ctx.letterSpacing = '2px';
      ctx.fillText(`${s.name}`, padX + 26, y + 36);
      ctx.letterSpacing = '0px';

      ctx.fillStyle = P.text;
      ctx.font = `500 27px ${FONT_SERIF}`;
      ctx.fillText(s.shadow_title, padX + 26, y + 72);

      drawText(ctx, s.shadow_desc, padX + 26, y + 104, {
        maxWidth: cw - 52,
        lineHeight: 28,
        font: `400 19px ${FONT_SANS}`,
        color: P.sub,
        maxLines: 1,
      });

      y += cardH + 14;
    });
    y += 20;
  }

  /* ---------- 跨卷读心 ---------- */
  if (long && report.cross?.length) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.faint;
    ctx.font = `400 19px ${FONT_SANS}`;
    ctx.letterSpacing = '4px';
    ctx.fillText('CROSS-VOLUME INSIGHTS · 跨卷读心', padX, y);
    ctx.letterSpacing = '0px';
    y += 40;

    report.cross.slice(0, 3).forEach((c) => {
      const h = 40 + Math.min(4, measureLines(ctx, c.insight, cw - 52, `400 19px ${FONT_SANS}`)) * 30 + 34;
      roundRect(ctx, padX, y, cw, h, 6);
      ctx.fillStyle = P.card;
      ctx.fill();
      ctx.strokeStyle = P.border;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = P.gold;
      ctx.font = `400 16px ${FONT_SANS}`;
      ctx.letterSpacing = '2px';
      ctx.fillText(c.tag, padX + 26, y + 30);
      ctx.letterSpacing = '0px';

      ctx.fillStyle = P.text;
      ctx.font = `500 26px ${FONT_SERIF}`;
      ctx.fillText(c.title, padX + 26, y + 68);

      const used = drawText(ctx, c.insight, padX + 26, y + 100, {
        maxWidth: cw - 52,
        lineHeight: 30,
        font: `400 19px ${FONT_SANS}`,
        color: P.sub,
        maxLines: 4,
      });
      y += Math.max(h, used + 20) + 14;
    });
    y += 20;
  }

  /* ---------- 核心价值 ---------- */
  if (report.values?.length) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.faint;
    ctx.font = `400 19px ${FONT_SANS}`;
    ctx.letterSpacing = '4px';
    ctx.fillText('CORE VALUES · 核心价值排序', padX, y);
    ctx.letterSpacing = '0px';
    y += 48;

    let vx = padX;
    report.values.slice(0, 3).forEach((v, i) => {
      ctx.fillStyle = P.gold;
      ctx.font = `500 34px ${FONT_SERIF}`;
      ctx.fillText(`0${i + 1}`, vx, y);
      ctx.fillStyle = P.text;
      ctx.font = `500 30px ${FONT_SERIF}`;
      ctx.fillText(v.name, vx + 54, y);
      vx += 54 + ctx.measureText(v.name).width + 40;
    });
    y += 56;
  }

  /* ---------- 核心刻度条 ---------- */
  const bars = (report.dimRows || []).slice(0, long ? 8 : 6);
  if (bars.length && y < height - (long ? 420 : 360)) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.faint;
    ctx.font = `400 19px ${FONT_SANS}`;
    ctx.letterSpacing = '4px';
    ctx.fillText('SIGNATURE AXES · 核心刻度', padX, y);
    ctx.letterSpacing = '0px';
    y += 44;

    const barW = cw - 132;
    bars.forEach((r) => {
      ctx.fillStyle = P.sub;
      ctx.font = `400 21px ${FONT_SANS}`;
      ctx.textAlign = 'left';
      ctx.fillText(r.name, padX, y + 6);

      const bx = padX + 150;
      ctx.fillStyle = P.border;
      ctx.fillRect(bx, y - 1, barW, 2);

      const frac = Math.max(0, Math.min(100, Number(r.score) || 0)) / 100;
      ctx.fillStyle = frac >= 0.5 ? P.gold : P.faint;
      ctx.fillRect(bx, y - 1, barW * frac, 2);

      ctx.textAlign = 'right';
      ctx.fillStyle = P.text;
      ctx.font = `500 22px ${FONT_SERIF}`;
      ctx.fillText(String(Math.round(r.score)), width - padX, y + 8);

      y += 46;
    });
    y += 20;
  }

  /* ---------- 页脚 ---------- */
  return finishPosterFrame(canvas, ctx, { width, height, padX, P });
}

function computeLightDarkRatio(report) {
  const s = report.scores || {};
  const lightKeys = ['light_humanism', 'light_kant', 'light_faith', 'virtue_humility', 'virtue_charity', 'virtue_kindness', 'virtue_patience', 'virtue_temperance', 'virtue_diligence', 'virtue_chastity'];
  const darkKeys = ['dark_mach', 'dark_narc', 'dark_psycho', 'sin_pride', 'sin_greed', 'sin_envy', 'sin_wrath', 'sin_sloth', 'sin_lust', 'sin_gluttony'];
  const l = lightKeys.map((k) => s[k]).filter(Number.isFinite);
  const d = darkKeys.map((k) => s[k]).filter(Number.isFinite);
  if (!l.length || !d.length) return '—';
  const lm = l.reduce((a, b) => a + b, 0) / l.length;
  const dm = d.reduce((a, b) => a + b, 0) / d.length;
  if (dm <= 1) return '99:1';
  const ratio = Math.round((lm / dm) * 100);
  return `${Math.round(ratio / 10) * 10}:100`;
}

export async function exportPoster(report, { long = false, theme = 'light', nickname = '' } = {}) {
  const w = 1080;
  const h = long ? 2800 : 1920;
  const canvas = await drawPoster(report, { width: w, height: h, theme, long, nickname });
  return canvasToPngBlob(canvas);
}

/* ------------------------------------------------------------
   战报卡 1：顺境 × 高压双态对比卡（1080 × 1620）
   ------------------------------------------------------------ */

export async function drawDualStatePoster(report, {
  width = 1080,
  height = 1620,
  theme = 'light',
  nickname = '',
  sandbox = null,
  dimMap = {},
} = {}) {
  const { canvas, ctx, P, cw, padX, startY } = createPosterFrame({
    width, height, theme, padX: 84, headerY: 98,
  });
  let y = startY - 12;

  ctx.textAlign = 'left';
  ctx.fillStyle = P.gold;
  ctx.font = `400 20px ${FONT_SANS}`;
  ctx.letterSpacing = '4px';
  ctx.fillText('DUAL-STATE MATRIX · 顺境舒展 × 高压退行', padX, y);
  ctx.letterSpacing = '0px';
  y += 54;

  const arch = report?.archetype?.best;
  const headline = arch?.name || (nickname ? `${nickname} 的双态图谱` : '顺境与高压双态');
  ctx.fillStyle = P.text;
  ctx.font = `500 56px ${FONT_SERIF}`;
  ctx.fillText(headline, padX, y);
  y += 40;

  ctx.fillStyle = P.sub;
  ctx.font = `400 22px ${FONT_SANS}`;
  ctx.fillText(
    `${nickname ? `${nickname} · ` : ''}${arch?.psych_tag || '同一个性格在高能量与低电量下的两张面孔'}`,
    padX, y,
  );
  y += 42;

  /* ---------- 左右双态对撞主卡 ---------- */
  const colGap = 24;
  const colW = (cw - colGap) / 2;
  const dualH = 330;
  const dual = report?.dual || {};
  const dualCards = [
    {
      x: padX,
      kicker: 'FLOURISH · 顺境舒展态',
      color: P.virtue,
      body: dual.flourish || '完成更多卷宗后将勾勒你的高能量舒展形态。',
    },
    {
      x: padX + colW + colGap,
      kicker: 'DEPLETED · 高压退行态',
      color: P.sin,
      body: dual.underPressure || '完成更多卷宗后将显影你的低电量防御形态。',
    },
  ];

  dualCards.forEach((c) => {
    roundRect(ctx, c.x, y, colW, dualH, 8);
    ctx.fillStyle = P.card;
    ctx.fill();
    ctx.strokeStyle = P.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 顶部色彩标识线
    roundRect(ctx, c.x, y, colW, 5, 3);
    ctx.fillStyle = c.color;
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = c.color;
    ctx.font = `500 18px ${FONT_SANS}`;
    ctx.letterSpacing = '2.5px';
    ctx.fillText(c.kicker, c.x + 26, y + 46);
    ctx.letterSpacing = '0px';

    drawText(ctx, c.body, c.x + 26, y + 88, {
      maxWidth: colW - 52,
      lineHeight: 36,
      font: `400 22px ${FONT_SANS}`,
      color: P.text,
      maxLines: 6,
    });
  });

  y += dualH + 28;

  /* ---------- 退行触发点 & 刹车处方 ---------- */
  const style = dual.style;
  const styleBoxH = style ? 250 : 120;
  roundRect(ctx, padX, y, cw, styleBoxH, 8);
  ctx.fillStyle = P.card;
  ctx.fill();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (style) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.gold;
    ctx.font = `500 23px ${FONT_SERIF}`;
    ctx.fillText(`高压退行路径 · ${style.name}`, padX + 28, y + 46);

    const wTag = drawBadge(ctx, 'Vol.8 高压剧场', padX + cw - 190, y + 18, {
      color: P.gold, border: P.goldSoft, font: `400 17px ${FONT_SANS}`, padX: 14, height: 32,
    });
    void wTag;

    let sy = y + 92;
    sy = drawText(ctx, `触发点：${style.trigger}`, padX + 28, sy, {
      maxWidth: cw - 56, lineHeight: 32, font: `400 20px ${FONT_SANS}`, color: P.sub, maxLines: 2,
    });
    sy += 8;
    drawText(ctx, `刹车处方：${style.brake}`, padX + 28, sy, {
      maxWidth: cw - 56, lineHeight: 32, font: `400 20px ${FONT_SANS}`, color: P.text, maxLines: 2,
    });
  } else {
    drawText(ctx, '完成 Vol.8「高压剧场」后，这里将显影你专属的高压触发词与现场刹车方案。', padX + 28, y + 52, {
      maxWidth: cw - 56, lineHeight: 34, font: `400 21px ${FONT_SANS}`, color: P.sub, maxLines: 2,
    });
  }

  y += styleBoxH + 34;

  /* ---------- 压力耗竭位移条（常态 → 极度耗竭） ---------- */
  ctx.textAlign = 'left';
  ctx.fillStyle = P.faint;
  ctx.font = `400 18px ${FONT_SANS}`;
  ctx.letterSpacing = '3px';
  ctx.fillText('STRESS SHIFT AT DEPLETED 15% · 低电量最易失衡维度', padX, y);
  ctx.letterSpacing = '0px';
  y += 32;

  const rising = (sandbox?.rising || []).map(([dim, delta]) => ({ dim, delta }));
  const falling = (sandbox?.falling || []).map(([dim, delta]) => ({ dim, delta }));
  const shifts = [...rising.slice(0, 3), ...falling.slice(0, 3)];

  if (shifts.length) {
    shifts.forEach((item) => {
      const label = dimMap?.[item.dim]?.name || item.dim;
      const base = Number(report?.scores?.[item.dim]);
      const dep = Number(sandbox?.scores?.[item.dim]);
      const valid = Number.isFinite(base) && Number.isFinite(dep);
      const isUp = item.delta > 0;
      const tone = isUp ? P.sin : P.virtue;

      roundRect(ctx, padX, y, cw, 62, 6);
      ctx.fillStyle = P.card;
      ctx.fill();
      ctx.strokeStyle = P.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = P.text;
      ctx.font = `500 21px ${FONT_SANS}`;
      ctx.fillText(label, padX + 22, y + 38);

      // 中间水平位移轨（260px）
      const trackX = padX + 340;
      const trackW = 280;
      const trackY = y + 31;
      ctx.fillStyle = P.border;
      ctx.fillRect(trackX, trackY - 2, trackW, 4);

      if (valid) {
        const bx = trackX + (Math.max(0, Math.min(100, base)) / 100) * trackW;
        const dx = trackX + (Math.max(0, Math.min(100, dep)) / 100) * trackW;
        const lo = Math.min(bx, dx);
        const span = Math.max(4, Math.abs(dx - bx));
        ctx.fillStyle = tone;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(lo, trackY - 3, span, 6);
        ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.arc(bx, trackY, 5, 0, Math.PI * 2);
        ctx.fillStyle = P.faint;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(dx, trackY, 7, 0, Math.PI * 2);
        ctx.fillStyle = tone;
        ctx.fill();
      }

      ctx.textAlign = 'right';
      ctx.fillStyle = tone;
      ctx.font = `500 21px ${FONT_SERIF}`;
      const numText = valid ? `${Math.round(base)} → ${Math.round(dep)} (${isUp ? '+' : ''}${round(item.delta, 0)})` : `${isUp ? '+' : ''}${round(item.delta, 0)}`;
      ctx.fillText(numText, padX + cw - 22, y + 38);

      y += 74;
    });
  } else {
    roundRect(ctx, padX, y, cw, 110, 8);
    ctx.fillStyle = P.card;
    ctx.fill();
    drawText(ctx, '答完更多核心维度后，这里将画出常态与极度耗竭状态之间位移最剧烈的 6 条性格轨迹。', padX + 24, y + 48, {
      maxWidth: cw - 48, lineHeight: 32, font: `400 20px ${FONT_SANS}`, color: P.sub, maxLines: 2,
    });
  }

  return finishPosterFrame(canvas, ctx, { width, height, padX, P });
}

export async function exportDualStatePoster(report, opts = {}) {
  const canvas = await drawDualStatePoster(report, opts);
  return canvasToPngBlob(canvas);
}

export async function downloadDualStatePoster(report, opts = {}) {
  const blob = await exportDualStatePoster(report, opts);
  const name = `human-atlas-dual-${Date.now()}.png`;
  downloadBlob(name, blob);
  return name;
}

/* ------------------------------------------------------------
   战报卡 2：双人合盘 & 「我以为的 TA」投射对照卡（1080 × 1720）
   ------------------------------------------------------------ */

export async function drawComparePoster(payload, {
  width = 1080,
  height = 1720,
  theme = 'light',
} = {}) {
  const {
    res = {},
    eco = { list: [] },
    nameA = '我',
    nameB = '对方',
    projectionDiffs = null,
    dimMap = {},
    isProjection = false,
  } = payload || {};

  const { canvas, ctx, P, cw, padX, startY } = createPosterFrame({
    width, height, theme, padX: 84, headerY: 96,
  });
  let y = startY - 14;

  ctx.textAlign = 'left';
  ctx.fillStyle = P.gold;
  ctx.font = `400 20px ${FONT_SANS}`;
  ctx.letterSpacing = '4px';
  ctx.fillText(
    isProjection
      ? 'PROJECTION VS REALITY · 「我以为的 TA」投射偏差战报'
      : 'SOUL ALIGNMENT · 双人全息合盘战报',
    padX, y,
  );
  ctx.letterSpacing = '0px';
  y += 46;

  /* ---------- 对阵卡 + 总契合定级 ---------- */
  const heroH = 266;
  roundRect(ctx, padX, y, cw, heroH, 10);
  ctx.fillStyle = P.card;
  ctx.fill();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 左：双方名字 & 判词
  ctx.textAlign = 'left';
  ctx.fillStyle = P.text;
  ctx.font = `500 36px ${FONT_SERIF}`;
  ctx.fillText(`${nameA}  ×  ${nameB}`, padX + 30, y + 58);

  const grade = res.grade || { id: '—', name: '合盘速写', desc: '' };
  ctx.fillStyle = P.gold;
  ctx.font = `500 24px ${FONT_SERIF}`;
  ctx.fillText(`${grade.name} · ${grade.id} 级`, padX + 30, y + 100);

  drawText(ctx, grade.desc || '只基于双方真正共有的核心维度对比推演。', padX + 30, y + 142, {
    maxWidth: cw - 270,
    lineHeight: 32,
    font: `400 20px ${FONT_SANS}`,
    color: P.sub,
    maxLines: 3,
  });

  // 右：大号总契合度圆盾
  const scoreX = padX + cw - 122;
  const scoreY = y + 114;
  ctx.save();
  ctx.beginPath();
  ctx.arc(scoreX, scoreY, 72, 0, Math.PI * 2);
  ctx.strokeStyle = P.goldSoft;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = P.text;
  ctx.font = `500 52px ${FONT_SERIF}`;
  ctx.fillText(Number.isFinite(res.overall) ? `${Math.round(res.overall)}` : '—', scoreX, scoreY + 12);
  ctx.fillStyle = P.faint;
  ctx.font = `400 17px ${FONT_SANS}`;
  ctx.fillText('契合度 %', scoreX, scoreY + 42);
  ctx.restore();

  y += heroH + 22;

  /* ---------- 四项关键指标 ---------- */
  const metrics = [
    { k: '交汇范围', v: res.isExpressPair ? '极速速写' : `${(res.common || []).length} 卷` },
    { k: '可比维度', v: `${(res.dims || []).length} 维` },
    { k: '价值观共振', v: res.sync ? `${Math.round(res.sync.value)}` : '—' },
    { k: '阴影碰撞', v: `${(res.collisions || []).length} 处` },
  ];
  const mw = cw / 4;
  metrics.forEach((m, i) => {
    const mx = padX + i * mw;
    roundRect(ctx, mx + (i ? 6 : 0), y, mw - (i ? 6 : 6), 90, 6);
    ctx.fillStyle = P.card;
    ctx.fill();
    ctx.strokeStyle = P.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = P.faint;
    ctx.font = `400 17px ${FONT_SANS}`;
    ctx.fillText(m.k, mx + 22, y + 32);

    ctx.fillStyle = P.text;
    ctx.font = `500 28px ${FONT_SERIF}`;
    ctx.fillText(m.v, mx + 22, y + 70);
  });
  y += 116;

  /* ---------- 主视觉模块：投射模式优先画「投射偏差透视」，常规合盘画「七大生态位排行」 ---------- */
  if (isProjection && projectionDiffs?.length) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.faint;
    ctx.font = `400 18px ${FONT_SANS}`;
    ctx.letterSpacing = '3px';
    ctx.fillText('PROJECTION GAPS · 你误解 TA 最深的维度 Top 5', padX, y);
    ctx.letterSpacing = '0px';
    y += 26;

    projectionDiffs.slice(0, 5).forEach((d) => {
      const name = dimMap?.[d.dim]?.name || d.dim;
      const absD = Math.round(Math.abs(d.signed));
      const tag = absD < 8 ? '直觉命中' : d.signed > 0 ? `高估 +${absD}` : `低估 -${absD}`;
      const barTone = absD < 8 ? P.virtue : d.signed > 0 ? P.gold : P.sin;

      roundRect(ctx, padX, y, cw, 64, 6);
      ctx.fillStyle = P.card;
      ctx.fill();
      ctx.strokeStyle = P.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = P.text;
      ctx.font = `500 21px ${FONT_SANS}`;
      ctx.fillText(name, padX + 20, y + 39);

      // 双点对照轨（你猜金点 vs 真实红褐点）
      const tx = padX + 310;
      const tw = 290;
      const ty = y + 32;
      ctx.fillStyle = P.border;
      ctx.fillRect(tx, ty - 2, tw, 4);
      const ax = tx + (Math.max(0, Math.min(100, d.a)) / 100) * tw;
      const bx = tx + (Math.max(0, Math.min(100, d.b)) / 100) * tw;
      ctx.fillStyle = barTone;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(Math.min(ax, bx), ty - 3, Math.max(4, Math.abs(bx - ax)), 6);
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(ax, ty, 6, 0, Math.PI * 2); ctx.fillStyle = P.gold; ctx.fill();
      ctx.beginPath(); ctx.arc(bx, ty, 6, 0, Math.PI * 2); ctx.fillStyle = P.sin; ctx.fill();

      ctx.textAlign = 'right';
      ctx.fillStyle = barTone;
      ctx.font = `500 20px ${FONT_SERIF}`;
      ctx.fillText(`猜${Math.round(d.a)} / 真${Math.round(d.b)} · ${tag}`, padX + cw - 20, y + 39);

      y += 74;
    });
    y += 14;
  }

  const ecoList = (eco?.list || []).slice(0, isProjection ? 3 : 7);
  if (ecoList.length) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.faint;
    ctx.font = `400 18px ${FONT_SANS}`;
    ctx.letterSpacing = '3px';
    ctx.fillText(
      isProjection ? 'ECOLOGY FIT · 投射关系生态位前 3' : `RELATIONSHIP ECOLOGIES · ${eco.list.length} 大关系生态位排行`,
      padX, y,
    );
    ctx.letterSpacing = '0px';
    y += 28;

    ecoList.forEach((r, idx) => {
      const best = idx === 0;
      const rowH = isProjection ? 56 : 62;
      roundRect(ctx, padX, y, cw, rowH, 6);
      ctx.fillStyle = P.card;
      ctx.fill();
      ctx.strokeStyle = best ? P.goldSoft : P.border;
      ctx.lineWidth = best ? 1.5 : 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = best ? P.gold : P.text;
      ctx.font = `500 21px ${FONT_SERIF}`;
      ctx.fillText(`${best ? '★ ' : ''}${r.name}`, padX + 20, y + (rowH / 2 + 7));

      const barX = padX + 230;
      const barW = 540;
      const barY = y + rowH / 2;
      ctx.fillStyle = P.border;
      ctx.fillRect(barX, barY - 3, barW, 6);
      const frac = Math.max(0, Math.min(100, Number(r.value) || 0)) / 100;
      ctx.fillStyle = best ? P.gold : P.sub;
      ctx.fillRect(barX, barY - 3, barW * frac, 6);

      ctx.textAlign = 'right';
      ctx.fillStyle = best ? P.gold : P.text;
      ctx.font = `500 24px ${FONT_SERIF}`;
      ctx.fillText(String(Math.round(r.value)), padX + cw - 20, y + (rowH / 2 + 8));

      y += rowH + 10;
    });
    y += 14;
  }

  /* ---------- 底部双栏结论：共振亮点 vs 阴影/最大分叉 ---------- */
  const bottomRemain = height - 132 - y;
  if (bottomRemain >= 190) {
    const bw = (cw - 24) / 2;
    const bh = Math.min(280, bottomRemain);

    const resItems = (res.resonances || []).slice(0, 3).map((r) => `· ${r.title}`);
    if (!resItems.length && res.complement?.golden?.length) {
      res.complement.golden.slice(0, 3).forEach((g) => {
        resItems.push(`· ${dimMap?.[g.dim]?.name || g.dim}（差 ${Math.round(g.diff)}）`);
      });
    }
    if (!resItems.length) resItems.push('· 跨卷共振维度尚未完全解锁');

    const colItems = (res.collisions || []).slice(0, 3).map((c) => `· ${c.title}`);
    if (!colItems.length && res.topGaps?.length) {
      res.topGaps.slice(0, 3).forEach((g) => {
        colItems.push(`· ${dimMap?.[g.dim]?.name || g.dim}（相差 ${Math.round(g.diff)} 分）`);
      });
    }
    if (!colItems.length) colItems.push('· 暂未触发高危冲突闭环');

    [
      { x: padX, title: '同频与互补亮点', color: P.virtue, lines: resItems },
      { x: padX + bw + 24, title: '碰撞预警与最大分叉', color: P.sin, lines: colItems },
    ].forEach((b) => {
      roundRect(ctx, b.x, y, bw, bh, 8);
      ctx.fillStyle = P.card;
      ctx.fill();
      ctx.strokeStyle = P.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = b.color;
      ctx.font = `500 18px ${FONT_SANS}`;
      ctx.letterSpacing = '2px';
      ctx.fillText(b.title, b.x + 22, y + 40);
      ctx.letterSpacing = '0px';

      drawText(ctx, b.lines.join('\n'), b.x + 22, y + 82, {
        maxWidth: bw - 44,
        lineHeight: 36,
        font: `400 20px ${FONT_SANS}`,
        color: P.text,
        maxLines: 5,
      });
    });
  }

  return finishPosterFrame(canvas, ctx, { width, height, padX, P });
}

export async function exportComparePoster(payload, opts = {}) {
  const canvas = await drawComparePoster(payload, opts);
  return canvasToPngBlob(canvas);
}

export async function downloadComparePoster(payload, opts = {}) {
  const blob = await exportComparePoster(payload, opts);
  const tag = payload?.isProjection ? 'projection' : 'compare';
  const name = `human-atlas-${tag}-${Date.now()}.png`;
  downloadBlob(name, blob);
  return name;
}

/* ------------------------------------------------------------
   Markdown
   ------------------------------------------------------------ */

export function buildMarkdown(report, { nickname = '' } = {}) {
  const L = [];
  const arch = report.archetype?.best;
  const date = formatDate(Date.now());

  L.push(`# 人性全息图谱 · ${nickname || '未署名'}`);
  L.push('');
  L.push(`> 生成于 ${date} · 已完成 ${(report.completed || []).length}/${report.totalVolumes ?? 16} 卷 · 纯前端本地运算`);
  L.push('');

  if (arch) {
    L.push(`## ${arch.name}`);
    L.push('');
    L.push(`*${arch.latin}*`);
    L.push('');
    L.push(arch.verdict);
    L.push('');
    L.push(`关键词：${(arch.keywords || []).join(' · ')}`);
    L.push('');
  }

  L.push('## 核心仪表');
  L.push('');
  L.push('| 指标 | 数值 |');
  L.push('| --- | --- |');
  L.push(`| 光暗能量比 | ${computeLightDarkRatio(report)} |`);
  L.push(`| 社会面具厚度 | ${Number.isFinite(report.mask?.value) ? Math.round(report.mask.value) : '—'} |`);
  L.push(`| 完成卷宗 | ${(report.completed || []).length}/${report.totalVolumes ?? 16} |`);
  L.push('');

  if (report.values?.length) {
    L.push('## 核心价值排序');
    L.push('');
    report.values.forEach((v, i) => L.push(`${i + 1}. **${v.name}** — ${v.desc}`));
    L.push('');
  }

  if (report.gifts?.length) {
    L.push('## 王牌天赋');
    L.push('');
    report.gifts.forEach((g) => {
      L.push(`### ${g.gift_title}`);
      L.push('');
      L.push(`*维度：${g.name} · ${g.score}（${g.tier.name}）*`);
      L.push('');
      L.push(g.gift_desc);
      L.push('');
    });
  }

  if (report.shadows?.length) {
    L.push('## 阴影预警');
    L.push('');
    report.shadows.forEach((s) => {
      L.push(`### ${s.shadow_title}`);
      L.push('');
      L.push(`*维度：${s.name} · ${s.score}*`);
      L.push('');
      L.push(s.shadow_desc);
      L.push('');
      L.push(`**炼金处方：** ${s.alchemy_tip}`);
      L.push('');
    });
  }

  if (report.cross?.length) {
    L.push('## 跨卷读心');
    L.push('');
    report.cross.forEach((c) => {
      L.push(`### ${c.title} · ${c.tag}`);
      L.push('');
      L.push(c.insight);
      L.push('');
      L.push(`**行动建议：** ${c.advice}`);
      L.push('');
    });
  }

  if (report.dual) {
    L.push('## 顺境与高压双态');
    L.push('');
    L.push(`**顺境舒展态：** ${report.dual.flourish}`);
    L.push('');
    L.push(`**高压退行态：** ${report.dual.underPressure}`);
    L.push('');
    if (report.dual.style) {
      L.push(`**触发点：** ${report.dual.style.trigger}`);
      L.push('');
      L.push(`**刹车处方：** ${report.dual.style.brake}`);
      L.push('');
    }
  }

  if (report.manual) {
    L.push('## 人生使用说明书');
    L.push('');
    if (report.manual.occupation?.length) {
      L.push('### 最佳生态位');
      report.manual.occupation.forEach((t) => L.push(`- ${t}`));
      L.push('');
    }
    if (report.manual.partner?.length) {
      L.push('### 灵魂同频画像');
      report.manual.partner.forEach((t) => L.push(`- ${t}`));
      L.push('');
    }
    if (report.manual.toxic?.length) {
      L.push('### 绝对避雷');
      report.manual.toxic.forEach((t) => L.push(`- ${t}`));
      L.push('');
    }
    if (report.manual.actions?.length) {
      L.push('### 行动处方');
      report.manual.actions.forEach((t) => L.push(`- ${t}`));
      L.push('');
    }
  }

  if (report.dimRows?.length) {
    L.push('## 维度明细');
    L.push('');
    L.push('| 维度 | 分数 | 档位 |');
    L.push('| --- | --- | --- |');
    report.dimRows.forEach((r) => {
      L.push(`| ${r.name} | ${r.score} | ${r.tier.name} |`);
    });
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('*本报告由 The Human Atlas 于本地浏览器生成。所有原始作答均未离开你的设备。*');

  return L.join('\n');
}

/* ------------------------------------------------------------
   导出动作
   ------------------------------------------------------------ */

export async function downloadPoster(report, { long = false, theme = 'light', nickname = '' } = {}) {
  const blob = await exportPoster(report, { long, theme, nickname });
  const name = `human-atlas-${long ? 'full' : 'card'}-${Date.now()}.png`;
  downloadBlob(name, blob);
  return name;
}

export function downloadMarkdown(report, opts = {}) {
  const md = buildMarkdown(report, opts);
  const name = `human-atlas-${Date.now()}.md`;
  downloadText(name, md, 'text/markdown;charset=utf-8');
  return name;
}

export async function copyMarkdown(report, opts = {}) {
  const md = buildMarkdown(report, opts);
  const ok = await copyText(md);
  if (ok) toast('Markdown 报告已复制');
  else toast('复制失败，请改用下载');
  return ok;
}

/* ------------------------------------------------------------
   AI 深度精读密文（由 dossierCore.js 共享编译）
   把全维得分、Z 尖峰、面具三分量、以及「耗时最久 / 改选最多」的
   犹豫题原文与选项，拼成一段可直接粘给任意大模型的分析师 Prompt。
   ------------------------------------------------------------ */

/**
 * @param {Object} report   buildHolographicReport() 的产物（可带 dimRows）
 * @param {Object} opt      { nickname, answersByVolume, telemetry, volumes, mask, topValues }
 * @returns {string}
 */
export function buildAIPrompt(report, opt = {}) {
  return buildStructuredPrompt(report, opt);
}

export async function copyAIPrompt(report, opt = {}) {
  const text = buildAIPrompt(report, opt);
  const ok = await copyText(text);
  toast(ok ? 'AI 精读密文已复制，粘给任意大模型即可' : '复制失败，请改用下载');
  return ok;
}
