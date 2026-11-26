/* ============================================================
   scoring.js — 全局池加权归一化 / Z 尖峰 / 面具厚度 M / 四档分级

   v4.2 修复要点（对应审计清单）：
     BUG-01  单选/多选题里「只在部分选项出现的维度」被整题跳过
             → 现在先用 getQuestionDims() 收集该题【全部】合法维度，
               未选中选项视为贡献 0，正常计入低分，不再漏算或虚高到 100。
     BUG-02  pyramid_top3 对只在 1–2 张卡出现的维度返回 NaN
             → questionRange 补齐 0 参与三顺位极值计算。
     BUG-03  budget_100 负增益区间反了被丢弃；线性映射把「远高于均值」
             的分配算成低分
             → 改用相对均值居中映射 scoreBudgetItem()。
     BUG-04  先按卷求分再算术平均，导致附加题稀释主测题
             → 改为全局池单次遍历，并按 (hi-lo) 振幅加权。
   新增：个人内部相对尖峰 Z_d，用于打破「中庸魔咒」。

   v4.2.2 追加修复：
     · 区间中心改为「该题选项上的期望值」，消除「只在一个选项出现」
       的维度被系统性压到 30 分的问题。
     · budget_100 同维多滑块合并计分（v10_q15 / v16_q15），
       基准取 100×k/N 而非 100/N，避免倾注点数被摊薄。
     · 筹码题统一 base:0 / gain:1，反向语义用显式 reverse:true 表达。
   ============================================================ */

import { clamp, round, mean } from './utils.js';
import { readingBaseline, getTelemetry, isBlindPick, questionChars } from './telemetry.js';

export const TYPE_WEIGHT = {
  forced_choice: 1.4,
  impulse_3s: 1.2,
  stealth_scale: 0.85,
  budget_100: 1.3,
  pyramid_top3: 1.3,
};

export const TIERS = [
  { id: 1, min: 80, max: 100, name: '极显锋芒', sub: '核心主导态' },
  { id: 2, min: 60, max: 80, name: '清晰倾向', sub: '稳定显性态' },
  { id: 3, min: 40, max: 60, name: '弹性灰度', sub: '情境平衡态' },
  { id: 4, min: 0, max: 40, name: '反向深潜', sub: '低分特质态' },
];

export const MASK_TIERS = [
  { id: 'low', max: 30, name: '本真赤诚层', desc: '表里高度一致，极少为了迎合他人而扭曲自我表达。' },
  { id: 'mid', max: 60, name: '体面调节层', desc: '具备成熟的社交分寸感，能自如切换职场外衣与私下本我。' },
  { id: 'high', max: 101, name: '精密防卫层', desc: '对外展示极度克制得体的形象，内心却压抑着强烈反差张力。' },
];

export function tierOf(score) {
  const s = clamp(score, 0, 100);
  if (s >= 80) return TIERS[0];
  if (s >= 60) return TIERS[1];
  if (s >= 40) return TIERS[2];
  return TIERS[3];
}

export function maskTierOf(m) {
  const v = clamp(m ?? 0, 0, 100);
  return MASK_TIERS.find((t) => v < t.max) || MASK_TIERS[MASK_TIERS.length - 1];
}

/* ------------------------------------------------------------
   1. 该题可能影响到的全部维度（含未选中的选项）
   ------------------------------------------------------------ */

export function getQuestionDims(q, validDimSet) {
  const dims = new Set();
  const add = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      // 白名单过滤：任何拼错的键（如历史遗留的 fw_open）在这里被静默剔除
      if (!validDimSet || validDimSet.has(k)) dims.add(k);
    }
  };

  if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
    for (const opt of q.options || []) add(opt.effects);
  } else if (q.type === 'stealth_scale') {
    add(q.effects);
  } else if (q.type === 'budget_100') {
    for (const item of q.items || []) {
      if (item.dim && (!validDimSet || validDimSet.has(item.dim))) dims.add(item.dim);
      add(item.effects);
    }
  } else if (q.type === 'pyramid_top3') {
    for (const v of q.values || []) add(v.effects);
  }
  return Array.from(dims);
}

/* ------------------------------------------------------------
   2. 把作答翻译为维度原始贡献
   ------------------------------------------------------------ */

export function answerContributions(q, value) {
  const out = {};
  if (value === undefined || value === null) return out;

  if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
    const opt = (q.options || []).find((o) => o.key === value);
    if (!opt) return out;
    for (const [d, v] of Object.entries(opt.effects || {})) out[d] = (out[d] || 0) + Number(v || 0);
    return out;
  }

  if (q.type === 'stealth_scale') {
    const n = clamp(Number(value) || 4, 1, 7);
    const t = (n - 1) / 6;
    for (const [d, range] of Object.entries(q.effects || {})) {
      if (Array.isArray(range)) {
        out[d] = (Number(range[0]) || 0) + ((Number(range[1]) || 0) - (Number(range[0]) || 0)) * t;
      } else if (typeof range === 'object' && range) {
        const lo = Number(range.low) || 0;
        const hi = Number(range.high) || 0;
        out[d] = lo + (hi - lo) * t;
      } else {
        out[d] = Number(range) || 0;
      }
    }
    return out;
  }

  if (q.type === 'pyramid_top3') {
    const ranks = Array.isArray(value) ? value : [];
    const rankWeights = [3, 2, 1];
    ranks.slice(0, 3).forEach((key, i) => {
      const item = (q.values || []).find((v) => v.key === key);
      if (!item) return;
      const rw = rankWeights[i] ?? 1;
      for (const [d, v] of Object.entries(item.effects || {})) {
        out[d] = (out[d] || 0) + Number(v || 0) * rw;
      }
    });
    return out;
  }

  // budget_100 由 scoreBudgetItem 专门处理，不在这里折算
  return out;
}

/* ------------------------------------------------------------
   3. 单题在维度 d 上的真实 [min, max]
   ------------------------------------------------------------ */

/**
 * 单题在某维度上的作答区间。
 *
 * v4.2.1 关键修正 —— 「期望值居中」：
 *   BUG-01 的修复让未出现在所选选项里的维度按 0 计分，
 *   但如果区间仍用 [min, max] 的中位数做中心，会产生系统性偏差：
 *   某维度只在 4 个选项中的 1 个出现（+2），区间 [0,2]，中点 1。
 *   于是「没选那一个」= 0 → centered = -1（满分反方向），
 *   「选了那一个」= +2 → centered = +1。
 *   均匀作答时该维度的期望值是 0.25×(+1) + 0.75×(−1) = −0.5，
 *   即整卷所有「只在一个选项出现」的维度都会被系统性压到 30 分附近。
 *
 *   修法：把中心从「区间中点」改成「选项上的期望值」，
 *   半程取「离中心最远那个可达值」的距离。
 *   上面这个例子变成 中心 0.5、半程 1.5：
 *     选 A → (2−0.5)/1.5 = +1（强正向证据）
 *     选 B → (0−0.5)/1.5 = −0.33（轻微反向证据）
 *   这才是「没提这件事」应有的分量——它不该等于强烈否认。
 *
 *   振幅 (hi − lo) 仍然用于加权，所以主测题（振幅 4.0）
 *   照旧压过附加题（振幅 0.8），BUG-04 的修复不受影响。
 */
export function questionRange(q, dim) {
  if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
    const vals = (q.options || []).map((o) => Number(o.effects?.[dim] ?? 0));
    if (!vals.length) return null;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    if (!(hi > lo)) return null;
    const expected = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { lo, hi, center: expected };
  }

  if (q.type === 'stealth_scale') {
    const r = q.effects?.[dim];
    let a = null;
    let b = null;
    if (Array.isArray(r) && r.length >= 2) {
      a = Number(r[0]) || 0;
      b = Number(r[1]) || 0;
    } else if (r && typeof r === 'object') {
      a = Number(r.low) || 0;
      b = Number(r.high) || 0;
    }
    if (a === null || a === b) return null;
    // 量表是连续作答，期望值就是两端均值
    return { lo: Math.min(a, b), hi: Math.max(a, b), center: (a + b) / 2 };
  }

  if (q.type === 'pyramid_top3') {
    // 所有卡片都参与（缺失按 0），彻底消灭 undefined → NaN
    const vals = (q.values || []).map((v) => Number(v.effects?.[dim] ?? 0));
    if (vals.length < 3 || vals.every((v) => v === 0)) return null;
    const desc = [...vals].sort((a, b) => b - a);
    const asc = [...vals].sort((a, b) => a - b);
    const hi = 3 * desc[0] + 2 * desc[1] + 1 * desc[2];
    const lo = 3 * asc[0] + 2 * asc[1] + 1 * asc[2];
    if (!(hi > lo)) return null;
    // 随机排前三时，每个排位上的期望值都等于卡片均值 → 期望总分 = 6 × 均值
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { lo, hi, center: 6 * m };
  }

  if (q.type === 'budget_100') {
    // 筹码题走相对均值映射，直接产出 [-1, +1]，这里给一个哨兵区间
    return { lo: -1, hi: 1, center: 0 };
  }

  return null;
}

/* ------------------------------------------------------------
   4. 筹码题：相对均值居中映射
   6 项平均分 100/6 ≈ 16.7 点视为中性（0 分 → 50 分），
   投入达到 2.2 倍均值（≈36.7 点）即视为极强倾向（+1 → 100 分）。
   ------------------------------------------------------------ */

export function scoreBudgetItem(pts, itemCount, polarity = 1, expectedPts = null) {
  const n = Math.max(2, itemCount || 6);
  // v4.2.2：同维多滑块合并后，基准不再是 100/N，而是 100×k/N。
  // 由调用方通过 expectedPts 传进来；不传时退回均分基准。
  const expected = Number.isFinite(expectedPts) ? expectedPts : 100 / n;
  // 锚点取 2.2 倍基准：
  //   6 项均分时基准 16.7，锚点 36.7 —— 倾注 25 点 → 71 分（明显偏高但不封顶），
  //   倾注 37 点 → 100 分。锚点抬到 2.5 会把 25 点压到 67，反而更接近「压扁」，
  //   与本次整改的目标相反，所以保留 2.2。
  //   同维多滑块合并后（k>1）基准是 100×k/N，锚点自然抬到 100，不受影响。
  const highAnchor = Math.min(100, expected * 2.2);

  let centered;
  if (pts <= expected) {
    // 0 点不判死刑，留 0.85 的温和底线
    centered = -0.85 * (1 - pts / expected);
  } else {
    centered = Math.min(1, (pts - expected) / Math.max(1e-6, highAnchor - expected));
  }
  return clamp(centered * (polarity < 0 ? -1 : 1), -1, 1);
}

/* ------------------------------------------------------------
   5. 全局池加权算分（不再逐卷求平均）
   ------------------------------------------------------------ */

export function scorePool(state, questions, opts = {}) {
  const validDimSet = opts.validDimSet || null;
  const dimHomeMap = opts.dimHomeMap || null;
  // 跨卷副权重总量上限（相对于所属主卷证据分母）：防止无关卷大水漫灌稀释主测维度
  const maxAuxRatio = opts.maxAuxRatio === undefined ? 0.35 : Number(opts.maxAuxRatio);
  /**
   * 证据收缩的先验权重。
   * 默认 1.2：只被 1–2 题测到的维度向 50 拉，避免「答对一次就满分」。
   * 传 0 则关闭收缩 —— 镜像撕裂度（mirrorTear）必须关掉，
   * 因为它比的是「同一维度在明线 / 暗线上的差值」，
   * 两侧如果都被拉向 50，差值会被系统性压小，G_mirror 永远偏低。
   */
  const priorW = opts.priorW === undefined ? 1.2 : Number(opts.priorW);
  const homeNum = {};
  const homeDen = {};
  const auxNum = {};
  const auxDen = {};
  const counts = {};

  const addEvidence = (d, qVol, w, val) => {
    if (!(w > 0)) return;
    const homeVol = dimHomeMap?.[d];
    if (!homeVol || homeVol === qVol) {
      homeNum[d] = (homeNum[d] || 0) + w * val;
      homeDen[d] = (homeDen[d] || 0) + w;
    } else {
      auxNum[d] = (auxNum[d] || 0) + w * val;
      auxDen[d] = (auxDen[d] || 0) + w;
    }
    counts[d] = (counts[d] || 0) + 1;
  };

  for (const q of questions) {
    const qVol = q.volume_id ?? q.volumeId;
    const ans = state.answersByVolume?.[qVol];
    const rec = ans?.[q.id];
    if (!rec || rec.draft || rec.value === undefined || rec.value === null) continue;
    const value = rec.value;

    const tele = state.telemetry?.[q.id];
    const baseW = Number(q.weight) || TYPE_WEIGHT[q.type] || 1;
    const qWeight = isBlindPick(q, tele) ? baseW * 0.4 : baseW;

    // ---- 筹码题 ----
    // v4.2.2：同一维度可能有多个滑块（v10_q15 有 3 项都指 dd_order，
    // v16_q15 有 2 项指 hsp_sensory）。旧实现逐项独立映射，
    // 每项都按 100/N 作基准 → 该维度的实际可投入点数是 3 倍，
    // 却在按 1 倍基准打分，于是被系统性压扁。
    // 现在先按 dim 聚合：合并点数 + 合并期望值，再统一映射。
    if (q.type === 'budget_100') {
      const items = q.items || [];
      const map = typeof value === 'object' ? value : {};
      const N = Math.max(2, items.length);

      // 1) 按 dim 分组
      //    注意：没有 item.dim 但有 item.effects 的项也要参与（只贡献联动维度）
      const groups = new Map();
      const effectOnly = [];   // { effects, weightBaseline }
      for (const item of items) {
        if (!item.dim) {
          if (item.effects && Object.keys(item.effects).length) effectOnly.push(item);
          continue;
        }
        if (validDimSet && !validDimSet.has(item.dim)) {
          if (item.effects && Object.keys(item.effects).length) effectOnly.push(item);
          continue;
        }
        let g = groups.get(item.dim);
        if (!g) {
          g = {
            dim: item.dim,
            keys: [],
            effects: {},
            polarity: 1,
          };
          groups.set(item.dim, g);
        }
        g.keys.push(item.key);
        // 极性：显式 reverse/polarity 优先，其次 gain 符号
        if (item.reverse === true || item.polarity === -1) g.polarity = -1;
        else if (item.polarity === 1) g.polarity = 1;
        else if (Number(item.gain) < 0) g.polarity = -1;
        // 附带维度取该组内的最大幅值，避免同维多滑块把联动维度重复计权
        for (const [d, f] of Object.entries(item.effects || {})) {
          if (validDimSet && !validDimSet.has(d)) continue;
          const factor = Number(f) || 0;
          if (Math.abs(factor) > Math.abs(g.effects[d] || 0)) g.effects[d] = factor;
        }
      }

      // 2) 逐组打分
      const effW = qWeight * 1.3;
      for (const g of groups.values()) {
        const pts = g.keys.reduce((a, k) => a + Number(map[k] ?? 0), 0);
        const expected = (100 * g.keys.length) / N;
        const centered = scoreBudgetItem(pts, N, g.polarity, expected);

        addEvidence(g.dim, qVol, effW, centered);

        // 附带维度联动：以「相对均值的偏离」为强度，避免被基准值污染
        for (const [d, f] of Object.entries(g.effects)) {
          const factor = Number(f) || 0;
          if (!factor) continue;
          addEvidence(d, qVol, effW * Math.abs(factor), centered * (factor < 0 ? -1 : 1));
        }
      }

      // 2b) 只贡献联动维度、本身没有 dim 的滑块
      //     它们仍占用了用户的点数，强度按「该滑块点数相对均值的偏离」计算。
      for (const item of effectOnly) {
        const pts = Number(map[item.key] ?? 0);
        const centered = scoreBudgetItem(pts, N, 1, 100 / N);
        for (const [d, f] of Object.entries(item.effects || {})) {
          if (validDimSet && !validDimSet.has(d)) continue;
          const factor = Number(f) || 0;
          if (!factor) continue;
          addEvidence(d, qVol, effW * Math.abs(factor), centered * (factor < 0 ? -1 : 1));
        }
      }
      continue;
    }

    // ---- 常规题型 ----
    const contrib = answerContributions(q, value);
    const dims = getQuestionDims(q, validDimSet);

    for (const d of dims) {
      const range = questionRange(q, d);
      if (!range) continue;
      const { lo, hi } = range;
      if (!(hi > lo)) continue;

      // 中心 = 该题选项上的期望值；半程 = 离中心最远的可达距离
      const center = Number.isFinite(range.center) ? range.center : (hi + lo) / 2;
      const half = Math.max(center - lo, hi - center) || (hi - lo) / 2;
      const raw = Number(contrib[d] ?? 0);
      const centered = clamp((raw - center) / half, -1, 1);

      // 振幅加权：主测题（振幅 4.0）自然压过附加题（振幅 0.8）
      const dimWeight = qWeight * clamp(hi - lo, 0.4, 4);

      addEvidence(d, qVol, dimWeight, centered);
    }
  }

  // ---- 证据收缩（shrinkage）+ 主卷保护 ----
  // 只被 1–2 道题测到的维度，不该仅凭一次极端作答就宣称 100 分或 0 分。
  // 同时当主卷作答存在时，将跨卷副权重总量限制在主卷的 maxAuxRatio 倍以内。
  const PRIOR_W = Math.max(0, priorW);
  const scores = {};
  const evidence = {};
  const allDims = new Set([...Object.keys(homeDen), ...Object.keys(auxDen)]);
  for (const d of allDims) {
    const hD = homeDen[d] || 0;
    const hN = homeNum[d] || 0;
    const aD = auxDen[d] || 0;
    const aN = auxNum[d] || 0;

    let effNum = hN;
    let effDen = hD;
    if (hD > 0 && aD > 0) {
      const scale = Math.min(1, (hD * maxAuxRatio) / aD);
      effNum += aN * scale;
      effDen += aD * scale;
    } else if (hD === 0 && aD > 0) {
      effNum = aN;
      effDen = aD;
    }

    if (effDen <= 0) continue;
    const n = effNum / (effDen + PRIOR_W);
    scores[d] = clamp(round(50 + 50 * n, 1), 0, 100);
    // 证据强度：0–1，用于报告页标注可信度
    evidence[d] = round(effDen / (effDen + PRIOR_W), 2);
  }

  // ---- 个人内部相对尖峰 Z_d ----
  const vals = Object.values(scores);
  const avg = vals.length ? mean(vals) : 50;
  const variance = vals.length
    ? vals.reduce((a, v) => a + (v - avg) ** 2, 0) / vals.length
    : 0;
  const std = Math.max(6, Math.sqrt(variance));

  const zScores = {};
  for (const [d, s] of Object.entries(scores)) {
    zScores[d] = round((s - avg) / std, 2);
  }

  return { scores, zScores, counts, evidence, mean: round(avg, 1), std: round(std, 1) };
}

/* ------------------------------------------------------------
   6. 某卷的全部题
   ------------------------------------------------------------ */

export function questionsOfVolume(DATA, volId) {
  const v = DATA.volumes[volId];
  if (!v) return [];
  return (v.questions || []).map((q) => ({
    ...q,
    volumeId: volId,
    volume_id: v.volume_id || volId,
  }));
}

export function allQuestions(DATA) {
  const out = [];
  for (const volId of Object.keys(DATA.volumes)) out.push(...questionsOfVolume(DATA, volId));
  return out;
}

/** 单卷计分（报告页局部用，逻辑与全局池一致） */
export function scoreQuestions(state, questions, validDimSet) {
  return scorePool(state, questions, { validDimSet });
}

/**
 * 分层计分：表显层（明线自评）vs 暗线层（stealth / 高压投射）。
 */
export function layeredScores(state, DATA) {
  const valid = new Set(DATA.dimOrder);
  const all = allQuestions(DATA);

  const surface = scorePool(state, all.filter((q) => q.layer !== 'stealth'), { validDimSet: valid }).scores;
  const depth = scorePool(state, all.filter((q) => q.layer === 'stealth'), { validDimSet: valid }).scores;

  const keys = Object.keys(surface).filter((d) => Number.isFinite(depth[d]));
  if (!keys.length) return { keys: [], surface, depth, gMirror: null };

  const gMirror = mean(keys.map((d) => Math.abs(surface[d] - depth[d])));
  return { keys, surface, depth, gMirror: round(gMirror, 1) };
}

export function answeredQuestions(state, DATA, volId) {
  const v = DATA.volumes[volId];
  if (!v) return { questions: [], answered: [] };
  const list = questionsOfVolume(DATA, volId);
  const ans = state.answersByVolume?.[volId] || {};
  return {
    questions: list,
    answered: list.filter((q) => {
      const rec = ans[q.id];
      return Boolean(rec && !rec.draft && rec.value !== undefined && rec.value !== null);
    }),
  };
}

/* ------------------------------------------------------------
   面具厚度 M
   ------------------------------------------------------------ */

/** 1) 社会期许偏移率 D_sd */
export function socialDesirabilityIndex(state, questions) {
  const vals = [];
  for (const q of questions) {
    const rec = state.answersByVolume?.[q.volume_id ?? q.volumeId]?.[q.id];
    if (!rec || rec.draft || rec.value === undefined || rec.value === null) continue;
    const ans = rec.value;

    if (Array.isArray(q.options)) {
      const sds = q.options.map((o) => Number(o.social_desirability)).filter(Number.isFinite);
      if (sds.length < 2) continue;
      const lo = Math.min(...sds);
      const hi = Math.max(...sds);
      if (hi <= lo) continue;
      const opt = q.options.find((o) => o.key === ans);
      if (!opt) continue;
      vals.push(clamp(((Number(opt.social_desirability) - lo) / (hi - lo)) * 100, 0, 100));
    } else if (q.type === 'stealth_scale' && q.scale?.sdHigh) {
      const n = clamp(Number(ans) || 4, 1, 7);
      const towardRight = (n - 1) / 6;
      const t = q.scale.sdHigh === 'right' ? towardRight : 1 - towardRight;
      vals.push(clamp(t * 100, 0, 100));
    }
  }
  return vals.length ? mean(vals) : null;
}

/** 2) 敏感题犹豫修饰度 H_lat */
export function hesitationIndex(state, questions) {
  const baseline = readingBaseline(state, questions);
  const sens = questions.filter((q) => q.is_sensitive);
  if (!sens.length) return { value: null, baseline, samples: 0 };

  let acc = 0;
  let n = 0;
  for (const q of sens) {
    const ansRec = state.answersByVolume?.[q.volume_id ?? q.volumeId]?.[q.id];
    if (!ansRec || ansRec.draft || ansRec.value === undefined || ansRec.value === null) continue;
    const ans = ansRec.value;
    n += 1;

    const rec = getTelemetry(state, q.id);
    // 脏样本（切屏 / 长时间发呆）已由 telemetry 打标，剔出犹豫分
    if (!rec.ms || rec.dirty) continue;

    const chars = questionChars(q);
    const expected = Math.max(400, baseline * chars);
    const ratio = rec.ms / expected;
    const changes = rec.changes || 0;

    if (q.type === 'budget_100' || q.type === 'pyramid_top3') {
      if (ratio > 2.4 || changes >= 3) {
        acc += Math.min(1.0, Math.max(0, ratio - 1.4) * 0.6 + 0.25 * changes);
      }
      continue;
    }

    let sdHigh = false;
    if (Array.isArray(q.options) && q.options.length) {
      const hi = Math.max(...q.options.map((o) => Number(o.social_desirability) || 0));
      const opt = q.options.find((o) => o.key === ans);
      sdHigh = hi > 0 && Number(opt?.social_desirability || 0) >= hi;
    } else if (q.type === 'stealth_scale' && q.scale?.sdHigh) {
      const v = clamp(Number(ans) || 4, 1, 7);
      sdHigh = q.scale.sdHigh === 'right' ? v >= 6 : v <= 2;
    }

    if (!sdHigh) continue;
    if (ratio <= 2.2 && changes < 2) continue;
    acc += Math.min(1.5, Math.max(0, ratio - 1) + 0.35 * changes);
  }
  const value = n ? clamp((100 / n) * acc, 0, 100) : null;
  return { value, baseline, samples: n };
}

const MIRROR_TARGET_DIMS = {
  pride_humility: ['sin_pride', 'virtue_humility'],
  wrath_patience: ['sin_wrath', 'virtue_patience'],
  greed_charity: ['sin_greed', 'virtue_charity'],
  lust_chastity: ['sin_lust', 'virtue_chastity'],
  envy_kindness: ['sin_envy', 'virtue_kindness'],
  gluttony_temperance: ['sin_gluttony', 'virtue_temperance'],
  sloth_diligence: ['sin_sloth', 'virtue_diligence'],
  alignment_order: ['dd_order'],
  alignment_good: ['dd_good'],
};

/** 3) 跨卷镜像撕裂度 G_mirror */
export function mirrorTear(state, DATA) {
  const valid = new Set(DATA.dimOrder);
  const allQ = allQuestions(DATA);

  const pairs = [];
  const seen = new Set();
  for (const q of allQ) {
    if (q.layer !== 'stealth') continue;
    const key = q.mirror_key || '';
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const explicitQs = allQ.filter((x) => x.mirror_key === key && x.layer !== 'stealth' && x.volumeId !== 'vol8');
    const stealthQs = allQ.filter((x) => x.mirror_key === key && x.layer === 'stealth');
    if (!explicitQs.length || !stealthQs.length) continue;

    // 关闭证据收缩：比的是两侧差值，收缩会把差值一起压平
    const a = scorePool(state, explicitQs, { validDimSet: valid, priorW: 0 }).scores;
    const b = scorePool(state, stealthQs, { validDimSet: valid, priorW: 0 }).scores;
    const shared = Object.keys(a).filter((d) => Number.isFinite(b[d]));
    if (!shared.length) continue;

    // 只对照该 mirror_key 靶向的核心维度，避免把同题附带的 8–10 个无关副维度算进撕裂度
    const targetList = MIRROR_TARGET_DIMS[key] || (valid.has(key) ? [key] : []);
    const targeted = shared.filter((d) => targetList.includes(d));
    const dims = targeted.length ? targeted : shared;

    const diff = mean(dims.map((d) => Math.abs(a[d] - b[d])));
    pairs.push({ mirrorKey: key, diff, dims });
  }

  if (!pairs.length) return { value: null, pairs };
  const raw = clamp(mean(pairs.map((p) => p.diff)), 0, 100);
  const TEAR_FULL_SCALE = 45;
  return { value: clamp((raw / TEAR_FULL_SCALE) * 100, 0, 100), raw, pairs };
}

/**
 * 综合面具厚度。
 * 未完成 Vol.8 时 G_mirror 不参与，前两项自适应重归一化。
 */
export function maskIndex(state, DATA) {
  const all = allQuestions(DATA);

  const dsd = socialDesirabilityIndex(state, all);
  const hlat = hesitationIndex(state, all);
  const tear = mirrorTear(state, DATA);

  const parts = [];
  if (dsd !== null) parts.push({ k: 'D_sd', v: dsd, w: 0.35 });
  if (hlat.value !== null) parts.push({ k: 'H_lat', v: hlat.value, w: 0.25 });
  if (tear.value !== null && (state.completedVolumes || []).includes('vol8')) {
    parts.push({ k: 'G_mirror', v: tear.value, w: 0.4 });
  }

  if (!parts.length) {
    return {
      value: null, tier: null, dsd, hlat: hlat.value, mirror: tear.value,
      parts, baseline: hlat.baseline,
    };
  }

  const totalW = parts.reduce((a, p) => a + p.w, 0);
  const m = clamp(parts.reduce((a, p) => a + p.v * p.w, 0) / totalW, 0, 100);

  return {
    value: round(m, 1),
    tier: maskTierOf(m),
    dsd: dsd === null ? null : round(dsd, 1),
    hlat: hlat.value === null ? null : round(hlat.value, 1),
    mirror: tear.value === null ? null : round(tear.value, 1),
    mirrorPairs: tear.pairs,
    parts,
    baseline: round(hlat.baseline, 1),
  };
}

/* ------------------------------------------------------------
   价值金字塔 / 压力退行态
   ------------------------------------------------------------ */

/**
 * 核心价值金字塔的 8 个合法键。
 * HA4- 存档码里 Top3 只存 0–7 的索引，超出这个白名单的键无法编码（会写成 255）。
 * 所以这里必须只认这 8 个。
 */
export const CORE_VALUE_KEYS = [
  'freedom', 'dignity', 'wealth', 'intimacy',
  'security', 'breakthrough', 'fairness', 'ease',
];

/**
 * v4.4 修复：跨卷污染。
 * 十六卷里有 9 道 pyramid_top3，其中只有 vol4 的 v4_q20 用的是核心 8 价值；
 * Vol.9–16 的分别是认知功能栈 / 道德基础 / 九型 / 图式 / 金钱 / 冲突 / 神经，
 * 键名完全不在 CORE_VALUE_KEYS 里。
 * 旧实现遍历全部 16 卷，若用户先做了扩展卷，topValues 会被写入 'jung_ni' 之类的键，
 * 编码时全变成 255 → 存档码里的价值金字塔永远是空的。
 */
export function extractTopValues(state, DATA) {
  if (Array.isArray(state.topValues) && state.topValues.length) {
    const clean = state.topValues.filter((k) => CORE_VALUE_KEYS.includes(k));
    if (clean.length) return clean.slice(0, 3);
  }

  const out = [];
  for (const volId of Object.keys(DATA.volumes)) {
    for (const q of DATA.volumes[volId].questions || []) {
      if (q.type !== 'pyramid_top3') continue;
      // 快速跳过：该题的卡片键与核心价值无交集，说明不是价值金字塔
      const keys = (q.values || []).map((v) => v.key);
      if (!keys.some((k) => CORE_VALUE_KEYS.includes(k))) continue;

      const ansRec = state.answersByVolume?.[volId]?.[q.id];
      if (!ansRec || ansRec.draft || !Array.isArray(ansRec.value)) continue;
      ansRec.value.forEach((k) => {
        if (CORE_VALUE_KEYS.includes(k) && !out.includes(k)) out.push(k);
      });
    }
  }
  return out.slice(0, 3);
}

export function pressureStyle(state, DATA) {
  const vol = DATA.volumes.vol8;
  if (!vol) return null;
  const styles = {};
  for (const q of vol.questions || []) {
    if (q.kind !== 'pressure') continue;
    const ansRec = state.answersByVolume?.vol8?.[q.id];
    if (!ansRec || ansRec.draft || !ansRec.value) continue;
    const ans = ansRec.value;
    const opt = (q.options || []).find((o) => o.key === ans);
    if (!opt || !opt.style) continue;
    styles[opt.style] = (styles[opt.style] || 0) + (Number(q.weight) || 1);
  }
  const list = Object.entries(styles).sort((a, b) => b[1] - a[1]);
  if (!list.length) return null;
  const total = list.reduce((a, [, v]) => a + v, 0);
  return {
    key: list[0][0],
    share: round((list[0][1] / total) * 100, 1),
    distribution: Object.fromEntries(list.map(([k, v]) => [k, round((v / total) * 100, 1)])),
  };
}

/* ------------------------------------------------------------
   汇总：全局池一次算完
   ------------------------------------------------------------ */

export function computeAll(state, DATA) {
  const dimOrder = DATA.dimensions.dims.map((d) => d.id);
  const valid = new Set(dimOrder);
  const dimHomeMap = Object.fromEntries(
    (DATA.dimensions?.dims || []).filter((d) => d.volume).map((d) => [d.id, d.volume]),
  );

  // 全局池（主卷证据保护 + 按振幅加权，避免跨卷附带维度淹没主测维度）
  const pool = scorePool(state, allQuestions(DATA), { validDimSet: valid, dimHomeMap });

  const scores = {};
  for (const d of dimOrder) {
    scores[d] = Number.isFinite(pool.scores[d]) ? pool.scores[d] : null;
  }
  const zScores = {};
  for (const d of dimOrder) {
    zScores[d] = Number.isFinite(pool.zScores[d]) ? pool.zScores[d] : null;
  }

  // 逐卷分数保留，仅供单卷报告与图表使用
  const perVolume = {};
  for (const volId of Object.keys(DATA.volumes)) {
    perVolume[volId] = scorePool(state, questionsOfVolume(DATA, volId), { validDimSet: valid });
  }

  const evidence = {};
  for (const d of dimOrder) {
    evidence[d] = Number.isFinite(pool.evidence?.[d]) ? pool.evidence[d] : 0;
  }

  const mask = maskIndex(state, DATA);
  const topValues = extractTopValues(state, DATA);
  const pressure = pressureStyle(state, DATA);

  return {
    scores,
    zScores,
    evidence, 
    perVolume,
    dimOrder,
    mask,
    topValues,
    pressure,
    userMean: pool.mean,
    userStd: pool.std,
    answeredCount: Object.keys(scores).filter((d) => Number.isFinite(scores[d])).length,
  };
}

export function normalizeScores(raw, dimOrder) {
  const out = {};
  for (const d of dimOrder) {
    const v = raw?.[d];
    out[d] = Number.isFinite(v) ? clamp(v, 0, 100) : null;
  }
  return out;
}
