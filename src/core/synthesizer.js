/* ============================================================
   synthesizer.js — 单卷 / 全息报告拼装
   · 维度四面镜选取与四档分级
   · 24 原型匹配
   · 35 条跨卷交叉规则触发
   · 顺境 / 高压双态推演
   · 人生使用说明书
   ============================================================ */

import { clamp, round, mean, sortBy } from './utils.js';
import { tierOf, maskTierOf, computeAll } from './scoring.js';

/* ------------------------------------------------------------
   双源无损融合：live 现算 ∪ 存档分数
   ------------------------------------------------------------ */

/**
 * 个人内部相对尖峰 Z。
 * 与 scoring.js 的 scorePool() 尾部保持同一把尺子：σ 下限 6.0。
 */
function zFromScores(scores, dims) {
  const vals = dims.map((d) => scores[d]).filter(Number.isFinite);
  const mu = vals.length ? mean(vals) : 50;
  const variance = vals.length
    ? vals.reduce((a, v) => a + (v - mu) ** 2, 0) / vals.length
    : 0;
  const sigma = Math.max(6, Math.sqrt(variance));
  const out = {};
  for (const d of dims) {
    if (!Number.isFinite(scores[d])) continue;
    out[d] = round((scores[d] - mu) / sigma, 2);
  }
  return out;
}

/**
 * 有效分数（v5.2.2）。
 *
 * 背景：HA4- 存档码只编码「完成卷位掩码 + 127 个维度分 + 面具 + 价值 + 昵称」，
 * 不含 answersByVolume。导入后 computeAll() 只能看到空作答池，于是 live 里全是 null。
 * 旧实现直接 `state.computedScores = {}` 再从 live 填回去 —— 导入的 60–99 个维度
 * 被整对象覆盖洗白，报告页便被空态门禁拦成「档案尚未启封」。
 *
 * 现在的规则：
 *   1. 底盘 = state.computedScores（内存/导入/本地存档里已有的分）
 *   2. 只用 live 里【有限】的值覆盖，null 绝不参与覆盖
 *   3. mask / topValues / pressure 同理：live 没有就回落到存档值
 *   4. Z 分：live 覆盖不到合并后的全部维度时，按合并后的分布重算（σ 下限 6.0）
 *
 * @param {Object} state 任意 HA 状态（可只带 computedScores，无 answersByVolume）
 * @param {Object} DATA  { volumes, dimensions, dimOrder, ... }
 * @returns {{ scores, zScores, mask, maskDetail, topValues, pressure, live, completedVolumes }}
 */
export function resolveEffectiveComputed(state, DATA) {
  const live = computeAll(state, DATA);

  const dimOrder = (DATA.dimOrder && DATA.dimOrder.length)
    ? DATA.dimOrder
    : (DATA.dimensions?.dims || []).map((d) => d.id);
  const valid = new Set(dimOrder);

  /* ---- 1. 底盘：存档里已有的分 ---- */
  const scores = {};
  for (const [d, v] of Object.entries(state?.computedScores || {})) {
    if (!valid.has(d)) continue;
    if (Number.isFinite(v)) scores[d] = v;
  }

  /* ---- 2. live 覆盖（仅有限值，且仅在「本地真的答过这一卷」时） ----
     单纯「live 是有限值就覆盖」还不够。反例：
       导入 vol1–8（只带 computedScores，无作答原文）→ 接着答 vol9
       vol9 的选项会顺带在 big5_open 之类的维度上产生交叉载荷，
       于是 live.big5_open 是个有限值（58.6），它会把导入的 8 卷聚合值覆盖掉。
       一次单卷作答就打穿了八卷的证据量 —— 这正是「洗白」的另一种形式，
       只是从「变成 null」变成了「变成另一个数」。
     所以再加一道：只有该维度属于【本地确有作答】的卷，live 才有权覆盖。
     本地没答过的卷，它的分来自存档码，没有新证据，一律保留存档值。 */
  const localVols = new Set();
  for (const [v, bucket] of Object.entries(state?.answersByVolume || {})) {
    /* 虚拟桶不算「答过某卷」：它的分归属到真实卷，由 commitExpress 负责写回。
       若留在桶里，DATA.volumes['__express'] 是 undefined，不会产生任何归属，
       所以这里直接跳过即可。 */
    if (v === '__express') continue;
    if (bucket && Object.keys(bucket).length) localVols.add(v);
  }
  const liveOwnedDims = new Set();
  for (const v of localVols) {
    const vol = DATA?.volumes?.[v];
    for (const d of vol?.dimensions || []) liveOwnedDims.add(d);
  }

  for (const d of dimOrder) {
    const v = live?.scores?.[d];
    if (!Number.isFinite(v)) continue;
    /* 本地零作答（纯导入态）：live 完全无权覆盖，全部保留存档值。
       否则 live 会把「没有任何证据的空计算」写进底盘。 */
    if (!liveOwnedDims.size) continue;
    if (!liveOwnedDims.has(d)) continue;
    scores[d] = v;
  }

  /* ---- 3. Z 分 ---- */
  const finiteDims = dimOrder.filter((d) => Number.isFinite(scores[d]));
  const liveZ = live?.zScores || {};
  const liveZCovers = finiteDims.every((d) => Number.isFinite(liveZ[d]));
  const zScores = liveZCovers
    ? Object.fromEntries(finiteDims.map((d) => [d, liveZ[d]]))
    : zFromScores(scores, finiteDims);

  /* ---- 4. 面具：live 为 null 时回落存档值 ---- */
  const liveMask = live?.mask && typeof live.mask === 'object' ? live.mask : null;
  let maskValue = Number.isFinite(liveMask?.value) ? liveMask.value : null;
  if (maskValue === null && Number.isFinite(state?.maskIndex)) maskValue = state.maskIndex;
  const maskTier = maskValue === null ? null : maskTierOf(maskValue);
  const mask = {
    ...(liveMask || {}),
    value: maskValue,
    tier: maskTier,
  };

  const baseDetail = state?.maskDetail && typeof state.maskDetail === 'object'
    ? { ...state.maskDetail }
    : {};
  const liveParts = Array.isArray(liveMask?.parts) ? liveMask.parts : [];
  const maskDetail = {
    ...baseDetail,
    ...(liveMask || {}),
    parts: liveParts.length ? liveParts : (Array.isArray(baseDetail.parts) ? baseDetail.parts : []),
    value: maskValue,
    tier: maskTier,
  };

  /* ---- 5. 价值金字塔 / 压力退行态 ---- */
  const topValues = (Array.isArray(live?.topValues) && live.topValues.length)
    ? live.topValues
    : [...(state?.topValues || [])];
  const pressure = live?.pressure || state?.pressureStyle || null;

  return {
    scores,
    zScores,
    mask,
    maskDetail,
    topValues,
    pressure,
    live,
    completedVolumes: [...(state?.completedVolumes || [])],
  };
}

/* ------------------------------------------------------------
   维度解读：一维四面镜 → 当前档位应取的那一面
   ------------------------------------------------------------ */

export function mirrorFor(dim, score, MIRRORS) {
  const m = MIRRORS[dim];
  if (!m) return null;
  const s = Number.isFinite(score) ? score : 50;
  const tier = tierOf(s);
  const side = s >= 50 ? 'high' : 'low';
  const face = m[side];
  if (!face) return null;
  return {
    dim,
    name: m.name,
    category: m.category,
    volume: m.volume,
    polar: !!m.polar,
    ...(m.negLabel ? { negLabel: m.negLabel } : {}),
    ...(m.posLabel ? { posLabel: m.posLabel } : {}),
    score: s,
    tier,
    side,
    label: face.label,
    gift_title: face.gift_title,
    gift_desc: face.gift_desc,
    shadow_title: face.shadow_title,
    shadow_desc: face.shadow_desc,
    alchemy_tip: face.alchemy_tip,
  };
}

export function mirrorAll(scores, MIRRORS) {
  const out = {};
  for (const dim of Object.keys(MIRRORS)) {
    if (!Number.isFinite(scores[dim])) continue;
    out[dim] = mirrorFor(dim, scores[dim], MIRRORS);
  }
  return out;
}

/* ------------------------------------------------------------
   王牌天赋卡 / 阴影预警卡
   ------------------------------------------------------------ */

/**
 * 王牌天赋卡。
 * v4.2 起综合「绝对分」与「个人内部相对尖峰 Z」：
 *   composite = 0.62 · strength + 0.38 · zNorm
 * 只靠绝对分会永远选出那几个天生就高的维度，
 * 加入 Z 才能把「这个人身上真正突出的那一处」翻出来。
 *
 * @param {Object} zScores 可选的 Z 分数表；缺省时退化为纯绝对分
 */
export function topGifts(scores, MIRRORS, limit = 3, zScores = null) {
  const rows = [];
  for (const [dim, s] of Object.entries(scores)) {
    if (!Number.isFinite(s)) continue;
    const m = mirrorFor(dim, s, MIRRORS);
    if (!m) continue;
    // 极显锋芒 / 清晰倾向 → 高分面；反向深潜 → 低分隐藏优势
    const strength = m.side === 'high' ? s : 100 - s;
    const z = Number.isFinite(zScores?.[dim]) ? zScores[dim] : 0;
    // v4.4 修复：strength 在低分侧已翻转为 (100 − s)，zNorm 也必须跟着翻转。
    // 旧实现直接用原始 z，导致「低分隐藏天赋」的 Z 为负（因为 s < μ），
    // zNorm 被压到 50 以下，反而拉低了 composite —— 低分侧的天赋永远选不出来。
    const alignedZ = m.side === 'high' ? z : -z;
    const zNorm = clamp(50 + 25 * alignedZ, 0, 100);
    const composite = zScores ? 0.62 * strength + 0.38 * zNorm : strength;
    rows.push({
      ...m, strength: round(strength, 1), z: round(z, 2), composite: round(composite, 1),
    });
  }
  return sortBy(rows, (r) => r.composite, -1).slice(0, limit);
}

export function topShadows(scores, MIRRORS, limit = 3, zScores = null) {
  const rows = [];
  for (const [dim, s] of Object.entries(scores)) {
    if (!Number.isFinite(s)) continue;
    const m = mirrorFor(dim, s, MIRRORS);
    if (!m) continue;
    // 两侧极端化的程度 = 离 50 的距离；越极端，失控风险越高
    const intensity = Math.abs(s - 50) * 2;
    const z = Number.isFinite(zScores?.[dim]) ? zScores[dim] : 0;
    const zNorm = clamp(Math.abs(z) * 26, 0, 100);
    const composite = zScores ? 0.55 * intensity + 0.45 * zNorm : intensity;
    rows.push({ ...m, intensity: round(intensity, 1), z: round(z, 2), composite: round(composite, 1) });
  }
  return sortBy(rows, (r) => r.composite, -1).slice(0, limit);
}

/* ------------------------------------------------------------
   原型匹配
   ------------------------------------------------------------ */

/**
 * 原型匹配。
 *
 * v4.5 修复「单维劫持」：
 *   旧实现把未测维度直接跳过，只用「已测的那几项」求平均。
 *   于是某个原型只要 1 个维度恰好高分，就能凭 100% 的单维平均分
 *   反杀另一个扎实命中 4 个维度的原型。
 *
 * 现在按三步走：
 *   1. 统计 totalW / coveredW，算出覆盖率
 *   2. 硬闸门：coverage >= 0.60 且头号核心维度已测，才有资格进候选池
 *   3. 覆盖率置信惩罚：fit = rawFit × (0.75 + 0.25 × coverage)
 *
 * 若没有任何原型达标，返回 { eligible: false }，由单卷分型接管封面，
 * 绝不硬塞一个跨卷大原型。
 */
export const ARCH_COVERAGE_MIN = 0.6;
export const ARCH_COMPOSITE_GAP = 8;

export function matchArchetype(scores, ARCHETYPES) {
  const list = ARCHETYPES.archetypes || [];
  if (!list.length) return null;

  const graded = list.map((a) => {
    const weights = a.weights || {};
    const negWeights = a.negWeights || {};

    /* ---- 1. 总权重 / 已覆盖权重 / 头号核心维度 ---- */
    let totalW = 0;
    let coveredW = 0;
    let primaryDim = null;
    let primaryMag = -1;

    for (const [dim, w] of Object.entries(weights)) {
      const mag = Math.abs(w);
      totalW += mag;
      if (mag > primaryMag) { primaryMag = mag; primaryDim = dim; }
      if (Number.isFinite(scores[dim])) coveredW += mag;
    }
    for (const [dim, w] of Object.entries(negWeights)) {
      const mag = Math.abs(w);
      totalW += mag;
      if (mag > primaryMag) { primaryMag = mag; primaryDim = dim; }
      if (Number.isFinite(scores[dim])) coveredW += mag;
    }

    const coverage = totalW > 0 ? coveredW / totalW : 0;
    const primaryCovered = primaryDim ? Number.isFinite(scores[primaryDim]) : false;
    const eligible = coverage >= ARCH_COVERAGE_MIN && primaryCovered;

    /* ---- 2. 只用已测维度算原始契合度 ---- */
    let acc = 0;
    let wSum = 0;
    const hits = [];

    for (const [dim, w] of Object.entries(weights)) {
      const sc = scores[dim];
      if (!Number.isFinite(sc)) continue;
      const mag = Math.abs(w);
      // weights 里的负号含义是「该维度越低越像」，按 (100 − sc) 参与累加
      acc += (w < 0 ? 100 - sc : sc) * mag;
      wSum += mag;
      if (mag >= 0.9) hits.push({ dim, score: round(sc, 0), w, inverse: w < 0 });
    }
    for (const [dim, w] of Object.entries(negWeights)) {
      const sc = scores[dim];
      if (!Number.isFinite(sc)) continue;
      const mag = Math.abs(w);
      acc += (100 - sc) * mag;
      wSum += mag;
      if (mag >= 0.9) hits.push({ dim, score: round(sc, 0), w: -mag, inverse: true });
    }

    const rawFit = wSum > 0 ? clamp(acc / wSum, 0, 100) : 0;

    /* ---- 3. 覆盖率置信惩罚 ---- */
    const fit = clamp(rawFit * (0.75 + 0.25 * coverage), 0, 100);

    return {
      ...a,
      fit: round(fit, 1),
      rawFit: round(rawFit, 1),
      coverage: round(coverage, 2),
      primaryDim,
      primaryCovered,
      eligible,
      hitCount: hits.length,
      hits,
    };
  });

  const ranked = sortBy(graded, (r) => r.fit, -1);

  /* 只有达标原型才有资格上封面 */
  const pool = ranked.filter((r) => r.eligible);
  if (!pool.length) {
    return {
      eligible: false,
      best: null,
      runnerUp: null,
      isComposite: false,
      coverage: 0,
      ranked,
      reason: '共同维度不足以支撑任何跨卷原型',
    };
  }

  const best = pool[0];
  const runnerUp = pool[1] || null;
  const isComposite = Boolean(runnerUp && (best.fit - runnerUp.fit) <= ARCH_COMPOSITE_GAP);

  return {
    eligible: true,
    best,
    runnerUp,
    isComposite,
    coverage: best.coverage,
    ranked,
    pool,
  };
}

/* ------------------------------------------------------------
   跨卷交叉规则
   ------------------------------------------------------------ */

function testCondition(cond, scores, mask) {
  // v4.4：mask 可能直接传数值，也可能传 { value, tier } 对象
  const v = cond.dim === 'mask'
    ? (typeof mask === 'number' ? mask : mask?.value)
    : scores[cond.dim];
  if (!Number.isFinite(v)) return false;
  switch (cond.op) {
    case '>=': return v >= cond.val;
    case '>': return v > cond.val;
    case '<=': return v <= cond.val;
    case '<': return v < cond.val;
    default: return false;
  }
}

export function matchCrossRules(scores, mask, CROSS_RULES, completedVolumes = []) {
  const out = [];
  for (const rule of CROSS_RULES) {
    const reqs = rule.required_volumes || [];
    if (reqs.some((v) => !completedVolumes.includes(v))) continue;
    const ok = (rule.conditions || []).every((c) => testCondition(c, scores, mask));
    if (!ok) continue;
    const hits = (rule.conditions || [])
      .map((c) => ({
        dim: c.dim,
        name: c.dim === 'mask' ? '社会面具厚度' : null,
        score: c.dim === 'mask' ? mask?.value : scores[c.dim],
      }))
      .filter((h) => Number.isFinite(h.score));
    out.push({ ...rule, hits });
  }
  return out;
}

/* ------------------------------------------------------------
   顺境 / 高压双态推演
   ------------------------------------------------------------ */

const PRESSURE_MAP = {
  burst: {
    name: '爆发攻击型',
    pattern: '你的压力会瞬间外化为怒火。先掀桌，再后悔，事后又要花很长时间修补关系。',
    trigger: '被当众否定、被抢功、边界被反复跨越',
    brake: '在最高温的那二十分钟里，先不发任何消息。把要说的话写下来，第二天再决定要不要发。',
  },
  cutoff: {
    name: '彻底断联型',
    pattern: '你的压力会把所有人关在门外。消失、沉默、把自己藏起来，直到一切自己变轻。',
    trigger: '被消耗到极限、被背叛、感觉没人真正懂',
    brake: '在关掉之前，至少留下一句「我需要一点时间，不是不要你」。一句解释能救下很多关系。',
  },
  cold: {
    name: '冰冷黑化型',
    pattern: '你的压力会让情绪归零，只剩计算。你会非常冷静，也非常不近人情，用效率把所有人请出局。',
    trigger: '被欺骗、被当傻子、退路被切断',
    brake: '在你做出那个「正确但冷」的决定之前，告诉一个旁观者。第三人视角能校正大部分过度反应。',
  },
  collapse: {
    name: '自我坍塌型',
    pattern: '你的压力会把攻击转向自己。自责、失眠、耗竭，最后连起床都需要理由。',
    trigger: '长期高压、被否定、无法控制的外部变化',
    brake: '把「我是不是不行」换成「我现在需要什么」。前者是审判，后者才有出口。',
  },
};

export function dualState(scores, MIRRORS, pressure) {
  const gifts = topGifts(scores, MIRRORS, 3);
  const shadows = topShadows(scores, MIRRORS, 3);
  const style = PRESSURE_MAP[pressure?.key] || null;

  const flourish = gifts.length
    ? `在资源充足、被信任、能自己做主的顺境里，你会表现出${gifts.map((g) => `「${g.gift_title}」`).join('、')}。这正是你最好的生态位：有足够的空间，有值得的事，有少数懂你的人。`
    : '完成更多卷宗后，这里会逐渐显影出你在顺境中的真实形态。';

  const underPressure = [
    style ? `当压力超过阈值，你的第一反应倾向于「${style.name}」：${style.pattern}` : null,
    shadows.length
      ? `同时，最容易被放大的阴影是「${shadows[0].shadow_title}」——${shadows[0].shadow_desc}`
      : null,
  ].filter(Boolean).join(' ') || '完成更多卷宗后，这里会逐渐显影出你在高压下的退行方向。';

  return {
    flourish,
    underPressure,
    style,
    gifts,
    shadows,
    brakes: shadows.length ? shadows.map((s) => ({ title: s.shadow_title, tip: s.alchemy_tip })) : [],
  };
}

/* ------------------------------------------------------------
   人生使用说明书
   ------------------------------------------------------------ */

const OCCUPATION_MAP = [
  { dim: 'big5_open', high: true, text: '需要持续接触新问题的领域：早期产品、研究、跨界策划、内容创作' },
  { dim: 'big5_order', high: true, text: '需要极高确定性的领域：工程、财务、运营、项目管理、法务' },
  { dim: 'cog_global', high: true, text: '需要判断方向的位置：战略、架构、投资、创始人型角色' },
  { dim: 'cog_logic', high: true, text: '需要冷静取舍的位置：风控、审计、谈判、复杂决策支持' },
  { dim: 'mot_autonomy', high: true, text: '自主度高的形态：独立执业、远程协作、自营业务、项目制合作' },
  { dim: 'mot_mastery', high: true, text: '有明确上升阶梯的环境：竞争型组织、成长型团队、能被看见的战功体系' },
  { dim: 'mot_belonging', high: true, text: '高信任小团队：长期搭档、深度协作型组织、需要长期关系的服务业' },
  { dim: 'mot_purpose', high: true, text: '有社会回响的领域：教育、医疗、公益、文化、基础设施' },
  { dim: 'big5_compassion', high: true, text: '以人为核心的工作：咨询、教练、医疗照护、用户研究、人力发展' },
  { dim: 'big5_assert', high: true, text: '需要前台能量的角色：销售、BD、对外沟通、需要代表团队发声的位置' },
  { dim: 'big5_assert', high: false, text: '安静但高价值的位置：深度研究、独立开发、写作、专业顾问' },
  { dim: 'big5_social', high: false, text: '低社交密度的形态：独立作业、异步协作、可自由控制交互量的工作' },
  { dim: 'dark_psycho', high: true, text: '需要果断止损的位置：危机管理、重组、审计追责、需要拍板的一线' },
  { dim: 'big5_compliance', high: true, text: '需要极强协同的位置：跨部门统筹、客户成功、长期关系维护' },
];

function pickOccupation(scores) {
  const hits = [];
  for (const rule of OCCUPATION_MAP) {
    const s = scores[rule.dim];
    if (!Number.isFinite(s)) continue;
    const ok = rule.high ? s >= 60 : s <= 42;
    if (ok) hits.push({ ...rule, score: s });
  }
  return sortBy(hits, (h) => Math.abs(h.score - 50), -1).slice(0, 4).map((h) => h.text);
}

function pickPartner(scores) {
  const out = [];
  const av = scores.att_avoidance;
  const an = scores.att_anxiety;
  if (av >= 62) {
    out.push('一个不太需要高频确认、能给足空间的人。他不必时刻在场，但每次出现都是真的在场。');
  } else if (an >= 62) {
    out.push('一个表达稳定、承诺清楚的人。你需要的不是浪漫，而是可预期的回应。');
  } else {
    out.push('一个情绪稳定、边界清晰的人。你不太需要戏剧性，你需要的是长期的可靠。');
  }
  if (scores.mot_mastery >= 62) {
    out.push('一个同样有自己目标的人。你无法长期尊重一个没有方向感的人，哪怕他很温柔。');
  }
  if (scores.cog_global >= 62) {
    out.push('一个能和你聊到结构层面的人。你会在「聊不到一起」的关系里慢慢失去兴趣。');
  } else {
    out.push('一个说到做到、不太空谈的人。你会被具体的行动打动，而不是宏大的表达。');
  }
  if (scores.big5_compassion >= 62) {
    out.push('一个愿意把脆弱交给你的人。你需要被需要，也需要真的能接住对方。');
  }
  return out.slice(0, 3);
}

function pickToxic(scores) {
  const out = [];
  if (scores.def_fawn >= 58) {
    out.push('习惯用情绪施压的人：你一读空气就自动让步，这段关系会迅速变成单向消耗。');
  }
  if (scores.att_avoidance >= 60) {
    out.push('需要全天候黏连的人：他的靠近会被你体验成入侵，最后你会用冷淡把关系弄坏。');
  }
  if (scores.att_anxiety >= 60) {
    out.push('长期含糊其辞的人：他会不断触发你的猜测循环，把你拖进反复确认的漩涡。');
  }
  if (scores.val_moral >= 60) {
    out.push('把原则当筹码的人：你会在每一次「这次特殊」里被磨掉信任，最后连自己都怀疑。');
  } else {
    out.push('把一切都上升为道德审判的人：你会被长期的正确感压住，最后只想逃。');
  }
  if (scores.dark_mach >= 62) {
    out.push('同样善于布局的人：你们会互相防备到极致，关系最后只剩博弈。');
  }
  return out.slice(0, 3);
}

function pickActions(scores) {
  const out = [];
  if (scores.big5_rumination >= 60) out.push('每晚睡前写三行「今天发生的事实」，不带评价。让反刍停在纸上。');
  if (scores.big5_alert >= 60) out.push('每周做一次「风险清单」：写下担心的事、概率、应对方案，然后合上。');
  if (scores.sin_sloth >= 58) out.push('把最难启动的那件事，拆到「两分钟能做完」的粒度，只做那两分钟。');
  if (scores.def_intellectual >= 60) out.push('每周留一次「不分析时间」：只说感受，不允许解释原因。');
  if (scores.def_fawn >= 58) out.push('每天练一次「不解释的拒绝」，一句话即可，不必给理由。');
  if (scores.mot_autonomy >= 65) out.push('每季度做一件完全由自己决定、不被任何人评价的选择。');
  if (scores.big5_industry >= 65) out.push('把休息写进日程，并给它一个明确的结束时间。');
  if (scores.dark_narc >= 60) out.push('每季度写一次「我为自己骄傲的小事」，不给任何人看。');
  if (out.length < 3) out.push('每周留一段完全不产出的时间，只用来恢复感受力。');
  return out.slice(0, 3);
}

export function useManual(scores, pressure) {
  const style = PRESSURE_MAP[pressure?.key] || null;
  return {
    occupation: pickOccupation(scores),
    partner: pickPartner(scores),
    toxic: pickToxic(scores),
    actions: pickActions(scores),
    pressureBrake: style ? style.brake : null,
    pressureTrigger: style ? style.trigger : null,
  };
}

/* ------------------------------------------------------------
   单卷报告
   ------------------------------------------------------------ */

export function buildVolumeReport(state, DATA, volId) {
  const vol = DATA.volumes[volId];
  if (!vol) return null;

  const qs = (vol.questions || []);
  const ans = state.answersByVolume?.[volId] || {};
  const answered = qs.filter((q) => ans[q.id]?.value !== undefined);

  /* 分数底盘：state.computedScores。只有当它完全为空（例如只拿到 answersByVolume
     的原始态）时才现场融合一次，不重复计算。 */
  const hasStored = Object.values(state?.computedScores || {}).some(Number.isFinite);
  const eff = hasStored ? null : resolveEffectiveComputed(state, DATA);
  const scoreMap = hasStored ? (state.computedScores || {}) : eff.scores;
  const zMap = (hasStored && Object.keys(state?.zScores || {}).length)
    ? state.zScores
    : (eff ? eff.zScores : (state?.zScores || null));

  const dims = {};
  for (const d of vol.dimensions || []) {
    const v = scoreMap[d];
    if (Number.isFinite(v)) dims[d] = v;
  }

  const mirrors = mirrorAll(dims, DATA.mirrors);
  const gifts = topGifts(dims, DATA.mirrors, 3, zMap);
  const shadows = topShadows(dims, DATA.mirrors, 3, zMap);
  const maskV = Number.isFinite(state.maskIndex) ? state.maskIndex : (eff?.mask?.value ?? null);
  const mask = maskV === null || maskV === undefined ? null : maskV;

  return {
    volumeId: volId,
    volume: vol,
    answers: answered,
    total: qs.length,
    answeredCount: answered.length,
    dims,
    mirrors,
    gifts,
    shadows,
    mask,
    maskTier: mask === null ? null : maskTierOf(mask),
    pressure: null,
    keywords: (gifts.length ? gifts : Object.values(mirrors)).slice(0, 3).map((g) => g.gift_title || g.label),
    verdict: buildVolumeVerdict(vol, gifts, shadows, answered.length, qs.length),
  };
}

function buildVolumeVerdict(vol, gifts, shadows, answered, total) {
  const done = answered >= total;
  const giftPart = gifts.length
    ? `在这一卷的坐标里，你最亮的地方是「${gifts[0].gift_title}」——${gifts[0].gift_desc.split('，')[0]}。`
    : '';
  const shadowPart = shadows.length
    ? `需要留意的反面是「${shadows[0].shadow_title}」。它不是缺陷，而是同一股力量在能量不足时显影的另一种形状。`
    : '';
  const prefix = done ? '' : `（本卷已完成 ${answered}/${total} 题，以下解读基于目前作答。）`;
  return `${prefix}${giftPart}${shadowPart}`;
}

/* ------------------------------------------------------------
   全息报告（≥3 卷）
   ------------------------------------------------------------ */

export function buildHolographicReport(state, DATA) {
  /* 分数底盘：优先用 state.computedScores（renderReport 已先算好融合态传进来）；
     只有当它完全为空时，才现场融合一次 —— 保证任何直接调用本函数的
     地方（导出工作室 / 验收脚本 / 其他视图）不会拿到一份全空报告。 */
  const hasStored = Object.values(state?.computedScores || {}).some(Number.isFinite);
  const eff = hasStored ? null : resolveEffectiveComputed(state, DATA);
  const scores = hasStored ? (state.computedScores || {}) : eff.scores;
  const zScores = (hasStored && Object.keys(state?.zScores || {}).length)
    ? state.zScores
    : (eff ? eff.zScores : (state?.zScores || {}));
  const completed = state.completedVolumes || [];
  const maskValue = Number.isFinite(state.maskIndex) ? state.maskIndex : (eff?.mask?.value ?? null);
  const mask = {
    value: maskValue,
    tier: Number.isFinite(maskValue) ? maskTierOf(maskValue) : null,
  };

  const cross = matchCrossRules(scores, mask, DATA.crossRules, completed);
  const archetype = matchArchetype(scores, DATA.archetypes);
  const dual = dualState(scores, DATA.mirrors, state.pressureStyle || eff?.pressure || null);
  const manual = useManual(scores, state.pressureStyle || eff?.pressure || null);

  const values = (state.topValues?.length ? state.topValues : (eff?.topValues || [])).map((id) => {
    const v = (DATA.dimensions.values || []).find((x) => x.id === id);
    return v ? { id: v.id, name: v.name, desc: v.desc } : { id, name: id, desc: '' };
  });

  return {
    completed,
    totalVolumes: Object.keys(DATA.volumes || {}).length,
    scores,
    zScores,
    mask,
    cross,
    archetype,
    dual,
    manual,
    values,
    pressure: state.pressureStyle || eff?.pressure || null,
    gifts: topGifts(scores, DATA.mirrors, 4, zScores),
    shadows: topShadows(scores, DATA.mirrors, 3, zScores),
  };
}

/** 单卷 vs 全息：按完成卷数选择呈现深度（v4.2 五阶） */
export function reportDepth(completedCount) {
  if (completedCount >= 16) return { stage: 5, name: '破圈全启', desc: '十六卷全通 · 终极典藏版已解锁' };
  if (completedCount >= 8) return { stage: 4, name: '全息大成', desc: '核心八卷闭环 · 全息白皮书已解锁' };
  if (completedCount >= 5) return { stage: 3, name: '面具显影', desc: '常态 / 高压叠层与面具校准已解锁' };
  if (completedCount >= 3) return { stage: 2, name: '交叉读心', desc: '跨卷化学反应已激活' };
  if (completedCount >= 1) return { stage: 1, name: '单点透视', desc: '单卷深度报告可查看' };
  return { stage: 0, name: '未启封', desc: '完成任意一卷即可解锁' };
}

/** 用于存档码 / 分享卡的简短判词 */
export function soulVerdict(state, DATA) {
  const hasStored = Object.values(state?.computedScores || {}).some(Number.isFinite);
  const scores = hasStored ? (state.computedScores || {}) : resolveEffectiveComputed(state, DATA).scores;
  const arch = matchArchetype(scores, DATA.archetypes);
  if (!arch?.best) return null;
  return {
    name: arch.best.name,
    latin: arch.best.latin,
    verdict: arch.best.verdict,
    keywords: arch.best.keywords,
    fit: round(arch.best.fit, 1),
  };
}

/** 平均值（用于双人对比的总体倾向） */
export function meanOfScores(scores, dims) {
  const vals = dims.map((d) => scores[d]).filter(Number.isFinite);
  return vals.length ? round(mean(vals), 1) : null;
}
