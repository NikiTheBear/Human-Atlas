/* ============================================================
   squad.js — 3–6 人小队群像星图

   · 生态位角色分配（定海神针 / 破冰点火器 / 隐形操盘手 /
     气氛调温师 / 冷静风控官 / 长期主义者）
   · N × N 缘分热力矩阵
   · 群体雷达覆盖与共同短板预警
   ============================================================ */

import { clamp, round, mean } from './utils.js';
import { compareStates } from './comparator.js';

/* ------------------------------------------------------------
   1. 生态位角色
   ------------------------------------------------------------ */

export const SQUAD_ROLES = [
  {
    id: 'anchor',
    name: '定海神针',
    latin: 'The Anchor',
    desc: '情绪最稳、最不容易被带动的那一个。事情一乱，所有人会先看他的表情。',
    weights: { big5_order: 1.4, mot_security: 1.4, def_detach: 1.0, att_anxiety: -1.2 },
  },
  {
    id: 'igniter',
    name: '破冰点火器',
    latin: 'The Igniter',
    desc: '沉默一旦超过三秒，他一定开口。他不在乎话题是否完美，只在乎没人尴尬。',
    weights: { big5_social: 1.5, big5_assert: 1.2, hss_novelty: 1.0, big5_compliance: -0.8 },
  },
  {
    id: 'operator',
    name: '隐形操盘手',
    latin: 'The Operator',
    desc: '他很少在群里说话，但真正推动事情的那几条线都在他手上。',
    weights: { covert_control: 1.6, dark_mach: 1.3, cog_global: 1.0, big5_assert: -0.6 },
  },
  {
    id: 'warmer',
    name: '气氛调温师',
    latin: 'The Warmer',
    desc: '谁被冷落了他第一个发现，谁不高兴了他第一个递台阶。整屋的温度由他调。',
    weights: { big5_compassion: 1.5, jung_fe: 1.3, def_fawn: 0.9, big5_assert: -0.4 },
  },
  {
    id: 'risk',
    name: '冷静风控官',
    latin: 'The Risk Officer',
    desc: '所有人都在兴奋时，他是那个说「等一下，这里有问题」的人。',
    weights: { big5_alert: 1.5, cog_logic: 1.3, light_kant: 1.0, big5_open: -0.5 },
  },
  {
    id: 'longhaul',
    name: '长期主义者',
    latin: 'The Long Hauler',
    desc: '他不参与当下的争论，他在算三年后的事。小组里最不显眼也最不可缺的那个。',
    weights: { time_future: 1.4, big5_industry: 1.3, mot_purpose: 1.0, time_present_hed: -0.8 },
  },
];

/**
 * 为每个成员分配生态位。
 * 用加权契合度，同一角色不给两个人（贪心 + 分数降序）。
 */
export function assignRoles(members, DATA) {
  if (!members.length) return [];

  const scored = [];
  for (let i = 0; i < members.length; i += 1) {
    const s = members[i].state.computedScores || {};
    for (const role of SQUAD_ROLES) {
      let acc = 0;
      let wSum = 0;      // 覆盖到的权重（用于算覆盖率）
      let totalW = 0;    // 该角色的全部权重

      for (const [dim, w] of Object.entries(role.weights)) {
        const mag = Math.abs(w);
        totalW += mag;
        const v = s[dim];
        /* 缺测维度按中性 50 计入，而不是直接跳过。
           跳过会让「只测了一维但那一维极高」的人拿到接近 100 的分母归一化，
           于是 1 卷用户能靠单维劫持 16 卷用户的团队角色。 */
        if (!Number.isFinite(v)) {
          acc += 50 * mag;
          wSum += mag;
          continue;
        }
        acc += (w < 0 ? 100 - v : v) * mag;
        wSum += mag;
      }

      if (totalW <= 0) continue;

      /* 覆盖率置信系数（与 matchArchetype() 同一判别力）：
         真正覆盖到的权重占比越低，分数越往 50 收缩。
         全覆盖 → 1.0；只覆盖 25% → 0.75。 */
      let coveredW = 0;
      for (const [dim, w] of Object.entries(role.weights)) {
        if (Number.isFinite(s[dim])) coveredW += Math.abs(w);
      }
      const conf = 0.75 + 0.25 * Math.min(1, coveredW / totalW);
      scored.push({ idx: i, role: role.id, fit: round((acc / totalW) * conf, 1) });
    }
  }

  scored.sort((a, b) => b.fit - a.fit);

  const usedMember = new Set();
  const usedRole = new Set();
  const out = members.map((m, i) => ({
    idx: i,
    name: m.name,
    state: m.state,
    role: null,
    roleFit: 0,
  }));

  for (const s of scored) {
    if (usedMember.has(s.idx) || usedRole.has(s.role)) continue;
    usedMember.add(s.idx);
    usedRole.add(s.role);
    out[s.idx].role = s.role;
    out[s.idx].roleFit = s.fit;
    if (usedMember.size === members.length) break;
  }

  /* 剩下的人（角色数少于人数时）按最高分补 */
  for (const m of out) {
    if (m.role) continue;
    const best = scored.filter((s) => s.idx === m.idx).sort((a, b) => b.fit - a.fit)[0];
    if (best) { m.role = best.role; m.roleFit = best.fit; }
  }

  void DATA;
  return out;
}

export function roleMeta(id) {
  return SQUAD_ROLES.find((r) => r.id === id) || null;
}

/* ------------------------------------------------------------
   2. 缘分热力矩阵
   ------------------------------------------------------------ */

/**
 * @returns {{ matrix: number[][], best: {i,j,score}, worst: {i,j,score} }}
 */
export function affinityMatrix(members, DATA) {
  const n = members.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(null));

  for (let i = 0; i < n; i += 1) {
    matrix[i][i] = 100;
    for (let j = i + 1; j < n; j += 1) {
      let score = null;
      try {
        const res = compareStates(members[i].state, members[j].state, DATA);
        if (res?.ok && Number.isFinite(res.overall)) score = round(res.overall, 1);
      } catch {
        score = null;
      }
      matrix[i][j] = score;
      matrix[j][i] = score;
    }
  }

  const pairs = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (Number.isFinite(matrix[i][j])) pairs.push({ i, j, score: matrix[i][j] });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  return {
    matrix,
    best: pairs[0] || null,
    worst: pairs[pairs.length - 1] || null,
    pairs,
  };
}

/* ------------------------------------------------------------
   3. 群体覆盖与短板
   ------------------------------------------------------------ */

/** 常用能力维度：整个小队在这些轴上的覆盖情况 */
export const COVER_DIMS = [
  'big5_order', 'big5_open', 'big5_assert', 'big5_compassion',
  'cog_global', 'cog_logic', 'mot_autonomy', 'mot_belonging',
  'mot_mastery', 'mot_purpose', 'light_kant', 'dark_mach',
  'tki_collaborating', 'time_future', 'hsp_sensory',
];

/**
 * 每个人的强项是否被整个小队覆盖。
 * 「共同短板」= 所有人在这条轴上都低于 55。
 */
export function coverage(members, DATA) {
  const dims = COVER_DIMS.slice();
  const rows = [];

  for (const d of dims) {
    const vals = members
      .map((m) => m.state.computedScores?.[d])
      .filter(Number.isFinite);
    if (!vals.length) continue;
    const max = Math.max(...vals);
    const avg = mean(vals);
    rows.push({
      dim: d,
      name: DATA.dimMap?.[d]?.name || d,
      max: round(max, 0),
      avg: round(avg, 0),
      covered: max >= 60,
    });
  }

  const gaps = rows.filter((r) => !r.covered);
  const strong = rows.filter((r) => r.covered).sort((a, b) => b.max - a.max);

  return { rows, gaps, strong };
}

/* ------------------------------------------------------------
   4. 小队公约
   ------------------------------------------------------------ */

export function squadCharter(members, roles, gaps) {
  const lines = [];

  const r = (id) => roles.find((x) => x.role === id);

  if (r('operator')) {
    lines.push(`${r('operator').name} 大概率是真正推动事情的人，但他的动作不一定让所有人看见。定期问一句「现在是谁在推」，能省掉很多误会。`);
  }
  if (r('igniter') && r('risk')) {
    lines.push(`${r('igniter').name} 会先冲，${r('risk').name} 会先拦。这不是矛盾，是这支队伍最值钱的一组刹车与油门——只要两个人互相知道对方在做什么。`);
  }
  if (r('warmer')) {
    lines.push(`${r('warmer').name} 承担的调温工作通常不会被记功。把「谁在照顾气氛」明确说出来，能防止这种劳动长期隐形。`);
  }
  if (r('anchor')) {
    lines.push(`${r('anchor').name} 一沉默，全队会本能地紧张。他的稳定是公共资源，也需要被回充——别只在出事时才找他。`);
  }
  if (r('longhaul')) {
    lines.push(`${r('longhaul').name} 说的是三年后的事，容易被当下的紧迫感压过去。每次决策留五分钟专门听这一段。`);
  }

  if (gaps.length) {
    lines.push(`整支队伍在「${gaps.slice(0, 3).map((g) => g.name).join('、')}」上都没有人明显强——这不是谁的错，是结构缺口。要么外请一个补位，要么明确承认这块没人负责。`);
  } else {
    lines.push('这支队伍在常见的能力轴上都有人覆盖，真正的风险不在能力，而在分工是否被说清楚过。');
  }

  return lines;
}
