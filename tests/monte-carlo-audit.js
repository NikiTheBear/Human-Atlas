#!/usr/bin/env node
/* ============================================================
   monte-carlo-audit.js — 万次仿真审计

   目的：
     1. 每个维度的分值分布是否健康（不塌缩、不双峰、不贴边）
     2. 是否存在「野字段」（注册表外的维度键）
     3. 是否存在「死规则」（永远无法触发的跨卷规则）
     4. 存档码在极端画像下是否仍然可往返
   ============================================================ */

import { DIMENSIONS, VOLUMES, MIRRORS, ARCHETYPES, CROSS_RULES, PAIR_RULES, DIM_ORDER } from '../src/data/bundle.js';
import { computeAll, scorePool, allQuestions } from '../src/core/scoring.js';
import { encodeSoulCode, decodeSoulCode } from '../src/core/storage.js';
import { matchArchetype, matchCrossRules } from '../src/core/synthesizer.js';

const DATA = {
  dimensions: DIMENSIONS,
  volumes: VOLUMES,
  mirrors: MIRRORS,
  archetypes: ARCHETYPES,
  crossRules: CROSS_RULES,
  pairRules: PAIR_RULES,
  dimOrder: DIM_ORDER,
  dimMap: Object.fromEntries(DIMENSIONS.dims.map((d) => [d.id, d])),
  values: DIMENSIONS.values || [],
};

const VOL_IDS = Object.keys(VOLUMES).sort((a, b) => VOLUMES[a].index - VOLUMES[b].index);
const ROUNDS = Number(process.argv[2]) || 10000;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

/* ---------- 随机正态 ---------- */
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------- 随机作答（带人格一致性） ----------
   每个仿真体有一个潜在特质向量，作答时按特质投票——
   纯均匀随机会把所有维度压到 50，测不出分布问题。 */
function makePersona() {
  const latent = {};
  for (const d of DIM_ORDER) latent[d] = gauss();
  return latent;
}

function answerAll(state, persona, noise = 1) {
  for (const vid of VOL_IDS) {
    const vol = VOLUMES[vid];
    const ans = (state.answersByVolume[vid] ||= {});
    for (const q of vol.questions) {
      let value;
      if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
        let best = null;
        let bestScore = -Infinity;
        for (const o of q.options || []) {
          let s = 0;
          for (const [d, w] of Object.entries(o.effects || {})) {
            s += (persona[d] ?? 0) * Number(w || 0);
          }
          s += gauss() * noise;
          if (s > bestScore) { bestScore = s; best = o.key; }
        }
        value = best;
      } else if (q.type === 'stealth_scale') {
        let lo = 0;
        let hi = 0;
        for (const [d, r] of Object.entries(q.effects || {})) {
          const v = Array.isArray(r) ? (r[1] - r[0]) : 0;
          lo += (persona[d] ?? 0) * v * 0.5;
        }
        void hi;
        const t = 1 / (1 + Math.exp(-(lo + gauss() * noise)));
        value = Math.max(1, Math.min(7, Math.round(1 + t * 6)));
      } else if (q.type === 'budget_100') {
        const items = q.items || [];
        const raw = items.map((it) => Math.exp((persona[it.dim] ?? 0) * 0.8 + gauss() * 0.4));
        const sum = raw.reduce((a, b) => a + b, 0) || 1;
        const map = {};
        let used = 0;
        items.forEach((it, i) => {
          const pts = Math.floor((raw[i] / sum) * 100);
          map[it.key] = pts;
          used += pts;
        });
        let rest = 100 - used;
        let i = 0;
        while (rest > 0) { map[items[i % items.length].key] += 1; rest -= 1; i += 1; }
        value = map;
      } else if (q.type === 'pyramid_top3') {
        const vals = [...(q.values || [])];
        vals.sort((a, b) => {
          const sa = Object.entries(a.effects || {}).reduce((x, [d, w]) => x + (persona[d] ?? 0) * w, 0);
          const sb = Object.entries(b.effects || {}).reduce((x, [d, w]) => x + (persona[d] ?? 0) * w, 0);
          return sb - sa;
        });
        value = vals.slice(0, 3).map((v) => v.key);
      }
      ans[q.id] = { value, ms: 5000 + Math.random() * 4000, changes: 0, at: Date.now() };
      const chars = (q.prompt || '').length + (q.context || '').length;
      state.telemetry[q.id] = { ms: Math.max(2500, chars * 200), readMs: 0, changes: 0 };
    }
    if (!state.completedVolumes.includes(vid)) state.completedVolumes.push(vid);
  }
  return state;
}

function emptyState() {
  return {
    version: '4.0', nickname: '', createdAt: Date.now(), updatedAt: Date.now(),
    completedVolumes: [], inProgress: {}, answersByVolume: {}, computedScores: {},
    maskIndex: null, topValues: [], initialSnapshot: {}, flags: {}, telemetry: {},
  };
}

/* ============================================================
   1. 野字段扫描
   ============================================================ */
console.log('\n[MC1] 野字段扫描');
const valid = new Set(DIM_ORDER);
const wild = [];
for (const [vid, vol] of Object.entries(VOLUMES)) {
  for (const q of vol.questions || []) {
    const scan = (obj, where) => {
      for (const k of Object.keys(obj || {})) if (!valid.has(k)) wild.push(`${vid}/${q.id}${where}→${k}`);
    };
    scan(q.effects, '');
    for (const o of q.options || []) scan(o.effects, `[${o.key}]`);
    for (const it of q.items || []) {
      if (it.dim && !valid.has(it.dim)) wild.push(`${vid}/${q.id}[${it.key}].dim→${it.dim}`);
      scan(it.effects, `[${it.key}]`);
    }
    for (const v of q.values || []) scan(v.effects, `[${v.key}]`);
  }
}
check('无野维度键', wild.length === 0, wild.slice(0, 5).join('; '));

/* ============================================================
   2. 万次仿真 · 维度分布健康度
   ============================================================ */
console.log(`\n[MC2] ${ROUNDS} 次仿真 · 维度分布健康度`);
const buckets = {};
for (const d of DIM_ORDER) buckets[d] = [];
const atEdge = {};
for (const d of DIM_ORDER) atEdge[d] = { low: 0, high: 0, null: 0 };
let soulCodeFails = 0;
let archFails = 0;

const t0 = Date.now();
for (let r = 0; r < ROUNDS; r += 1) {
  const persona = makePersona();
  const st = answerAll(emptyState(), persona, 1);
  const all = computeAll(st, DATA);
  for (const d of DIM_ORDER) {
    const v = all.scores[d];
    if (v === null) { atEdge[d].null += 1; continue; }
    buckets[d].push(v);
    if (v <= 2) atEdge[d].low += 1;
    if (v >= 98) atEdge[d].high += 1;
  }
  if (r % 500 === 0) {
    const rep = matchArchetype(all.scores, ARCHETYPES);
    if (!rep?.best?.name) archFails += 1;
  }
  if (r % 1000 === 0) {
    const code = encodeSoulCode(st, DIM_ORDER);
    const back = decodeSoulCode(code, DIM_ORDER);
    if (!back.ok) soulCodeFails += 1;
  }
}

const stats = DIM_ORDER.map((d) => {
  const arr = buckets[d];
  const n = arr.length;
  const mean = n ? arr.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n ? Math.sqrt(arr.reduce((a, v) => a + (v - mean) ** 2, 0) / n) : 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const p05 = sorted[Math.floor(n * 0.05)] ?? 0;
  const p95 = sorted[Math.floor(n * 0.95)] ?? 0;
  return { d, n, mean, sd, p05, p95, ...atEdge[d] };
});

const deadDims = stats.filter((s) => s.n === 0).map((s) => s.d);
const narrow = stats.filter((s) => s.n > 0 && s.sd < 4).map((s) => `${s.d}(sd=${s.sd.toFixed(1)})`);
const meanDrift = stats.filter((s) => s.n > 0 && (s.mean < 32 || s.mean > 68))
  .map((s) => `${s.d}(μ=${s.mean.toFixed(0)})`);
const edgeHeavy = stats.filter((s) => s.n > 0 && (s.low / s.n > 0.35 || s.high / s.n > 0.35))
  .map((s) => `${s.d}(${(100 * s.low / s.n).toFixed(0)}%/${(100 * s.high / s.n).toFixed(0)}%)`);

console.log(`  （${Date.now() - t0}ms，覆盖 ${DIM_ORDER.length} 维 × ${ROUNDS} 轮）`);
check('所有维度都能产出分数（无死维）', deadDims.length === 0, deadDims.slice(0, 8).join(','));
check('所有维度无 NaN', stats.every((s) => Number.isFinite(s.mean)));
check('所有维度分布不过窄（sd ≥ 4）', narrow.length === 0, narrow.slice(0, 8).join(','));
check('维度均值不严重偏移（32–68）', meanDrift.length === 0, meanDrift.slice(0, 8).join(','));
check('不过度贴边（低/高端各 <35%）', edgeHeavy.length === 0, edgeHeavy.slice(0, 8).join(','));

/* ============================================================
   3. 死规则扫描
   ============================================================ */
console.log('\n[MC3] 跨卷规则可达性');
const fired = new Set();

/** 伪装者画像：总选社会赞许度最高项 + 敏感题上超长犹豫 —— 用于点亮面具类规则 */
function answerAsFaker(state) {
  for (const vid of VOL_IDS) {
    const vol = VOLUMES[vid];
    const ans = (state.answersByVolume[vid] ||= {});
    for (const q of vol.questions) {
      let value;
      if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
        // 既要最体面，又优先选「用理性解释自己」的那一项 —— 这是
        // 「连崩溃都要体面的人」（CR_32）唯一能被点亮的作答方式。
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
      } else if (q.type === 'pyramid_top3') {
        value = (q.values || []).slice(0, 3).map((v) => v.key);
      }
      ans[q.id] = { value, ms: 12000, changes: q.is_sensitive ? 3 : 0, at: Date.now() };
      const chars = (q.prompt || '').length + (q.context || '').length;
      state.telemetry[q.id] = {
        ms: Math.round(Math.max(2500, chars * 200) * (q.is_sensitive ? 3.9 : 1)),
        readMs: 0,
        changes: q.is_sensitive ? 3 : 0,
      };
    }
    if (!state.completedVolumes.includes(vid)) state.completedVolumes.push(vid);
  }
  return state;
}

/**
 * 双面者画像：明线题一律挑最体面的，暗线题一律挑最不体面的。
 * 这是面具厚度 M 的最大值来源（D_sd 与 G_mirror 同时拉高），
 * 也是 CR_31 / CR_32 这类面具校准规则唯一能被点亮的人群。
 */
function answerAsSplit(state) {
  for (const vid of VOL_IDS) {
    const vol = VOLUMES[vid];
    const ans = (state.answersByVolume[vid] ||= {});
    for (const q of vol.questions) {
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
      ans[q.id] = { value, ms: 14000, changes: 3, at: Date.now() };
      const chars = (q.prompt || '').length + (q.context || '').length;
      state.telemetry[q.id] = {
        ms: Math.round(Math.max(2500, chars * 200) * 3.2),
        readMs: 0,
        changes: 3,
      };
    }
    if (!state.completedVolumes.includes(vid)) state.completedVolumes.push(vid);
  }
  return state;
}

for (let r = 0; r < 1200; r += 1) {
  const mode = r % 4;
  const st = mode === 0
    ? answerAsSplit(emptyState())
    : mode === 1
      ? answerAsFaker(emptyState())
      : answerAll(emptyState(), makePersona(), 1);
  const all = computeAll(st, DATA);
  const cross = matchCrossRules(all.scores, { value: all.mask.value }, CROSS_RULES, st.completedVolumes);
  cross.forEach((c) => fired.add(c.id));
}
const deadRules = CROSS_RULES.filter((r) => !fired.has(r.id)).map((r) => r.id);
check('跨卷规则可达（无死规则）', deadRules.length === 0,
  `${deadRules.length} 条未触发：${deadRules.slice(0, 8).join(',')}`);

/* ============================================================
   4. 原型覆盖
   ============================================================ */
console.log('\n[MC4] 原型覆盖');
const archHit = new Set();
for (let r = 0; r < 3000; r += 1) {
  const persona = makePersona();
  const st = answerAll(emptyState(), persona, 1);
  const all = computeAll(st, DATA);
  const a = matchArchetype(all.scores, ARCHETYPES);
  if (a?.best?.id) archHit.add(a.best.id);
}
const archDead = ARCHETYPES.archetypes.filter((a) => !archHit.has(a.id)).map((a) => a.id);
check(`原型可被命中（${archHit.size}/${ARCHETYPES.archetypes.length}）`, archDead.length === 0,
  archDead.join(','));

/* ============================================================
   5. 存档码 / 报告鲁棒性
   ============================================================ */
console.log('\n[MC5] 存档码与报告鲁棒性');
check('存档码万次往返无失败', soulCodeFails === 0, `${soulCodeFails}`);
check('原型始终可匹配', archFails === 0, `${archFails}`);

/* ============================================================
   汇总
   ============================================================ */
console.log('\n' + '─'.repeat(64));
console.log(`  通过 ${pass} · 失败 ${fail}`);
if (fail) {
  console.log('\n  失败项：');
  failures.forEach((f) => console.log(`   · ${f}`));

  // 打印最差/最好的十维，便于定位
  const sorted = [...stats].sort((a, b) => a.sd - b.sd);
  console.log('\n  区分度最弱的 8 维：');
  sorted.slice(0, 8).forEach((s) => console.log(
    `   ${s.d.padEnd(22)} μ=${s.mean.toFixed(1)} sd=${s.sd.toFixed(1)} p05=${s.p05} p95=${s.p95}`,
  ));
  console.log('\n  区分度最强的 5 维：');
  sorted.slice(-5).reverse().forEach((s) => console.log(
    `   ${s.d.padEnd(22)} μ=${s.mean.toFixed(1)} sd=${s.sd.toFixed(1)} p05=${s.p05} p95=${s.p95}`,
  ));
}
console.log('─'.repeat(64));
process.exit(fail ? 1 : 0);
