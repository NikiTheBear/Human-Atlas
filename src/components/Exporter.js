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
   海报绘制
   ------------------------------------------------------------ */

export async function drawPoster(report, {
  width = 1080,
  height = 1920,
  theme = 'light',
  long = false,
  nickname = '',
} = {}) {
  const P = PALETTE[theme] || PALETTE.light;

  // iOS Safari 对单张 canvas 有硬上限（约 4096×4096 或 1677 万像素，
  // 超出后 toDataURL 直接返回空字符串 → 白图）。
  // 1080×2800 @2x = 2160×5600 = 1210 万像素，高度 5600 已经越过 4096。
  // 这里按「最长边 ≤ 4096 且总面积 ≤ 1600 万」动态降 DPR。
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

  // 背景
  ctx.fillStyle = P.page;
  ctx.fillRect(0, 0, width, height);

  // 顶部柔和渐层
  const grad = ctx.createRadialGradient(width * 0.88, 40, 0, width * 0.88, 40, width * 0.9);
  grad.addColorStop(0, theme === 'dark' ? 'rgba(201,169,110,0.10)' : 'rgba(168,137,79,0.09)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height * 0.55);

  const padX = long ? 92 : 84;
  const cw = width - padX * 2;

  let y = long ? 96 : 104;

  /* ---------- 页眉 ---------- */
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

  /* ---------- 双线藏书票边框（Ex-Libris） ---------- */
  // 外框细线 + 内框更细的金线，四角留出小缺口，做出印刷品的装帧感
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

  // 四角的短角标
  const corner = 22;
  ctx.strokeStyle = P.gold;
  ctx.lineWidth = 1.6;
  const cx0 = exOuter;
  const cy0 = exOuter;
  const cx1 = width - exOuter;
  const cy1 = height - exOuter;
  [[cx0, cy0, 1, 1], [cx1, cy0, -1, 1], [cx0, cy1, 1, -1], [cx1, cy1, -1, -1]].forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x + sx * corner, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * corner);
    ctx.stroke();
  });
  ctx.restore();

  return canvas;
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
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png', 1);
  });
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
