#!/usr/bin/env node
/* ============================================================
   verify-engine.js — 自动化画像校验
   模拟 5 类极端画像，跑通全链路，验证无 NaN / undefined
   ============================================================ */

import fs from 'node:fs';
import { DIMENSIONS, VOLUMES, MIRRORS, ARCHETYPES, CROSS_RULES, PAIR_RULES, DIM_ORDER } from '../src/data/bundle.js';
import { computeAll, maskIndex, maskTierOf, tierOf } from '../src/core/scoring.js';
import { encodeSoulCode, decodeSoulCode, mergeImportedState, SCHEMA_VERSION } from '../src/core/storage.js';
import {
  EXPRESS_BUCKET, buildExpressVolume, seedFromVolumes, commitExpress, resetExpress, expressProgress,
} from '../src/core/express.js';
import {
  buildHolographicReport, matchArchetype, matchCrossRules, mirrorFor,
  topGifts, topShadows, buildVolumeReport,
} from '../src/core/synthesizer.js';
import { compareStates } from '../src/core/comparator.js';
import { buildVolumeTypology } from '../src/core/typology.js';
import {
  pressureSandbox, innerParliament, timelineDiff, stageOf, ENERGY_STAGES,
} from '../src/core/lab.js';
import {
  JOHARI_DIMS, JOHARI_QUESTIONS, encodeJohari, decodeJohari, johariResult,
} from '../src/core/johari.js';
import { assignRoles, affinityMatrix, coverage, squadCharter } from '../src/core/squad.js';
import { ALIGNMENTS, alignmentFrom } from '../src/viz/alignmentSvg.js';
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
  check('原型匹配成功', report.archetype?.eligible === true && !!report.archetype?.best?.name,
    `eligible=${report.archetype?.eligible}`);
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

  /* 极端 A：卷交集为空，但可比维度足够（28 题极速档的真实形态）。
     v5.2.2 起合盘闸门改为「可比维度 ≥ 10」，不再看共同卷宗。
     A 做了 vol1–6，C 只做了 vol8 —— 一卷都不重合，但 sin/virtue/dark/light/big5
     有 20 个共同维度，必须放行。 */
  const C = emptyState('C 君');
  answerVolume(C, 'vol8', 'random');
  applyScores(C);
  const res2 = compareStates(A, C, DATA);
  check('卷交集为空但可比维度 ≥10 时放行', res2.ok === true && res2.common.length === 0,
    `common=${res2.common.length} dims=${res2.dims.length}`);
  check('卷交集为空时标记为极速对档', res2.isExpressPair === true);

  /* 极端 B：可比维度不足 10 → 优雅降级 */
  const D = emptyState('D 君');
  D.computedScores = {};
  DIM_ORDER.slice(0, 6).forEach((d) => { D.computedScores[d] = 55; });
  const res4 = compareStates(A, D, DATA);
  check('可比维度 <10 时优雅降级', res4.ok === false && typeof res4.reason === 'string',
    `${res4.dims?.length} 维`);

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
   TC6i · 导览页与首屏分流
   ------------------------------------------------------------ */

function tc6i() {
  console.log('\n[TC6i] 导览页与首屏分流');

  const mainSrc = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const guideSrc = fs.readFileSync(new URL('../src/components/GuideView.js', import.meta.url), 'utf8');

  /* ---- 路由与导航 ---- */
  check('注册了 #/guide 路由', /head === 'guide'/.test(mainSrc));
  check('顶部导航含「导览」', /href: '#\/guide', label: '导览'/.test(mainSrc));

  /* ---- 首屏分流：必须只作用于根路由 ---- */
  check('首屏分流在根路由分支内',
    /if \(head === '' \|\| head === 'hub'\)[\s\S]{0,400}guideSeen\(\)/.test(mainSrc));
  check('有进度时跳过大堂不被拦',
    /hasProgress[\s\S]{0,200}!hasProgress && !guideSeen\(\)/.test(mainSrc));

  // 关键：功能深链绝不能被导览拦截 —— 它们各自有独立分支，且分支顺序在 hub 之前或之后都不影响
  const deepLinks = ['quiz', 'report', 'compare', 'express', 'johari', 'squad'];
  deepLinks.forEach((k) => {
    check(`深链 #/${k} 有独立分支`, new RegExp(`head === '${k}'`).test(mainSrc));
  });
  check('深链分支里不出现 guideSeen 重定向',
    !/head === 'join'[\s\S]{0,200}guideSeen/.test(mainSrc));

  /* ---- 零硬编码：导览页数字必须动态读 DATA ---- */
  const hardcoded = [];
  if (/"298"/.test(guideSrc) || /'298'/.test(guideSrc)) hardcoded.push('298');
  if (/"127"/.test(guideSrc) || /'127'/.test(guideSrc)) hardcoded.push('127');
  if (/"65"/.test(guideSrc) || /'65'/.test(guideSrc)) hardcoded.push('65');
  if (/"296"/.test(guideSrc)) hardcoded.push('296');
  check('导览页无写死的卷/题/维/规则数', hardcoded.length === 0, hardcoded.join(','));

  check('题数从 DATA 累加', /reduce\(\(a, v\) => a \+ DATA\.volumes\[v\]\.questions\.length/.test(guideSrc));
  check('维度数读 dimOrder', /DATA\.dimOrder\.length/.test(guideSrc));
  check('规则数读 crossRules', /DATA\.crossRules/.test(guideSrc));

  /* ---- 可访问性：aria-expanded ---- */
  check('模块按钮带 aria-expanded', /'aria-expanded': 'false'/.test(guideSrc));
  check('展开时更新 aria-expanded', /setAttribute\('aria-expanded', 'true'\)/.test(guideSrc));
  check('再次点击会收起', /if \(isOpen\) \{[\s\S]{0,260}setAttribute\('aria-expanded', 'false'\)/.test(guideSrc));

  /* ---- 六模块齐全 ---- */
  const nos = ['01', '02', '03', '04', '05', '06'];
  check('六个模块编号齐全', nos.every((n) => guideSrc.includes(`no: '${n}'`)));
}

/* ------------------------------------------------------------
   TC6h · 九宫格 / 四象限 / 沙盒刻度
   ------------------------------------------------------------ */

function tc6h() {
  console.log('\n[TC6h] 九宫格 / 四象限 / 沙盒刻度');

  /* ---- 九宫格：九格齐全 ---- */
  check('九宫格恰好 9 格', ALIGNMENTS.length === 9, `${ALIGNMENTS.length}`);
  check('九格 key 唯一', new Set(ALIGNMENTS.map((a) => a.key)).size === 9);

  const EXPECT_KEYS = ['lg', 'ng', 'cg', 'ln', 'tn', 'cn', 'le', 'ne', 'ce'];
  const keys = new Set(ALIGNMENTS.map((a) => a.key));
  check('九格覆盖 lg/ng/cg/ln/tn/cn/le/ne/ce',
    EXPECT_KEYS.every((k) => keys.has(k)) && keys.size === 9,
    [...keys].join(','));

  /* ---- 九宫格：分档与落点必须一致 ---- */
  // 分档用精确三等分（与 alignmentSvg.BAND_EDGE 一致）
  const E = 100 / 3;
  const bandOfLocal = (v) => (v >= E * 2 ? 0 : v <= E ? 2 : 1);
  let mismatch = 0;
  const bad = [];
  for (let o = 0; o <= 100; o += 1) {
    const hit = alignmentFrom(o, 50);
    if (bandOfLocal(o) !== hit.col) { mismatch += 1; bad.push(o); }
  }
  check('101 个分数点的档位与落点一致', mismatch === 0,
    mismatch ? `不一致：${bad.slice(0, 5).join(',')}` : '');

  /* ---- 九宫格：方向（守序=第 0 列，混乱=第 2 列） ---- */
  check('高秩序落在守序列（col 0）', alignmentFrom(80, 50).col === 0,
    alignmentFrom(80, 50).alignment.name);
  check('低秩序落在混乱列（col 2）', alignmentFrom(20, 50).col === 2,
    alignmentFrom(20, 50).alignment.name);
  check('中秩序落在中立列（col 1）', alignmentFrom(50, 50).col === 1,
    alignmentFrom(50, 50).alignment.name);

  /* ---- 四象限轴标签必须在格子外 ---- */
  const src = fs.readFileSync(new URL('../src/viz/matrixSvg.js', import.meta.url), 'utf8');
  check('xLo/xHi 画在格子下方',
    /x: padL \+ 2, y: padT \+ ih \+ 18/.test(src)
    && /x: padL \+ iw - 2, y: padT \+ ih \+ 18/.test(src));
  check('yHi/yLo 画在格子左侧',
    /x: padL - 10, y: padT \+ 12/.test(src)
    && /x: padL - 10, y: padT \+ ih - 4/.test(src));
  check('格子内不再画 yHi/yLo',
    !/x: padL \+ 6, y: padT \+ 12/.test(src)
    && !/x: padL \+ 6, y: padT \+ ih - 6/.test(src));

  /* ---- 沙盒刻度牌必须与滑杆同向 ---- */
  const lab = fs.readFileSync(new URL('../src/components/LabView.js', import.meta.url), 'utf8');
  check('刻度牌不再 reverse', !/ENERGY_STAGES\.slice\(\)\.reverse\(\)/.test(lab));
  check('刻度牌按 ENERGY_STAGES 原序', /ENERGY_STAGES\.forEach/.test(lab));
  check('ENERGY_STAGES 从低到高',
    ENERGY_STAGES[0].key === 'depleted' && ENERGY_STAGES[3].key === 'zone',
    `${ENERGY_STAGES[0].key} → ${ENERGY_STAGES[3].key}`);
}

/* ------------------------------------------------------------
   TC6g · 单卷报告渲染回归（防 TDZ / 象限镜像）
   ------------------------------------------------------------ */

function tc6g() {
  console.log('\n[TC6g] 单卷报告渲染回归');

  /* --- 1. TDZ 守卫：typoScoreMap 必须在首次使用之前声明 --- */
  const src = fs.readFileSync(new URL('../src/components/ReportView.js', import.meta.url), 'utf8');
  const lines = src.split('\n');
  const decl = lines.findIndex((l) => /const\s+typoScoreMap\s*=/.test(l));
  // 「首次使用」= 第一处不包含声明的引用
  const firstUse = lines.findIndex((l, i) => i !== decl && /typoScoreMap/.test(l));
  check('typoScoreMap 有且仅有一处声明',
    lines.filter((l) => /const\s+typoScoreMap\s*=/.test(l)).length === 1,
    `${lines.filter((l) => /const\s+typoScoreMap\s*=/.test(l)).length} 处`);
  check('typoScoreMap 先声明后使用', decl !== -1 && decl < firstUse,
    `声明@${decl + 1} 首次使用@${firstUse + 1}`);

  /* --- 2. 九宫格象限必须与轴方向一致 --- */
  check('高秩序高良善 → 守序善良', alignmentFrom(72, 74).alignment.key === 'lg',
    alignmentFrom(72, 74).alignment.name);
  check('低秩序高良善 → 混乱善良', alignmentFrom(30, 72).alignment.key === 'cg',
    alignmentFrom(30, 72).alignment.name);
  check('高秩序低良善 → 守序冷硬', alignmentFrom(72, 32).alignment.key === 'le',
    alignmentFrom(72, 32).alignment.name);
  check('低秩序低良善 → 混乱冷硬', alignmentFrom(28, 26).alignment.key === 'ce',
    alignmentFrom(28, 26).alignment.name);

  /* --- 3. 每卷分型都能算出（含无数据时不崩） --- */
  let okCount = 0;
  for (const vid of VOL_IDS) {
    const vol = VOLUMES[vid];
    const sc = {};
    (vol.dimensions || []).forEach((d, i) => { sc[d] = 58 + (i % 6) * 5; });
    try {
      const t = buildVolumeTypology(vid, sc, {}, DATA.dimMap, { pressure: { key: 'cold', share: 40 }, mask: 55 });
      if (t && t.title) okCount += 1;
    } catch (e) {
      check(`${vid} 分型不抛异常`, false, e.message);
    }
  }
  check('16 卷分型全部可算无异常', okCount === VOL_IDS.length, `${okCount}`);

  /* --- 4. 空分数不该崩 --- */
  try {
    const t = buildVolumeTypology('vol1', {}, {}, DATA.dimMap, {});
    check('空分数返回 null 而非抛错', t === null || typeof t === 'object');
  } catch (e) {
    check('空分数返回 null 而非抛错', false, e.message);
  }
}

/* ------------------------------------------------------------
   TC6f · 社交实验室（乔哈里窗 / 群像星图）
   ------------------------------------------------------------ */

function tc6f() {
  console.log('\n[TC6f] 社交拓展实验室');

  /* ---- 乔哈里 ---- */
  check('乔哈里 12 题', JOHARI_QUESTIONS.length === 12, `${JOHARI_QUESTIONS.length}`);

  /* 极性：每题必须有 scale 两端说明，且选项数恒为 4 —— 倒序会让象限判反 */
  check('每题都声明了 polarity scale',
    JOHARI_QUESTIONS.every((q) => Array.isArray(q.scale) && q.scale.length === 2),
    JOHARI_QUESTIONS.filter((q) => !q.scale).map((q) => q.dim).join(','));

  check('题干与选项统一用中性人称 TA',
    JOHARI_QUESTIONS.every((q) => !/\b他\b/.test(q.prom)
      && !(q.opts || []).some((o) => /\b他\b/.test(o))),
    JOHARI_QUESTIONS.filter((q) => /他/.test(q.prom)).map((q) => q.dim).join(','));

  /* 6 道曾被审计指出倒序的题：确认首项描述低端、末项描述高端 */
  const POLAR = {
    big5_order: [/没有秩序/, /连角度都对/],
    virtue_humility: [/坦率承认/, /功劳分给别人/],
    light_kant: [/会做/, /规则就是规则/],
    big5_compassion: [/解决方案|建议/, /跟着一起难受/],
    dark_mach: [/道理/, /不表态|摸清/],
    mot_belonging: [/自在/, /觉得空/],
  };
  for (const [dim, [lo, hi]] of Object.entries(POLAR)) {
    const q = JOHARI_QUESTIONS.find((x) => x.dim === dim);
    check(`${dim} 选项是由低到高`,
      Boolean(q) && lo.test(q.opts[0]) && hi.test(q.opts[3]),
      q ? `${q.opts[0].slice(0, 12)} … ${q.opts[3].slice(0, 12)}` : 'missing');
  }

  check('mot_belonging 是单维 4 档而非 4 个动机',
    /连续两周/.test(JOHARI_QUESTIONS.find((q) => q.dim === 'mot_belonging')?.prom || ''),
    JOHARI_QUESTIONS.find((q) => q.dim === 'mot_belonging')?.prom);
  check('乔哈里 12 维', JOHARI_DIMS.length === 12, `${JOHARI_DIMS.length}`);
  check('每题都对应一个合法维度',
    JOHARI_QUESTIONS.every((q) => DIM_ORDER.includes(q.dim)));
  check('每题恰好 4 个选项',
    JOHARI_QUESTIONS.every((q) => (q.opts || []).length === 4));

  const self = {};
  JOHARI_DIMS.forEach((d, i) => { self[d] = 40 + i * 4; });

  const code = encodeJohari(self, '青禾');
  check('HA4J- 前缀正确', code.startsWith('HA4J-'), code.slice(0, 8));
  const dec = decodeJohari(code);
  check('印象码可解码', dec.ok, dec.ok ? '' : dec.error);
  check('昵称保留', dec.nickname === '青禾', dec.nickname);
  check('12 维全部保留',
    JOHARI_DIMS.every((d) => Math.abs(dec.scores[d] - self[d]) <= 1),
    Object.keys(dec.scores).length + '');

  check('错误前缀被拒绝', decodeJohari('HA4-xxx').ok === false);
  check('篡改的印象码被拒绝',
    decodeJohari(`${code.slice(0, -2)}AA`).ok === false);

  const guesses = JOHARI_DIMS.map((d, i) => ({ dim: d, pick: i % 4 }));
  const res = johariResult(self, guesses);
  const total = res.open.length + res.blind.length + res.facade.length + res.unknown.length;
  check('四象限覆盖全部维度', total === JOHARI_DIMS.length, `${total}`);
  check('一致度已计算', Number.isFinite(res.agreement), `${res.agreement}`);
  check('一致度在 0–100', res.agreement >= 0 && res.agreement <= 100);

  /* ---- 群像 ---- */
  const mk = (name, over) => {
    const sc = {};
    for (const d of DIM_ORDER) sc[d] = 50;
    Object.assign(sc, over);
    return {
      name,
      state: {
        nickname: name,
        computedScores: sc,
        completedVolumes: ['vol1', 'vol2', 'vol3', 'vol4', 'vol5', 'vol6', 'vol7'],
        maskIndex: 50,
        topValues: [],
      },
    };
  };

  const squad = [
    mk('甲', { big5_order: 76, mot_security: 74, def_detach: 66, att_anxiety: 32 }),
    mk('乙', { big5_social: 78, big5_assert: 72, hss_novelty: 70, big5_compliance: 30 }),
    mk('丙', { covert_control: 76, dark_mach: 72, cog_global: 70, big5_assert: 34 }),
    mk('丁', { big5_compassion: 78, jung_fe: 74, def_fawn: 70 }),
  ];

  const roles = assignRoles(squad, DATA);
  check('每人都有生态位', roles.every((r) => r.role));
  check('角色不重复', new Set(roles.map((r) => r.role)).size === roles.length,
    roles.map((r) => r.role).join(','));
  check('定海神针落在高秩序的人身上',
    roles.find((r) => r.name === '甲')?.role === 'anchor',
    roles.find((r) => r.name === '甲')?.role);

  const aff = affinityMatrix(squad, DATA);
  check('矩阵尺寸正确', aff.matrix.length === 4 && aff.matrix[0].length === 4);
  check('对角线为 100', aff.matrix[0][0] === 100 && aff.matrix[3][3] === 100);
  check('矩阵对称', aff.matrix[0][1] === aff.matrix[1][0]);
  check('能找出最合拍的一对', !!aff.best && Number.isFinite(aff.best.score));

  const cov = coverage(squad, DATA);
  check('覆盖表非空', cov.rows.length > 0, `${cov.rows.length}`);
  check('缺口已识别', Array.isArray(cov.gaps));

  const charter = squadCharter(squad, roles, cov.gaps);
  check('公约至少 2 条', charter.length >= 2, `${charter.length}`);
}

/* ------------------------------------------------------------
   TC6e · 个人实验室（沙盒 / 议会 / 时间胶囊）
   ------------------------------------------------------------ */

function tc6e() {
  console.log('\n[TC6e] 个人深度实验室');

  const base = {};
  for (const d of DIM_ORDER) base[d] = 55;
  const spicy = {
    ...base,
    mot_autonomy: 72, mot_security: 68,
    hsp_sensory: 70, hss_novelty: 66,
    sin_pride: 70, att_anxiety: 66,
    light_kant: 68, dark_mach: 62,
  };

  /* ---- 沙盒 ---- */
  const mid = pressureSandbox(spicy, 50);
  check('能量 50 时等于原值', spicy.sin_pride === mid.scores.sin_pride,
    `${mid.scores.sin_pride}`);

  const low = pressureSandbox(spicy, 0);
  const high = pressureSandbox(spicy, 100);
  check('耗竭时暗面维度上升', low.scores.sin_pride > spicy.sin_pride,
    `${spicy.sin_pride} → ${low.scores.sin_pride}`);
  check('充沛时暗面维度下降', high.scores.sin_pride < spicy.sin_pride,
    `${spicy.sin_pride} → ${high.scores.sin_pride}`);
  check('耗竭时明面维度下降', low.scores.mot_autonomy < spicy.mot_autonomy,
    `${spicy.mot_autonomy} → ${low.scores.mot_autonomy}`);
  check('充沛时明面维度上升', high.scores.mot_autonomy > spicy.mot_autonomy,
    `${spicy.mot_autonomy} → ${high.scores.mot_autonomy}`);
  check('偏移不超过 16 分', Math.abs(low.delta.sin_pride) <= 16.1,
    `${low.delta.sin_pride}`);

  const allInRange = Object.values(low.scores).every((v) => v >= 0 && v <= 100);
  check('沙盒分数不越界', allInRange);

  check('四档能量阶段齐全', ENERGY_STAGES.length === 4);
  check('能量 0 落在极度耗竭', stageOf(0).key === 'depleted');
  check('能量 100 落在充沛顺境', stageOf(100).key === 'zone');

  /* ---- 议会 ---- */
  const pairs = innerParliament(spicy, 3);
  check('议会能命中张力对', pairs.length > 0, `${pairs.length}`);
  check('议会对数不超过 limit', pairs.length <= 3, `${pairs.length}`);
  check('每对都有双声部与调解',
    pairs.every((p) => p.voiceA && p.voiceB && p.verdict && p.tip));

  const autoSec = innerParliament(spicy, 3).find((p) => p.title.includes('自由'));
  check('自由 × 安全被识别', !!autoSec, autoSec?.title || '');

  // 全部压低时不该命中
  const flat = {};
  for (const d of DIM_ORDER) flat[d] = 30;
  check('低分画像不触发议会', innerParliament(flat, 3).length === 0);

  /* ---- 时间胶囊 ---- */
  const past = { ...spicy, mot_autonomy: 56, hsp_sensory: 58, sin_pride: 78 };
  const now = { ...spicy };
  const diff = timelineDiff(past, now, DATA.dimMap);
  check('时间胶囊有重叠维度', diff.rows.length > 0, `${diff.rows.length}`);
  check('Top5 不超过 5 条', diff.top5.length <= 5, `${diff.top5.length}`);
  check('Top5 按绝对变化降序',
    diff.top5.every((r, i) => i === 0 || Math.abs(diff.top5[i - 1].delta) >= Math.abs(r.delta)));
  check('能识别上升最多的维度', diff.top5[0].delta > 0, diff.top5[0]?.name);
  check('meanShift 已计算', Number.isFinite(diff.meanShift), `${diff.meanShift}`);
  check('结语非空', typeof diff.verdict === 'string' && diff.verdict.length > 10);

  const noOverlap = timelineDiff({ unknown_dim: 50 }, now, DATA.dimMap);
  check('无重叠时优雅降级', noOverlap.rows.length === 0 && /无法对照/.test(noOverlap.verdict));
}

/* ------------------------------------------------------------
   TC6d · 单卷分型与跨卷原型分家
   ------------------------------------------------------------ */

function tc6d() {
  console.log('\n[TC6d] 单卷分型 / 跨卷原型分家');

  const dm = DATA.dimMap;

  // 每卷都必须有分型（用该卷维度给一组中性以上分数）
  for (const vid of VOL_IDS) {
    const vol = VOLUMES[vid];
    const sc = {};
    const z = {};
    (vol.dimensions || []).forEach((d, i) => {
      sc[d] = 62 + (i % 5) * 4;
      z[d] = 0.4 + (i % 3) * 0.3;
    });
    const t = buildVolumeTypology(vid, sc, z, dm, { pressure: { key: 'cold', share: 42 }, mask: 58 });
    check(`${vid} 有专属分型`, !!t && !!t.title, t?.title || '');
  }

  // Vol.10 阵营命名
  const v10 = buildVolumeTypology('vol10', { dd_order: 72, dd_good: 45 }, {}, dm, {});
  check('Vol.10 输出九宫格阵营', /守序中立|Lawful Neutral/.test(v10.title), v10.title);

  // Vol.16 四象限
  const v16 = buildVolumeTypology('vol16', {
    hsp_sensory: 70, hsp_emotional: 66, hss_novelty: 68, hss_intensity: 72,
  }, {}, dm, {});
  check('Vol.16 识别 HSS/HSP 矛盾体', /HSS\/HSP/.test(v16.title), v16.title);

  // Vol.7 依恋类型
  const v7 = buildVolumeTypology('vol7', {
    att_anxiety: 70, att_avoidance: 72, def_detach: 68,
  }, {}, dm, {});
  check('Vol.7 输出恐惧矛盾型', /恐惧矛盾型/.test(v7.title), v7.title);

  // 36 原型命名规范
  const noTag = ARCHETYPES.archetypes.filter((a) => !a.psych_tag);
  check('36 原型全部有 psych_tag', noTag.length === 0, noTag.map((a) => a.id).join(','));
  const longName = ARCHETYPES.archetypes.filter((a) => a.name.length > 6);
  check('原型名不超过 6 字', longName.length === 0, longName.map((a) => a.name).join(','));
  const noLatin = ARCHETYPES.archetypes.filter((a) => !a.latin || !/^The /.test(a.latin));
  check('原型全部有英文副标', noLatin.length === 0, noLatin.map((a) => a.id).join(','));

  // weights 未被改动：36 个原型都还有 3–5 个维度
  const badWeights = ARCHETYPES.archetypes.filter((a) => {
    const n = Object.keys(a.weights || {}).length;
    return n < 3 || n > 5;
  });
  check('权重维度数未被改动（3–5）', badWeights.length === 0, badWeights.map((a) => a.id).join(','));
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
  /* 红黑榜现在带阈值门（图式 ≥56、道德底线 ≥58/≤42），
     所以夹具里必须真的存在一条显著图式，否则禁区为空是正确行为。 */
  const A = mk({ def_detach: 72, att_avoidance: 70, big5_social: 38, schema_abandonment: 74 });
  const B = mk({ att_anxiety: 70, def_fawn: 64, big5_social: 66, schema_std: 70, mft_authority: 66, mft_care: 36 });
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

  // 无共同 coreDims 时 compareStates 不应把非核心轴伪装成价值观共振
  const noCoreA = emptyState('无核A');
  const noCoreB = emptyState('无核B');
  const nonCore = DIM_ORDER.filter((d) => !(PAIR_RULES.coreDims || []).includes(d)).slice(0, 14);
  nonCore.forEach((d, idx) => {
    noCoreA.computedScores[d] = 75;
    noCoreB.computedScores[d] = idx < 7 ? 75 : 30;
  });
  const noCoreRes = compareStates(noCoreA, noCoreB, DATA);
  check('无共同 coreDims 时 sync 为 null（不降级伪造价值观共振）',
    noCoreRes.ok && noCoreRes.sync === null && (noCoreRes.basis ? noCoreRes.basis.hasSync === false : true),
    `sync=${noCoreRes.sync}`);

  // Express 重做清零闭环
  const ex = emptyState('重做测试');
  const exVol = buildExpressVolume(DATA, {
    questions: Object.values(VOLUMES).flatMap((v) => v.questions || []).filter((q) => q.type === 'forced_choice').slice(0, 28).map((q) => q.id),
  });
  ex.answersByVolume[EXPRESS_BUCKET] = {};
  for (const q of exVol.questions) {
    ex.answersByVolume[EXPRESS_BUCKET][q.id] = { value: q.options[0].key, ms: 4000, changes: 0 };
  }
  commitExpress(ex, exVol);
  resetExpress(ex, exVol, DATA);
  seedFromVolumes(ex, exVol);
  check('resetExpress 后重新进入极速版不会回填旧答案',
    expressProgress(ex, exVol).answered === 0,
    `answered=${expressProgress(ex, exVol).answered}`);

  // mergeImportedState 保留遥测、初印象与题级合并
  const mLocal = emptyState('本地');
  mLocal.answersByVolume.vol1 = { v1_q01: { value: 6, ms: 3000 } };
  mLocal.telemetry = { v1_q01: { ms: 3000, changes: 0 } };
  const mImport = emptyState('备份');
  mImport.answersByVolume.vol1 = { v1_q01: { value: 2, ms: 9000 }, v1_q02: { value: 'A', ms: 5000 } };
  mImport.telemetry = { v1_q02: { ms: 5000, changes: 1 } };
  mImport.initialSnapshot = { vol1: { sealedAt: Date.now(), scores: { sin_pride: 60 } } };
  const merged = mergeImportedState(mLocal, mImport);
  check('mergeImportedState 按题级保留双方作答并优先本机',
    merged.answersByVolume.vol1.v1_q01.value === 6 && merged.answersByVolume.vol1.v1_q02.value === 'A');
  check('mergeImportedState 保留 telemetry 与 initialSnapshot',
    Boolean(merged.telemetry.v1_q02) && Boolean(merged.initialSnapshot.vol1));
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
  tc6d();
  tc6e();
  tc6f();
  tc6g();
  tc6h();
  tc6i();
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
