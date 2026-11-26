/* ============================================================
   ecology.js — 关系生态位引擎（当前 7 个，数量由 ECOLOGIES 决定）

   核心修正（v5.0.1）：
     最初版本只用「同频 = 100 − |a − b|」。两个完全一样的人会拿到
     满分 100，导致六个生态位全部接近 100，看不出差别。
     实际上「同频」必须同时考虑两件事：
       1. 相似度   —— 你们像不像
       2. 水平     —— 你们是一起高，还是一起低
     两个人都对哲学毫无兴趣，不该被判成「灵魂知己」。

   因此每个维度带一个 pole：
     syncHigh  相似且双方都在高位（如哲学底色、契约底线）
     syncLow   相似且双方都在低位（如焦虑、躲闪）
     sync      纯相似（方向无所谓）
     tension   差异落在 20–45 的黄金带最好
     bothHigh  双方都高才得分（宿敌的锋芒对撞）

   全部只读 127 维得分，不改任何题库或计分公式。
   ============================================================ */

import { clamp, round } from './utils.js';

/* ------------------------------------------------------------
   1. 七套权重矩阵
   ------------------------------------------------------------ */

export const ECOLOGIES = [
  {
    id: 'partner',
    name: '长期伴侣',
    latin: 'The Long Companion',
    summary: '过日子的适配度：底线一致，节奏能对上，吵架有边界。',
    dims: [
      /* 核心底线：三观必须都在高位且接近 */
      { id: 'val_moral', kind: 'syncHigh', w: 2.4 },
      { id: 'val_boundary', kind: 'syncHigh', w: 2.0 },
      { id: 'wv_causal', kind: 'syncHigh', w: 1.6 },
      { id: 'wv_social', kind: 'syncHigh', w: 1.2 },
      /* 依恋双轴：越低越稳，双方都低最好 */
      { id: 'att_anxiety', kind: 'syncLow', w: 2.0 },
      { id: 'att_avoidance', kind: 'syncLow', w: 2.0 },
      /* 金钱与冲突的风格接近即可 */
      { id: 'money_vigilance', kind: 'sync', w: 1.2 },
      { id: 'tki_compromising', kind: 'syncHigh', w: 1.2 },
      { id: 'pac_adult', kind: 'syncHigh', w: 1.4 },
      /* 生活节律要有一点差异，才不至于窒息 */
      { id: 'hsp_sensory', kind: 'sync', w: 1.0 },
      { id: 'big5_order', kind: 'tension', w: 0.8 },
    ],
    penalties: [
      /* 追逃是【跨人】动态：一方焦虑 + 另一方回避。
         旧实现写成 partner，要求同一个人同时高焦虑且高回避 —— 语义相反。 */
      {
        crossPair: ['att_anxiety', 'att_avoidance'], at: 62, w: 14, label: '焦虑 × 回避的追逃',
      },
      {
        crossPair: ['money_worship', 'money_avoid'], at: 60, w: 9, label: '金钱崇拜 × 回避',
      },
      {
        id: 'def_attack', a: 60, b: 60, same: true, w: 11, label: '双方都先发反击',
      },
    ],
    unlock: 'vol4',
  },
  {
    id: 'spark',
    name: '心动拉扯',
    latin: 'The Spark',
    summary: '引力关系：靠吸引力和张力驱动，不靠稳定。',
    dims: [
      /* 张力项：太像就没火花 */
      { id: 'big5_aesthetic', kind: 'tension', w: 1.8 },
      { id: 'hss_novelty', kind: 'tension', w: 1.6 },
      { id: 'hss_intensity', kind: 'tension', w: 1.2 },
      { id: 'jung_ne', kind: 'tension', w: 1.0 },
      { id: 'jung_se', kind: 'tension', w: 1.0 },
      /* 推进度：双方都要有 */
      { id: 'inst_sx', kind: 'syncHigh', w: 2.0 },
      { id: 'sin_lust', kind: 'syncHigh', w: 1.4 },
      { id: 'big5_assert', kind: 'syncHigh', w: 0.8 },
    ],
    penalties: [
      /* 这一条确实是「双方同时」，保留 same 语义 */
      /* 两人都回避型 + 两人都用回避式冲突处理 → 真正的「无人破冰」。
         旧写法只要其中一人同时满足两项就触发，语义松了一半。 */
      {
        both: { x: 'att_avoidance', y: 'tki_avoiding', at: 58 }, w: 15, label: '互相观望、无人破冰',
      },
    ],
    extra: (masks) => {
      const av = Number.isFinite(masks?.a) ? masks.a : 50;
      const bv = Number.isFinite(masks?.b) ? masks.b : 50;
      const d = Math.abs(av - bv);
      if (d >= 8 && d <= 28) return 6;   // 一点神秘感最好
      if (d < 8) return -3;              // 太透明
      return -7;                          // 彼此看不透
    },
    unlock: 'vol7',
  },
  {
    id: 'confidant',
    name: '灵魂知己',
    latin: 'The Confidant',
    summary: '精神底色同频：你怎么看世界，TA就怎么看世界。',
    dims: [
      /* 哲学底色：双方都得真在这条线上，不是都不在乎 */
      { id: 'phil_stoic', kind: 'syncHigh', w: 1.6 },
      { id: 'phil_existential', kind: 'syncHigh', w: 1.4 },
      { id: 'phil_absurd', kind: 'syncHigh', w: 1.0 },
      { id: 'phil_humanist', kind: 'syncHigh', w: 1.4 },
      { id: 'mft_care', kind: 'syncHigh', w: 1.8 },
      { id: 'mft_fairness', kind: 'syncHigh', w: 1.5 },
      { id: 'mft_liberty', kind: 'syncHigh', w: 1.0 },
      { id: 'big5_open', kind: 'syncHigh', w: 1.6 },
      { id: 'cog_global', kind: 'syncHigh', w: 1.2 },
      { id: 'mot_purpose', kind: 'syncHigh', w: 1.2 },
      { id: 'light_humanism', kind: 'syncHigh', w: 1.4 },
      { id: 'enn_4', kind: 'sync', w: 0.6 },
    ],
    penalties: [
      { id: 'mft_authority', gap: 40, w: 10, label: '道德基础严重对立' },
      /* 一方算计、另一方赤诚 —— 也是跨人不对称 */
      {
        crossPair: ['dark_mach', 'light_faith'], at: 62, w: 12, label: '算计 × 赤诚',
      },
    ],
    unlock: 'vol11',
  },
  {
    id: 'cofounder',
    name: '事业搭档',
    latin: 'The Cofounder',
    summary: '认知执行互补：你补TA的盲区，TA补你的盲区。',
    dims: [
      /* 认知风格要有差异 */
      { id: 'cog_global', kind: 'tension', w: 1.8 },
      { id: 'cog_diverge', kind: 'tension', w: 1.6 },
      { id: 'cog_speed', kind: 'tension', w: 1.4 },
      { id: 'big5_order', kind: 'tension', w: 1.2 },
      /* 但执行力和契约底线都要在线 */
      { id: 'big5_industry', kind: 'syncHigh', w: 1.8 },
      { id: 'wv_social', kind: 'syncHigh', w: 1.2 },
      { id: 'light_kant', kind: 'syncHigh', w: 1.8 },
      { id: 'time_future', kind: 'syncHigh', w: 1.0 },
    ],
    penalties: [
      /* 空想无落地 = 想法多（发散高）+ 落地弱（尽责-勤勉低）。
         旧写法写成「勤勉 ≥42」，几乎人人过线，等于把「想法多且能落地的人」
         也判成空想 —— 认知互补的事业搭档因此被白扣 12 分。
         现在两人中任意一个「发散高但勤勉低」才算雷区。 */
      {
        id: 'cog_diverge', a: 60, partner: 'big5_industry', partnerMax: 42, w: 12, label: '空想无落地',
      },
      { id: 'light_kant', gap: 40, w: 12, label: '契约底线相差过大' },
    ],
    unlock: 'vol5',
  },
  {
    id: 'roommate',
    name: '日常合住',
    latin: 'The Roommate',
    summary: '过日子的琐碎适配度：作息、边界、冲突耗能。',
    dims: [
      { id: 'big5_order', kind: 'syncHigh', w: 2.4 },
      { id: 'val_boundary', kind: 'syncHigh', w: 1.8 },
      { id: 'mot_security', kind: 'sync', w: 1.2 },
      { id: 'sin_gluttony', kind: 'syncLow', w: 1.0 },
      { id: 'tki_compromising', kind: 'syncHigh', w: 1.2 },
      { id: 'tki_accommodating', kind: 'syncHigh', w: 0.8 },
      { id: 'big5_alert', kind: 'syncLow', w: 0.8 },
      /* 感官阈值接近最省心：同高或同低都行 */
      { id: 'hsp_sensory', kind: 'sync', w: 1.8 },
    ],
    penalties: [
      { id: 'big5_order', gap: 48, w: 14, label: '极高秩序 × 极低秩序' },
      {
        crossPair: ['hsp_sensory', 'hss_intensity'], at: 65, w: 9, label: '感官高敏 × 强度寻求',
      },
    ],
    unlock: 'vol12',
  },
  {
    id: 'rival',
    name: '镜面宿敌',
    latin: 'The Mirror Rival',
    summary: '竞争张力：得分高代表彼此成就的戏剧性，不是坏事。',
    dims: [
      { id: 'sin_pride', kind: 'bothHigh', w: 1.6 },
      { id: 'sin_wrath', kind: 'bothHigh', w: 1.2 },
      { id: 'dark_mach', kind: 'bothHigh', w: 1.4 },
      { id: 'mot_mastery', kind: 'bothHigh', w: 1.6 },
      { id: 'enn_8', kind: 'bothHigh', w: 1.2 },
      { id: 'tki_competing', kind: 'bothHigh', w: 1.4 },
      { id: 'big5_assert', kind: 'bothHigh', w: 1.0 },
    ],
    penalties: [],
    unlock: null,
  },
  /* ------------------------------------------------------------
     第 7 位 · 同行挚友（v5.2.4 新增）
     ------------------------------------------------------------
     为什么加它：现有六个生态位里没有「普通朋友」这个最普遍的关系类型。
       · 灵魂知己测的是精神同频（哲学立场 / 道德基础 / 开放性），太重
       · 事业搭档 / 日常合住 是同事与室友
       · 心动拉扯 / 长期伴侣 是恋爱与伴侣
       · 镜面宿敌 是竞争
     普通朋友在这上面一律低分，但关系本身没问题 —— 因为朋友不需要
     「世界观都一样」，只需要「节奏合得来、边界干净」。

     设计要点：
       · 以 sync（相似）为主，不用 syncHigh —— 朋友不必两人都高，
         只需要差不多。这是它与「灵魂知己」最本质的区别。
       · 唯一用 syncHigh 的是 val_boundary：边界感两人都得清楚，
         朋友关系最容易毁在「一方觉得无所谓，另一方觉得被冒犯」。
       · sin_gluttony 用 sync：一起放纵的默契，同高同低都行。
     ------------------------------------------------------------ */
  {
    id: 'companion',
    name: '同行挚友',
    latin: 'The Companion',
    summary: '一起消磨时间的适配度：节奏合不合、边界干不干净。',
    dims: [
      /* ---- 节奏接近即可（sync：越像越好，不要求都高）---- */
      { id: 'big5_social', kind: 'sync', w: 1.4 },
      { id: 'mot_hedonism', kind: 'sync', w: 1.2 },
      { id: 'hss_novelty', kind: 'sync', w: 1.0 },
      /* 一起放纵的默契：同高同低都成立 */
      { id: 'sin_gluttony', kind: 'sync', w: 1.0 },
      /* ---- 这三条必须两人都在线（syncHigh：都高才算好）----
         朋友关系最容易毁在「一方觉得无所谓，另一方觉得被冒犯」，
         所以边界、配合意愿、基本忠诚都不能只是「差不多」，
         而是双方都得站得住。这也是它与「灵魂知己」的分野：
         知己要求世界观同频，朋友只要求相处底线同频。 */
      { id: 'val_boundary', kind: 'syncHigh', w: 1.6 },
      { id: 'tki_collaborating', kind: 'syncHigh', w: 1.0 },
      { id: 'mft_loyalty', kind: 'syncHigh', w: 1.2 },
    ],
    penalties: [
      {
        id: 'val_boundary', gap: 45, w: 12, label: '边界感差太多（一方越界而不自知）',
      },
    ],
    unlock: 'vol4',
  },
];

export const ECOLOGY_IDS = ECOLOGIES.map((e) => e.id);

/* ------------------------------------------------------------
   2. 张力曲线（与 comparator.complement 一致）
   ------------------------------------------------------------ */

/**
 * 张力曲线：差异 20 分左右达到峰值 100，之后缓慢衰减。
 * 分段说明：
 *   d < 12   55 → 71.8   太像，没有互补
 *   d < 20   72 → 92.8   开始产生互补
 *   d ≤ 45   100 → 82.5  峰值在 d = 20，这是「黄金互补区」
 *   d > 45   82.5 ↓       差太多，听不懂对方在说什么
 */
export function tensionScore(diff) {
  const d = Math.abs(diff);
  if (d < 12) return 55 + d * 1.4;
  if (d < 20) return 72 + (d - 12) * 2.6;
  if (d <= 45) return 100 - (d - 20) * 0.7;
  return 82 - (d - 45) * 1.5;
}

/* ------------------------------------------------------------
   3. 单维度得分
   ------------------------------------------------------------ */

/**
 * 把 (av, bv, kind) 折算成 0–100。
 *
 * syncHigh 的关键在「水平门」：两人都高才满分。
 *   相似度 = 100 − |av − bv|
 *   水平门 = min(av, bv) / 62，夹在 0–1
 *   最终 = 相似度 × 水平门
 * 两人都是 80 且完全一致：100 × 1 = 100
 * 两人都是 35 且完全一致：100 × 0.56 = 56（「一起不在乎」不算同频）
 */
function dimScore(av, bv, kind) {
  const diff = av - bv;
  const sim = clamp(100 - Math.abs(diff), 0, 100);

  switch (kind) {
    case 'tension':
      return clamp(tensionScore(diff), 0, 100);

    case 'bothHigh':
      // 双方都要高；取较低一侧，避免一方极高把均值拉起来
      return clamp(Math.min(av, bv), 0, 100);

    case 'syncHigh': {
      /* 校准说明：计分引擎把所有维度中心化到 50，所以「两个普通人」
         在 min(av,bv)/62 下会拿到 0.81 × 100 = 81 分，六个生态位全都挤在 80 附近。
         改成 (min − 35) / 30：
           35 分 → 0     50 分（中性）→ 0.50     65 分以上 → 1.0
         这样中性组合落在 50 附近，真有共同底色才上得去。 */
      const gate = clamp((Math.min(av, bv) - 35) / 30, 0, 1);
      return clamp(sim * gate, 0, 100);
    }

    case 'syncLow': {
      // 双方都不高才好：(65 − max) / 30，50 分 → 0.5，35 分以下 → 1.0
      const gate = clamp((65 - Math.max(av, bv)) / 30, 0, 1);
      return clamp(sim * gate, 0, 100);
    }

    case 'sync':
    default:
      return sim;
  }
}

/* ------------------------------------------------------------
   3.5 kind 经验校准表

   数据来源：纳入 16 卷全量作答、按真实题库反演生成的 400 份随机画像，
   逐 kind 取样 2,000–11,000 次，量出各类 kind 在中性人群上的实际落点：

     kind        n       mean    SD     p50
     sync        2000    78.2    16.7   82
     tension     4000    76.5    14.5   76
     syncHigh   11200    24.9    28.0   15
     syncLow     1600    30.3    29.4   25
     bothHigh    2800    41.5    12.9   42

   syncHigh 均值只有 24.9 是因为它要求「两人都高」—— 现实里绝大多数组合
   都达不到，所以原始分天然贴地。不校准的后果是：配比里 syncHigh 多的
   生态位（长期伴侣 / 灵魂知己 / 日常合住）永远垫底，而 sync 占主导的
   生态位（心动拉扯）常年霸榜。2024 版实测心动拉扯夺冠 51.7%、灵魂知己 1.0%。

   校准把每种 kind 拉回 mean 50 / sd 18 的同一把尺子，再按维度权重合并。
   注意这是【统计校准】，不是人为抬高某个生态位 —— 校准参数来自实测分布，
   换了题库或改了维度权重，跑一次 tests/audit-v5.mjs 就能看出分布是否还均衡。
   ------------------------------------------------------------ */

export const TARGET_SD = 18;

/* 校准中心。原先取 50（统计学中性），但实测七个生态位的均分都落在 43–48，
   用户看到「你们长期伴侣 40 分」会理解成「很差」，其实是「中性」。
   移到 58 后中性仍是中性的相对位置，但绝对分数读起来更接近直觉：
   普通组合 50 上下、有点契合 60+、真正罕见的好组合 78+。 */
export const CALIB_CENTER = 58;

export const KIND_CALIB = {
  sync: { mean: 78.2, sd: 16.7 },
  tension: { mean: 76.5, sd: 14.5 },
  syncHigh: { mean: 24.9, sd: 28.0 },
  syncLow: { mean: 30.3, sd: 29.4 },
  bothHigh: { mean: 41.5, sd: 12.9 },
};

/* ------------------------------------------------------------
   4. 单生态位计分
   ------------------------------------------------------------ */

export function scoreEcology(a, b, availableDims, def, masks = {}) {
  const set = new Set(availableDims);
  const aS = a.computedScores || {};
  const bS = b.computedScores || {};

  const parts = [];
  for (const d of def.dims) {
    if (!set.has(d.id)) continue;
    const av = aS[d.id];
    const bv = bS[d.id];
    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;

    parts.push({
      id: d.id,
      w: d.w,
      kind: d.kind,
      score: round(dimScore(av, bv, d.kind), 1),
      av: round(av, 0),
      bv: round(bv, 0),
      diff: round(av - bv, 1),
    });
  }

  if (!parts.length) return null;

  const wSum = parts.reduce((s, p) => s + p.w, 0);
  const rawWeighted = parts.reduce((s, p) => s + p.score * p.w, 0) / wSum;

  /* 统计校准：把每种 kind 拉回 mean 50 / sd 18 的同一把尺子（见文件顶部 KIND_CALIB） */
  const calibrated = parts.map((p) => {
    const c = KIND_CALIB[p.kind] || KIND_CALIB.sync;
    return { ...p, cal: CALIB_CENTER + ((p.score - c.mean) / c.sd) * TARGET_SD };
  });

  const weighted = calibrated.reduce((s2, p) => s2 + p.cal * p.w, 0) / wSum;

  let value = weighted;
  if (typeof def.extra === 'function') {
    value += def.extra(masks, a, b) || 0;
  }

  /* 减分雷区 */
  const hits = [];
  for (const p of def.penalties || []) {
    let fired = false;

    /* 以下两类雷区没有单一 p.id，必须在 av/bv 校验之前处理，
       否则 `if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;`
       会把它们整条跳过 —— spark 的「无人破冰」曾因此成为死代码。 */
    if (Array.isArray(p.crossPair)) {
      const [x, y] = p.crossPair;
      const at = Number(p.at) || 60;
      const ax = aS[x]; const ay = aS[y];
      const bx = bS[x]; const by = bS[y];
      const okA = Number.isFinite(ax) && Number.isFinite(by) && ax >= at && by >= at;
      const okB = Number.isFinite(bx) && Number.isFinite(ay) && bx >= at && ay >= at;
      if (okA || okB) hits.push({ label: p.label, w: p.w });
      continue;
    }

    /* 两人都必须同时具备两项特征（spark 的「无人破冰」） */
    if (p.both && typeof p.both === 'object') {
      const { x, y, at } = p.both;
      const n = Number(at) || 58;
      const ok = Number.isFinite(aS[x]) && Number.isFinite(bS[x])
        && Number.isFinite(aS[y]) && Number.isFinite(bS[y])
        && aS[x] >= n && bS[x] >= n && aS[y] >= n && bS[y] >= n;
      if (ok) hits.push({ label: p.label, w: p.w });
      continue;
    }

    const av = aS[p.id];
    const bv = bS[p.id];
    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;

    if (p.gap !== undefined) {
      if (Math.abs(av - bv) >= p.gap) fired = true;
    } else if (p.cross) {
      const pv = aS[p.partner];
      const pw = bS[p.partner];
      const okA = av >= (p.a || 0) && Number.isFinite(pw) && pw >= p.partnerAt;
      const okB = bv >= (p.a || 0) && Number.isFinite(pv) && pv >= p.partnerAt;
      if (okA || okB) fired = true;
    } else if (p.partnerMax !== undefined) {
      /* 同一个人：主维度高 + 伴随维度低 */
      const pv = aS[p.partner];
      const pw = bS[p.partner];
      const okA = av >= (p.a ?? 0) && Number.isFinite(pv) && pv <= p.partnerMax;
      const okB = bv >= (p.a ?? 0) && Number.isFinite(pw) && pw <= p.partnerMax;
      if (okA || okB) fired = true;
    } else if (p.partner) {
      const pv = aS[p.partner];
      const pw = bS[p.partner];
      const okA = av >= p.a && Number.isFinite(pv) && pv >= p.partnerAt;
      const okB = bv >= p.a && Number.isFinite(pw) && pw >= p.partnerAt;
      if (okA || okB) fired = true;
    } else if (p.same) {
      if (av >= p.a && bv >= p.b) fired = true;
    }

    if (fired) hits.push({ label: p.label, w: p.w });
  }

  const penalty = hits.reduce((s, h) => s + h.w, 0);
  value = clamp(value - penalty, 0, 100);

  const n = parts.length;
  const confidence = n >= 10 ? 'high' : n >= 5 ? 'mid' : 'low';

  return {
    id: def.id,
    name: def.name,
    latin: def.latin,
    summary: def.summary,
    value: round(value, 1),
    weighted: round(weighted, 1),
    raw: round(rawWeighted, 1),
    penalty,
    hits,
    parts,
    dimCount: n,
    confidence,
    unlock: def.unlock,
  };
}

/* ------------------------------------------------------------
   5. 七生态位总览
   ------------------------------------------------------------ */

export function scoreAllEcologies(a, b, availableDims, masks = {}) {
  const list = ECOLOGIES
    .map((def) => scoreEcology(a, b, availableDims, def, masks))
    .filter(Boolean)
    .sort((x, y) => y.value - x.value);

  const best = list[0] || null;
  return {
    list,
    best,
    missing: ECOLOGIES
      .filter((def) => !list.some((r) => r.id === def.id))
      .map((def) => ({ id: def.id, name: def.name, unlock: def.unlock })),
  };
}

export const CONFIDENCE_LABEL = {
  high: '证据置信度 高',
  mid: '证据置信度 中',
  low: '证据置信度 初探',
};

export function ecologyById(id) {
  return ECOLOGIES.find((e) => e.id === id) || null;
}

/* ============================================================
   6. 深度关系剧本 / 潜台词解码器 / 相处红黑榜
   ============================================================ */

const pick = (scoreMap, ids) => ids
  .map((id) => ({ id, v: scoreMap?.[id] }))
  .filter((x) => Number.isFinite(x.v))
  .sort((a, b) => b.v - a.v);

/**
 * 关系演变三幕剧。
 * @returns {{ acts: Array<{ key, title, body, tags }> }}
 */
export function relationshipScript(A, B, masks = {}) {
  const aS = A.computedScores || {};
  const bS = B.computedScores || {};
  const aMask = Number.isFinite(masks?.a) ? masks.a : null;
  const bMask = Number.isFinite(masks?.b) ? masks.b : null;
  /* 用真实昵称替代 A/B；无昵称时退回 A/B（验收脚本大量断言依赖这两个字母，
     所以只在两者都有 name 时替换，避免把测试搞脆）。 */
  const NA = cleanName(A?.nickname || masks?.nameA, '');
  const NB = cleanName(B?.nickname || masks?.nameB, '');
  const N = (tag) => (tag === 'A' ? (NA || 'A') : (NB || 'B'));
  const acts = [];

  /* ---------- 第一幕 · 初识破冰 ---------- */
  {
    const tags = [];
    let body = '';

    const aSocial = aS.big5_social;
    const bSocial = bS.big5_social;
    const aFawn = aS.def_fawn;
    const bFawn = bS.def_fawn;
    const aDetach = aS.def_detach;
    const bDetach = bS.def_detach;

    const shier = (aSocial ?? 50) < (bSocial ?? 50) ? 'A' : 'B';
    const moreFawn = (aFawn ?? 50) > (bFawn ?? 50) ? 'A' : 'B';
    const moreDetach = (aDetach ?? 50) > (bDetach ?? 50) ? 'A' : 'B';

    if (Number.isFinite(aMask) && Number.isFinite(bMask) && Math.abs(aMask - bMask) >= 15) {
      const thick = aMask > bMask ? 'A' : 'B';
      body += `${N(thick)} 刚开始会显得更完整、更得体，话都说得恰到好处；另一方则更早露出真实的一面。`
        + '这段关系最初的错位就藏在这里：一个人以为对方天生从容，其实那只是TA习惯的外壳。';
      tags.push('体面差');
    } else {
      body += '你们的初始体面度接近，所以第一印象大概率为「同类」。';
      tags.push('同频起步');
    }

    if (moreFawn === moreDetach) {
      body += `${N(shier)} 更慢热，${N(moreDetach)} 更早退回自己的壳里——破冰这一步通常要花比预期更久。`;
      tags.push('慢热');
    } else {
      body += `${N(moreFawn)} 会主动把气氛托住，${N(shier)} 因此不容易冷场，第一次见面大概率是舒服的。`;
      tags.push('有人暖场');
    }

    acts.push({ key: 'act1', title: '第一幕 · 初识破冰期', body, tags });
  }

  /* ---------- 第二幕 · 升温共振 ---------- */
  {
    const tags = [];
    const sameHigh = [];
    const ids = ['big5_open', 'big5_aesthetic', 'phil_humanist', 'light_humanism', 'hss_novelty', 'hss_intensity', 'mot_purpose', 'jung_ne'];
    for (const id of ids) {
      const av = aS[id];
      const bv = bS[id];
      if (Number.isFinite(av) && Number.isFinite(bv) && av >= 60 && bv >= 60) sameHigh.push(id);
    }

    const topShared = sameHigh.slice(0, 2);
    const sceneMap = {
      big5_open: '一起去看一个谁都没听过的小展，出来后能聊两小时',
      big5_aesthetic: '同一张照片、同一段配乐，你们会同时停下来',
      phil_humanist: '聊起某个人的处境，你们都先替TA说话',
      light_humanism: '对一件公共事件，你们第一反应都是「那几个人怎么办」',
      hss_novelty: '临时改道去一个没计划的地方，越乱越兴奋',
      hss_intensity: '凌晨三点还在说话，谁都不想先结束',
      mot_purpose: '一起做一件不大但会让别人受益的事',
      jung_ne: '一个话题能岔出五条支线，越聊越散',
    };

    if (topShared.length) {
      const scenes = topShared.map((id) => sceneMap[id]).filter(Boolean);
      acts.push({
        key: 'act2',
        title: '第二幕 · 升温共振期',
        body: `最容易产生默契的场景：${scenes.join('；')}。这些不是刻意安排的，是你们刚好都在同一条频率上。`,
        tags: topShared.map((id) => TOP_LABEL[id] || id),
      });
    } else {
      acts.push({
        key: 'act2',
        title: '第二幕 · 升温共振期',
        body: '你们没有明显重叠的高位兴趣，升温会更依赖「一起做事」而不是「一起聊天」。'
          + '共同完成一件具体的事，比共同消磨一个晚上更能拉近距离。',
        tags: ['靠共同行动'],
      });
    }
    void tags;
  }

  /* ---------- 第三幕 · 首次摩擦 ---------- */
  {
    const tags = [];
    let body = '';

    const aAnx = aS.att_anxiety;
    const bAnx = bS.att_anxiety;
    const aAvo = aS.att_avoidance;
    const bAvo = bS.att_avoidance;
    const chase = (aAnx ?? 0) >= 60 && (bAvo ?? 0) >= 60;
    const chaseRev = (bAnx ?? 0) >= 60 && (aAvo ?? 0) >= 60;

    if (chase || chaseRev) {
      const chaser = chase ? 'A' : 'B';
      const runner = chase ? 'B' : 'A';
      body += `第一次冷战最可能这样开始：${N(chaser)} 想要一个明确的回应，${N(runner)} 觉得被逼近了需要退开。`
        + '一个更用力，另一个更远，两天后谁都不记得最初是为了什么。';
      tags.push('追逃循环');
    } else if ((aS.tki_avoiding ?? 0) >= 58 && (bS.tki_avoiding ?? 0) >= 58) {
      body += '第一次摩擦大概率不会爆发，而是同时沉默：两个人都选择先不碰。'
        + '表面风平浪静，但那件事会一直躺在那里，等下一次小事把它翻出来。';
      tags.push('双回避');
    } else if ((aS.tki_competing ?? 0) >= 58 && (bS.tki_competing ?? 0) >= 58) {
      body += '第一次摩擦会是正面冲突：两个人都想把道理讲赢，且都擅长这件事。'
        + '吵完不会有人受伤到崩溃，但会留下一个「这个人不好惹」的印象。';
      tags.push('硬碰硬');
    } else {
      body += '第一次分歧大概会以「一个人先让一步」结束。短期看很顺，'
        + '但让步的那一方会记住次数——真正的爆点往往在第五次之后。';
      tags.push('单侧让步');
    }

    if ((aS.def_attack ?? 0) >= 58 && (bS.def_attack ?? 0) >= 58) {
      body += '特别注意：你们都会在受伤时先反击，这意味着小误会很容易升级成互相指责。';
      tags.push('双反击');
    }

    acts.push({
      key: 'act3',
      title: '第三幕 · 首次摩擦期',
      body,
      bodyPlus: '破冰口令：先说出「我不是要赢，我只是刚才有点难受」，再谈事情本身。',
      tags,
    });
  }

  return { acts };
}

const TOP_LABEL = {
  big5_open: '好奇心',
  big5_aesthetic: '审美',
  phil_humanist: '人本',
  light_humanism: '善意',
  hss_novelty: '求新',
  hss_intensity: '强度',
  mot_purpose: '意义感',
  jung_ne: '发散',
};

/* ------------------------------------------------------------
   昵称工具
   ------------------------------------------------------------ */

/** 把存档里的昵称清洗成可读称呼；空值退回 fallback */
export function cleanName(raw, fallback = 'A') {
  const n = String(raw ?? '').trim();
  return n || fallback;
}

/* ------------------------------------------------------------
   潜台词解码器
   ------------------------------------------------------------ */

const SUBTEXT_RULES = [
  {
    dim: 'def_detach',
    at: 58,
    line: '「最近有点忙，过两天再聊。」',
    real: '我不是不想理你，是我现在没有力气处理任何需要回应的事。',
    better: '不追问、不冷处理：先回一句「好，你先忙，我在」。过两天由你先开口，不谈这件事，只聊别的。',
    tag: '情感隔离',
  },
  {
    dim: 'att_avoidance',
    at: 58,
    line: '「我们是不是进展得太快了。」',
    real: '靠近让我紧张。我怕一旦依赖上，就再也承受不了失去。',
    better: '把节奏交给TA决定，但把话说清楚：「我不急，你可以按你的速度来，但我不会消失。」',
    tag: '回避依恋',
  },
  {
    dim: 'att_anxiety',
    at: 58,
    line: '「没事，你去吧，我一个人也行。」',
    real: '我很想你说「那我不去了」。我说一个人也行，是想让你反驳我。',
    better: '不要真的走，也不要敷衍。给它一个具体的替代：「今晚我去，明天整天留给你。」',
    tag: '焦虑依恋',
  },
  {
    dim: 'def_fawn',
    at: 58,
    line: '「都行，你决定就好。」',
    real: '我有偏好，但说出来怕你不高兴，所以我把选择权先交出去。',
    better: '主动给两个选项让TA挑，而不是开放式提问。有边界的选择题，TA才答得出来。',
    tag: '讨好安抚',
  },
  {
    dim: 'def_intellectual',
    at: 58,
    line: '「我们先理性分析一下这件事。」',
    real: '这件事让我有情绪，但我不允许自己有，所以我把它变成一道题。',
    better: '配合分析，但在最后加一句：「分析完了，你现在心里什么感觉？」给TA一个允许脆弱的入口。',
    tag: '理智化',
  },
  {
    dim: 'def_attack',
    at: 58,
    line: '「你怎么每次都这样。」',
    real: '我刚才被刺痛了。攻击比示弱安全。',
    better: '不接招，也不逃。只回一句：「你现在很生气，我先不说了。等你缓过来我们再谈。」',
    tag: '先发反击',
  },
  {
    dim: 'tki_competing',
    at: 58,
    line: '「这件事就是你不对。」',
    real: '我需要的不是道歉，是确认我在这个问题上是对的。',
    better: '先承认TA讲得对的那部分（哪怕只有一句），再补你的部分。TA要的常常只是被承认，不是赢。',
    tag: '竞争型冲突',
  },
  {
    dim: 'tki_avoiding',
    at: 58,
    line: '「算了，不说了。」',
    real: '我说下去会吵起来，而吵架让我害怕。我宁愿自己咽下去。',
    better: '别追着要TA现在讲完。改成：「那先放着，等你想说的时候我听。」把门留着，不要推。',
    tag: '回避型冲突',
  },
  {
    dim: 'schema_deprivation',
    at: 58,
    line: '「不用了，我自己来就行。」',
    real: '我很想有人帮我，但我不敢开口。开口了没被接住，比不开口更难受。',
    better: '不要问「要不要帮忙」，直接做一件具体的小事。被接住一次，比被问十次有用。',
    tag: '情感剥夺图式',
  },
  {
    dim: 'enn_4',
    at: 58,
    line: '「你和他们玩得挺开心的。」',
    real: '我在确认自己是不是可有可无的那一个。',
    better: '不要辩解。给一个具体的、只属于你们的安排：「周六那家店我一直想去，只跟你去。」',
    tag: '4 号 · 独特者',
  },
];

/**
 * @param {Object} target  对方 state（我们解码「TA」的潜台词）
 * @param {string} name    对方称呼
 */
export function subtextDecoder(target, name = '对方') {
  const s = target.computedScores || {};
  const who = cleanName(name, '对方');

  /* 触发条件：该维度 ≥ 规则阈值；取分最高的 3 条。
     旧实现按 SUBTEXT_RULES 的数组顺序取，等于永远返回前 3 条命中规则，
     哪怕对方真正最强的是第 8 条 —— 解码器因此常常「说得挺对但没说到点上」。 */
  const hits = SUBTEXT_RULES
    .map((r) => ({ r, v: s[r.dim] }))
    .filter(({ r, v }) => Number.isFinite(v) && v >= r.at)
    .sort((x, y) => y.v - x.v)
    .slice(0, 3);

  return hits.map(({ r, v }) => ({
    dim: r.dim,
    tag: r.tag,
    score: round(v, 0),
    line: r.line,
    real: r.real,
    better: r.better.replace(/\{who\}/g, who),
  }));
}

/* ------------------------------------------------------------
   相处红黑榜
   ------------------------------------------------------------ */

/**
 * 从 Vol.6 欲望引擎、Vol.13 图式、Vol.11 道德基础提炼各 3 条。
 */
export function chemistryBoard(A, B) {
  const aS = A.computedScores || {};
  const bS = B.computedScores || {};
  /* 真实昵称替代 A/B 标签；无昵称时保留 A/B */
  const NA = cleanName(A?.nickname, '');
  const NB = cleanName(B?.nickname, '');
  const who = (tag) => (tag === 'A' ? (NA || 'A') : (NB || 'B'));

  const green = [];   // 加分动作
  const red = [];     // 隐形禁区

  /* ---- 从欲望引擎看：对方最在意什么，就给它什么 ---- */
  const motives = [
    ['mot_autonomy', '不替TA做决定', '给TA一段完全不被打扰的时间，不要问TA在干什么'],
    ['mot_mastery', '认真看TA的成果', '让TA讲一次TA做成的具体的事，听完追问一个细节'],
    ['mot_belonging', '具体的分量', '一句「这件事我只跟你讲」，比任何夸奖都有效'],
    ['mot_security', '提前说清楚', '把你们下一步的安排讲明白，模糊本身就是消耗'],
    ['mot_purpose', '意义要落地', '跟TA聊一件「这事对谁有用」，而不是「这事值多少钱」'],
    ['mot_hedonism', '一起浪费时间', '安排一个没有任何产出的下午，允许纯粹开心'],
  ];

  const aTop = pick(aS, motives.map((m) => m[0]))[0];
  const bTop = pick(bS, motives.map((m) => m[0]))[0];

  for (const [dim, title, text] of motives) {
    if (aTop && aTop.id === dim) green.push({ for: who('A'), title, text });
    if (bTop && bTop.id === dim) green.push({ for: who('B'), title, text });
  }

  /* ---- 从图式看：别踩的雷 ---- */
  const mines = [
    ['schema_abandonment', '不要说「随便你」', '这句话对TA是「我要走了」的简化版，宁可说「我不同意，但我不会走」'],
    ['schema_deprivation', '不要拿关心当条件', '如果想给，就别让对方觉得欠你'],
    ['schema_defect', '不要在别人面前纠正TA', '私下说都行，当众说是另一种伤害'],
    ['schema_mistrust', '别追问得太急', '查岗式的追问只会让TA更确信你不可信'],
    ['schema_std', '不要替TA降标准', '「这样就行了」在TA是「你不用管了」'],
    ['schema_sacrifice', '不要让TA一直让步', '每一次TA退让，都在心里记了一笔'],
    ['schema_approval', '不要只讲道理', 'TA要的第一句是「你做得挺好」，然后才是建议'],
    ['schema_entitlement', '别当众驳TA', 'TA的自尊比事实更急'],
    ['schema_negativity', '不要突然变计划', '临时改期对你是小事，对TA是灾难预演'],
  ];

  /* 阈值门：只有该图式确实显著（≥56）才输出红线。
     没有这个门，一个完全没创伤的人也会被判「不要说随便你」，
     读起来像在替对方编造心理阴影。 */
  const MINE_AT = 56;
  const aV = pick(aS, mines.map((m) => m[0]))[0];
  const bV = pick(bS, mines.map((m) => m[0]))[0];

  for (const [dim, title, text] of mines) {
    if (aV && aV.id === dim && aV.v >= MINE_AT) red.push({ for: who('A'), title, text });
    if (bV && bV.id === dim && bV.v >= MINE_AT) red.push({ for: who('B'), title, text });
  }

  /* ---- 从道德基础看：价值排序别碰 ---- */
  const mftDims = ['mft_care', 'mft_fairness', 'mft_loyalty', 'mft_authority', 'mft_sanctity', 'mft_liberty'];
  const mftLabel = {
    mft_care: '关爱',
    mft_fairness: '公平',
    mft_loyalty: '忠诚',
    mft_authority: '权威',
    mft_sanctity: '圣洁',
    mft_liberty: '自由',
  };
  const aMft = pick(aS, mftDims)[0];
  const bMft = pick(bS, mftDims)[0];
  const aMftLow = [...mftDims].map((d) => ({ id: d, v: aS[d] })).filter((x) => Number.isFinite(x.v)).sort((x, y) => x.v - y.v)[0];
  const bMftLow = [...mftDims].map((d) => ({ id: d, v: bS[d] })).filter((x) => Number.isFinite(x.v)).sort((x, y) => x.v - y.v)[0];

  if (aMft && Number.isFinite(aMft.v) && aMft.v >= 58) {
    green.push({
      for: who('A'),
      title: `TA的底线是「${mftLabel[aMft.id]}」`,
      text: '在这件事上不要讲效率和划算，那是TA判断一个人值不值得深交的地方',
    });
  }
  if (bMft && Number.isFinite(bMft.v) && bMft.v >= 58) {
    green.push({
      for: who('B'),
      title: `TA的底线是「${mftLabel[bMft.id]}」`,
      text: '在这件事上不要讲效率和划算，那是TA判断一个人值不值得深交的地方',
    });
  }
  if (aMftLow && Number.isFinite(aMftLow.v) && aMftLow.v <= 42) {
    red.push({
      for: who('A'),
      title: `别拿「${mftLabel[aMftLow.id]}」要求TA`,
      text: '这一项在TA身上本来就弱，用道德去要求，只会换来敷衍而不是认同',
    });
  }
  if (bMftLow && Number.isFinite(bMftLow.v) && bMftLow.v <= 42) {
    red.push({
      for: who('B'),
      title: `别拿「${mftLabel[bMftLow.id]}」要求TA`,
      text: '这一项在TA身上本来就弱，用道德去要求，只会换来敷衍而不是认同',
    });
  }

  return { green: green.slice(0, 6), red: red.slice(0, 6) };
}
