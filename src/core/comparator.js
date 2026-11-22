/* ============================================================
   comparator.js — 双人局部 / 全量契合度
   · 底层共振度（三观 + 光明/黑暗）
   · 性格互补度（大五 + 思维）
   · 阴影碰撞预警
   ============================================================ */

import { clamp, round, mean, sortBy } from './utils.js';
import { ALL_VOLUMES as VOLS } from './storage.js';

export function commonVolumes(a, b) {
  return VOLS.filter((v) => (a.completedVolumes || []).includes(v) && (b.completedVolumes || []).includes(v));
}

export function commonDims(a, b, DATA) {
  const vols = commonVolumes(a, b);
  const set = new Set();
  for (const v of vols) {
    const vol = DATA.volumes[v];
    for (const d of vol?.dimensions || []) set.add(d);
  }
  return Array.from(set).filter(
    (d) => Number.isFinite(a.computedScores?.[d]) && Number.isFinite(b.computedScores?.[d]),
  );
}

/** 底层共振度 R_sync = 100 − 平均绝对差 */
export function resonance(a, b, dims, DATA) {
  const core = dims.filter((d) => (DATA.pairRules.coreDims || []).includes(d));
  const list = core.length ? core : dims;
  if (!list.length) return null;
  const diffs = list.map((d) => Math.abs(a.computedScores[d] - b.computedScores[d]));
  return {
    value: round(100 - mean(diffs), 1),
    dims: list,
    meanDiff: round(mean(diffs), 1),
  };
}

/** 性格互补度：差异 20–45 视为黄金互补 */
export function complement(a, b, dims, DATA) {
  const list = dims.filter((d) => (DATA.pairRules.complementDims || []).includes(d));
  if (!list.length) return null;

  const rows = list.map((d) => {
    const diff = Math.abs(a.computedScores[d] - b.computedScores[d]);
    let score;
    if (diff < 12) score = 55 + diff * 1.4;          // 太像：缺张力
    else if (diff < 20) score = 72 + (diff - 12) * 2.6;
    else if (diff <= 45) score = 100 - (diff - 20) * 0.7; // 黄金互补区
    else score = 82 - (diff - 45) * 1.5;
    return { dim: d, diff: round(diff, 1), score: clamp(score, 0, 100) };
  });

  const value = mean(rows.map((r) => r.score));
  const golden = rows.filter((r) => r.diff >= 20 && r.diff <= 45);
  const twins = rows.filter((r) => r.diff < 12);
  return {
    value: round(value, 1),
    rows,
    golden: sortBy(golden, (r) => r.diff, -1),
    twins,
  };
}

/* ------------------------------------------------------------
   阴影碰撞
   ------------------------------------------------------------ */

function hit(rules, scores, mask) {
  return rules.every((c) => {
    const v = c.dim === 'mask' ? mask : scores[c.dim];
    if (!Number.isFinite(v)) return false;
    switch (c.op) {
      case '>=': return v >= c.val;
      case '>': return v > c.val;
      case '<=': return v <= c.val;
      case '<': return v < c.val;
      default: return false;
    }
  });
}

export function collisions(a, b, dims, DATA) {
  const rules = DATA.pairRules.collisions || [];
  const out = [];
  const aScores = a.computedScores || {};
  const bScores = b.computedScores || {};

  for (const r of rules) {
    const dimsUsed = [...r.a.map((c) => c.dim), ...r.b.map((c) => c.dim)];
    if (!dimsUsed.every((d) => dims.includes(d))) continue;

    const direct = hit(r.a, aScores, a.maskIndex) && hit(r.b, bScores, b.maskIndex);
    const reverse = hit(r.b, aScores, a.maskIndex) && hit(r.a, bScores, b.maskIndex);
    if (!direct && !reverse) continue;
    out.push({ ...r, reversed: !direct && reverse });
  }
  return sortBy(out, (r) => ({ high: 0, mid: 1, low: 2 }[r.severity] ?? 3), 1);
}

export function resonances(a, b, dims, DATA) {
  const rules = DATA.pairRules.resonance || [];
  const out = [];
  const aS = a.computedScores || {};
  const bS = b.computedScores || {};

  for (const r of rules) {
    if (!r.dims.every((d) => dims.includes(d))) continue;
    let ok = true;
    for (const d of r.dims) {
      const av = aS[d];
      const bv = bS[d];
      if (!Number.isFinite(av) || !Number.isFinite(bv)) { ok = false; break; }
      if (r.op === 'bothHigh') {
        if (!(av >= r.threshold && bv >= r.threshold)) { ok = false; break; }
      } else if (r.op === 'bothLow') {
        if (!(av <= r.threshold && bv <= r.threshold)) { ok = false; break; }
      } else if (r.op === 'gapSmall') {
        if (Math.abs(av - bv) > (r.threshold || 15)) { ok = false; break; }
      }
    }
    if (ok) out.push(r);
  }
  return out;
}

/* ------------------------------------------------------------
   综合契合度
   ------------------------------------------------------------ */

export function compareStates(a, b, DATA) {
  const common = commonVolumes(a, b);
  const dims = commonDims(a, b, DATA);

  if (!common.length || !dims.length) {
    return {
      ok: false,
      common,
      dims,
      reason: common.length
        ? '双方共同完成的卷宗里，还没有可比较的维度。'
        : '你们还没有共同完成任何一卷，暂时无法计算契合度。',
    };
  }

  const res = resonance(a, b, dims, DATA);
  const comp = complement(a, b, dims, DATA);
  const coll = collisions(a, b, dims, DATA);
  const reson = resonances(a, b, dims, DATA);

  const sync = res?.value ?? 50;
  const tension = comp?.value ?? 50;
  let overall = sync * 0.58 + tension * 0.42;

  // 高严重度碰撞扣分，但不至于归零（冲突本身就是关系的一部分）
  const highHits = coll.filter((c) => c.severity === 'high').length;
  const midHits = coll.filter((c) => c.severity === 'mid').length;
  const penalty = Math.min(20, highHits * 5.5 + midHits * 2.5);
  overall = clamp(overall - penalty, 20, 100);

  const grade = overall >= 84
    ? { id: 'S', name: '深度共振', desc: '你们的核心价值与节奏高度接近，同时保留了足够的性格张力。' }
    : overall >= 72
      ? { id: 'A', name: '稳固互补', desc: '有共同的地基，也有彼此没有的部分；多数分歧可以靠沟通穿过。' }
      : overall >= 60
        ? { id: 'B', name: '需要校准', desc: '基础是好的，但有几处结构性的差异，需要明确的规则来承接。' }
        : { id: 'C', name: '张力偏高', desc: '你们的核心逻辑差异明显，靠近需要更多耐心与更少的假设。' };

  // 维度对照表
  const rows = sortBy(
    dims.map((d) => {
      const av = a.computedScores[d];
      const bv = b.computedScores[d];
      return { dim: d, a: av, b: bv, diff: round(Math.abs(av - bv), 1) };
    }),
    (r) => r.diff,
    -1,
  );

  return {
    ok: true,
    common,
    dims,
    sync: res,
    complement: comp,
    collisions: coll,
    resonances: reson,
    overall: round(overall, 1),
    grade,
    topGaps: rows.slice(0, 5),
    topMatches: rows.slice(-5).reverse(),
    rows,
    maskGap: Number.isFinite(a.maskIndex) && Number.isFinite(b.maskIndex)
      ? round(Math.abs(a.maskIndex - b.maskIndex), 1)
      : null,
  };
}

/** 判定昵称展示 */
export function displayName(state, fallback = '这位朋友') {
  return (state?.nickname || '').trim() || fallback;
}
