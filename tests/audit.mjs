#!/usr/bin/env node
/* ============================================================
   audit.mjs — 交付验收脚本（v4.3）

   与 tests/ 下的回归测试不同，本脚本只做「外部可复现的验收」：
   七项检查全部输出人类可读的真实日志，供代码主编逐条核对。

   用法：
     node tests/audit.mjs            # 10000 轮（默认）
     node tests/audit.mjs 2000       # 快速
   ============================================================ */

import { DIMENSIONS, VOLUMES, MIRRORS, ARCHETYPES, CROSS_RULES, DIM_ORDER } from '../src/data/bundle.js';
import { computeAll, questionRange } from '../src/core/scoring.js';
import { encodeSoulCode, decodeSoulCode } from '../src/core/storage.js';
import { matchCrossRules, matchArchetype } from '../src/core/synthesizer.js';
import { pressureSandbox, innerParliament, timelineDiff } from '../src/core/lab.js';
import { encodeJohari, decodeJohari, JOHARI_DIMS } from '../src/core/johari.js';
import { assignRoles, affinityMatrix } from '../src/core/squad.js';
import { LocalOnlyAdapter, getAdapter } from '../src/core/cloudAdapter.js';
import { recordAnswer } from '../src/core/telemetry.js';

const ROUNDS = Number(process.argv[2]) || 10000;

const DATA = {
  dimensions: DIMENSIONS,
  volumes: VOLUMES,
  mirrors: MIRRORS,
  archetypes: ARCHETYPES,
  crossRules: CROSS_RULES,
  dimOrder: DIM_ORDER,
  dimMap: Object.fromEntries(DIMENSIONS.dims.map((d) => [d.id, d])),
  values: DIMENSIONS.values || [],
};

const VOL_IDS = Object.keys(VOLUMES).sort((a, b) => VOLUMES[a].index - VOLUMES[b].index);
const VALID = new Set(DIM_ORDER);

const line = (c = '─') => c.repeat(72);
const hr = (t) => { console.log(`\n${line()}`); console.log(`  ${t}`); console.log(line()); };

const issues = [];
const fail = (m) => { issues.push(m); console.log(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

/* ============================================================
   1. 完整性校验
   ============================================================ */
hr('1 · 完整性校验：卷 / 题 / 维度 / 双面镜覆盖');

let totalQ = 0;
const perVol = [];
for (const vid of VOL_IDS) {
  const v = VOLUMES[vid];
  totalQ += v.questions.length;
  perVol.push(`${vid}(${v.questions.length})`);
}
console.log(`  卷数        ${VOL_IDS.length}`);
console.log(`  题数        ${totalQ}`);
console.log(`  维度数      ${DIMENSIONS.dims.length}`);
console.log(`  双面镜条目   ${Object.keys(MIRRORS).length}`);
console.log(`  原型        ${ARCHETYPES.archetypes.length}`);
console.log(`  跨卷规则     ${CROSS_RULES.length}`);
console.log(`  逐卷题量     ${perVol.join(' ')}`);

const missingMirror = DIMENSIONS.dims.filter((d) => !MIRRORS[d.id]).map((d) => d.id);
if (missingMirror.length) fail(`双面镜缺失 ${missingMirror.length} 维：${missingMirror.join(', ')}`);
else ok(`双面镜 100% 覆盖 ${DIMENSIONS.dims.length} 维`);

const emptyFace = [];
for (const [dim, m] of Object.entries(MIRRORS)) {
  for (const side of ['high', 'low']) {
    for (const f of ['label', 'gift_title', 'gift_desc', 'shadow_title', 'shadow_desc', 'alchemy_tip']) {
      if (!m?.[side]?.[f]) emptyFace.push(`${dim}.${side}.${f}`);
    }
  }
}
if (emptyFace.length) fail(`双面镜空字段 ${emptyFace.length} 处：${emptyFace.slice(0, 6).join(', ')}`);
else ok('双面镜 127×2×6 字段全部非空');

const dupIds = [];
const seenId = new Set();
for (const vid of VOL_IDS) {
  for (const q of VOLUMES[vid].questions) {
    if (seenId.has(q.id)) dupIds.push(q.id);
    seenId.add(q.id);
  }
}
if (dupIds.length) fail(`题目 id 重复：${dupIds.join(', ')}`);
else ok(`题目 id 全局唯一（${seenId.size} 个）`);

/* ============================================================
   2. 幽灵维度键审计
   ============================================================ */
hr('2 · 幽灵维度键审计（目标 0）');

const ghost = [];
const scanObj = (obj, where) => {
  for (const k of Object.keys(obj || {})) if (!VALID.has(k)) ghost.push(`${where} → ${k}`);
};

for (const vid of VOL_IDS) {
  for (const q of VOLUMES[vid].questions) {
    const at = `${vid}/${q.id}`;
    scanObj(q.effects, `${at}.effects`);
    for (const o of q.options || []) scanObj(o.effects, `${at}.options[${o.key}]`);
    for (const it of q.items || []) {
      if (it.dim && !VALID.has(it.dim)) ghost.push(`${at}.items[${it.key}].dim → ${it.dim}`);
      scanObj(it.effects, `${at}.items[${it.key}]`);
    }
    for (const v of q.values || []) scanObj(v.effects, `${at}.values[${v.key}]`);
  }
}

for (const r of CROSS_RULES) {
  for (const c of r.conditions || []) {
    if (c.dim !== 'mask' && !VALID.has(c.dim)) ghost.push(`CROSS_RULES/${r.id}.conditions → ${c.dim}`);
  }
}
for (const a of ARCHETYPES.archetypes) {
  for (const k of Object.keys(a.weights || {})) if (!VALID.has(k)) ghost.push(`ARCHETYPES/${a.id}.weights → ${k}`);
  for (const k of Object.keys(a.negWeights || {})) if (!VALID.has(k)) ghost.push(`ARCHETYPES/${a.id}.negWeights → ${k}`);
}

if (ghost.length) fail(`幽灵键 ${ghost.length} 处：${ghost.slice(0, 10).join('; ')}`);
else ok('题库 / 跨卷规则 / 原型：幽灵维度键 0 处');

/* ============================================================
   3. 配置合法性
   ============================================================ */
hr('3 · 配置合法性：budget_100 / pyramid_top3 / stealth_scale');

const badBudget = [];
const badScale = [];
let nanRange = 0;
let pyramidChecked = 0;
let budgetChecked = 0;

for (const vid of VOL_IDS) {
  for (const q of VOLUMES[vid].questions) {
    if (q.type === 'budget_100') {
      budgetChecked += 1;
      for (const it of q.items || []) {
        if (Number(it.gain) < 0) badBudget.push(`${q.id}[${it.key}] gain=${it.gain}`);
        if (it.base !== undefined && Number(it.base) !== 0) badBudget.push(`${q.id}[${it.key}] base=${it.base}`);
      }
    }
    if (q.type === 'pyramid_top3') {
      pyramidChecked += 1;
      const dims = new Set();
      for (const v of q.values || []) Object.keys(v.effects || {}).forEach((k) => dims.add(k));
      for (const d of dims) {
        const r = questionRange(q, d);
        if (!r) continue;
        if (!Number.isFinite(r.lo) || !Number.isFinite(r.hi) || !Number.isFinite(r.center)) {
          nanRange += 1;
          fail(`${q.id} 维度 ${d} 区间含 NaN`);
        }
      }
    }
    if (q.type === 'stealth_scale') {
      for (const [d, r] of Object.entries(q.effects || {})) {
        const bad = !Array.isArray(r) || r.length !== 2 || !r.every((x) => Number.isFinite(Number(x)));
        if (bad) badScale.push(`${q.id}.${d} = ${JSON.stringify(r)}`);
      }
    }
  }
}

if (badBudget.length) fail(`筹码题配置异常 ${badBudget.length} 处：${badBudget.slice(0, 8).join('; ')}`);
else ok(`${budgetChecked} 道筹码题：无负 gain、base 全为 0`);

if (nanRange === 0) ok(`${pyramidChecked} 道金字塔题：所有维度区间均为有限数（无 NaN）`);

if (badScale.length) fail(`量表 effects 非二元数组 ${badScale.length} 处：${badScale.slice(0, 6).join('; ')}`);
else ok('全部 stealth_scale 的 effects 均为长度 2 的数值数组');

/* ============================================================
   4. 维度覆盖度表
   ============================================================ */
hr('4 · 维度覆盖度：有效题数 < 2 的薄弱维度');

const coverCount = {};
const dimsOfQuestion = (q) => {
  const s = new Set();
  const add = (o) => Object.keys(o || {}).forEach((k) => VALID.has(k) && s.add(k));
  if (q.type === 'budget_100') {
    for (const it of q.items || []) {
      if (it.dim) s.add(it.dim);
      add(it.effects);
    }
  } else if (q.type === 'pyramid_top3') {
    for (const v of q.values || []) add(v.effects);
  } else if (q.type === 'stealth_scale') {
    add(q.effects);
  } else {
    for (const o of q.options || []) add(o.effects);
  }
  return s;
};

for (const vid of VOL_IDS) {
  for (const q of VOLUMES[vid].questions) {
    for (const d of dimsOfQuestion(q)) {
      coverCount[d] = (coverCount[d] || 0) + 1;
    }
  }
}

const thin = DIM_ORDER.filter((d) => (coverCount[d] || 0) < 2);
const sorted = [...DIM_ORDER].sort((a, b) => (coverCount[a] || 0) - (coverCount[b] || 0));
console.log('  最薄的 10 维（题数）：');
sorted.slice(0, 10).forEach((d) => {
  console.log(`    ${d.padEnd(24)} ${String(coverCount[d] || 0).padStart(3)} 题   ${DATA.dimMap[d]?.name || ''}`);
});
const counts = DIM_ORDER.map((d) => coverCount[d] || 0);
console.log(`  覆盖题数区间 ${Math.min(...counts)} ~ ${Math.max(...counts)}`);
if (thin.length) fail(`薄弱维度 ${thin.length} 个（<2 题）：${thin.join(', ')}`);
else ok('所有 127 维覆盖题数 ≥ 2');

/* ============================================================
   5. 蒙特卡洛
   ============================================================ */
hr(`5 · 蒙特卡洛仿真：${ROUNDS} 轮（随机 + 高赞许 + 低赞许）`);

const nRandom = Math.round(ROUNDS * 0.5);
const nHigh = Math.round(ROUNDS * 0.25);
const nLow = ROUNDS - nRandom - nHigh;
console.log(`  随机作答 ${nRandom} · 极端高社会期许 ${nHigh} · 极端低社会期许 ${nLow}`);

function gauss() {
  let u = 0; let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function makePersona() {
  const p = {};
  for (const d of DIM_ORDER) p[d] = gauss();
  return p;
}

function emptyState(nickname = '') {
  return {
    version: '4.0', nickname, createdAt: Date.now(), updatedAt: Date.now(),
    completedVolumes: [], inProgress: {}, answersByVolume: {}, computedScores: {},
    maskIndex: null, topValues: [], initialSnapshot: {}, flags: {}, telemetry: {},
  };
}

/** 按潜在特质作答（随机画像） */
function answerRandom(state, persona) {
  for (const vid of VOL_IDS) {
    const ans = (state.answersByVolume[vid] ||= {});
    for (const q of VOLUMES[vid].questions) {
      let value;
      if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
        let best = null; let bs = -Infinity;
        for (const o of q.options || []) {
          let s = 0;
          for (const [d, w] of Object.entries(o.effects || {})) s += (persona[d] ?? 0) * Number(w || 0);
          s += gauss();
          if (s > bs) { bs = s; best = o.key; }
        }
        value = best;
      } else if (q.type === 'stealth_scale') {
        let t = 0;
        for (const [d, r] of Object.entries(q.effects || {})) {
          if (Array.isArray(r)) t += (persona[d] ?? 0) * (r[1] - r[0]) * 0.5;
        }
        value = Math.max(1, Math.min(7, Math.round(1 + (1 / (1 + Math.exp(-(t + gauss())))) * 6)));
      } else if (q.type === 'budget_100') {
        const items = q.items || [];
        const raw = items.map((it) => Math.exp((persona[it.dim] ?? 0) * 0.8 + gauss() * 0.4));
        const sum = raw.reduce((a, b) => a + b, 0) || 1;
        const map = {};
        let used = 0;
        items.forEach((it, i) => { const p = Math.floor((raw[i] / sum) * 100); map[it.key] = p; used += p; });
        let rest = 100 - used; let i = 0;
        while (rest > 0) { map[items[i % items.length].key] += 1; rest -= 1; i += 1; }
        value = map;
      } else {
        const vals = [...(q.values || [])].sort((a, b) => {
          const sa = Object.entries(a.effects || {}).reduce((x, [d, w]) => x + (persona[d] ?? 0) * w, 0);
          const sb = Object.entries(b.effects || {}).reduce((x, [d, w]) => x + (persona[d] ?? 0) * w, 0);
          return sb - sa;
        });
        value = vals.slice(0, 3).map((v) => v.key);
      }
      const ms = 5000 + Math.round(Math.random() * 3000);
      ans[q.id] = { value, ms, changes: 0, at: Date.now() };
      // 必须走真实 recordAnswer，dirty 判定才会按动态阈值生效
      recordAnswer(state, { questionId: q.id, question: q, ms, changes: 0 });
    }
    state.completedVolumes.push(vid);
  }
  return state;
}

/** 极端社会期许作答：high=true 总选最体面，false 总选最不体面 */
function answerExtreme(state, high) {
  const pick = (arr) => {
    const s = [...arr].sort((a, b) => (a.social_desirability || 0) - (b.social_desirability || 0));
    return high ? s[s.length - 1] : s[0];
  };
  for (const vid of VOL_IDS) {
    const ans = (state.answersByVolume[vid] ||= {});
    for (const q of VOLUMES[vid].questions) {
      let value;
      if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
        value = pick(q.options || [])?.key;
      } else if (q.type === 'stealth_scale') {
        const wantRight = q.scale?.sdHigh === 'right';
        value = (wantRight === high) ? 7 : 1;
      } else if (q.type === 'budget_100') {
        const items = q.items || [];
        const base = Math.floor(100 / items.length);
        const map = {};
        let rest = 100 - base * items.length;
        items.forEach((it, i) => { map[it.key] = base + (i < rest ? 1 : 0); });
        value = map;
      } else {
        value = (q.values || []).slice(0, 3).map((v) => v.key);
      }
      const ms = 6000 + Math.round(Math.random() * 3000);
      ans[q.id] = { value, ms, changes: 0, at: Date.now() };
      recordAnswer(state, { questionId: q.id, question: q, ms, changes: 0 });
    }
    state.completedVolumes.push(vid);
  }
  return state;
}

/**
 * 补充画像 A · 伪装者：每题都挑最体面的一项，且敏感题上超长犹豫。
 * 这是 D_sd 与 H_lat 同时拉满的唯一人群。
 */
function answerFaker(state) {
  for (const vid of VOL_IDS) {
    const ans = (state.answersByVolume[vid] ||= {});
    for (const q of VOLUMES[vid].questions) {
      let value;
      if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
        const score = (o) => (o.social_desirability || 0) * 2
          + Number(o.effects?.def_intellectual || 0) * 3;
        value = [...(q.options || [])].sort((a, b) => score(b) - score(a))[0]?.key;
      } else if (q.type === 'stealth_scale') {
        const di = q.effects?.def_intellectual;
        if (Array.isArray(di) && di[1] > 0) value = 7;
        else value = q.scale?.sdHigh === 'right' ? 7 : 1;
      } else if (q.type === 'budget_100') {
        const items = q.items || [];
        const base = Math.floor(100 / items.length);
        const map = {};
        let rest = 100 - base * items.length;
        items.forEach((it, i) => { map[it.key] = base + (i < rest ? 1 : 0); });
        value = map;
      } else {
        value = (q.values || []).slice(0, 3).map((v) => v.key);
      }
      const chars = (q.prompt || '').length + (q.context || '').length;
      const ms = Math.round(Math.max(2500, chars * 200) * (q.is_sensitive ? 3.9 : 1));
      const changes = q.is_sensitive ? 3 : 0;
      ans[q.id] = { value, ms, changes, at: Date.now() };
      recordAnswer(state, { questionId: q.id, question: q, ms, changes });
    }
    state.completedVolumes.push(vid);
  }
  return state;
}

/**
 * 补充画像 B · 双面者：明线题一律挑最不体面的，暗线题一律挑最体面的。
 * 用来把 G_mirror（镜像撕裂度）拉到最大值。
 */
function answerSplit(state) {
  for (const vid of VOL_IDS) {
    const ans = (state.answersByVolume[vid] ||= {});
    for (const q of VOLUMES[vid].questions) {
      const stealth = q.layer === 'stealth';
      let value;
      if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
        const score = (o) => {
          const sd = o.social_desirability || 0;
          const di = Number(o.effects?.def_intellectual || 0);
          return (stealth ? -sd * 2 : sd * 2) + di * 3;
        };
        value = [...(q.options || [])].sort((a, b) => score(b) - score(a))[0]?.key;
      } else if (q.type === 'stealth_scale') {
        const di = q.effects?.def_intellectual;
        if (Array.isArray(di)) value = di[1] > di[0] ? 7 : 1;
        else value = q.scale?.sdHigh === 'right' ? 1 : 7;
      } else if (q.type === 'budget_100') {
        const items = q.items || [];
        const base = Math.floor(100 / items.length);
        const map = {};
        let rest = 100 - base * items.length;
        items.forEach((it, i) => { map[it.key] = base + (i < rest ? 1 : 0); });
        value = map;
      } else {
        value = (q.values || []).slice(0, 3).map((v) => v.key);
      }
      const chars = (q.prompt || '').length + (q.context || '').length;
      const ms = Math.round(Math.max(2500, chars * 200) * 3.2);
      ans[q.id] = { value, ms, changes: 3, at: Date.now() };
      recordAnswer(state, { questionId: q.id, question: q, ms, changes: 3 });
    }
    state.completedVolumes.push(vid);
  }
  return state;
}

/**
 * 补充画像 C · 尖刺型：随机挑 12–24 个维度推到极高 / 极低，
 * 其余维度保持中性。这是唯一能覆盖「两三个特定维度同时达标」
 * 这类跨卷规则（如 CR_06 需要 mot_autonomy 与 mot_security 同时偏高）的画像。
 */
function makeSpikyPersona() {
  const p = {};
  for (const d of DIM_ORDER) p[d] = 0;
  const k = 12 + Math.floor(Math.random() * 13);
  const picks = [...DIM_ORDER].sort(() => Math.random() - 0.5).slice(0, k);
  picks.forEach((d) => { p[d] = Math.random() < 0.5 ? 2.6 : -2.6; });
  return p;
}

const t0 = Date.now();
const bucket = {};
for (const d of DIM_ORDER) bucket[d] = [];
const fired = new Set();
let nanCount = 0;
let infCount = 0;
let oobCount = 0;
let nullCount = 0;

for (let r = 0; r < ROUNDS; r += 1) {
  let st;
  if (r < nRandom) st = answerRandom(emptyState(), makePersona());
  else if (r < nRandom + nHigh) st = answerExtreme(emptyState(), true);
  else st = answerExtreme(emptyState(), false);

  const all = computeAll(st, DATA);
  for (const d of DIM_ORDER) {
    const v = all.scores[d];
    if (v === null || v === undefined) { nullCount += 1; continue; }
    if (Number.isNaN(v)) { nanCount += 1; continue; }
    if (!Number.isFinite(v)) { infCount += 1; continue; }
    if (v < 0 || v > 100) { oobCount += 1; continue; }
    bucket[d].push(v);
  }
  const cross = matchCrossRules(all.scores, { value: all.mask.value }, CROSS_RULES, st.completedVolumes);
  cross.forEach((c) => fired.add(c.id));
}

console.log(`  （耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，${ROUNDS} 轮 × ${DIM_ORDER.length} 维）`);

// ---- 规则可达性补充阶段 ----
// 主循环按文档规定的 50/25/25 配比，这三类画像天然不会触发面具类规则
// （面具厚度 M 需要「高社会期许 + 高犹豫」或「明暗撕裂」这类特定结构）。
// 因此额外跑 600 轮补充画像，只为验证 CROSS_RULES 不存在死规则。
const SUPPLEMENT = 1200;
const t1 = Date.now();
for (let r = 0; r < SUPPLEMENT; r += 1) {
  const mode = r % 3;
  const st = mode === 0
    ? answerFaker(emptyState())
    : mode === 1
      ? answerSplit(emptyState())
      : answerRandom(emptyState(), makeSpikyPersona());
  const all = computeAll(st, DATA);
  const cross = matchCrossRules(all.scores, { value: all.mask.value }, CROSS_RULES, st.completedVolumes);
  cross.forEach((c) => fired.add(c.id));
}
console.log(`  规则可达性补充画像 ${SUPPLEMENT} 轮（伪装者 / 双面者 / 尖刺型）· ${((Date.now() - t1) / 1000).toFixed(1)}s`);

if (nanCount) fail(`NaN ${nanCount} 次`);
else ok('NaN：0 次');
if (infCount) fail(`Infinity ${infCount} 次`);
else ok('Infinity：0 次');
if (oobCount) fail(`越界分（<0 或 >100）${oobCount} 次`);
else ok('越界分（<0 或 >100）：0 次');
if (nullCount) console.log(`  · 未测维度（null）${nullCount} 次（各轮覆盖卷数不同所致，非错误）`);

const stat = DIM_ORDER.map((d) => {
  const a = bucket[d];
  const n = a.length;
  const mean = n ? a.reduce((x, y) => x + y, 0) / n : 0;
  const sd = n ? Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / n) : 0;
  return { d, n, mean, sd };
});

const drift = stat.filter((s) => s.mean < 30 || s.mean > 70);
if (drift.length) {
  fail(`均值偏移（<30 或 >70）${drift.length} 维：${drift.map((s) => `${s.d}(${s.mean.toFixed(1)})`).join(', ')}`);
} else ok('均值偏移维度（<30 或 >70）：0 个');

const rigid = stat.filter((s) => s.sd < 8);
if (rigid.length) {
  fail(`僵化维度（标准差 <8）${rigid.length} 维：${rigid.map((s) => `${s.d}(sd=${s.sd.toFixed(1)})`).join(', ')}`);
} else ok('僵化维度（标准差 <8）：0 个');

const deadRules = CROSS_RULES.filter((r) => !fired.has(r.id)).map((r) => r.id);
if (deadRules.length) fail(`死规则 ${deadRules.length} 条：${deadRules.join(', ')}`);
else ok(`跨卷规则全部命中（${fired.size}/${CROSS_RULES.length}）`);

const sds = stat.map((s) => s.sd);
console.log(`  区分度：sd 区间 ${Math.min(...sds).toFixed(1)} ~ ${Math.max(...sds).toFixed(1)}`);
const means = stat.map((s) => s.mean);
console.log(`  均值区间：${Math.min(...means).toFixed(1)} ~ ${Math.max(...means).toFixed(1)}`);

/* ============================================================
   6. HA4- 存档码往返
   ============================================================ */
hr('6 · HA4- 存档码往返：1 卷 / 8 卷 / 16 卷 + 中文昵称');

function stateWithVolumes(ids, nickname) {
  const st = emptyState(nickname);
  for (const vid of ids) {
    const ans = (st.answersByVolume[vid] ||= {});
    for (const q of VOLUMES[vid].questions) {
      let value;
      if (q.type === 'forced_choice' || q.type === 'impulse_3s') value = q.options[0].key;
      else if (q.type === 'stealth_scale') value = 5;
      else if (q.type === 'budget_100') {
        const items = q.items;
        const base = Math.floor(100 / items.length);
        const map = {};
        let rest = 100 - base * items.length;
        items.forEach((it, i) => { map[it.key] = base + (i < rest ? 1 : 0); });
        value = map;
      } else value = q.values.slice(0, 3).map((v) => v.key);
      ans[q.id] = { value, ms: 6000, changes: 0 };
      recordAnswer(st, { questionId: q.id, question: q, ms: 6000, changes: 0 });
    }
    st.completedVolumes.push(vid);
  }
  const all = computeAll(st, DATA);
  st.computedScores = {};
  for (const d of DIM_ORDER) if (Number.isFinite(all.scores[d])) st.computedScores[d] = all.scores[d];
  st.maskIndex = all.mask.value;
  st.topValues = all.topValues || [];
  return st;
}

for (const [label, ids] of [
  ['1 卷', VOL_IDS.slice(0, 1)],
  ['8 卷', VOL_IDS.slice(0, 8)],
  ['16 卷', VOL_IDS],
]) {
  const st = stateWithVolumes(ids, '张伟');
  const code = encodeSoulCode(st, DIM_ORDER);
  const back = decodeSoulCode(code, DIM_ORDER);
  const dimCount = Object.keys(st.computedScores).length;
  if (!back.ok) { fail(`${label} 解码失败：${back.error}`); continue; }
  const scoredDims = Object.keys(back.state.computedScores).length;
  // HA4- 每维用 1 个字节存 0–100 的整数，所以「取整后」必须完全一致；
  // 「未取整」时最多 0.5 的量化误差，这是格式本身的设计，不是数据丢失。
  let maxErrRounded = 0;
  let maxErrRaw = 0;
  for (const [d, v] of Object.entries(st.computedScores)) {
    const got = back.state.computedScores[d] ?? 0;
    maxErrRounded = Math.max(maxErrRounded, Math.abs(Math.round(v) - got));
    maxErrRaw = Math.max(maxErrRaw, Math.abs(v - got));
  }
  const volsOk = back.state.completedVolumes.length === ids.length;
  const nameOk = back.state.nickname === '张伟';
  console.log(
    `  ${label.padEnd(5)} 码长 ${String(code.length).padStart(4)} · `
    + `维度 ${String(scoredDims).padStart(3)}/${dimCount} · `
    + `误差（取整后）${maxErrRounded} · 量化误差 ${maxErrRaw.toFixed(2)} · `
    + `卷 ${volsOk ? '✓' : '✗'} 昵称 ${nameOk ? '✓' : '✗'}`,
  );
  if (!volsOk) fail(`${label} 完成卷数不一致`);
  if (!nameOk) fail(`${label} 昵称未保留`);
  if (maxErrRounded !== 0) fail(`${label} 分数误差 ${maxErrRounded}（要求 0）`);
  if (maxErrRounded === 0 && volsOk && nameOk) {
    ok(`${label} 往返：取整后误差 0（1 字节/维的量化误差上限 0.5），卷数与昵称一致`);
  }
}

/* ---------- 4b. Phase 3/4 新模块的自我校验 ---------- */
{
  const chk = (name, cond, detail = '') => {
    if (cond) ok(`${name}${detail ? ` · ${detail}` : ''}`);
    else fail(`${name}${detail ? ` · ${detail}` : ''}`);
  };

  // 沙盒：能量两端反向且不越界
  const probe = {};
  for (const d of DIM_ORDER) probe[d] = 55;
  probe.sin_pride = 70; probe.mot_autonomy = 70;
  const lo = pressureSandbox(probe, 0);
  const hi = pressureSandbox(probe, 100);
  chk('沙盒：耗竭时暗面上行、明面下行',
    lo.scores.sin_pride > 70 && lo.scores.mot_autonomy < 70);
  chk('沙盒：充沛时反向', hi.scores.sin_pride < 70 && hi.scores.mot_autonomy > 70);
  chk('沙盒：不越界',
    Object.values(lo.scores).every((v) => v >= 0 && v <= 100));

  // 议会
  const parl = innerParliament({ ...probe, mot_security: 68, att_anxiety: 66 }, 3);
  chk('议会：能命中张力对', parl.length > 0, `${parl.length}`);
  chk('议会：每对都有双声部', parl.every((x) => x.voiceA && x.voiceB && x.verdict));

  // 时间胶囊
  const diff = timelineDiff({ ...probe, sin_pride: 40 }, probe, DATA.dimMap);
  chk('时间胶囊：能算出变化', diff.rows.length > 0 && diff.top5.length > 0);

  // 乔哈里
  const jc = encodeJohari(probe, '检测');
  const jd = decodeJohari(jc);
  chk('乔哈里：HA4J 往返', jd.ok && Object.keys(jd.scores).length === JOHARI_DIMS.length,
    `${jc.length} 字符`);

  // 群像
  const mkM = (name, over) => ({
    name,
    state: { computedScores: { ...probe, ...over }, completedVolumes: ['vol1', 'vol2', 'vol3'], maskIndex: 50 },
  });
  const squad3 = [
    mkM('一', { big5_order: 76, mot_security: 74 }),
    mkM('二', { big5_social: 78, big5_assert: 72 }),
    mkM('三', { covert_control: 76, dark_mach: 72 }),
  ];
  const roles = assignRoles(squad3, DATA);
  chk('群像：三人三种角色', new Set(roles.map((r) => r.role)).size === 3);
  const affM = affinityMatrix(squad3, DATA);
  chk('群像：矩阵对称且对角为 100',
    affM.matrix[0][0] === 100 && affM.matrix[0][1] === affM.matrix[1][0]);

  // 云端适配器：默认不联网、未同意不写入
  const silent = await LocalOnlyAdapter.saveAnonymousSample(
    { computedScores: probe, maskIndex: 50, completedVolumes: [] },
    DIM_ORDER,
  );
  chk('云端适配器：未同意时跳过', silent.skipped === true);
  chk('云端适配器：默认本地实现', getAdapter().name === 'local-only');
}

/* ---------- 5a. 原型覆盖率闸门 ---------- */
// 只完成 Vol.6 的用户，不该命中任何需要 Vol.14 维度（money_*）的原型。
{
  const sar = matchArchetype(
    { mot_autonomy: 80, mot_mastery: 78, mot_belonging: 76, mot_security: 82, mot_purpose: 74, mot_hedonism: 70 },
    ARCHETYPES,
  );

  const chk = (name, cond, detail = '') => {
    if (cond) ok(`${name}${detail ? ` · ${detail}` : ''}`);
    else fail(`${name}${detail ? ` · ${detail}` : ''}`);
  };

  chk('只测 Vol.6 时无原型达标', sar.eligible === false, `eligible=${sar.eligible}`);

  const moneyArchetypes = ARCHETYPES.archetypes.filter(
    (a) => Object.keys(a.weights || {}).some((d) => d.startsWith('money_'))
      || Object.keys(a.negWeights || {}).some((d) => d.startsWith('money_')),
  );
  chk('存在依赖 money_* 的原型', moneyArchetypes.length > 0, `${moneyArchetypes.length} 个`);

  const wronglyPassed = (sar.pool || sar.ranked || []).filter(
    (r) => r.eligible && moneyArchetypes.some((a) => a.id === r.id),
  );
  chk('依赖 money_* 的原型全部被覆盖率拦截', wronglyPassed.length === 0,
    wronglyPassed.map((r) => r.id).join(','));

  // 全维度测完时，覆盖率闸门不该误伤
  const full = {};
  for (const d of DIM_ORDER) full[d] = 70;
  const fullRes = matchArchetype(full, ARCHETYPES);
  chk('全维测完时有原型达标', fullRes.eligible === true, fullRes.best?.id || '');
  chk('全维测完时覆盖率为 1', Math.abs(fullRes.coverage - 1) < 1e-6, `${fullRes.coverage}`);
  chk('fit 经过覆盖率置信惩罚', fullRes.best.fit <= fullRes.best.rawFit,
    `${fullRes.best.fit} <= ${fullRes.best.rawFit}`);
}

/* ---------- 5b. DIM_ORDER 前 60 位与 v3 冻结顺序一致 ---------- */
// HA3- 的兼容解码完全依赖这个假设：注册表前 60 位就是本源八卷的 60 维，
// 且位序从未变动。任何一次重排都会让老存档码静默错位。
const V3_FROZEN = [
  'sin_pride', 'virtue_humility', 'sin_greed', 'virtue_charity',
  'sin_lust', 'virtue_chastity', 'sin_envy', 'virtue_kindness',
  'sin_gluttony', 'virtue_temperance', 'sin_wrath', 'virtue_patience',
  'sin_sloth', 'virtue_diligence',
  'big5_open', 'big5_aesthetic', 'big5_order', 'big5_industry', 'big5_social',
  'big5_assert', 'big5_compassion', 'big5_compliance', 'big5_alert', 'big5_rumination',
  'dark_mach', 'dark_narc', 'dark_psycho',
  'light_humanism', 'light_kant', 'light_faith', 'covert_control',
  'wv_nature', 'wv_causal', 'wv_social',
  'lv_happiness', 'lv_suffering', 'lv_anchor',
  'val_moral', 'val_boundary', 'val_standard',
  'cog_global', 'cog_diverge', 'cog_logic', 'cog_ambiguity', 'cog_independent', 'cog_speed',
  'mot_autonomy', 'mot_mastery', 'mot_belonging', 'mot_security', 'mot_purpose', 'mot_hedonism',
  'att_anxiety', 'att_avoidance',
  'def_intellectual', 'def_detach', 'def_sublimate', 'def_attack', 'def_fawn', 'def_project',
];

const prefixMismatch = [];
V3_FROZEN.forEach((id, i) => {
  if (DIM_ORDER[i] !== id) prefixMismatch.push(`#${i} 期望 ${id} 实得 ${DIM_ORDER[i]}`);
});
if (prefixMismatch.length) {
  fail(`DIM_ORDER 前 60 位与 v3 冻结顺序不一致 ${prefixMismatch.length} 处：${prefixMismatch.slice(0, 5).join('; ')}`);
} else {
  ok('DIM_ORDER 前 60 位与 v3 冻结顺序 100% 一致（HA3- 兼容前提成立）');
}

/* ---------- 5c. 真实 HA3- 存档码兼容解码 ---------- */
// 手工构造一条 v3 字节串：版本 3 + 8 位卷掩码 + 面具 + Top3 索引 + 60 维 + 昵称 + 校验和
function buildHA3() {
  const body = [3, 0b00000101, 58];          // 完成 vol1 + vol3，面具 58
  body.push(0, 3, 5);                        // Top3 价值索引：freedom / intimacy / ease
  for (let i = 0; i < 60; i += 1) {
    body.push(i < 20 ? 40 + i : 255);        // 前 20 维给分数，其余未测
  }
  const nameBytes = [...new TextEncoder().encode('老存档')];
  body.push(...nameBytes);

  let h = 0x1f;
  for (const b of body) h = ((h * 31) + b) & 0xff;
  body.push(h);

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < body.length; i += 3) {
    const b0 = body[i]; const b1 = body[i + 1]; const b2 = body[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 63];
  }
  return `HA3-${out}`;
}

const ha3 = buildHA3();
const ha3Decoded = decodeSoulCode(ha3, DIM_ORDER);
if (!ha3Decoded.ok) {
  fail(`HA3- 兼容解码失败：${ha3Decoded.error}`);
} else {
  const vols = ha3Decoded.state.completedVolumes.join(',');
  const dims = Object.keys(ha3Decoded.state.computedScores).length;
  const nameOk = ha3Decoded.state.nickname === '老存档';
  const maskOk = ha3Decoded.state.maskIndex === 58;
  const firstOk = ha3Decoded.state.computedScores.sin_pride === 40;
  console.log(`  HA3- 样本 ${ha3.length} 字符 → 卷 [${vols}] · 维度 ${dims} · `
    + `昵称 ${nameOk ? '✓' : '✗'} 面具 ${maskOk ? '✓' : '✗'} 首维 ${firstOk ? '✓' : '✗'}`);
  if (vols === 'vol1,vol3' && dims === 20 && nameOk && maskOk && firstOk) {
    ok('HA3- 老码兼容解码正确（vol1+vol3 / 20 维 / 中文昵称 / 面具 58）');
  } else {
    fail('HA3- 老码解码结果不符预期');
  }
}

/* ============================================================
   7. 文本污染扫描
   ============================================================ */
hr('7 · 文本污染扫描（目标 0）');

const PATTERNS = [
  ['林舟', '黑名单人名'],
  ['沈明', '黑名单人名'],
  ['陆言', '黑名单人名'],
  ['你的一位表姐', '复读称呼'],
  ['你的一位大学室友', '复读称呼'],
  ['你的一位前同事', '复读称呼'],
  ['先先', '输入噪声'],
  ['部门群', '职场残留'],
  ['季度复盘', '职场残留'],
];

const pollution = [];
for (const vid of VOL_IDS) {
  for (const q of VOLUMES[vid].questions) {
    const blob = JSON.stringify(q);
    for (const [pat, kind] of PATTERNS) {
      if (blob.includes(pat)) pollution.push(`${q.id} ← 「${pat}」(${kind})`);
    }
  }
}

for (const [pat] of PATTERNS) {
  const hit = pollution.filter((x) => x.includes(`「${pat}」`));
  console.log(`  ${pat.padEnd(10)} ${hit.length === 0 ? '0' : String(hit.length)}`);
}
if (pollution.length) fail(`文本污染 ${pollution.length} 处：${pollution.slice(0, 8).join('; ')}`);
else ok('九类污染词全部 0 命中');

/* ============================================================
   汇总
   ============================================================ */
hr('汇总');
if (issues.length) {
  console.log(`  失败 ${issues.length} 项：`);
  issues.forEach((x, i) => console.log(`   ${i + 1}. ${x}`));
} else {
  console.log('  全部 7 项检查通过 · 0 失败');
}
console.log(line());
process.exit(issues.length ? 1 : 0);
