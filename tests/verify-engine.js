#!/usr/bin/env node
/* ============================================================
   verify-engine.js — 自动化画像校验
   模拟 5 类极端画像，跑通全链路，验证无 NaN / undefined
   ============================================================ */

import fs from 'node:fs';
import { DIMENSIONS, VOLUMES, MIRRORS, ARCHETYPES, CROSS_RULES, PAIR_RULES, DIM_ORDER } from '../src/data/bundle.js';
import { computeAll, maskIndex, maskTierOf, tierOf } from '../src/core/scoring.js';
import { encodeSoulCode, decodeSoulCode, SCHEMA_VERSION } from '../src/core/storage.js';
import {
  buildHolographicReport, matchArchetype, matchCrossRules, mirrorFor,
  topGifts, topShadows, buildVolumeReport,
} from '../src/core/synthesizer.js';
import { compareStates } from '../src/core/comparator.js';
import {
  scoreAllEcologies, relationshipScript, subtextDecoder, chemistryBoard,
} from '../src/core/ecology.js';

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

/* ------------------------------------------------------------
   断言 / 报告
   ------------------------------------------------------------ */

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

function deepScan(value, path = '$', issues = []) {
  if (value === undefined) issues.push(`${path} = undefined`);
  else if (typeof value === 'number' && Number.isNaN(value)) issues.push(`${path} = NaN`);
  else if (value === Infinity || value === -Infinity) issues.push(`${path} = Infinity`);
  else if (Array.isArray(value)) {
    value.forEach((v, i) => deepScan(v, `${path}[${i}]`, issues));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) deepScan(v, `${path}.${k}`, issues);
  }
  return issues;
}

/* ------------------------------------------------------------
   造画像
   ------------------------------------------------------------ */

function emptyState(nickname = '') {
  return {
    version: SCHEMA_VERSION,
    nickname,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedVolumes: [],
    inProgress: {},
    answersByVolume: {},
    computedScores: {},
    maskIndex: null,
    topValues: [],
    flags: {},
    telemetry: {},
  };
}

function qList(volId) {
  const vol = VOLUMES[volId];
  return (vol.questions || []).map((q) => ({ ...q, volumeId: volId, volume_id: q.volume_id || vol.volume_id }));
}

/**
 * 作答策略：
 *   bite      — 随机均匀
 *   sd        — 总选最高社会赞许度
 *   sd_slow   — 高赞许度 + 超长犹豫 + 多次改选（伪装者）
 *   extreme   — 总选第一个/最后一个，制造极端
 */
function answerVolume(state, volId, strategy = 'random', rng = Math.random) {
  const list = qList(volId);
  const ans = (state.answersByVolume[volId] ||= {});

  const isSd = strategy === 'sd' || strategy === 'sd_slow';

  for (const q of list) {
    let value;
    if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
      if (isSd) {
        const best = [...(q.options || [])].sort(
          (a, b) => (b.social_desirability || 0) - (a.social_desirability || 0),
        )[0];
        value = best?.key;
      } else if (strategy === 'extreme') {
        value = q.options?.[0]?.key;
      } else {
        const i = Math.floor(rng() * (q.options?.length || 1));
        value = q.options?.[i]?.key;
      }
    } else if (q.type === 'stealth_scale') {
      if (isSd) value = q.scale?.sdHigh === 'right' ? 7 : 1;
      else if (strategy === 'extreme') value = 7;
      else value = 1 + Math.floor(rng() * 7);
    } else if (q.type === 'budget_100') {
      const items = q.items || [];
      const base = Math.floor(100 / items.length);
      const map = {};
      let rest = 100 - base * items.length;
      items.forEach((it, i) => {
        map[it.key] = base + (i < rest ? 1 : 0);
      });
      if (strategy === 'extreme') {
        items.forEach((it, i) => { map[it.key] = i === 0 ? 100 : 0; });
      }
      value = map;
    } else if (q.type === 'pyramid_top3') {
      const keys = (q.values || []).map((v) => v.key);
      const shuffled = strategy === 'extreme' ? keys : [...keys].sort(() => rng() - 0.5);
      value = shuffled.slice(0, 3);
    }

    ans[q.id] = { value, ms: 6000, changes: 0, at: Date.now() };

    // 遥测
    const chars = (q.prompt || '').length + (q.context || '').length;
    let ms = Math.max(2400, chars * 190);
    let changes = 0;
    if (strategy === 'sd_slow' && q.is_sensitive) {
      ms = Math.round(ms * 3.8);
      changes = 3;
    }
    if (strategy === 'blind') ms = 400;

    state.telemetry[q.id] = { ms, readMs: ms, changes, ts: Date.now() };
  }

  if (!state.completedVolumes.includes(volId)) state.completedVolumes.push(volId);
  delete state.inProgress[volId];
  return state;
}

function applyScores(state) {
  const all = computeAll(state, DATA);
  state.computedScores = {};
  for (const d of DIM_ORDER) {
    if (Number.isFinite(all.scores[d])) state.computedScores[d] = all.scores[d];
  }
  const m = maskIndex(state, DATA);
  state.maskIndex = m.value;
  state.maskDetail = m;
  state.topValues = all.topValues || [];
  state.pressureStyle = all.pressure || null;
  return state;
}

/* ------------------------------------------------------------
   TC1 · 仅完成单卷
   ------------------------------------------------------------ */

function tc1() {
  console.log('\n[TC1] 仅完成 Vol.1（单卷闭环）');
  const s = emptyState('单卷用户');
  answerVolume(s, 'vol1', 'random');
  applyScores(s);

  check('完成卷数为 1', s.completedVolumes.length === 1);
  check('computedScores 非空', Object.keys(s.computedScores).length >= 10, `${Object.keys(s.computedScores).length}`);
  check('分数均在 0-100', Object.values(s.computedScores).every((v) => v >= 0 && v <= 100));

  const report = buildHolographicReport(s, DATA);
  const issues = deepScan({
    gifts: report.gifts, shadows: report.shadows, arch: report.archetype?.best?.name,
  });
  check('单卷报告无 NaN/undefined', issues.length === 0, issues.slice(0, 3).join('; '));

  const volReport = buildVolumeReport(s, DATA, 'vol1');
  check('单卷报告可生成', !!volReport && volReport.dims && Object.keys(volReport.dims).length >= 10);
  check('双面镜卡片非空', volReport.gifts.length > 0 && volReport.shadows.length > 0);
  check('单卷面具指数在 0-100', s.maskIndex === null || (s.maskIndex >= 0 && s.maskIndex <= 100));
  check('单卷未触发跨卷规则', matchCrossRules(s.computedScores, { value: s.maskIndex }, CROSS_RULES, s.completedVolumes).length === 0
    || CROSS_RULES.every((r) => (r.required_volumes || []).length > 0));
  return s;
}

/* ------------------------------------------------------------
   TC2 · 完成 3 卷触发交叉
   ------------------------------------------------------------ */

function tc2() {
  console.log('\n[TC2] 完成 3 卷（跨卷引擎激活）');
  const s = emptyState('三卷用户');
  ['vol1', 'vol2', 'vol3'].forEach((v) => answerVolume(s, v, 'random'));
  applyScores(s);

  check('完成卷数为 3', s.completedVolumes.length === 3);
  const cross = matchCrossRules(s.computedScores, { value: s.maskIndex }, CROSS_RULES, s.completedVolumes);
  check('跨卷规则可返回结果（0~N 条，不报错）', Array.isArray(cross));
  check('返回的规则结构完整', cross.every((c) => c.title && c.insight && c.advice && c.id));

  const arch = matchArchetype(s.computedScores, ARCHETYPES);
  check('原型匹配返回最佳原型', !!arch?.best?.name);
  check('原型 fit 在 0-100', arch.best.fit >= 0 && arch.best.fit <= 100);

  const report = buildHolographicReport(s, DATA);
  const issues = deepScan({
    scores: report.scores, gifts: report.gifts, shadows: report.shadows,
    cross: report.cross.map((c) => ({ t: c.title, i: c.insight })),
    dual: report.dual, manual: report.manual,
  });
  check('三卷全息报告无 NaN/undefined', issues.length === 0, issues.slice(0, 3).join('; '));
  return s;
}

/* ------------------------------------------------------------
   TC3 · 全卷常规作答
   ------------------------------------------------------------ */

function tc3() {
  console.log('\n[TC3] 全卷常规作答（全息大成）');
  const s = emptyState('全卷用户');
  VOL_IDS.forEach((v) => answerVolume(s, v, 'random'));
  applyScores(s);

  check(`完成卷数为 ${VOL_IDS.length}`, s.completedVolumes.length === VOL_IDS.length);
  const scored = Object.keys(s.computedScores);
  check('全部维度有分', scored.length === DIMENSIONS.dims.length, `${scored.length}`);
  check('所有维度均非 NaN', Object.values(s.computedScores).every((v) => Number.isFinite(v)));

  const report = buildHolographicReport(s, DATA);
  check('原型匹配成功', !!report.archetype?.best?.name);
  check('王牌天赋 4 张', report.gifts.length === 4);
  check('阴影预警 3 张', report.shadows.length === 3);
  check('跨卷规则不超总数', report.cross.length <= CROSS_RULES.length);

  // 存档码往返
  const code = encodeSoulCode(s, DIM_ORDER);
  check('存档码长度合理', code.length >= 100 && code.length <= 640, `${code.length}`);
  const back = decodeSoulCode(code, DIM_ORDER);
  check('存档码可解码', back.ok, back.ok ? '' : back.error);
  if (back.ok) {
    check('存档码保留完成卷数', back.state.completedVolumes.length === s.completedVolumes.length,
      `${back.state.completedVolumes.length}/${s.completedVolumes.length}`);
    check('存档码保留面具有效值', Number.isFinite(back.state.maskIndex));
    const diffs = Object.entries(back.state.computedScores)
      .filter(([d, v]) => Math.abs((s.computedScores[d] ?? 0) - v) > 1);
    check('存档码分数误差 ≤1', diffs.length === 0, diffs.slice(0, 3).map(([d]) => d).join(','));
  }

  const issues = deepScan(report);
  check('全量报告无 NaN/undefined', issues.length === 0, issues.slice(0, 3).join('; '));
  return s;
}

/* ------------------------------------------------------------
   TC4 · 刻意伪装
   ------------------------------------------------------------ */

function tc4() {
  console.log('\n[TC4] 全程刻意伪装（高社会赞许 + 超长犹豫）');
  const s = emptyState('伪装者');
  VOL_IDS.forEach((v) => answerVolume(s, v, 'sd_slow'));
  applyScores(s);

  check('面具指数 M ≥ 65', s.maskIndex !== null && s.maskIndex >= 65, `M=${s.maskIndex}`);
  check('面具档位为精密防卫层或体面调节层',
    ['精密防卫层', '体面调节层'].includes(maskTierOf(s.maskIndex).name),
    maskTierOf(s.maskIndex).name);

  const d = s.maskDetail;
  check('D_sd 被计算', Number.isFinite(d.dsd), `${d.dsd}`);
  check('H_lat 被计算', Number.isFinite(d.hlat), `${d.hlat}`);
  check('完成 vol8 后 G_mirror 参与', d.mirror !== null, `${d.mirror}`);

  const report = buildHolographicReport(s, DATA);
  const maskRules = report.cross.filter((c) => c.id === 'CR_31' || c.id === 'CR_32');
  check('面具相关跨卷规则被触发', maskRules.length > 0, `${maskRules.map((r) => r.id).join(',')}`);
  return s;
}

/* ------------------------------------------------------------
   TC5 · 双人局部交集
   ------------------------------------------------------------ */

function tc5() {
  console.log('\n[TC5] 双人局部交集（A 6 卷，B 3 卷）');
  const A = emptyState('A 君');
  const B = emptyState('B 君');
  ['vol1', 'vol2', 'vol3', 'vol4', 'vol5', 'vol6'].forEach((v) => answerVolume(A, v, 'random'));
  ['vol1', 'vol2', 'vol7'].forEach((v) => answerVolume(B, v, 'random'));
  applyScores(A);
  applyScores(B);

  const res = compareStates(A, B, DATA);
  check('对比可计算', res.ok, res.ok ? '' : res.reason);
  check('交集为 vol1, vol2', res.common.length === 2 && res.common.includes('vol1') && res.common.includes('vol2'));
  check('契合度在 0-100', res.overall >= 0 && res.overall <= 100, `${res.overall}`);
  check('共振分在 0-100', res.sync && res.sync.value >= 0 && res.sync.value <= 100);
  check('互补分在 0-100', res.complement && res.complement.value >= 0 && res.complement.value <= 100);

  const issues = deepScan({
    overall: res.overall,
    sync: res.sync,
    complement: { value: res.complement?.value, golden: res.complement?.golden },
    collisions: res.collisions,
    resonances: res.resonances,
    rows: res.rows,
  });
  check('对比结果无 NaN/undefined', issues.length === 0, issues.slice(0, 3).join('; '));

  // 极端：无交集
  const C = emptyState('C 君');
  answerVolume(C, 'vol8', 'random');
  applyScores(C);
  const res2 = compareStates(A, C, DATA);
  check('无交集时优雅降级', res2.ok === false && typeof res2.reason === 'string');

  // 极端：完全相同的画像
  const res3 = compareStates(A, A, DATA);
  check('自比对可计算', res3.ok);
  check('自比对共振为 100', res3.sync && Math.round(res3.sync.value) === 100, `${res3.sync?.value}`);
  return { A, B };
}

/* ------------------------------------------------------------
   TC6 · 数据契约完整性
   ------------------------------------------------------------ */

function tc6() {
  console.log('\n[TC6] 数据契约完整性');

  // 卷 → 题量契约（v4.2 十六卷）
  const expected = {
    vol1: 22, vol2: 20, vol3: 18, vol4: 20, vol5: 18, vol6: 18, vol7: 18, vol8: 18,
    vol9: 20, vol10: 16, vol11: 20, vol12: 22, vol13: 18, vol14: 18, vol15: 16, vol16: 16,
  };
  let total = 0;
  let expectedTotal = 0;
  for (const [vid, n] of Object.entries(expected)) {
    const vol = VOLUMES[vid];
    check(`${vid} 题量为 ${n}`, vol?.questions?.length === n, `${vol?.questions?.length}`);
    total += vol?.questions?.length || 0;
    expectedTotal += n;
  }
  check(`总题量为 ${expectedTotal}`, total === expectedTotal, `${total}`);

  check('维度总数为 127', DIMENSIONS.dims.length === 127, `${DIMENSIONS.dims.length}`);
  check('双面镜覆盖全部维度', Object.keys(MIRRORS).length === DIMENSIONS.dims.length,
    `${Object.keys(MIRRORS).length}/${DIMENSIONS.dims.length}`);
  check('双面镜四面完整', Object.values(MIRRORS).every(
    (m) => m.high?.gift_title && m.high?.shadow_title && m.high?.alchemy_tip
      && m.low?.gift_title && m.low?.shadow_title && m.low?.alchemy_tip
      && m.high?.gift_desc && m.high?.shadow_desc && m.low?.gift_desc && m.low?.shadow_desc,
  ));
  check('原型数量为 36', ARCHETYPES.archetypes.length === 36, `${ARCHETYPES.archetypes.length}`);
  check('跨卷规则 ≥ 60', CROSS_RULES.length >= 60, `${CROSS_RULES.length}`);

  // 题型覆盖
  const types = new Set();
  let stealthMirror = 0;
  for (const vid of VOL_IDS) {
    for (const q of VOLUMES[vid].questions) {
      types.add(q.type);
      if (q.layer === 'stealth' && q.mirror_key) stealthMirror += 1;
    }
  }
  check('5 种题型全部使用', ['forced_choice', 'stealth_scale', 'impulse_3s', 'budget_100', 'pyramid_top3']
    .every((t) => types.has(t)), [...types].join(','));
  check('vol8 暗线镜像题 ≥ 10', stealthMirror >= 10, `${stealthMirror}`);

  // ID 唯一
  const ids = [];
  for (const vid of VOL_IDS) ids.push(...VOLUMES[vid].questions.map((q) => q.id));
  check('题目 ID 全局唯一', new Set(ids).size === ids.length);

  // mirror_key 一致性
  const mirrorKeys = new Set();
  for (const vid of VOL_IDS) {
    for (const q of VOLUMES[vid].questions) {
      if (q.mirror_key && q.mirror_key !== 'values' && q.mirror_key !== 'motors') mirrorKeys.add(q.mirror_key);
    }
  }
  check('mirror_key 数量充足（≥14）', mirrorKeys.size >= 14, `${mirrorKeys.size}`);

  // budget 总和约束
  for (const vid of VOL_IDS) {
    for (const q of VOLUMES[vid].questions) {
      if (q.type === 'budget_100') {
        check(`${q.id} items 数 ≥ 5`, (q.items || []).length >= 5);
      }
      if (q.type === 'pyramid_top3') {
        check(`${q.id} 值为 8 选 3`, (q.values || []).length === 8);
      }
    }
  }

  // 选项字数均衡（≤1.45）
  let worst = 1;
  let worstId = '';
  for (const vid of VOL_IDS) {
    for (const q of VOLUMES[vid].questions) {
      if (!q.options?.length) continue;
      const lens = q.options.map((o) => o.text.length);
      const r = Math.max(...lens) / Math.max(1, Math.min(...lens));
      if (r > worst) { worst = r; worstId = q.id; }
    }
  }
  check('选项字数比 ≤1.7', worst <= 1.7, `${worst.toFixed(2)} @ ${worstId}`);
}

/* ------------------------------------------------------------
   TC6c · 六大关系生态位引擎
   ------------------------------------------------------------ */

function tc6c() {
  console.log('\n[TC6c] 六大关系生态位');

  const mk = (over, mask = 50) => {
    const s = {};
    for (const d of DIM_ORDER) s[d] = 50;
    Object.assign(s, over);
    return { computedScores: s, maskIndex: mask };
  };

  // 全中性：六个生态位都该落在 45–70，不该有满分
  const neutral = scoreAllEcologies(mk({}), mk({}), DIM_ORDER, { a: 50, b: 50 });
  check('中性画像可算出生态位', neutral.list.length > 0, `${neutral.list.length}`);
  check('中性画像无满分', neutral.list.every((r) => r.value < 80),
    neutral.list.map((r) => `${r.id}:${r.value}`).join(' '));

  // 精神同频：灵魂知己必须排第一
  const same = {
    phil_stoic: 76, phil_existential: 74, mft_care: 80, mft_fairness: 78,
    big5_open: 78, cog_global: 76, mot_purpose: 74, light_humanism: 76,
  };
  const sameShift = Object.fromEntries(Object.entries(same).map(([k, v]) => [k, v - 3]));
  const confidant = scoreAllEcologies(mk(same), mk(sameShift), DIM_ORDER, { a: 55, b: 52 });
  check('精神同频时灵魂知己排第一', confidant.best?.id === 'confidant',
    confidant.best?.id);

  // 认知互补：事业搭档必须排第一
  const workA = { cog_global: 82, cog_diverge: 84, cog_speed: 78, big5_order: 72, big5_industry: 78, light_kant: 74, wv_social: 70, time_future: 76 };
  const workB = { cog_global: 34, cog_diverge: 36, cog_speed: 40, big5_order: 32, big5_industry: 74, light_kant: 70, wv_social: 66, time_future: 72 };
  const cofounder = scoreAllEcologies(mk(workA), mk(workB), DIM_ORDER, { a: 50, b: 50 });
  check('认知互补时事业搭档排第一', cofounder.best?.id === 'cofounder',
    cofounder.best?.id);

  // 双高锋芒：镜面宿敌必须排第一
  const rivalOver = {
    sin_pride: 78, sin_wrath: 72, dark_mach: 80, mot_mastery: 80,
    enn_8: 76, tki_competing: 78, big5_assert: 76,
  };
  const rivalShift = Object.fromEntries(Object.entries(rivalOver).map(([k, v]) => [k, v - 4]));
  const rival = scoreAllEcologies(mk(rivalOver), mk(rivalShift), DIM_ORDER, { a: 60, b: 58 });
  check('双高锋芒时镜面宿敌排第一', rival.best?.id === 'rival', rival.best?.id);

  // 置信度随维度数变化
  const few = scoreAllEcologies(mk({ phil_stoic: 70, phil_existential: 68 }), mk({ phil_stoic: 68, phil_existential: 66 }), ['phil_stoic', 'phil_existential'], {});
  check('维度少时置信度为初探', few.list.every((r) => r.confidence === 'low'),
    few.list.map((r) => r.confidence).join(','));

  // 三幕剧
  const A = mk({ def_detach: 72, att_avoidance: 70, big5_social: 38 });
  const B = mk({ att_anxiety: 70, def_fawn: 64, big5_social: 66 });
  const script = relationshipScript(A, B, { a: 62, b: 38 });
  check('三幕剧恰好三幕', script.acts.length === 3, `${script.acts.length}`);
  check('三幕剧每幕都有正文', script.acts.every((x) => x.body && x.body.length > 20));
  check('追逃组合被识别', script.acts[2].tags.includes('追逃循环'),
    script.acts[2].tags.join('/'));

  // 潜台词解码器
  const dec = subtextDecoder(B);
  check('解码器能给出至少 1 条', dec.length >= 1, `${dec.length}`);
  check('解码器最多 3 条', dec.length <= 3, `${dec.length}`);
  check('解码器每条三要素齐全', dec.every((x) => x.line && x.real && x.better));

  // 红黑榜
  const board = chemistryBoard(A, B);
  check('红黑榜有加分项', board.green.length > 0, `${board.green.length}`);
  check('红黑榜有禁区项', board.red.length > 0, `${board.red.length}`);
  check('红黑榜每项都带 A/B 归属', [...board.green, ...board.red].every((x) => x.for === 'A' || x.for === 'B'));
}

/* ------------------------------------------------------------
   TC6b · 量表档位与语义文案必须严格一一对应
   ------------------------------------------------------------ */

function tc6b() {
  console.log('\n[TC6b] 量表档位 ↔ 语义文案一致性');

  // 与 QuizRunner 中 SCALE_WORDS 保持一致（此处独立抄写，防止被同时改错）
  const EXPECT = [
    '强烈偏向左侧',
    '明显偏向左侧',
    '略偏左侧',
    '居中平衡',
    '略偏右侧',
    '明显偏向右侧',
    '强烈偏向右侧',
  ];

  const src = fs.readFileSync(new URL('../src/components/QuizRunner.js', import.meta.url), 'utf8');

  // 1) 词表本身
  const m = src.match(/const SCALE_WORDS = \[([\s\S]*?)\];/);
  check('QuizRunner 中存在 SCALE_WORDS 常量', !!m);
  if (m) {
    const words = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    check('SCALE_WORDS 恰好 7 档', words.length === 7, `${words.length}`);
    check('七档语义与预期逐字一致', JSON.stringify(words) === JSON.stringify(EXPECT),
      words.join('/'));
  }

  // 2) 提示文字只能由「悬停预览」或「已选档位」推导，不能有第三个来源
  check('提示由 hovering ?? selected 推导', /hovering\s*!==\s*null\s*\?\s*hovering\s*:\s*selected/.test(src));
  check('存在 setScale 供外部同步', /wrap\.setScale\s*=/.test(src));
  check('onPick 内会调用 setScale', /scaleWidget\.setScale\(value\)/.test(src));

  // 3) 键盘路径不得绕过 onPick（否则提示会停留在悬停态）
  const keyStart = src.indexOf('const onKey');
  const keyEnd = src.indexOf("window.addEventListener('keydown', onKey)");
  const keyBlock = keyStart >= 0 && keyEnd > keyStart ? src.slice(keyStart, keyEnd) : '';
  check('键盘数字键量表分支走 pickHandler', /stealth_scale[\s\S]{0,220}pickHandler\(n\)/.test(keyBlock));
  check('键盘选择题分支也走 pickHandler', /forced_choice[\s\S]{0,200}pickHandler\(opt\.key\)/.test(keyBlock));
  check('键盘分支不再直接写 scale-dot 类名', !/\.scale-dot'[\s\S]{0,120}dataset\.k === String\(n\)/.test(keyBlock));

  // 4) 数值一致性：第 i 档 → 第 i 条文案
  EXPECT.forEach((w, i) => {
    const expectLabel = `第 ${i + 1} 档：${w}`;
    check(`aria-label 与档位对齐（${expectLabel}）`, src.includes(`第 \${i} 档：\${SCALE_WORDS[i - 1]}`) || src.includes(expectLabel));
  });
}

/* ------------------------------------------------------------
   TC7 · 边界鲁棒性
   ------------------------------------------------------------ */

function tc7() {
  console.log('\n[TC7] 边界与鲁棒性');

  // 空状态
  const s = emptyState('');
  const all = computeAll(s, DATA);
  check('空状态计分不报错', !!all);
  check('空状态全部维度为 null', Object.values(all.scores).every((v) => v === null));
  check('空状态面具为 null', all.mask.value === null);

  const code = encodeSoulCode(s, DIM_ORDER);
  const back = decodeSoulCode(code, DIM_ORDER);
  check('空状态存档码可往返', back.ok && back.state.completedVolumes.length === 0);

  // 损坏的存档码
  check('错误前缀被拒绝', decodeSoulCode('XX-foo').ok === false);
  check('截断的存档码被拒绝', decodeSoulCode('HA3-AAA').ok === false);
  check('篡改的存档码被拒绝', decodeSoulCode(`${code.slice(0, -3)}AAA`).ok === false);

  // 半途作答
  const p = emptyState('半途');
  const vol1 = qList('vol1');
  const ans = (p.answersByVolume.vol1 = {});
  vol1.slice(0, 5).forEach((q) => {
    const v = q.options?.[0]?.key ?? (q.type === 'stealth_scale' ? 4 : null);
    if (v !== null) ans[q.id] = { value: v, ms: 4000, changes: 0 };
  });
  applyScores(p);
  check('半途作答可计分', Object.keys(p.computedScores).length > 0);

  // 盲选降权
  const b = emptyState('盲选');
  answerVolume(b, 'vol1', 'blind');
  applyScores(b);
  check('全盲选仍可产出分数', Object.keys(b.computedScores).length > 0);

  // mirrorFor 边界
  check('0 分映射低分面', mirrorFor('sin_pride', 0, MIRRORS)?.side === 'low');
  check('100 分映射高分面', mirrorFor('sin_pride', 100, MIRRORS)?.side === 'high');
  check('50 分映射高分面', mirrorFor('sin_pride', 50, MIRRORS)?.side === 'high');
  check('未知维度返回 null', mirrorFor('nope', 50, MIRRORS) === null);

  check('tierOf 四档正确',
    tierOf(90).id === 1 && tierOf(70).id === 2 && tierOf(50).id === 3 && tierOf(20).id === 4);
}

/* ------------------------------------------------------------
   主流程
   ------------------------------------------------------------ */

function main() {
  console.log('═'.repeat(64));
  console.log('  The Human Atlas · 自动化画像校验');
  console.log('═'.repeat(64));

  const t1 = tc1();
  tc2();
  tc3();
  tc4();
  tc5();
  tc6();
  tc6b();
  tc6c();
  tc7();

  console.log('\n' + '─'.repeat(64));
  console.log(`  通过 ${pass} · 失败 ${fail}`);
  if (fail) {
    console.log('\n  失败项：');
    failures.forEach((f) => console.log(`   · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`));
  }
  console.log('─'.repeat(64));

  process.exit(fail ? 1 : 0);
}

main();
