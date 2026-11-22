/* ============================================================
   lab.js — 个人深度实验室（Phase 3）

   三个模块：
     1. pressureSandbox()  压力变形沙盒：能量 0–100 时各维度如何偏移
     2. innerParliament()  内在议会：16 组高张力维度对的双声部对话
     3. timelineDiff()     时间胶囊：两份存档的双层对照与变化 Top 5

   全部只读已有得分，不写任何数据、不改计分。
   ============================================================ */

import { clamp, round, mean } from './utils.js';

/* ============================================================
   1 · 压力变形沙盒
   ============================================================ */

/**
 * 压力偏移模型。
 *
 * 直觉上「能量充沛」时人会稍微更接近自己的明线表显层，
 * 「极度耗竭」时则向暗线高压层滑落。这里不重跑题库，
 * 而是用一套可解释的线性偏移：
 *
 *   energy 0（极度耗竭） → 每个维度向「暗面方向」偏移
 *   energy 50（日常常态） → 原样
 *   energy 100（充沛顺境）→ 向「明面方向」偏移
 *
 * 「暗面方向」不是随意的：它由维度自身的极性决定——
 * 原罪 / 暗黑三角 / 防御 / 依恋不安 这类越耗竭越强，
 * 美德 / 光明三角 / 自主 / 掌控 这类越耗竭越弱。
 */
const DARKWARD = new Set([
  'sin_pride', 'sin_greed', 'sin_lust', 'sin_envy', 'sin_gluttony', 'sin_wrath', 'sin_sloth',
  'dark_mach', 'dark_narc', 'dark_psycho', 'covert_control',
  'att_anxiety', 'att_avoidance',
  'def_intellectual', 'def_detach', 'def_attack', 'def_fawn', 'def_project',
  'big5_alert', 'big5_rumination',
  'schema_abandonment', 'schema_deprivation', 'schema_defect', 'schema_mistrust',
  'schema_isolation', 'schema_std', 'schema_sacrifice', 'schema_approval',
  'schema_entitlement', 'schema_negativity',
  'hsp_sensory', 'hsp_emotional',
  'money_avoid', 'money_worship', 'money_status',
  'tki_avoiding', 'tki_competing', 'pac_child',
  'enn_4', 'enn_6', 'enn_9',
  'phil_cynic', 'phil_nihilism',
]);

const AMPLITUDE = 16;   // 满偏移时每个维度最多移动 16 分

/**
 * @param {Object} scores  当前得分
 * @param {number} energy  0–100
 * @returns {{ scores, delta, dominant, warnings, highlight }}
 */
export function pressureSandbox(scores, energy = 50) {
  const e = clamp(Number.isFinite(energy) ? energy : 50, 0, 100);
  // t ∈ [-1, +1]：负数=耗竭，正数=充沛
  const t = (e - 50) / 50;

  const out = {};
  const delta = {};

  for (const [dim, raw] of Object.entries(scores || {})) {
    if (!Number.isFinite(raw)) continue;
    const darkward = DARKWARD.has(dim);
    // 充沛时明面维度上行、暗面维度下行；耗竭时反过来
    const dir = darkward ? -1 : 1;
    const shift = t * AMPLITUDE * dir;
    const next = clamp(raw + shift, 0, 100);
    out[dim] = round(next, 1);
    delta[dim] = round(next - raw, 1);
  }

  /* 变动最大的几项，用于文案 */
  const moved = Object.entries(delta)
    .filter(([, d]) => Math.abs(d) >= 1)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  const rising = moved.filter(([, d]) => d > 0).slice(0, 3);
  const falling = moved.filter(([, d]) => d < 0).slice(0, 3);

  /* 预警：耗竭态下被推到危险高位的暗面维度 */
  const warnings = [];
  if (e < 40) {
    const hot = Object.entries(out)
      .filter(([dim, v]) => DARKWARD.has(dim) && v >= 68 && (scores[dim] ?? 0) < 62)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    for (const [dim, v] of hot) warnings.push({ dim, value: round(v, 1), kind: 'ember' });
  }

  const stage = e >= 78 ? 'zone' : e >= 55 ? 'steady' : e >= 32 ? 'tired' : 'depleted';

  return {
    energy: e,
    stage,
    scores: out,
    delta,
    rising,
    falling,
    warnings,
    mean: round(mean(Object.values(out)), 1),
  };
}

export const ENERGY_STAGES = [
  {
    key: 'depleted',
    name: '极度耗竭',
    range: '< 32',
    headline: '此刻最需要的是刹车，不是意志力',
    body: '这个状态下你的判断会变窄：所有事都显得更严重，所有人都显得更不体谅。这不是你的真实判断，是你的电量在说话。',
  },
  {
    key: 'tired',
    name: '低电量',
    range: '32 – 55',
    headline: '还能运转，但容错率很低',
    body: '你仍然能把事情做完，只是每件小事都要多花一份力气去按住情绪。这时候做的重大决定，事后往往需要重做一次。',
  },
  {
    key: 'steady',
    name: '日常常态',
    range: '55 – 78',
    headline: '你的默认形态',
    body: '这是报告里那套分数的来源状态。不特别高光，也不特别失控——大多数人一生绝大部分时间都在这里。',
  },
  {
    key: 'zone',
    name: '充沛顺境',
    range: '≥ 78',
    headline: '这是你最好的生态位',
    body: '有空间、有值得的事、有少数懂你的人。同样的特质在这个状态下是天赋，在耗竭状态下就成了刺。',
  },
];

export function stageOf(energy) {
  const e = clamp(Number.isFinite(energy) ? energy : 50, 0, 100);
  if (e >= 78) return ENERGY_STAGES[3];
  if (e >= 55) return ENERGY_STAGES[2];
  if (e >= 32) return ENERGY_STAGES[1];
  return ENERGY_STAGES[0];
}

/* ============================================================
   2 · 内在议会
   ============================================================ */

/**
 * 16 组高张力维度对。
 * 每组：两侧都偏高（≥ threshold）时，说明这个人身上同时住着两个方向。
 */
export const PARLIAMENT_PAIRS = [
  {
    a: 'mot_autonomy', b: 'mot_security', threshold: 58,
    title: '自由 × 安全',
    voiceA: '我需要能自己说了算的空间。被安排的人生，哪怕安逸，也不是我的。',
    voiceB: '但我怕的正是没有退路。一步踏空就全盘皆输，我不能不给自己留后手。',
    verdict: '你不是优柔寡断，你在同时保护两样真东西。真正的解法不是二选一，而是先建一个足够稳的底盘，再在底盘上放开手脚。',
    tip: '把「要不要辞职」换成「先存到能撑 12 个月的钱，再决定辞不辞」。让安全成为自由的地基，而不是它的对手。',
  },
  {
    a: 'hsp_sensory', b: 'hss_novelty', threshold: 56,
    title: '高敏 × 求新',
    voiceA: '一点噪音、一点气味、一点光的偏移，都会直接进到我的神经里。我需要安静才能恢复。',
    voiceB: '但重复和熟悉会让我发闷。我需要新的东西，哪怕是混乱的新。',
    verdict: '高敏与高寻求并不矛盾，它们只是同一个高增益系统的两面。你能接收到别人收不到的细节，也因此更容易被过量灌满。',
    tip: '给任何高强度体验预留恢复日。不是事后补救，是出发前就写进计划。',
  },
  {
    a: 'sin_pride', b: 'att_anxiety', threshold: 58,
    title: '高自尊 × 依恋焦虑',
    voiceA: '我不需要向谁证明什么。我的价值由我自己判定。',
    voiceB: '可他一冷淡，我就开始怀疑是不是自己哪里不够好。',
    verdict: '外层是硬的，内层是软的。这种结构让你在远处显得很有骨气，在近处却反复确认。',
    tip: '把「他是不是不喜欢我了」翻译成「我需要一次具体的回应」。要证据，不要情绪。',
  },
  {
    a: 'light_kant', b: 'dark_mach', threshold: 58,
    title: '高原则 × 高谋略',
    voiceA: '有些线不能踩。踩了就不是我了。',
    voiceB: '但这个世界不讲原则。不懂规则的人只会被规则碾过去。',
    verdict: '你既相信原则，又清楚规则的真实运作方式。这让你既能做成事，又常在心里给自己记账。',
    tip: '给每一次「技术性操作」设一条内部红线，写下来。只要没越线，就不必自责。',
  },
  {
    a: 'big5_industry', b: 'sin_sloth', threshold: 56,
    title: '高勤勉 × 高逃避',
    voiceA: '事情必须做完。停下来我就难受。',
    voiceB: '但我总在最后一刻才动手，前面那段时间像被什么按住了。',
    verdict: '这是典型的「高压启动型」：不是懒，是启动成本太高。你在用拖延换取一点点自主感。',
    tip: '把任务拆到「两分钟能做完」的粒度，只做那两分钟。启动比坚持更难，也更要紧。',
  },
  {
    a: 'def_fawn', b: 'sin_wrath', threshold: 58,
    title: '讨好 × 愤怒',
    voiceA: '我不想让任何人不舒服。让步是成本最低的做法。',
    voiceB: '但我心里其实在骂。每一次让步，我都在心里记了一笔。',
    verdict: '表面上你从不生气，实际上你的怒气在攒利息。攒到某一天，会因为一件极小的事全部倒出来。',
    tip: '在还能心平气和的时候说一次「这个我不太想」，不必解释理由。小剂量的拒绝能防止大剂量的爆发。',
  },
  {
    a: 'cog_global', b: 'cog_logic', threshold: 58,
    title: '抽象 × 严密',
    voiceA: '我要先看到整张地图，否则细节没有意义。',
    voiceB: '但推演错一步，整张地图就是错的。我必须每一步都站得住。',
    verdict: '你既想飞得高，又要求每一步都有证据。这让你思考质量很高，也让你在需要快速决定时卡住。',
    tip: '给自己设一个「足够好就出发」的时间盒。到点无论推到哪一步，先用现有的走一段。',
  },
  {
    a: 'att_avoidance', b: 'mot_belonging', threshold: 58,
    title: '回避 × 归属渴求',
    voiceA: '靠太近我会窒息。我需要随时能退出去的门。',
    voiceB: '但我又真的很想有一个人，是那种无论怎样都在的人。',
    verdict: '你想要深度连接，同时要求它不能约束你。这两件事可以共存，但需要对方明确同意这个协议。',
    tip: '把「我需要空间」提前说出来，而不是等被逼近才消失。提前说，是协商；事后消失，是伤害。',
  },
  {
    a: 'big5_open', b: 'big5_order', threshold: 58,
    title: '开放 × 秩序',
    voiceA: '我想试试没做过的方式。重复让我觉得活着没意思。',
    voiceB: '但没有结构我什么都做不成。混乱会让我焦虑到无法思考。',
    verdict: '你需要新鲜感，也需要容器。最好的状态是「在稳定的框架里做不稳定的实验」。',
    tip: '把生活切成两块：一块严格按流程，一块完全放开。不要试图让同一件事同时满足两种需求。',
  },
  {
    a: 'light_faith', b: 'schema_mistrust', threshold: 56,
    title: '信任倾向 × 不信任图式',
    voiceA: '我愿意先给出信任。人大多是好的。',
    voiceB: '可我被辜负过。先信任的人，往往伤得最重。',
    verdict: '你天生愿意相信，但被教过一次要小心。所以你常常先伸出手，同时随时准备收回。',
    tip: '分层信任：先给小事，观察，再给大事。不必一次性交出全部，也不必一开始就把门锁死。',
  },
  {
    a: 'enn_3', b: 'enn_4', threshold: 56,
    title: '成就 × 独特',
    voiceA: '我要拿到结果。被认可的成绩是最硬的通货。',
    voiceB: '但我不想成为那种「很成功但很通用」的人。我要有辨识度。',
    verdict: '你既要赢，又要赢得不像别人。这让你的驱动力极强，也让满足感很难持久。',
    tip: '把「被谁认可」写具体。模糊的「被认可」永远不会满足，具体的名字可以。',
  },
  {
    a: 'phil_stoic', b: 'lv_suffering', threshold: 58,
    title: '斯多葛 × 苦难敏感',
    voiceA: '不可控的事不归我管，我只负责自己的姿态。',
    voiceB: '但我确实会痛。装作不痛，只是把痛挪到了看不见的地方。',
    verdict: '你的克制是真的，痛也是真的。问题在于这套系统让你很难开口说「我需要帮忙」。',
    tip: '练习一次不体面的求助：明确告诉某个人「我今天撑不住，你能不能陪我一会儿」。不带理由。',
  },
  {
    a: 'covert_control', b: 'big5_compassion', threshold: 56,
    title: '隐性掌控 × 高共情',
    voiceA: '我知道怎么让事情按我的方向走。这不叫操控，叫懂人。',
    voiceB: '但我又真的在意对方的感受。让他不舒服，我自己也难受。',
    verdict: '你能同时读懂一个人的需求和弱点。这让你的影响力很强，也让你常在「用不用」之间犹豫。',
    tip: '每次想推动别人之前，先问自己一句：如果他知道我在推动，他会怎么想？答案就是边界。',
  },
  {
    a: 'money_vigilance', b: 'time_present_hed', threshold: 56,
    title: '金钱警觉 × 享乐当下',
    voiceA: '钱是退路。多一点，选择就多一点。',
    voiceB: '但人生就这一次。存到死也没花，那些体验过期不补发。',
    verdict: '你既怕不够，又怕白活。这个拉扯在很多人身上都有，只是你的两端都比较响。',
    tip: '给储蓄设一个明确的「够了」阈值，写下来。达到以后，把增量专门花在让自己开心的东西上。',
  },
  {
    a: 'tki_competing', b: 'tki_accommodating', threshold: 56,
    title: '竞争 × 迁就',
    voiceA: '该争的必须争。退一步，别人就会再进一步。',
    voiceB: '但撕破脸太累了。能让一步就让一步，关系比输赢重要。',
    verdict: '你会在不同的对象面前切换成完全不同的人。判断依据往往不是事情本身，而是「这个人值不值得我争」。',
    tip: '把标准写出来：哪些事我一定争，哪些事我永远让。有了名单，临场就不必重算。',
  },
  {
    a: 'jung_ni', b: 'jung_ne', threshold: 58,
    title: '收束直觉 × 发散直觉',
    voiceA: '所有线索最后会收成一个答案，我能感觉到它正在成形。',
    voiceB: '但我脑子里同时有七八条支线，每条都想去看看。',
    verdict: '这是罕见配置：你既会被「终将收束成一条主线」的预感驱动，又忍不住同时向多个方向发散。',
    tip: '给每次直觉冲动贴标签：这是收束型还是发散型。发散型只允许记录，不许立刻行动。',
  },
];

/**
 * @param {Object} scores
 * @returns {Array} 命中的张力对，按两端平均分降序
 */
export function innerParliament(scores, limit = 3) {
  const s = scores || {};
  const out = [];

  for (const p of PARLIAMENT_PAIRS) {
    const av = s[p.a];
    const bv = s[p.b];
    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
    if (av < p.threshold || bv < p.threshold) continue;

    const intensity = round((av + bv) / 2, 1);
    out.push({
      ...p,
      aScore: round(av, 0),
      bScore: round(bv, 0),
      intensity,
      /* 两端越接近，张力越大 */
      balance: round(100 - Math.abs(av - bv), 1),
    });
  }

  return out
    .sort((x, y) => (y.intensity + y.balance * 0.4) - (x.intensity + x.balance * 0.4))
    .slice(0, limit);
}

/* ============================================================
   3 · 时间胶囊
   ============================================================ */

/**
 * 对照两份得分，找出变化最大的维度。
 * @param {Object} past    过往快照的 scores
 * @param {Object} now     当前 scores
 * @param {Object} dimMap
 * @returns {{ rows, top5, meanShift, pastMean, nowMean, verdict }}
 */
export function timelineDiff(past, now, dimMap = {}) {
  const rows = [];

  for (const [dim, nowV] of Object.entries(now || {})) {
    const pastV = past?.[dim];
    if (!Number.isFinite(nowV) || !Number.isFinite(pastV)) continue;
    rows.push({
      id: dim,
      name: dimMap[dim]?.name || dim,
      past: round(pastV, 1),
      now: round(nowV, 1),
      delta: round(nowV - pastV, 1),
    });
  }

  const top5 = [...rows]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);

  const pastMean = rows.length ? round(mean(rows.map((r) => r.past)), 1) : null;
  const nowMean = rows.length ? round(mean(rows.map((r) => r.now)), 1) : null;
  const meanShift = rows.length ? round(nowMean - pastMean, 1) : null;

  const up = top5.filter((r) => r.delta > 0);
  const down = top5.filter((r) => r.delta < 0);

  let verdict = '';
  if (!rows.length) {
    verdict = '两份存档没有重叠维度，无法对照。';
  } else if (Math.abs(meanShift) < 2 && top5.every((r) => Math.abs(r.delta) < 6)) {
    verdict = '这段时间你的整体结构基本没动。稳定本身就是一种信息——要么环境没变，要么你的应对方式很稳。';
  } else if (meanShift > 5) {
    verdict = `整体上调了 ${meanShift} 分：${up[0]?.name || '多个维度'}明显走高。留意这是真的变了，还是这次作答比上次更愿意说自己好。`;
  } else if (meanShift < -5) {
    verdict = `整体下调了 ${Math.abs(meanShift)} 分：${down[0]?.name || '多个维度'}明显走低。如果这段时间确实不顺，这组数字更像一份记录，不是一份判决。`;
  } else {
    verdict = `整体只动了 ${meanShift} 分，但个别维度变化不小。这种「局部漂移」通常说明某一件具体的事改变了你的一部分，而不是整个人。`;
  }

  return { rows, top5, pastMean, nowMean, meanShift, verdict };
}
