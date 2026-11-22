/* ============================================================
   telemetry.js — 静默作答遥测：耗时 / 改选 / 阅读基线
   全程不向用户暴露"被监控"的任何提示。
   ============================================================ */

import { median, clamp } from './utils.js';

/** 每题的遥测记录存在 state.telemetry[qid] = { ms, changes, first, ts } */
export function ensureTelemetry(state) {
  if (!state.telemetry || typeof state.telemetry !== 'object') state.telemetry = {};
  return state.telemetry;
}

/**
 * 脏样本阈值（v4.4 改为动态）
 *
 * 旧实现一刀切 25000ms。但 160–220 字的长题，正常逐字阅读就要 18–22 秒，
 * 真正犹豫、反复权衡的人很容易到 30–40 秒 —— 这些恰恰是最有价值的 H_lat 样本，
 * 却会被当成「切屏发呆」丢掉，导致面具厚度里的「犹豫修饰度」常年偏低。
 *
 * 现在按题面长度给阈值：
 *   · 筹码 / 金字塔（拖滑块、反复排序）  → 120s
 *   · 其余题型                            → max(55s, 字数 × 480ms)
 * 160 字 → 76.8s，220 字 → 105.6s。
 *
 * DIRTY_MS 保留为「绝对下限」，任何题都不会低于它。
 */
export const DIRTY_MS = 55000;
export const DIRTY_CEILING_MS = 120000;
export const HIDDEN_MS = 1200;   // 单次切屏超过 1.2s 才计入扣除

/** 单题的发呆阈值（毫秒）。需在 questionChars 定义之后调用，故用函数声明提升。 */
export function dirtyLimitOf(q) {
  if (!q) return DIRTY_MS;
  if (q.type === 'budget_100' || q.type === 'pyramid_top3') return DIRTY_CEILING_MS;
  const chars = questionChars(q);
  return Math.min(DIRTY_CEILING_MS, Math.max(DIRTY_MS, chars * 480));
}

export function recordAnswer(state, {
  questionId,
  question = null,
  ms = 0,
  changes = 0,
  readMs = 0,
  hiddenMs = 0,
}) {
  const t = ensureTelemetry(state);
  const prev = t[questionId] || {};
  const net = Math.max(0, Math.round(ms));
  const limit = dirtyLimitOf(question);
  t[questionId] = {
    ms: net,
    readMs: Math.max(0, Math.round(readMs || net)),
    hiddenMs: Math.max(0, Math.round(hiddenMs || prev.hiddenMs || 0)),
    changes: Math.max(prev.changes || 0, Math.round(changes)),
    // 净耗时超过该题的动态上限 ⇒ 脏样本，剔出阅读基线与犹豫分
    dirty: net > limit,
    limitMs: Math.round(limit),
    ts: Date.now(),
  };
  return t[questionId];
}

/**
 * 切屏 / 失焦计时器
 * 用法：const timer = createFocusTimer();
 *       ...用户作答...
 *       timer.net()  → 扣掉切屏与失焦后的净毫秒
 *       timer.hidden() → 累计被隐藏的毫秒
 */
export function createFocusTimer() {
  const startedAt = Date.now();
  let hiddenAcc = 0;
  let hiddenSince = 0;

  const isHidden = () => typeof document !== 'undefined'
    && (document.visibilityState === 'hidden' || (typeof document.hasFocus === 'function' && !document.hasFocus()));

  let hidden = isHidden();
  if (hidden) hiddenSince = startedAt;

  const onChange = () => {
    const now = isHidden();
    if (now && !hidden) {
      hidden = true;
      hiddenSince = Date.now();
    } else if (!now && hidden) {
      hidden = false;
      if (hiddenSince && Date.now() - hiddenSince > HIDDEN_MS) {
        hiddenAcc += Date.now() - hiddenSince;
      }
      hiddenSince = 0;
    }
  };

  const listeners = [];
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onChange);
    listeners.push(['visibilitychange', onChange]);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('blur', onChange);
    window.addEventListener('focus', onChange);
    listeners.push(['blur', onChange], ['focus', onChange]);
  }

  const settle = () => {
    if (hidden && hiddenSince && Date.now() - hiddenSince > HIDDEN_MS) {
      return hiddenAcc + (Date.now() - hiddenSince);
    }
    return hiddenAcc;
  };

  return {
    net() {
      return Math.max(0, Date.now() - startedAt - settle());
    },
    hidden() {
      return settle();
    },
    dispose() {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onChange);
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', onChange);
        window.removeEventListener('focus', onChange);
      }
      listeners.length = 0;
    },
  };
}

export function addChange(state, questionId) {
  const t = ensureTelemetry(state);
  if (!t[questionId]) t[questionId] = { ms: 0, readMs: 0, changes: 0, ts: Date.now() };
  t[questionId].changes = (t[questionId].changes || 0) + 1;
  return t[questionId].changes;
}

export function getTelemetry(state, questionId) {
  return state.telemetry?.[questionId] || { ms: 0, readMs: 0, changes: 0 };
}

/**
 * 个人阅读基线：中位阅读速度（毫秒 / 字）
 * 只采纳"已作答且时长合理"的样本，避免首题、切后台导致基线失真。
 */
export function readingBaseline(state, questions = []) {
  const samples = [];
  for (const q of questions) {
    const rec = state.telemetry?.[q.id];
    if (!rec || !rec.ms) continue;
    if (rec.dirty) continue;          // 切屏/发呆样本不进基线
    if (rec.ms < 600) continue;
    // 用该题自己的动态上限做二次校验，兼容旧存档里没有 limitMs 的记录
    if (rec.ms > dirtyLimitOf(q)) continue;
    const chars = questionChars(q);
    if (chars < 20) continue;
    samples.push(rec.ms / chars);
  }
  const v = median(samples);
  // 合理区间夹逼：0.08s/字（极快）~ 0.60s/字（很慢）
  return samples.length >= 3 ? clamp(v, 80, 600) : clamp(v || 260, 80, 600);
}

/** 题干 + 上下文 + 全部选项的字数 */
export function questionChars(q) {
  let n = (q.prompt || '').replace(/\s/g, '').length;
  n += (q.context || '').replace(/\s/g, '').length;
  if (Array.isArray(q.options)) {
    for (const o of q.options) n += (o.text || '').replace(/\s/g, '').length;
  }
  if (q.scale) {
    n += (q.scale.left || '').length + (q.scale.right || '').length;
  }
  if (Array.isArray(q.items)) {
    for (const it of q.items) n += (it.label || '').length;
  }
  if (Array.isArray(q.values)) {
    // v4.4 修复：q.values 是 {key,label,effects} 对象数组，
    // 旧实现 join('') 会得到 "[object Object][object Object]…"，
    // 把字数算成上百，进而把发呆阈值和阅读基线一起带偏。
    for (const v of q.values) {
      const t = typeof v === 'string' ? v : (v?.label || '');
      n += t.replace(/\s/g, '').length;
    }
  }
  return Math.max(12, n);
}

/** 长题干（>45 字）且 <1200ms ⇒ 盲选低信度 */
export function isBlindPick(q, rec) {
  if (!rec || !rec.ms) return false;
  const chars = questionChars(q);
  if (chars <= 45) return false;
  return rec.ms < 1200;
}

/**
 * 高修饰犹豫捕捉：在"暗面 / 利益博弈 / 敏感"题目上，
 * 耗时超过 2.2 倍个人期望且最终落在高社会赞许选项。
 */
export function hesitationScore(q, rec, baseline, chosenOption) {
  if (!rec || !rec.ms || !q.is_sensitive) return 0;
  const chars = questionChars(q);
  const expected = Math.max(400, baseline * chars);
  const ratio = rec.ms / expected;
  const changes = rec.changes || 0;

  const sdValue = Number(chosenOption?.social_desirability ?? 0);
  const highSd = sdValue >= 2 || sdValue >= 1.5;

  if (!highSd) return 0;
  if (ratio <= 2.2 && changes < 2) return 0;

  const over = Math.max(0, ratio - 1);
  const raw = over + 0.35 * changes;
  return Math.min(1.5, Math.max(0.15, raw));
}

/** 单卷遥测摘要（用于报告页脚的可信度小字） */
export function volumeTelemetrySummary(state, volume) {
  const qs = volume.questions || [];
  let total = 0;
  let quick = 0;
  let changed = 0;
  let sensCount = 0;
  for (const q of qs) {
    const rec = getTelemetry(state, q.id);
    if (!rec.ms) continue;
    total += 1;
    if (isBlindPick(q, rec)) quick += 1;
    if (rec.changes > 0) changed += 1;
    if (q.is_sensitive) sensCount += 1;
  }
  return {
    answered: total,
    blind: quick,
    changed,
    sensitive: sensCount,
    avgMs: total ? Math.round(qs.reduce((a, q) => a + (getTelemetry(state, q.id).ms || 0), 0) / total) : 0,
    reliability: total ? clamp(1 - (quick / total) * 0.75, 0, 1) : 1,
  };
}
