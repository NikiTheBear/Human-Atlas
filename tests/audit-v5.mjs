#!/usr/bin/env node
/* ============================================================
   audit-v5.mjs — v5.0 专项验收脚本

   八项硬指标：
     1  主线零回归（16 卷 / 298 题 / 127 维 / HA4- 与 HA3- 往返）
     2  28 题极速包完整性与维度覆盖
     3  六大生态位蒙特卡洛（5,000 随机 + 500 跨模式）
     4  乔哈里窗 12 题盲盒
     5  群像星图 3–6 人与时间胶囊边界
     6  压力沙盒状态隔离
     7  v4.4.1 遗留小修
     8  部署安全体检

   用法：
     node tests/audit-v5.mjs            # 默认 5000 轮
     node tests/audit-v5.mjs 500        # 快速
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DIMENSIONS, VOLUMES, MIRRORS, ARCHETYPES, CROSS_RULES, PAIR_RULES,
  DIM_ORDER, EXPRESS,
} from '../src/data/bundle.js';

import { computeAll } from '../src/core/scoring.js';
import { compareStates } from '../src/core/comparator.js';
import { encodeSoulCode, decodeSoulCode, ALL_VOLUMES } from '../src/core/storage.js';
import { ECOLOGIES, scoreAllEcologies, relationshipScript, subtextDecoder, chemistryBoard } from '../src/core/ecology.js';
import { buildExpressVolume, seedFromVolumes, commitExpress, EXPRESS_BUCKET } from '../src/core/express.js';
import {
  JOHARI_DIMS, JOHARI_QUESTIONS, encodeJohari, decodeJohari, johariResult,
} from '../src/core/johari.js';
import { assignRoles, affinityMatrix, coverage, squadCharter, SQUAD_ROLES } from '../src/core/squad.js';
import {
  pressureSandbox, innerParliament, timelineDiff, stageOf, ENERGY_STAGES, PARLIAMENT_PAIRS,
} from '../src/core/lab.js';
import { LocalOnlyAdapter, getAdapter, ADAPTER_INTERFACE } from '../src/core/cloudAdapter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUNDS = Number(process.argv[2]) || 5000;

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

/* ---------- 断言 ---------- */
let pass = 0;
let fail = 0;
const failures = [];

const line = (c = '─') => c.repeat(70);
const hr = (t) => { console.log(`\n${line()}`); console.log(`  ${t}`); console.log(line()); };

function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${detail ? ` · ${detail}` : ''}`); }
  else { fail += 1; failures.push(`${name}${detail ? ` · ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` · ${detail}` : ''}`); }
}

/* ---------- 随机 ---------- */
function gauss() {
  let u = 0; let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function emptyState(nickname = '') {
  return {
    version: '4.0', nickname, createdAt: Date.now(), updatedAt: Date.now(),
    completedVolumes: [], inProgress: {}, answersByVolume: {}, computedScores: {},
    maskIndex: null, topValues: [], initialSnapshot: {}, flags: {}, telemetry: {},
  };
}

/* ---------- 造一个指定卷数的画像 ---------- */
function profile(volIds, persona = null) {
  const st = emptyState('模拟');
  const lat = persona || {};
  for (const d of DIM_ORDER) if (lat[d] === undefined) lat[d] = gauss();

  for (const vid of volIds) {
    const vol = VOLUMES[vid];
    const ans = (st.answersByVolume[vid] ||= {});
    for (const q of vol.questions) {
      let value;
      if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
        let best = null; let bs = -Infinity;
        for (const o of q.options || []) {
          let s = 0;
          for (const [d, w] of Object.entries(o.effects || {})) s += (lat[d] ?? 0) * Number(w || 0);
          s += gauss();
          if (s > bs) { bs = s; best = o.key; }
        }
        value = best;
      } else if (q.type === 'stealth_scale') {
        let t = 0;
        for (const [d, r] of Object.entries(q.effects || {})) {
          if (Array.isArray(r)) t += (lat[d] ?? 0) * (r[1] - r[0]) * 0.5;
        }
        value = Math.max(1, Math.min(7, Math.round(1 + (1 / (1 + Math.exp(-(t + gauss())))) * 6)));
      } else if (q.type === 'budget_100') {
        const items = q.items || [];
        const raw = items.map((it) => Math.exp((lat[it.dim] ?? 0) * 0.8 + gauss() * 0.4));
        const sum = raw.reduce((a, b) => a + b, 0) || 1;
        const map = {};
        let used = 0;
        items.forEach((it, i) => { const p = Math.floor((raw[i] / sum) * 100); map[it.key] = p; used += p; });
        let rest = 100 - used; let i = 0;
        while (rest > 0) { map[items[i % items.length].key] += 1; rest -= 1; i += 1; }
        value = map;
      } else {
        const vals = [...(q.values || [])].sort((a, b) => {
          const sa = Object.entries(a.effects || {}).reduce((x, [d, w]) => x + (lat[d] ?? 0) * w, 0);
          const sb = Object.entries(b.effects || {}).reduce((x, [d, w]) => x + (lat[d] ?? 0) * w, 0);
          return sb - sa;
        });
        value = vals.slice(0, 3).map((v) => v.key);
      }
      ans[q.id] = { value, ms: 6000, changes: 0, at: Date.now() };
      const chars = (q.prompt || '').length + (q.context || '').length;
      st.telemetry[q.id] = { ms: Math.max(2500, chars * 200), readMs: 0, changes: 0 };
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

/* ============================================================
   1 · 主线零回归
   ============================================================ */
hr('1 · 主线零回归（封板红线）');

check('16 卷齐全', VOL_IDS.length === 16, VOL_IDS.length);
const totalQ = VOL_IDS.reduce((a, v) => a + VOLUMES[v].questions.length, 0);
check('298 题', totalQ === 298, totalQ);
check('127 维', DIMENSIONS.dims.length === 127, DIMENSIONS.dims.length);
check('127 双面镜', Object.keys(MIRRORS).length === 127, Object.keys(MIRRORS).length);

/* 注册表顺序：前 60 位必须与 v3 冻结顺序一致（HA3- 兼容前提） */
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
const orderBad = V3_FROZEN.filter((id, i) => DIM_ORDER[i] !== id);
check('注册表前 60 位与 v3 冻结顺序一致', orderBad.length === 0, orderBad.slice(0, 3).join(','));

/* HA4- 往返 */
{
  const st = profile(['vol1', 'vol2', 'vol3']);
  st.nickname = '验收';
  const code = encodeSoulCode(st, DIM_ORDER);
  const back = decodeSoulCode(code, DIM_ORDER);
  let maxErr = 0;
  if (back.ok) {
    for (const [d, v] of Object.entries(st.computedScores)) {
      maxErr = Math.max(maxErr, Math.abs(Math.round(v) - (back.state.computedScores[d] ?? 0)));
    }
  }
  check('HA4- 可解码', back.ok, back.ok ? `${code.length} 字符` : back.error);
  check('HA4- 取整后误差为 0', maxErr === 0, maxErr);
  check('HA4- 保留昵称', back.ok && back.state.nickname === '验收');
}

/* HA3- 兼容（手工构造一条 v3 码） */
{
  const body = [3, 0b101, 58, 0, 3, 5];
  for (let i = 0; i < 60; i += 1) body.push(i < 20 ? 40 + i : 255);
  body.push(...[...new TextEncoder().encode('老档')]);
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
  const dec = decodeSoulCode(`HA3-${out}`, DIM_ORDER);
  check('HA3- 老码仍可解码', dec.ok, dec.ok ? dec.state.completedVolumes.join(',') : dec.error);
  check('HA3- 维度数正确', dec.ok && Object.keys(dec.state.computedScores).length === 20,
    dec.ok ? Object.keys(dec.state.computedScores).length : '—');
}

/* ============================================================
   2 · 28 题极速包
   ============================================================ */
hr('2 · 28 题极速包完整性与维度覆盖');

const expressIds = EXPRESS.questions || [];
check('清单恰好 28 题', expressIds.length === 28, expressIds.length);
check('清单无重复', new Set(expressIds).size === expressIds.length);

const allIds = new Set();
for (const v of Object.values(VOLUMES)) for (const q of v.questions) allIds.add(q.id);
const ghost = expressIds.filter((id) => !allIds.has(id));
check('全部 id 真实存在（无幽灵）', ghost.length === 0, ghost.join(','));

const expressVol = buildExpressVolume(DATA, EXPRESS);
check('可拼出虚拟卷', expressVol.questions.length === 28, expressVol.questions.length);
check('虚拟卷只含快答题型',
  expressVol.questions.every((q) => q.type === 'forced_choice' || q.type === 'impulse_3s'),
  [...new Set(expressVol.questions.map((q) => q.type))].join(','));

const expressDims = new Set(expressVol.dimensions);
check('覆盖维度数 ≥ 90', expressDims.size >= 90, `${expressDims.size}/127`);

/* 六大生态位在极速包下的可用维度数 */
{
  const rows = [];
  for (const def of ECOLOGIES) {
    const avail = def.dims
      .filter((d) => expressDims.has(d.id))
      .length;
    rows.push({ id: def.id, avail, total: def.dims.length });
  }
  const dead = rows.filter((r) => r.avail === 0);
  check('六大生态位在极速包下均有可用维度', dead.length === 0,
    rows.map((r) => `${r.id}:${r.avail}/${r.total}`).join(' '));

  /* 用极速包的画像跑一遍，确认不出 NaN */
  const ex = profile(['vol4', 'vol7']); // 借用完整画像的分数
  const exScores = {};
  for (const d of expressDims) if (Number.isFinite(ex.computedScores[d])) exScores[d] = ex.computedScores[d];
  ex.computedScores = exScores;
  const r = scoreAllEcologies(ex, ex, [...expressDims], { a: 50, b: 50 });
  check('极速包画像下六生态位无 NaN',
    r.list.every((x) => Number.isFinite(x.value)),
    r.list.map((x) => `${x.id}:${x.value}`).join(' '));
}

/* 极速 → 完整 双向互通 */
{
  const st = emptyState('互通');
  const eVol = buildExpressVolume(DATA, EXPRESS);
  seedFromVolumes(st, eVol);
  (st.answersByVolume[EXPRESS_BUCKET] ||= {});
  for (const q of eVol.questions) {
    st.answersByVolume[EXPRESS_BUCKET][q.id] = { value: q.options[0].key, ms: 5000, changes: 0 };
  }
  const moved = commitExpress(st, eVol);
  check('极速作答可写回原卷', moved === 28, moved);
  check('写回后虚拟桶已清空', !st.answersByVolume[EXPRESS_BUCKET]);

  const srcVols = new Set(eVol.questions.map((q) => q._srcVol));
  const wroteAll = [...srcVols].every((v) => Object.keys(st.answersByVolume[v] || {}).length > 0);
  check('写回覆盖全部来源卷', wroteAll, [...srcVols].length);

  /* 反向：完整卷已答的题，极速时不该重复 */
  const st2 = profile(['vol1']);
  const eVol2 = buildExpressVolume(DATA, EXPRESS);
  const seeded = seedFromVolumes(st2, eVol2);
  check('完整卷已答题不重复问', seeded >= 0 && st2.answersByVolume[EXPRESS_BUCKET] !== undefined,
    `预填 ${seeded} 题`);
}

/* ============================================================
   3 · 六大生态位蒙特卡洛
   ============================================================ */
hr(`3 · 六大生态位蒙特卡洛 · ${ROUNDS} 对随机双人`);

const stats = {};
for (const def of ECOLOGIES) stats[def.id] = { vals: [], wins: 0, name: def.name };

let nanCount = 0;
let infCount = 0;
let oobCount = 0;
let nullCount = 0;
let totalWins = 0;

const monoStart = Date.now();
for (let r = 0; r < ROUNDS; r += 1) {
  const a = profile(VOL_IDS, null);
  const b = profile(VOL_IDS, null);
  const dims = DIM_ORDER.filter((d) => Number.isFinite(a.computedScores[d]) && Number.isFinite(b.computedScores[d]));
  const res = scoreAllEcologies(a, b, dims, { a: a.maskIndex, b: b.maskIndex });

  if (res.best) { stats[res.best.id].wins += 1; totalWins += 1; }

  for (const item of res.list) {
    if (item.value === null || item.value === undefined) { nullCount += 1; continue; }
    if (Number.isNaN(item.value)) { nanCount += 1; continue; }
    if (!Number.isFinite(item.value)) { infCount += 1; continue; }
    if (item.value < 0 || item.value > 100) { oobCount += 1; continue; }
    stats[item.id].vals.push(item.value);
  }
}
console.log(`  （耗时 ${((Date.now() - monoStart) / 1000).toFixed(1)}s）`);

check('无 NaN', nanCount === 0, nanCount);
check('无 Infinity', infCount === 0, infCount);
check('无越界分（<0 或 >100）', oobCount === 0, oobCount);
check('无 null', nullCount === 0, nullCount);

console.log('\n  生态位          均值    SD    夺冠占比');
for (const def of ECOLOGIES) {
  const s = stats[def.id];
  const n = s.vals.length;
  const mean = n ? s.vals.reduce((x, y) => x + y, 0) / n : 0;
  const sd = n ? Math.sqrt(s.vals.reduce((x, y) => x + (y - mean) ** 2, 0) / n) : 0;
  const share = totalWins ? (s.wins / totalWins) * 100 : 0;
  console.log(`  ${s.name.padEnd(8)}  ${mean.toFixed(1).padStart(5)}  ${sd.toFixed(1).padStart(5)}  ${share.toFixed(1).padStart(5)}%`);
}

const shares = ECOLOGIES.map((d) => (totalWins ? (stats[d.id].wins / totalWins) * 100 : 0));
const maxShare = Math.max(...shares);
const minShare = Math.min(...shares);
check('无生态位霸榜 > 50%', maxShare <= 50, `最高 ${maxShare.toFixed(1)}%`);
check('无生态位几乎不夺冠 < 3%', minShare >= 3, `最低 ${minShare.toFixed(1)}%`);

/* 跨模式：真实 28 题极速态 × 完整 16 卷
   —— 走真实链路：buildExpressVolume → 灌答案进 __express 虚拟桶 →
      commitExpress 写回原卷 → computeAll → compareStates 合盘。
   也顺带验证「极速态没有 completedVolumes 时合盘不会瘫」。 */
function makeExpressState() {
  const st = emptyState('极速');
  const eVol = buildExpressVolume(DATA, EXPRESS);
  (st.answersByVolume[EXPRESS_BUCKET] ||= {});
  const lat = {};
  for (const d of DIM_ORDER) lat[d] = gauss();
  for (const q of eVol.questions) {
    let value;
    if (q.type === 'impulse_3s' || q.type === 'forced_choice') {
      let best = null; let bs = -Infinity;
      for (const o of q.options || []) {
        let s2 = 0;
        for (const [d, w] of Object.entries(o.effects || {})) s2 += (lat[d] ?? 0) * Number(w || 0);
        s2 += gauss();
        if (s2 > bs) { bs = s2; best = o.key; }
      }
      value = best;
    }
    st.answersByVolume[EXPRESS_BUCKET][q.id] = { value, ms: 5000, changes: 0 };
    st.telemetry[q.id] = { ms: 5000, readMs: 0, changes: 0 };
  }
  commitExpress(st, eVol);
  const all = computeAll(st, DATA);
  for (const d of DIM_ORDER) if (Number.isFinite(all.scores[d])) st.computedScores[d] = all.scores[d];
  st.maskIndex = all.mask.value;
  return st;
}

const CROSS = Math.max(50, Math.round(ROUNDS * 0.1));
let crossNan = 0;
let crossNoNaN = 0;
let cmpOk = 0;
let cmpFail = 0;
let cmpNoCommon = 0;
for (let r = 0; r < CROSS; r += 1) {
  const full = profile(VOL_IDS, null);
  const ex = makeExpressState();

  /* 必须真的没有 completedVolumes，才是「纯极速态」 */
  if (r === 0) {
    check('极速态 completedVolumes 为空', (ex.completedVolumes || []).length === 0,
      (ex.completedVolumes || []).length);
    check('极速态仍算出维度分', Object.keys(ex.computedScores).length >= 60,
      `${Object.keys(ex.computedScores).length}/127`);
  }

  const dims = DIM_ORDER.filter((d) => Number.isFinite(full.computedScores[d]) && Number.isFinite(ex.computedScores[d]));
  const res = scoreAllEcologies(full, ex, dims, { a: full.maskIndex, b: ex.maskIndex });
  if (res.list.some((x) => !Number.isFinite(x.value))) crossNan += 1;
  else crossNoNaN += 1;

  /* 真实 compareStates 链路 */
  try {
    const cmp = compareStates(full, ex, DATA);
    if (cmp.ok) cmpOk += 1;
    else { cmpFail += 1; if (!cmpNoCommon && /还没有共同完成/.test(cmp.reason || '')) cmpNoCommon += 1; }
  } catch { cmpFail += 1; }
}
check(`跨模式合盘 ${CROSS} 对无 NaN`, crossNan === 0, crossNan);
check(`真实 compareStates 全部 ok（${cmpOk}/${CROSS}）`, cmpFail === 0, `失败 ${cmpFail} 次`);
check('不再出现「还没有共同完成任何一卷」', cmpNoCommon === 0, cmpNoCommon);

/* 极速态标记：两份都没有共同卷的档位对，必须打上 isExpressPair。
   同时验证「真卷交集为空」与「可比维度足够」这两个条件同时成立。 */
{
  const full = profile(VOL_IDS, null);
  const exA = makeExpressState();
  const exB = makeExpressState();

  const pair = compareStates(exA, exB, DATA);
  check('极速×极速：ok 且 isExpressPair', pair.ok === true && pair.isExpressPair === true,
    `ok=${pair.ok} common=${pair.common?.length} dims=${pair.dims?.length}`);
  check('极速×极速：可比维度 ≥ 10', (pair.dims?.length || 0) >= 10, pair.dims?.length);
  check('极速×极速：契合度为有限值', Number.isFinite(pair.overall), pair.overall);

  const cross = compareStates(full, exA, DATA);
  check('完整×极速：ok 且 isExpressPair', cross.ok === true && cross.isExpressPair === true,
    `ok=${cross.ok} common=${cross.common?.length} dims=${cross.dims?.length}`);

  /* 反向：两份都有 16 卷完成 → 不得误标极速对 */
  const two = profile(VOL_IDS, null);
  const same = compareStates(full, two, DATA);
  check('完整×完整：isExpressPair 为 false', same.ok === true && same.isExpressPair === false,
    `common=${same.common?.length} isExpressPair=${same.isExpressPair}`);

  /* 闸门：可比维度不足 10 时必须优雅降级 */
  const thin = { computedScores: Object.fromEntries(DIM_ORDER.slice(0, 5).map((d) => [d, 50])), completedVolumes: [], maskIndex: 50, nickname: '' };
  const bad = compareStates(full, thin, DATA);
  check('可比维度 < 10 时降级且 isExpressPair 为 false',
    bad.ok === false && bad.isExpressPair === false && typeof bad.reason === 'string',
    `${bad.dims?.length} 维`);
}

/* 对称性 */
{
  let asym = 0;
  let asymExample = '';
  for (let r = 0; r < 100; r += 1) {
    const a = profile(VOL_IDS, null);
    const b = profile(VOL_IDS, null);
    const dims = DIM_ORDER.filter((d) => Number.isFinite(a.computedScores[d]) && Number.isFinite(b.computedScores[d]));
    const ab = scoreAllEcologies(a, b, dims, { a: a.maskIndex, b: b.maskIndex });
    const ba = scoreAllEcologies(b, a, dims, { a: b.maskIndex, b: a.maskIndex });
    for (const def of ECOLOGIES) {
      const x = ab.list.find((i) => i.id === def.id)?.value;
      const y = ba.list.find((i) => i.id === def.id)?.value;
      if (x !== y) { asym += 1; if (!asymExample) asymExample = `${def.id} ${x} vs ${y}`; }
    }
  }
  check('compare(A,B) 与 compare(B,A) 完全一致', asym === 0, asym ? `${asym} 处不对称（${asymExample}）` : '');
}

/* spark「无人破冰」雷区：必须真正触发（曾因 av/bv 闸门成为死代码） */
{
  const mk = (over) => {
    const s = {};
    for (const d of DIM_ORDER) s[d] = 50;
    Object.assign(s, over);
    return { computedScores: s, maskIndex: 50, completedVolumes: VOL_IDS, nickname: '' };
  };
  const dorm = mk({ att_avoidance: 72, tki_avoiding: 74 });
  const dorm2 = mk({ att_avoidance: 66, tki_avoiding: 62 });
  const dims = DIM_ORDER.slice();
  const r = scoreAllEcologies(dorm, dorm2, dims, { a: 50, b: 50 });
  const sp = r.list.find((x) => x.id === 'spark');
  check('spark「无人破冰」雷区真正触发',
    sp.hits.some((h) => h.label.includes('无人破冰')),
    sp.hits.map((h) => h.label).join(',') || '（无雷区）');
  check('该雷区扣 15 分', sp.penalty === 15, sp.penalty);

  /* 反向：只有一方回避，不该触发 */
  const one = mk({ att_avoidance: 72, tki_avoiding: 74 });
  const other = mk({ att_avoidance: 30, tki_avoiding: 30 });
  const r2 = scoreAllEcologies(one, other, dims, { a: 50, b: 50 });
  const sp2 = r2.list.find((x) => x.id === 'spark');
  check('只有一方回避时不触发', !sp2.hits.some((h) => h.label.includes('无人破冰')),
    sp2.hits.map((h) => h.label).join(',') || '（正确：无雷区）');
}

/* 潜台词解码器必须按分数降序 */
{
  const s = {};
  for (const d of DIM_ORDER) s[d] = 40;
  /* 规则表顺序：def_detach → att_avoidance → att_anxiety → … → enn_4（最后一条）。
     故意让最后一条分最高，验证不是按数组顺序返回前 3 条。 */
  s.def_detach = 62;
  s.att_anxiety = 70;
  s.enn_4 = 92;
  const dec = subtextDecoder({ computedScores: s }, '小北');
  check('解码器最多 3 条', dec.length <= 3, dec.length);
  check('解码器首条是分最高的（而非数组第一条）', dec[0]?.dim === 'enn_4', dec[0]?.dim);
  check('解码器按分数降序',
    dec.every((x, i) => i === 0 || dec[i - 1].score >= x.score),
    dec.map((x) => `${x.dim}:${x.score}`).join(' '));
}

/* 红黑榜阈值门 */
{
  const mk = (over) => {
    const s = {};
    for (const d of DIM_ORDER) s[d] = 50;
    Object.assign(s, over);
    return { computedScores: s, maskIndex: 50, completedVolumes: VOL_IDS, nickname: '' };
  };
  /* 全中性：不该输出任何图式红线 */
  const flat = mk({});
  const b1 = chemistryBoard(flat, flat);
  check('无创伤用户不输出图式红线',
    !b1.red.some((r) => /随便你|关心当条件|当众纠正/.test(r.title)),
    b1.red.map((r) => r.title).join(' / ') || '（无红线）');

  /* 高图式：应当输出 */
  const hurt = mk({ schema_abandonment: 78, mft_care: 72, mft_authority: 30 });
  const b2 = chemistryBoard(hurt, hurt);
  check('高遗弃图式触发「随便你」红线',
    b2.red.some((r) => r.title.includes('随便你')), b2.red.length);
  check('高关爱底线进入加分项',
    b2.green.some((g) => g.title.includes('关爱')), b2.green.length);
  check('低权威底线进入禁区',
    b2.red.some((r) => /权威/.test(r.title)), b2.red.length);

  /* 昵称替换 */
  const named = { ...hurt, nickname: '阿岚' };
  const b3 = chemistryBoard(named, named);
  check('红黑榜使用真实昵称', b3.green.concat(b3.red).every((x) => x.for === '阿岚'),
    [...new Set(b3.green.concat(b3.red).map((x) => x.for))].join(','));
}

/* 非对称冲突归属：A 焦虑 × B 回避 必须计入 partner 的追逃雷区 */
{
  const mk = (over) => {
    const s = {};
    for (const d of DIM_ORDER) s[d] = 50;
    Object.assign(s, over);
    return { computedScores: s, maskIndex: 50, completedVolumes: VOL_IDS, nickname: 'x' };
  };
  const anx = mk({ att_anxiety: 74, att_avoidance: 30 });
  const avo = mk({ att_anxiety: 30, att_avoidance: 74 });
  const dims = DIM_ORDER.slice();
  const r1 = scoreAllEcologies(anx, avo, dims, {});
  const r2 = scoreAllEcologies(avo, anx, dims, {});
  const p1 = r1.list.find((x) => x.id === 'partner');
  const p2 = r2.list.find((x) => x.id === 'partner');
  check('焦虑×回避 触发 partner 追逃雷区',
    p1.hits.some((h) => h.label.includes('追逃')), p1.hits.map((h) => h.label).join(','));
  check('交换双方后雷区仍触发（归属正确）',
    p2.hits.some((h) => h.label.includes('追逃')), p2.hits.map((h) => h.label).join(','));
  check('两种顺序得分一致', p1.value === p2.value, `${p1.value} / ${p2.value}`);
}

/* ============================================================
   4 · 乔哈里窗
   ============================================================ */
hr('4 · 乔哈里窗 12 题盲盒');

check('12 题', JOHARI_QUESTIONS.length === 12, JOHARI_QUESTIONS.length);
check('12 维', JOHARI_DIMS.length === 12, JOHARI_DIMS.length);
const badDim = JOHARI_DIMS.filter((d) => !DIM_ORDER.includes(d));
check('全部维度在 127 维注册表内', badDim.length === 0, badDim.join(','));
check('12 题与 12 维一一对应',
  JOHARI_QUESTIONS.every((q, i) => q.dim === JOHARI_DIMS[i]));

/* 3 卷用户 × 12 题盲猜 */
{
  const st = profile(['vol1', 'vol2', 'vol3']);
  const guesses = JOHARI_DIMS.map((d, i) => ({ dim: d, pick: i % 4 }));
  const res = johariResult(st.computedScores, guesses);
  const total = res.open.length + res.blind.length + res.facade.length + res.unknown.length;
  check('3 卷用户四象限可落位', total > 0, `共 ${total} 项`);
  check('3 卷用户一致度有效', Number.isFinite(res.agreement), res.agreement);
}

/* 16 卷用户 × 12 题盲猜 */
{
  const st = profile(VOL_IDS);
  const guesses = JOHARI_DIMS.map((d, i) => ({ dim: d, pick: (i + 2) % 4 }));
  const res = johariResult(st.computedScores, guesses);
  const total = res.open.length + res.blind.length + res.facade.length + res.unknown.length;
  check('16 卷用户四象限可落位', total === 12, `共 ${total} 项`);
  check('16 卷用户无 NaN', Number.isFinite(res.agreement));
}

/* 码长 */
{
  const scores = {};
  for (const d of JOHARI_DIMS) scores[d] = 50;
  const short = encodeJohari(scores, '');
  const long = encodeJohari(scores, '一个十二字的中文昵称样例');
  check('印象码 ≤ 450 字符', short.length <= 450 && long.length <= 450,
    `${short.length} / ${long.length}`);

  const url = `https://nikithebear.github.io/Human-Atlas/#/johari/${long}`;
  check('邀请链接 ≤ 450 字符', url.length <= 450, url.length);

  const dec = decodeJohari(long);
  check('印象码往返正确', dec.ok && dec.nickname === '一个十二字的中文昵称样例', dec.nickname);
}

/* ============================================================
   5 · 群像星图 & 时间胶囊
   ============================================================ */
hr('5 · 群像星图 & 时间胶囊边界');

{
  const mk = (name, vols) => {
    const st = profile(vols);
    st.nickname = name;
    return { name, state: st };
  };

  for (const n of [3, 6]) {
    const members = Array.from({ length: n }, (_, i) => mk(`成员${i + 1}`, VOL_IDS));
    const roles = assignRoles(members, DATA);
    check(`${n} 人角色分配无异常`, roles.length === n && roles.every((r) => r.role),
      roles.map((r) => r.role).join(','));
    const aff = affinityMatrix(members, DATA);
    check(`${n} 人矩阵尺寸正确`, aff.matrix.length === n);
    const cov = coverage(members, DATA);
    check(`${n} 人覆盖表非空`, cov.rows.length > 0, cov.rows.length);
    const charter = squadCharter(members, roles, cov.gaps);
    check(`${n} 人公约非空`, charter.length > 0, charter.length);
  }

  /* 重复存档码 */
  {
    const a = mk('甲', VOL_IDS);
    const members = [a, a, a];
    const roles = assignRoles(members, DATA);
    check('三份相同存档码不崩溃', roles.length === 3 && roles.every((r) => r.role),
      roles.map((r) => r.role).join(','));
    const aff = affinityMatrix(members, DATA);
    /* overall = 共振 × 0.58 + 互补 × 0.42（见 comparator.js）——
       它不是「相似度」，两个人完全一样也拿不到 100。
       这里能断言的是：自身对角线恒为 100、三人两两同值、落在合法区间。 */
    check('自身对角线恒为 100', aff.matrix[0][0] === 100 && aff.matrix[2][2] === 100);
    check('三份相同存档码两两一致', aff.matrix[0][1] === aff.matrix[0][2] && aff.matrix[0][1] === aff.matrix[1][2],
      aff.matrix[0][1]);
  }

  /* 混合完成卷数 */
  {
    const members = [mk('一卷', ['vol1']), mk('八卷', VOL_IDS.slice(0, 8)), mk('十六卷', VOL_IDS)];
    const roles = assignRoles(members, DATA);
    check('1/8/16 卷混搭不崩溃', roles.length === 3 && roles.every((r) => r.role),
      roles.map((r) => `${r.name}:${r.role}`).join(' '));
    const aff = affinityMatrix(members, DATA);
    check('混搭下矩阵有有效值',
      aff.pairs.length > 0 && Number.isFinite(aff.pairs[0].score), aff.pairs.length);
  }

  /* 覆盖率置信系数：1 卷用户单维极高，不该抢走 16 卷用户的角色 */
  {
    const barren = { computedScores: {}, maskIndex: 50, completedVolumes: ['vol1'], nickname: '一卷' };
    /* 只答过 vol1，只有一维有分且极高 */
    barren.computedScores.cog_global = 98;
    const rich = {
      computedScores: Object.fromEntries(DIM_ORDER.map((d) => [d, 60])),
      maskIndex: 50,
      completedVolumes: VOL_IDS.slice(),
      nickname: '十六卷',
    };
    rich.computedScores.cog_global = 74;
    rich.computedScores.dark_mach = 70;
    rich.computedScores.cog_logic = 72;

    const roles = assignRoles([
      { name: '一卷', state: barren },
      { name: '十六卷', state: rich },
    ], DATA);
    const one = roles[0];
    const full = roles[1];
    check('1 卷用户 fit 被收缩到低位', one.roleFit < 55, one.roleFit);
    check('16 卷用户获得更高 fit', full.roleFit > one.roleFit + 10,
      `${one.roleFit} vs ${full.roleFit}`);
    check('所有 fit 落在 0–100',
      roles.every((r) => r.roleFit >= 0 && r.roleFit <= 100),
      roles.map((r) => r.roleFit).join(','));
  }
}

/* 时间胶囊 */
{
  const now = profile(VOL_IDS);
  const six = { ...now, computedScores: { ...now.computedScores } };
  for (const d of Object.keys(six.computedScores)) {
    six.computedScores[d] = Math.max(0, Math.min(100, six.computedScores[d] - 8));
  }

  const d1 = timelineDiff(six.computedScores, now.computedScores, DATA.dimMap);
  check('隔 6 个月可算出变化', d1.rows.length > 0 && d1.top5.length > 0, d1.rows.length);
  check('Top5 按绝对变化降序',
    d1.top5.every((r, i) => i === 0 || Math.abs(d1.top5[i - 1].delta) >= Math.abs(r.delta)));

  /* 同月：完全相同 */
  const d2 = timelineDiff(now.computedScores, now.computedScores, DATA.dimMap);
  check('同月相同存档差值全为 0', d2.rows.every((r) => r.delta === 0), d2.rows.length);
  check('同月结语提示「基本没动」', /基本没动|结构/.test(d2.verdict), d2.verdict.slice(0, 24));

  /* 跨年：码里的年月戳 */
  const code = encodeSoulCode(now, DIM_ORDER);
  const dec = decodeSoulCode(code, DIM_ORDER);
  check('存档码带年月戳', /^\d{4}-\d{2}$/.test(dec.state.stamp || ''), dec.state.stamp);
}

/* ============================================================
   6 · 压力沙盒状态隔离
   ============================================================ */
hr('6 · 压力变形沙盒状态隔离');

{
  const st = profile(VOL_IDS);
  const snapshot = JSON.stringify(st.computedScores);

  const lo = pressureSandbox(st.computedScores, 0);
  const hi = pressureSandbox(st.computedScores, 100);
  const back = pressureSandbox(st.computedScores, 0);

  check('拖到 0% 后原始分数未被修改', JSON.stringify(st.computedScores) === snapshot);
  check('拖到 100% 后原始分数未被修改', JSON.stringify(st.computedScores) === snapshot);
  check('拖回 0% 结果可复现', JSON.stringify(lo.scores) === JSON.stringify(back.scores));

  const allInRange = [...Object.values(lo.scores), ...Object.values(hi.scores)]
    .every((v) => v >= 0 && v <= 100);
  check('变形后全部落在 [0,100]', allInRange);

  check('能量 50 等于原值',
    Object.entries(pressureSandbox(st.computedScores, 50).scores)
      .every(([d, v]) => Math.abs(v - st.computedScores[d]) < 0.11));

  check('四档阶段齐全', ENERGY_STAGES.length === 4);
  check('0 落在极度耗竭', stageOf(0).key === 'depleted');
  check('100 落在充沛顺境', stageOf(100).key === 'zone');

  /* 中性层不应随电量整体暴跌（荣格八维 / 双极三观 / 认知风格） */
  {
    const st2 = profile(VOL_IDS);
    const lo2 = pressureSandbox(st2.computedScores, 0);
    const jung = ['jung_si', 'jung_se', 'jung_ni', 'jung_ne', 'jung_ti', 'jung_te', 'jung_fi', 'jung_fe'];
    const present = jung.filter((d) => Number.isFinite(st2.computedScores[d]));
    const maxDrift = present.length
      ? Math.max(...present.map((d) => Math.abs(lo2.delta[d] ?? 0)))
      : 0;
    check(`荣格八维在 0% 时偏移 ≤ 3 分（实测 ${maxDrift}）`, maxDrift <= 3.1, maxDrift);
    check('荣格八维确实被测到了（不是空集合）', present.length >= 6, `${present.length}/8`);

    /* 暗面维度必须仍然显著下坠（不是把整个沙盒做废） */
    const darkDrift = Math.abs(lo2.delta.def_attack ?? lo2.delta.att_anxiety ?? 0);
    check('暗面维度在 0% 时仍显著偏移', darkDrift >= 12, darkDrift);
  }

  /* 内在议会 */
  const parl = innerParliament(st.computedScores, 3);
  check('议会不超 3 对', parl.length <= 3, parl.length);
  check('议会每对都有双声部', parl.every((p) => p.voiceA && p.voiceB && p.verdict && p.tip));
  check('张力模板 ≥ 16 组', PARLIAMENT_PAIRS.length >= 16, PARLIAMENT_PAIRS.length);
}

/* ============================================================
   7 · v4.4.1 遗留小修
   ============================================================ */
hr('7 · v4.4.1 遗留小修核验');

{
  const reportSrc = fs.readFileSync(path.join(ROOT, 'src/components/ReportView.js'), 'utf8');
  check('光暗能量比已改为百分比形式', /光 \$\{lp\}% \/ 暗 \$\{dp\}%/.test(reportSrc));
  check('不再输出 ratio : 100', !/return `\$\{ratio\} : 100`/.test(reportSrc));

  const arch = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/archetypes.json'), 'utf8'));
  const lowTag = arch.archetypes.filter((a) => /低/.test(a.psych_tag || ''));
  check('psych_tag 无「低X」直译', lowTag.length === 0, lowTag.map((a) => a.id).join(','));
  check('36 原型全有 psych_tag', arch.archetypes.every((a) => a.psych_tag), arch.archetypes.length);
  check('36 原型全有 latin', arch.archetypes.every((a) => /^The /.test(a.latin || '')));
}

/* ============================================================
   8 · 部署安全体检
   ============================================================ */
hr('8 · GitHub Pages 部署与安全体检');

{
  const scanDirs = ['src', 'styles', 'scripts'];
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  scanDirs.forEach(walk);
  files.push('index.html');

  const absPath = [];
  const apiKey = [];
  const googleFont = [];

  const ABS = /\/Users\/[A-Za-z0-9._-]+/;
  const KEY = /(sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,})/;

  for (const f of files) {
    const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (ABS.test(txt)) absPath.push(f);
    if (KEY.test(txt)) apiKey.push(f);
    if (txt.includes('fonts.googleapis.com')) googleFont.push(f);
  }

  check('无硬编码个人绝对路径', absPath.length === 0, absPath.slice(0, 3).join(','));
  check('无硬编码 API Key', apiKey.length === 0, apiKey.slice(0, 3).join(','));
  check('无 fonts.googleapis.com 直链', googleFont.length === 0, googleFont.slice(0, 3).join(','));

  /* 相对路径：index.html 里的资源引用 */
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [...idx.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('data:') && !u.startsWith('#') && !u.startsWith('http'));
  const absRefs = refs.filter((u) => u.startsWith('/'));
  check('index.html 资源引用均为相对路径', absRefs.length === 0, absRefs.join(','));

  check('并行/子路径安全（无 base href 写死）', !/<base\s/.test(idx));

  /* 云端适配器 */
  check('适配器四方法齐全',
    ADAPTER_INTERFACE.every((m) => typeof LocalOnlyAdapter[m] === 'function'),
    ADAPTER_INTERFACE.join(','));
  check('默认实现为 local-only', getAdapter().name === 'local-only', getAdapter().name);

  const consentBefore = LocalOnlyAdapter.hasConsent();
  LocalOnlyAdapter.setConsent(false);
  const silent = await LocalOnlyAdapter.saveAnonymousSample(
    { computedScores: { sin_pride: 60 }, maskIndex: 50, completedVolumes: [] },
    DIM_ORDER,
  );
  check('未同意时静默跳过（不发请求）', silent.skipped === true);
  void consentBefore;
}

/* ============================================================
   汇总
   ============================================================ */
hr('汇总');
if (fail) {
  console.log(`  失败 ${fail} 项：`);
  failures.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
} else {
  console.log(`  全部 8 项检查通过 · ${pass} 条断言 · 0 失败`);
}
console.log(line());
process.exit(fail ? 1 : 0);
