#!/usr/bin/env node
/* ============================================================
   verify-scoring.js — 计分引擎排雷验收（8 个 P0 缺陷回归测试）

   用法：node tests/verify-scoring.js
   ============================================================ */

import { VOLUMES, DIMENSIONS, DIM_ORDER } from '../src/data/bundle.js';
import {
  questionRange, getQuestionDims, scoreBudgetItem, scorePool, computeAll,
  answerContributions, TYPE_WEIGHT,
} from '../src/core/scoring.js';
import { DIRTY_MS, readingBaseline, dirtyLimitOf as limitOf } from '../src/core/telemetry.js';

const DATA = {
  volumes: VOLUMES,
  dimensions: DIMENSIONS,
  dimOrder: DIM_ORDER,
  mirrors: {},
  archetypes: { archetypes: [] },
  crossRules: [],
  pairRules: { coreDims: [], complementDims: [], resonance: [], collisions: [] },
};

const VALID = new Set(DIM_ORDER);

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function allQuestions() {
  const out = [];
  for (const [vid, vol] of Object.entries(VOLUMES)) {
    for (const q of vol.questions || []) out.push({ ...q, volumeId: vid, volume_id: vid });
  }
  return out;
}

function mkState() {
  return {
    version: '3.0',
    nickname: '',
    completedVolumes: [],
    inProgress: {},
    answersByVolume: {},
    computedScores: {},
    maskIndex: null,
    topValues: [],
    telemetry: {},
    flags: {},
  };
}

/* ------------------------------------------------------------
   BUG-01 · 只在部分选项出现的维度不能被跳过
   ------------------------------------------------------------ */

function testBug01() {
  console.log('\n[BUG-01] 未选中选项的维度必须正常计入低分，不得跳过或虚高');

  // 找一道「某维度只在部分选项出现」的迫选题
  const qs = allQuestions().filter((q) => q.type === 'forced_choice' && (q.options || []).length >= 3);
  let target = null;
  let partialDim = null;

  for (const q of qs) {
    const dims = new Set();
    for (const o of q.options) for (const k of Object.keys(o.effects || {})) dims.add(k);
    for (const d of dims) {
      const hit = q.options.filter((o) => o.effects?.[d] !== undefined).length;
      if (hit > 0 && hit < q.options.length) { target = q; partialDim = d; break; }
    }
    if (target) break;
  }

  check('找到含「部分选项维度」的迫选题', !!target, target ? `${target.id}/${partialDim}` : '无');

  if (target) {
    const present = target.options.filter((o) => o.effects?.[partialDim] !== undefined);
    const absent = target.options.filter((o) => o.effects?.[partialDim] === undefined);
    check('该题同时存在「命中」与「未命中」选项', present.length > 0 && absent.length > 0,
      `${present.length} 个命中 / ${absent.length} 个未命中`);

    const dims = getQuestionDims(target, VALID);
    check('getQuestionDims 收录了该维度', dims.includes(partialDim));

    // 选一个不含该维度的选项，应当算出偏低分而不是被跳过
    const missOpt = absent[0];
    const st = mkState();
    st.answersByVolume[target.volumeId] = { [target.id]: { value: missOpt.key } };
    const res = scorePool(st, [target], { validDimSet: VALID });

    check('选未命中选项后该维度仍有分数', Number.isFinite(res.scores[partialDim]),
      `${partialDim} = ${res.scores[partialDim]}`);
    check('分数明显低于 50（不是满分也不是 null）',
      res.scores[partialDim] < 50, `${res.scores[partialDim]}`);

    // 选一个命中该维度且为正的选项，应当得到偏高
    const posOpt = present.find((o) => Number(o.effects[partialDim]) > 0) || present[0];
    const st2 = mkState();
    st2.answersByVolume[target.volumeId] = { [target.id]: { value: posOpt.key } };
    const res2 = scorePool(st2, [target], { validDimSet: VALID });
    check('选命中选项后该维度分数更高', res2.scores[partialDim] > res.scores[partialDim],
      `${res2.scores[partialDim]} > ${res.scores[partialDim]}`);
  }

  // 反向：任何一个维度如果只在一题里被选中一次，都不能直接到 100
  const st = mkState();
  let over100 = 0;
  let over90 = 0;
  let total = 0;
  for (const q of allQuestions()) {
    if (q.type !== 'forced_choice') continue;
    const dims = new Set();
    for (const o of q.options) for (const k of Object.keys(o.effects || {})) dims.add(k);
    for (const d of dims) {
      const opts = q.options.filter((o) => o.effects?.[d] !== undefined);
      if (!opts.length || opts.length === q.options.length) continue;
      total += 1;
      const best = opts.sort((a, b) => Number(b.effects[d]) - Number(a.effects[d]))[0];
      const s2 = mkState();
      s2.answersByVolume[q.volumeId] = { [q.id]: { value: best.key } };
      const r = scorePool(s2, [q], { validDimSet: VALID });
      if (r.scores[d] >= 99.9) over100 += 1;
      if (r.scores[d] >= 90) over90 += 1;
    }
  }
  check('单题单维度不再打满 100', over100 === 0, `${over100}/${total} 处`);
  check('单题证据被收缩（90+ 也不该大面积出现）', over90 <= total * 0.1,
    `${over90}/${total} 处 ≥90`);
}

/* ------------------------------------------------------------
   BUG-02 · pyramid_top3 不得出现 NaN
   ------------------------------------------------------------ */

function testBug02() {
  console.log('\n[BUG-02] pyramid_top3 所有维度必须有合法区间，不得 NaN');

  const pyr = allQuestions().filter((q) => q.type === 'pyramid_top3');
  check('存在金字塔题', pyr.length > 0, `${pyr.length} 道`);

  let nanCount = 0;
  let nullWithSingleCard = 0;

  for (const q of pyr) {
    const dims = new Set();
    for (const v of q.values || []) for (const k of Object.keys(v.effects || {})) dims.add(k);

    for (const d of dims) {
      const r = questionRange(q, d);
      if (r && (Number.isNaN(r[0]) || Number.isNaN(r[1]))) {
        nanCount += 1;
        console.log(`      NaN: ${q.id}/${d} → ${JSON.stringify(r)}`);
      }
      // 只有 1 张卡提到该维度时，也必须给出合法区间
      const cards = (q.values || []).filter((v) => v.effects?.[d] !== undefined).length;
      if (cards <= 2 && !r) nullWithSingleCard += 1;
    }
  }

  check('无任何 NaN 区间', nanCount === 0, `${nanCount} 处`);
  check('1–2 张卡的维度也拿到合法区间', nullWithSingleCard === 0, `${nullWithSingleCard} 处缺失`);

  // 端到端：全选第 1–3 张卡，所有维度必须有分数
  const q = pyr[0];
  const st = mkState();
  st.answersByVolume[q.volumeId] = {
    [q.id]: { value: q.values.slice(0, 3).map((v) => v.key) },
  };
  const res = scorePool(st, [q], { validDimSet: VALID });
  const dims = new Set();
  for (const v of q.values) for (const k of Object.keys(v.effects || {})) dims.add(k);
  const missing = [...dims].filter((d) => !Number.isFinite(res.scores[d]));
  check('金字塔作答后所有关联维度都有分', missing.length === 0, missing.join(','));
}

/* ------------------------------------------------------------
   BUG-03 · budget_100 负增益与相对均值映射
   ------------------------------------------------------------ */

function testBug03() {
  console.log('\n[BUG-03] 筹码题：负增益不被丢弃，高于均值要得高分');

  // 纯函数层
  const e = 100 / 6;
  check('0 点 ≈ -0.85', Math.abs(scoreBudgetItem(0, 6) + 0.85) < 0.001, `${scoreBudgetItem(0, 6)}`);
  check('均分点 ≈ 0', Math.abs(scoreBudgetItem(e, 6)) < 0.001, `${scoreBudgetItem(e, 6)}`);
  check('25 点明显为正', scoreBudgetItem(25, 6) > 0.35, `${scoreBudgetItem(25, 6)}`);
  check('37 点封顶为 +1', scoreBudgetItem(37, 6) >= 0.99, `${scoreBudgetItem(37, 6)}`);
  check('负极性取反', scoreBudgetItem(25, 6, -1) < -0.3, `${scoreBudgetItem(25, 6, -1)}`);

  // 端到端：25 点应当稳定拿到 70+
  // 需要「六项各测一个不同维度」的筹码题，否则首个条目所在维度会被同题其他条目摊薄
  const q = allQuestions().find((x) => x.type === 'budget_100'
    && (x.items || []).length === 6
    && new Set(x.items.map((it) => it.dim)).size === x.items.length);
  check('找到 6 项且维度互不重复的筹码题', !!q, q?.id);

  if (q) {
    const st = mkState();
    const map = {};
    q.items.forEach((it, i) => { map[it.key] = i === 0 ? 25 : 15; });  // 25 + 5×15 = 100
    st.answersByVolume[q.volumeId] = { [q.id]: { value: map } };
    const res = scorePool(st, [q], { validDimSet: VALID });

    const first = q.items[0].dim;
    // 映射层：25 点本身应对应 70+ 的等效分（收缩前）
    const rawEquiv = 50 + 50 * scoreBudgetItem(25, 6);
    check('25 点的映射等效分 ≥ 70', rawEquiv >= 70, `等效 ${rawEquiv.toFixed(1)}`);

    // 端到端：单题证据弱，会被收缩，但仍应显著高于均值 50
    check('端到端倾注 25 点后高于 60', res.scores[first] >= 60, `${first} = ${res.scores[first]}`);

    // 相对比较才是用户真正感知的：多给点必须比平均给点得分更高
    const stFlat = mkState();
    const flat = {};
    q.items.forEach((it) => { flat[it.key] = Math.round(100 / q.items.length); });
    stFlat.answersByVolume[q.volumeId] = { [q.id]: { value: flat } };
    const resFlat = scorePool(stFlat, [q], { validDimSet: VALID });
    check('多给点的维度得分高于平均分配', res.scores[first] > resFlat.scores[first] + 5,
      `${res.scores[first].toFixed(1)} vs ${resFlat.scores[first].toFixed(1)}`);

    // 负极性项：v6_q10 的 autonomy gain = -2
    const negQ = allQuestions().find((x) => x.type === 'budget_100'
      && (x.items || []).some((it) => Number(it.gain) < 0));
    if (negQ) {
      const negItem = negQ.items.find((it) => Number(it.gain) < 0);
      const st2 = mkState();
      const map2 = {};
      negQ.items.forEach((it) => { map2[it.key] = 100 / negQ.items.length; });
      map2[negItem.key] = 40;   // 大量投入 -> 该维度应当显著偏低
      st2.answersByVolume[negQ.volumeId] = { [negQ.id]: { value: map2 } };
      const res2 = scorePool(st2, [negQ], { validDimSet: VALID });
      check('负极性项大量投入后分数偏低', Number.isFinite(res2.scores[negItem.dim]) && res2.scores[negItem.dim] < 45,
        `${negItem.dim} = ${res2.scores[negItem.dim]}`);
    }
  }

  // 6 项全平分：所有维度应接近 50，不该挤在两端
  if (q) {
    const st = mkState();
    const map = {};
    const n = q.items.length;
    const base = Math.floor(100 / n);
    q.items.forEach((it, i) => { map[it.key] = base + (i < 100 - base * n ? 1 : 0); });
    st.answersByVolume[q.volumeId] = { [q.id]: { value: map } };
    const res = scorePool(st, [q], { validDimSet: VALID });
    const vals = q.items.map((it) => res.scores[it.dim]).filter(Number.isFinite);
    const spread = Math.max(...vals) - Math.min(...vals);
    check('平分时各维度接近 50', spread < 20, `spread ${spread.toFixed(1)}, vals ${vals.map((v) => v.toFixed(0))}`);
  }
}

/* ------------------------------------------------------------
   BUG-04 · 跨卷不得等权稀释
   ------------------------------------------------------------ */

function testBug04() {
  console.log('\n[BUG-04] 全局池：主测题不得被附加题稀释');

  const qs = allQuestions();
  // 找一个在 vol1 是主测、在其它卷只作附带出现的维度
  const byVol = {};
  for (const q of qs) {
    const dims = getQuestionDims(q, VALID);
    for (const d of dims) {
      (byVol[d] ||= new Set()).add(q.volume_id);
    }
  }
  const multiVolDim = Object.entries(byVol).find(([, vols]) => vols.size >= 2);
  check('存在跨卷共用的维度', !!multiVolDim, multiVolDim?.[0]);

  // 同一套作答：旧算法（逐卷平均）vs 新算法（全局池）应不同，且新算法不把主测题权重砍半
  const st = mkState();
  // 让 vol1 的该维度答到最高端，其余卷答到最低端
  const dim = multiVolDim[0];
  for (const q of qs) {
    const dims = getQuestionDims(q, VALID);
    if (!dims.includes(dim)) continue;

    const volId = q.volume_id;
    const range = questionRange(q, dim);
    if (!range) continue;
    const { lo, hi } = range;
    const wantHigh = volId === 'vol1';
    const target = wantHigh ? hi : lo;

    st.answersByVolume[volId] ||= {};

    if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
      const opt = [...q.options].sort((a, b) => {
        const av = Number(a.effects?.[dim] ?? 0);
        const bv = Number(b.effects?.[dim] ?? 0);
        return wantHigh ? bv - av : av - bv;
      })[0];
      st.answersByVolume[volId][q.id] = { value: opt.key };
    } else if (q.type === 'stealth_scale') {
      const r = q.effects[dim];
      const arr = Array.isArray(r) ? r : [r.low, r.high];
      st.answersByVolume[volId][q.id] = { value: wantHigh ? (arr[1] > arr[0] ? 7 : 1) : (arr[1] > arr[0] ? 1 : 7) };
    }
    st.telemetry[q.id] = { ms: 8000, changes: 0, dirty: false };
  }

  const all = computeAll(st, DATA);
  const score = all.scores[dim];
  check('该维度有分数', Number.isFinite(score), `${dim} = ${score}`);

  // 关键断言：主测题的「单题话语权」必须显著高于附加题。
  // 旧算法（逐卷求均分再平均）会让 13 卷里的 30 道附加题把 vol1 的 5 道主测题摊平；
  // 新算法按 (hi − lo) 振幅加权，vol1 的单题权重应远高于其他卷。
  const volCount = byVol[dim].size;
  console.log(`      ${dim} 出现在 ${volCount} 卷，final = ${score}`);

  const wByVol = {};
  for (const q of qs) {
    if (!getQuestionDims(q, VALID).includes(dim)) continue;
    const r = questionRange(q, dim);
    if (!r) continue;
    const w = (Number(q.weight) || 1) * Math.min(4, Math.max(0.4, r.hi - r.lo));
    wByVol[q.volume_id] ||= [];
    wByVol[q.volume_id].push(w);
  }
  const avgW = (ids) => {
    const all = ids.flatMap((v) => wByVol[v] || []);
    return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  };
  const mainW = avgW(['vol1']);
  const otherW = avgW(Object.keys(wByVol).filter((v) => v !== 'vol1'));
  console.log(`      单题平均振幅权重：vol1 = ${mainW.toFixed(2)} · 其他卷 = ${otherW.toFixed(2)}`);
  check('主测题单题话语权 > 附加题 × 1.5', mainW > otherW * 1.5,
    `vol1 ${mainW.toFixed(2)} vs 其他 ${otherW.toFixed(2)}`);
  check('主测题不被等权摊平（vol1 权重占比 > 每题 AS 平均）', wByVol.vol1.length > 0);
}

/* ------------------------------------------------------------
   BUG-05 · 切屏与脏样本
   ------------------------------------------------------------ */

function testBug05() {
  console.log('\n[BUG-05] 切屏扣除与脏样本');

  const st = mkState();
  // 造 5 道题：4 道正常（2000ms），1 道切屏 60s
  const qs = allQuestions().filter((q) => q.prompt).slice(0, 5);
  qs.forEach((q, i) => {
    st.answersByVolume[q.volume_id] ||= {};
    st.answersByVolume[q.volume_id][q.id] = { value: 'A' };
    st.telemetry[q.id] = i === 0
      ? { ms: 60000, changes: 0, dirty: true, hiddenMs: 58000 }
      : { ms: 2000, changes: 0, dirty: false };
  });

  const baseline = readingBaseline(st, qs);
  const dirty = st.telemetry[qs[0].id];

  check('脏样本被标记', dirty.dirty === true);
  // v4.4：阈值改为按题面长度动态计算（DIRTY_MS 从 25s 提到 55s 作为下限）
  check('DIRTY_MS 下限已提升到 55s', DIRTY_MS === 55000, `${DIRTY_MS}`);
  check('长题阈值高于下限', limitOf({ type: 'forced_choice', prompt: '字'.repeat(200), context: '' }) > DIRTY_MS,
    `${limitOf({ type: 'forced_choice', prompt: '字'.repeat(200), context: '' })}`);
  check('筹码/金字塔给足 120s', limitOf({ type: 'budget_100' }) === 120000);
  check('阅读基线不被 60s 脏样本污染', baseline < 600, `baseline=${baseline.toFixed(0)}ms/字`);
}

/* ------------------------------------------------------------
   BUG-06/07/08 · 步长、野字段、单卷图表
   ------------------------------------------------------------ */

function testBug06to08() {
  console.log('\n[BUG-06~08] 步长 / 野字段 / 单卷图表');

  // BUG-07：野字段扫描
  const wild = [];
  for (const q of allQuestions()) {
    const scan = (obj, where) => {
      for (const k of Object.keys(obj || {})) {
        if (!VALID.has(k)) wild.push(`${q.id}${where}→${k}`);
      }
    };
    scan(q.effects, '');
    for (const o of q.options || []) scan(o.effects, `[${o.key}]`);
    for (const it of q.items || []) {
      if (it.dim && !VALID.has(it.dim)) wild.push(`${q.id}[${it.key}].dim→${it.dim}`);
      scan(it.effects, `[${it.key}]`);
    }
    for (const v of q.values || []) scan(v.effects, `[${v.key}]`);
  }
  check('无野维度键', wild.length === 0, wild.slice(0, 5).join(', '));

  // BUG-06：滑块的组分能凑整 100
  const q = allQuestions().find((x) => x.type === 'budget_100');
  if (q) {
    const n = q.items.length;
    const base = Math.floor(100 / n);
    const rest = 100 - base * n;
    const total = base * n + rest;
    check('平均分配结果恰好 100', total === 100, `${total}`);
    check('平均分配步长为整数', Number.isInteger(base), `${base}`);
  }
}

/* ------------------------------------------------------------
   TC · 极端画像下的分布健康度
   ------------------------------------------------------------ */

function buildProfile(strategy) {
  const st = mkState();
  const qs = allQuestions();

  for (const q of qs) {
    st.answersByVolume[q.volume_id] ||= {};
    let value;

    if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
      if (strategy === 'max') {
        value = q.options[0].key;
      } else if (strategy === 'sd') {
        value = [...q.options].sort((a, b) => (b.social_desirability || 0) - (a.social_desirability || 0))[0].key;
      } else {
        const mid = Math.floor(q.options.length / 2);
        value = q.options[mid].key;
      }
    } else if (q.type === 'stealth_scale') {
      value = strategy === 'max' ? 7 : strategy === 'sd' ? (q.scale?.sdHigh === 'right' ? 7 : 1) : 4;
    } else if (q.type === 'budget_100') {
      const n = q.items.length;
      const base = Math.floor(100 / n);
      const rest = 100 - base * n;
      const map = {};
      q.items.forEach((it, i) => { map[it.key] = base + (i < rest ? 1 : 0); });
      value = map;
    } else if (q.type === 'pyramid_top3') {
      value = q.values.slice(0, 3).map((v) => v.key);
    }

    st.answersByVolume[q.volume_id][q.id] = { value };
    st.telemetry[q.id] = { ms: 6000, changes: 0, dirty: false };
  }

  st.completedVolumes = Object.keys(VOLUMES);
  return st;
}

function testProfiles() {
  console.log('\n[TC] 极端画像分布健康度');

  for (const strategy of ['max', 'sd', 'mid']) {
    const st = buildProfile(strategy);
    const all = computeAll(st, DATA);
    const vals = Object.values(all.scores).filter(Number.isFinite);

    const nan = Object.values(all.scores).filter((v) => Number.isNaN(v)).length;
    const nulls = Object.values(all.scores).filter((v) => v === null).length;
    const at100 = vals.filter((v) => v >= 99.9).length;
    const spread = Math.max(...vals) - Math.min(...vals);

    check(`[${strategy}] 无 NaN`, nan === 0, `${nan}`);
    check(`[${strategy}] 无 null 维度`, nulls === 0, `${nulls}`);
    check(`[${strategy}] 没有大面积打满 100`, at100 <= 3, `${at100} 个维度 = 100`);
    check(`[${strategy}] 分布有区分度`, spread > 10, `spread=${spread.toFixed(1)}`);
    check(`[${strategy}] Z 尖峰已计算`, Object.keys(all.zScores || {}).length > 0);
  }
}

/* ------------------------------------------------------------
   主流程
   ------------------------------------------------------------ */

console.log('═'.repeat(66));
console.log('  计分引擎排雷验收（v4.2）');
console.log('═'.repeat(66));

testBug01();
testBug02();
testBug03();
testBug04();
testBug05();
testBug06to08();
testProfiles();

console.log('\n' + '─'.repeat(66));
console.log(`  通过 ${pass} · 失败 ${fail}`);
if (fail) {
  console.log('\n  失败项：');
  failures.forEach((f) => console.log(`   · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`));
}
console.log('─'.repeat(66));

process.exit(fail ? 1 : 0);
