#!/usr/bin/env node
/* ============================================================
   audit-v52.mjs — v5.2.1 报告页空态门禁与 SVG 排版热修验收

   六项硬指标：
     1  空态门禁：0 维度时绝不渲染报告主体
     2  图表按需渲染：缺维度时不出假点，改解锁占位条
     3  跨卷规则文案：0/65 不得宣称「组合很罕见」
     4  分卷档案：不得输出只有表头的空表格
     5  SVG 排版：蝶形图无中心圆点、pill 覆盖整行、依恋安全区内切
     6  吸顶导航与 scroll-margin-top 用同一组变量

   用法：node tests/audit-v52.mjs
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DIMENSIONS, VOLUMES, MIRRORS, ARCHETYPES, CROSS_RULES, PAIR_RULES,
  DIM_ORDER, EXPRESS,
} from '../src/data/bundle.js';
import { computeAll } from '../src/core/scoring.js';
import { encodeSoulCode, decodeSoulCode } from '../src/core/storage.js';
import {
  resolveEffectiveComputed, buildVolumeReport, matchArchetype,
} from '../src/core/synthesizer.js';
import { compareStates } from '../src/core/comparator.js';
import { ECOLOGIES, scoreAllEcologies } from '../src/core/ecology.js';
import { buildExpressVolume, commitExpress, EXPRESS_BUCKET } from '../src/core/express.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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

let pass = 0;
let fail = 0;
const failures = [];
const line = (c = '─') => c.repeat(70);
const hr = (t) => { console.log(`\n${line()}`); console.log(`  ${t}`); console.log(line()); };
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${detail ? ` · ${detail}` : ''}`); }
  else { fail += 1; failures.push(`${name}${detail ? ` · ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` · ${detail}` : ''}`); }
}

const report = read('src/components/ReportView.js');
const butterfly = read('src/viz/butterflySvg.js');
const quadrant = read('src/viz/quadrantSvg.js');
const css = read('styles/main.css');

/* ============================================================
   1 · 空态门禁
   ============================================================ */
hr('1 · 空态门禁（消灭全 50 假图与空壳表格）');

check('存在 renderEmptyDossier', /function renderEmptyDossier\s*\(/.test(report));
check('门禁依据是已测维度数（双源融合后），而非 completedVolumes.length',
  /const measuredDims = Object\.keys\(effectiveScores\)/.test(report)
  && /if \(!measuredDims\.length\)/.test(report)
  && /resolveEffectiveComputed\(state, DATA\)/.test(report));
check('空态卡在 buildHolographicReport 之前 return',
  report.indexOf('renderEmptyDossier(root, ctx)') < report.indexOf('const report = buildHolographicReport'));

/* 三个出口 */
check('出口① 极速版', /href: '#\/express'/.test(report));
check('出口② 大厅', /href: '#\/'/.test(report) && /前往十六卷宗大厅/.test(report));
check('出口③ 导入存档码', /openImportDialog\(/.test(report) && /导入已有存档码/.test(report));

/* 空态卡样式齐全 */
['.empty-dossier', '.empty-dossier__seal', '.empty-dossier__title',
  '.empty-dossier__paths', '.empty-path', '.empty-dossier__foot'].forEach((sel) => {
  check(`样式 ${sel} 存在`, css.includes(sel));
});

check('空态卡居中且宽度受限', /\.empty-dossier\s*\{[^}]*max-width:\s*620px/.test(css));
check('空态卡有移动端断点', /@media \(max-width: 640px\)[\s\S]{0,200}\.empty-dossier\s*\{[^}]*padding:\s*40px 22px/.test(css));

/* ============================================================
   2 · 图表按需渲染
   ============================================================ */
hr('2 · 图表按需渲染（禁止 ?? 50 伪造假点）');

check('存在 chartLockCard 占位组件', /function chartLockCard\s*\(\{/.test(report));
check('占位条样式存在', css.includes('.chart-lock'));
check('占位条写明缺口数量', /\$\{missing\} \/ \$\{total\} 个维度/.test(report));

/* 蝶形图门禁：14 维必须齐全 */
check('蝶形图先算缺失维度', /const missingButterfly = butterflyDims\.filter/.test(report));
check('蝶形图缺失时走占位条', /if \(missingButterfly\.length\)[\s\S]{0,220}chartLockCard/.test(report));
check('蝶形图不再用 completed.includes 当唯一门禁',
  !/if \(vol1 && completed\.includes\('vol1'\)\)/.test(report));

/* 依恋图门禁 */
check('依恋图按维度存在性判定', /const ok = Number\.isFinite\(an\) && Number\.isFinite\(av\)/.test(report));
check('依恋图缺失时走占位条',
  /chartLockCard\(\{\s*title: '依恋坐标 · 四象限'/.test(report));

/* 面具叠层门禁 */
check('面具叠层按 layers.keys 判定', /const hasLayer = layers\.keys\.length >= 4/.test(report));
check('面具叠层缺失时走占位条',
  /chartLockCard\(\{\s*title: '面具虚实叠层'/.test(report));

/* 蝶形图内部仍有 ?? 50 —— 但被外层门禁保证不会触发 */
check('蝶形图内部不再静默补点（改为显式默认仅作兜底）',
  /Number\.isFinite\(dims\[p\.virtue\]\) \? dims\[p\.virtue\] : 50/.test(butterfly),
  '外层门禁保证 14 维齐全，兜底不会触发');

/* ============================================================
   3 · 跨卷规则文案
   ============================================================ */
hr('3 · 跨卷规则文案（0/65 不能说「组合很罕见」）');

check('完成 <3 卷时提示「完成至少 3 卷后解锁跨卷化学反应」',
  /完成至少 3 卷后解锁跨卷化学反应/.test(report));
check('完成 <3 卷时不再输出「这一组组合很罕见」',
  !/h3', \{ text: '这一组组合很罕见' \}/.test(report));
check('真正 0 命中时的文案写明「完整跑过」',
  /跨卷引擎完整跑过 \$\{DATA\.crossRules\.length\} 条规则/.test(report));
check('不再硬编码规则条数', !/61 条规则/.test(report));

/* ============================================================
   4 · 分卷档案过滤
   ============================================================ */
hr('4 · 分卷深度档案（过滤未测卷，不输出空表）');

check('先过滤出真有维度的卷', /const archivable = completed\.filter/.test(report));
check('渲染循环改用 archivable', /archivable\.forEach\(\(vid\)/.test(report));
check('全空时给明确空态', /还没有可归档的卷宗/.test(report));
check('不再直接遍历 completed', !/completed\.forEach\(\(vid\) => \{\n\s+const vol = DATA\.volumes\[vid\];/.test(report));

/* ============================================================
   5 · SVG 排版
   ============================================================ */
hr('5 · SVG 排版（尺寸、遮挡、越界）');

/* 5.1 尺寸收敛 */
check('SVG 有 max-width 560', /max-width:\s*560px/.test(css));
check('SVG 有 max-height 460', /max-height:\s*460px/.test(css));
check('SVG 居中 display block margin auto',
  /max-width:\s*560px[\s\S]{0,200}margin:\s*0 auto/.test(css));
check('蝶形图允许更宽一档', /aria-label\*="蝶形"[\s\S]{0,120}max-width:\s*680px/.test(css));
check('移动端取消限高', /@media \(max-width: 760px\)[\s\S]{0,400}max-height:\s*none/.test(css));

/* 5.2 蝶形图中心遮挡 */
check('蝶形图中心徽记已移除',
  !/center 徽记/.test(butterfly) && !/cx, cy, r: 15/.test(butterfly),
  '原先 r=15 的圆压住第 4 行中轴文字');
check('蝶形图 pill 宽度按字数估算', /const emUnits = \[\.\.\.midText\]\.reduce/.test(butterfly));
check('pill 高度随字号', /height:\s*midSize \* 1\.44/.test(butterfly));
check('pill 透明度提高避免虚线透字', /opacity:\s*0\.94/.test(butterfly));

/* 5.3 依恋图安全区 */
check('安全区改用 rect 而非 circle', /safeCx[\s\S]{0,600}svg\('rect'/.test(quadrant));
check('安全区不碰中轴（左右各留 12px）', /safeW = iw \/ 2 - 12/.test(quadrant));
check('安全区不碰上下边框', /safeH = ih \/ 2 - 12/.test(quadrant));
check('安全区圆角内切', /rx: Math\.min\(safeW, safeH\) \* 0\.34/.test(quadrant));
check('不再用会越界的 r = min(iw,ih) * 0.24',
  !/r: Math\.min\(iw, ih\) \* 0\.24/.test(quadrant));

/* ============================================================
   6 · 吸顶导航对齐
   ============================================================ */
hr('6 · 吸顶二级导航与章节跳转偏移');

check('顶栏高度抽成变量', /--masthead-h:\s*56px/.test(css));
check('二级导航高度抽成变量', /--report-nav-h:\s*47px/.test(css));
check('report-nav 的 top 用变量', /\.report-nav\s*\{[^}]*top:\s*var\(--masthead-h\)/.test(css));
check('rsec 的 scroll-margin-top 用同一组变量',
  /\.rsec\s*\{[^}]*scroll-margin-top:\s*calc\(var\(--masthead-h\) \+ var\(--report-nav-h\)/.test(css));
check('不再写死 142px', !/scroll-margin-top:\s*142px/.test(css));
check('不再写死 top: 62px', !/\.report-nav\s*\{[^}]*top:\s*62px/.test(css));
check('移动端两档都用变量',
  /@media \(max-width: 760px\)[\s\S]{0,3000}--masthead-h:\s*49px/.test(css));

/* ============================================================
   7 · 防导入无报告回归（A0）
   ============================================================ */
hr('7 · 导入 HA4- 后报告可用（双源无损融合）');

/** 造一份真作答的状态：每卷逐题填合法值（与 verify-engine 的策略一致） */
function fillVolume(state, volId) {
  const vol = VOLUMES[volId];
  const bucket = (state.answersByVolume[volId] ||= {});
  for (const q of vol.questions || []) {
    let value;
    if (q.type === 'budget_100') {
      const items = q.items || [];
      const base = Math.floor(100 / Math.max(1, items.length));
      const map = {};
      let rest = 100 - base * items.length;
      items.forEach((it, i) => { map[it.key] = base + (i < rest ? 1 : 0); });
      value = map;
    } else if (q.type === 'pyramid_top3') {
      value = (q.values || []).slice(0, 3).map((v) => v.key);
    } else if (q.type === 'stealth_scale') {
      value = 1 + Math.floor(Math.random() * 7);
    } else {
      value = (q.options || [])[0]?.key;
    }
    bucket[q.id] = { value, ms: 5200, changes: 0 };
    state.telemetry[q.id] = { ms: 5200, readMs: 0, changes: 0 };
  }
  state.completedVolumes.push(volId);
}

function emptyState(nickname = '') {
  return {
    version: '4.0',
    nickname,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedVolumes: [],
    inProgress: {},
    answersByVolume: {},
    computedScores: {},
    maskIndex: null,
    topValues: [],
    initialSnapshot: {},
    flags: {},
    telemetry: {},
  };
}

{
  /* ---- 1. 8 卷完整态（真实 computeAll） ---- */
  const eight = VOL_IDS.slice(0, 8);
  const real = emptyState('八卷典藏');
  eight.forEach((v) => fillVolume(real, v));
  const live = computeAll(real, DATA);
  real.computedScores = {};
  for (const d of DIM_ORDER) if (Number.isFinite(live.scores[d])) real.computedScores[d] = live.scores[d];
  real.maskIndex = live.mask.value;
  real.topValues = live.topValues || [];

  const code = encodeSoulCode(real, DIM_ORDER);
  check('8 卷完整态出码成功', code.startsWith('HA4-'), `${code.length} 字符`);

  /* ---- 2. 模拟导入：答案被清空、只剩分数 ---- */
  const dec = decodeSoulCode(code, DIM_ORDER);
  check('解码 ok', dec.ok === true, dec.error || '');
  const imported = dec.state;
  check('导入后 answersByVolume 为空（根因复现）',
    Object.keys(imported.answersByVolume || {}).length === 0);
  check('导入后 completedVolumes 为 8', imported.completedVolumes.length === 8,
    imported.completedVolumes.join(','));

  /* ---- 3. 旧版清洗动作复现：computeAll 对空作答池全 null ---- */
  const naive = computeAll(imported, DATA);
  const naiveFinite = Object.values(naive.scores).filter(Number.isFinite).length;
  check('空作答池下 computeAll 确实返回 0 个有限维度（旧 bug 触发条件）',
    naiveFinite === 0, naiveFinite);

  /* ---- 4. 融合后必须保住导入分 ---- */
  const eff = resolveEffectiveComputed(imported, DATA);
  const effDims = Object.keys(eff.scores).filter((d) => Number.isFinite(eff.scores[d]));
  check('融合后有效维度 ≥ 60', effDims.length >= 60, `${effDims.length}/${DIM_ORDER.length}`);

  const zKeys = Object.keys(eff.zScores).filter((d) => Number.isFinite(eff.zScores[d]));
  check('zScores 非空', zKeys.length >= 60, zKeys.length);
  check('zScores 无 NaN', Object.values(eff.zScores).every(Number.isFinite));
  check('zScores 覆盖全部有效维度', zKeys.length === effDims.length, `${zKeys.length}/${effDims.length}`);
  check('面具从存档回落（非 null）', Number.isFinite(eff.mask?.value), eff.mask?.value);
  check('topValues 从存档回落', Array.isArray(eff.topValues) && eff.topValues.length > 0,
    (eff.topValues || []).join(','));

  const arch = matchArchetype(eff.scores, DATA.archetypes);
  check('matchArchetype 出原型', arch?.eligible === true && Boolean(arch.best?.name),
    arch?.best?.name || '（无）');

  const effState = {
    ...imported,
    computedScores: eff.scores,
    zScores: eff.zScores,
    maskIndex: eff.mask?.value ?? null,
    topValues: eff.topValues,
  };
  const r1 = buildVolumeReport(effState, DATA, 'vol1');
  const r2 = buildVolumeReport(effState, DATA, 'vol2');
  check('buildVolumeReport(vol1) 非空', Boolean(r1) && Object.keys(r1.dims).length >= 10,
    `${Object.keys(r1?.dims || {}).length} 维`);
  check('buildVolumeReport(vol2) 非空', Boolean(r2) && Object.keys(r2.dims).length >= 8,
    `${Object.keys(r2?.dims || {}).length} 维`);
  check('单卷报告有王牌天赋卡', (r1?.gifts?.length || 0) > 0, r1?.gifts?.length);

  /* 只给作答、没给 computedScores 的裸态（例如刚答完卷、还没跑 recompute）：
     buildVolumeReport 必须自己现场融合，不能返回一张空报告。 */
  const rawAns = emptyState('裸态');
  fillVolume(rawAns, 'vol1');
  delete rawAns.computedScores;
  const bare = buildVolumeReport(rawAns, DATA, 'vol1');
  check('buildVolumeReport 对只有作答的裸态能自愈', Boolean(bare) && Object.keys(bare.dims).length >= 10,
    `${Object.keys(bare?.dims || {}).length} 维`);

  /* ---- 5. 在导入态上再答完 vol9 后合并：前 8 卷分一个都不能丢 ---- */
  const next = {
    ...imported,
    answersByVolume: { ...(imported.answersByVolume || {}) },
    computedScores: { ...imported.computedScores },
    telemetry: { ...(imported.telemetry || {}) },
  };
  fillVolume(next, 'vol9');
  const mergedEff = resolveEffectiveComputed(next, DATA);
  const lost = eight
    .flatMap((v) => VOLUMES[v].dimensions || [])
    .filter((d) => Number.isFinite(imported.computedScores[d]))
    .filter((d) => !Number.isFinite(mergedEff.scores[d]));
  check('导入后答 vol9，vol1–vol8 分数一个都没丢', lost.length === 0,
    lost.length ? lost.slice(0, 5).join(',') : `前 8 卷 ${Object.keys(imported.computedScores).length} 维全保留`);

  /* 更强的断言：不只是「没丢」，而是「一个都没被改动」。
     反例曾真实发生过：只答 vol9 时，vol9 的选项会在 big5_open 之类维度上
     产生交叉载荷，live.big5_open 是个有限值（58.6），把导入的八卷聚合值覆盖掉。
     变成 null 是洗白，变成另一个数同样是洗白 —— 只是更难发现。 */
  const touched = eight
    .flatMap((v) => VOLUMES[v].dimensions || [])
    .filter((d) => Number.isFinite(imported.computedScores[d]))
    .filter((d) => Math.abs(mergedEff.scores[d] - imported.computedScores[d]) > 0.01);
  check('导入后答 vol9，vol1–vol8 的分一个都没被改写', touched.length === 0,
    touched.length ? touched.slice(0, 5).join(',') : '0 处改写');

  /* 纯导入态（本地零作答）更不该有任何漂移 */
  const pureEff = resolveEffectiveComputed(imported, DATA);
  const pureDrift = Object.keys(imported.computedScores)
    .filter((d) => Math.abs(pureEff.scores[d] - imported.computedScores[d]) > 0.01);
  check('纯导入态零作答时完全零漂移', pureDrift.length === 0,
    pureDrift.length ? pureDrift.slice(0, 5).join(',') : `${Object.keys(imported.computedScores).length} 维逐位相同`);
  check('vol9 新分被合进来', (VOLUMES.vol9.dimensions || [])
    .every((d) => Number.isFinite(mergedEff.scores[d])), VOLUMES.vol9.dimensions.join(','));
  check('总维度数 = 前 8 卷 ∪ vol9',
    Object.keys(mergedEff.scores).length >= Object.keys(imported.computedScores).length,
    `${Object.keys(mergedEff.scores).length} 维`);
}

/* ============================================================
   8 · 28 题极速态端到端（A1）
   ============================================================ */
hr('8 · 28 题极速态端到端（出码 → 解码 → 合盘）');

function makeExpressState(nickname = '极速') {
  const st = emptyState(nickname);
  const vol = buildExpressVolume(DATA, EXPRESS);
  st.answersByVolume[EXPRESS_BUCKET] = {};
  for (const q of vol.questions) {
    let value;
    if (q.type === 'budget_100') {
      const items = q.items || [];
      const map = {};
      items.forEach((it, i) => { map[it.key] = i === 0 ? 100 : 0; });
      value = map;
    } else if (q.type === 'pyramid_top3') {
      value = (q.values || []).slice(0, 3).map((v) => v.key);
    } else if (q.type === 'stealth_scale') {
      value = 1 + Math.floor(Math.random() * 7);
    } else {
      value = (q.options || [])[Math.floor(Math.random() * Math.max(1, (q.options || []).length))]?.key;
    }
    st.answersByVolume[EXPRESS_BUCKET][q.id] = { value, ms: 5000, changes: 0 };
    st.telemetry[q.id] = { ms: 5000, readMs: 0, changes: 0 };
  }
  const vol2 = buildExpressVolume(DATA, EXPRESS);
  commitExpress(st, vol2);
  return { st, vol };
}

function expressToCode(st) {
  const eff = resolveEffectiveComputed(st, DATA);
  const shaped = {
    ...st,
    computedScores: eff.scores,
    zScores: eff.zScores,
    maskIndex: eff.mask?.value ?? null,
    topValues: eff.topValues,
  };
  return encodeSoulCode(shaped, DIM_ORDER);
}

{
  const { st, vol } = makeExpressState('速写甲');
  check('极速卷含 28 道真题', vol.questions.length === 28, vol.questions.length);

  const live = computeAll(st, DATA);
  const liveDims = Object.values(live.scores).filter(Number.isFinite).length;
  check('28 题 + commitExpress + computeAll 能算出 85–110 个维度',
    liveDims >= 85 && liveDims <= 110, `${liveDims} 维`);

  st.computedScores = {};
  for (const d of DIM_ORDER) if (Number.isFinite(live.scores[d])) st.computedScores[d] = live.scores[d];
  st.maskIndex = live.mask.value;

  const code = expressToCode(st);
  const dec = decodeSoulCode(code, DIM_ORDER);
  check('极速存档码解码 ok', dec.ok === true, dec.error || '');
  check('极速码 completedVolumes 为空', dec.state.completedVolumes.length === 0,
    dec.state.completedVolumes.length);
  check('极速码 isExpressOnly 标记正确', dec.isExpressOnly === true, dec.isExpressOnly);

  const effA = resolveEffectiveComputed(dec.state, DATA);
  const effADims = Object.values(effA.scores).filter(Number.isFinite).length;
  check('极速个人报告可用（维度 ≥ 85）', effADims >= 85, `${effADims}/${DIM_ORDER.length}`);

  const rVol1 = buildVolumeReport({ ...dec.state, computedScores: effA.scores }, DATA, 'vol1');
  check('极速档的单卷报告也能渲染', Boolean(rVol1) && Object.keys(rVol1.dims).length > 0,
    `${Object.keys(rVol1?.dims || {}).length} 维`);

  /* ---- 与 16 卷完整态合盘 ---- */
  const full = emptyState('全十六卷');
  VOL_IDS.forEach((v) => fillVolume(full, v));
  const fullLive = computeAll(full, DATA);
  const fullCode = encodeSoulCode({
    ...full,
    computedScores: Object.fromEntries(DIM_ORDER
      .filter((d) => Number.isFinite(fullLive.scores[d]))
      .map((d) => [d, fullLive.scores[d]])),
    maskIndex: fullLive.mask.value,
    topValues: fullLive.topValues || [],
  }, DIM_ORDER);
  const fullDec = decodeSoulCode(fullCode, DIM_ORDER).state;

  const crossPair = compareStates(fullDec, dec.state, DATA);
  check('完整×极速：compareStates ok', crossPair.ok === true, crossPair.reason || '');
  check('完整×极速：isExpressPair 为 true', crossPair.isExpressPair === true,
    `common=${crossPair.common?.length} dims=${crossPair.dims?.length}`);

  const ecoCross = scoreAllEcologies(fullDec, dec.state, crossPair.dims, {
    a: fullDec.maskIndex, b: dec.state.maskIndex,
  });
  check('完整×极速：六大生态位全出分',
    ECOLOGIES.every((def) => {
      const row = ecoCross.list.find((x) => x.id === def.id);
      return Boolean(row) && Number.isFinite(row.value);
    }),
    ecoCross.list.map((x) => `${x.id}:${x.value}`).join(' '));
  check('完整×极速：生态位无 NaN',
    ecoCross.list.every((x) => Number.isFinite(x.value) && Number.isFinite(x.penalty)
      && x.parts.every((p) => Number.isFinite(p.score) && Number.isFinite(p.av) && Number.isFinite(p.bv))));

  /* ---- 与另一份极速态合盘 ---- */
  const other = makeExpressState('速写乙');
  const otherCode = expressToCode(other.st);
  const otherDec = decodeSoulCode(otherCode, DIM_ORDER).state;

  const exPair = compareStates(dec.state, otherDec, DATA);
  check('极速×极速：compareStates ok', exPair.ok === true, exPair.reason || '');
  check('极速×极速：isExpressPair 为 true', exPair.isExpressPair === true,
    `common=${exPair.common?.length} dims=${exPair.dims?.length}`);

  const ecoPair = scoreAllEcologies(dec.state, otherDec, exPair.dims, {
    a: dec.state.maskIndex, b: otherDec.maskIndex,
  });
  check('极速×极速：六大生态位全出分',
    ECOLOGIES.every((def) => {
      const row = ecoPair.list.find((x) => x.id === def.id);
      return Boolean(row) && Number.isFinite(row.value);
    }),
    ecoPair.list.map((x) => `${x.id}:${x.value}`).join(' '));
  check('极速×极速：生态位无 NaN',
    ecoPair.list.every((x) => Number.isFinite(x.value) && Number.isFinite(x.penalty)));
}

/* ============================================================
   9 · 双人对比页逐维拆解与显微镜（A2）
   ============================================================ */
hr('9 · 双人对比页 · 逐维拆解与全维度显微镜');

const cmp = read('src/components/CompareView.js');

/* 9.1 六大生态位逐维拆解 */
check('生态位卡片有拆解按钮', /eco-break__toggle/.test(cmp));
check('拆解按钮带 aria-expanded', /'aria-expanded':\s*'false'/.test(cmp));
check('拆解按钮文案含项数', /查看 \$\{r\.parts\.length\} 项拆解/.test(cmp));
check('遍历 parts 渲染全部小项', /r\.parts\.forEach/.test(cmp));
check('命中雷区有单独区块', /eco-break__hits/.test(cmp));
check('五种匹配法则都有中文徽章',
  ['syncHigh', 'tension', 'syncLow', 'sync', 'bothHigh'].every((k) => new RegExp(`${k}:\\s*'`).test(cmp)),
  Object.keys({ syncHigh: 1, tension: 1, syncLow: 1, sync: 1, bothHigh: 1 }).join(','));

/* 9.2 全维度显微镜 */
check('存在 #cmp-micro 锚点', /id:\s*'cmp-micro'/.test(cmp));
check('四种视图都在', ['按 16 卷分组', '高度同频', '最大反差', '黄金互补']
  .every((t) => cmp.includes(t)));
check('有卷宗筛选 select', /cmp-micro__select/.test(cmp));
check('有关键词搜索 input', /type:\s*'search'/.test(cmp));
check('有图例条', /cmp-micro__legend/.test(cmp));
check('图例标明中线 50', /中线 50 为人群中性/.test(cmp));

/* 差值分档四态 */
check('差值四档齐全', ['双高共振', '双低共鸣', '张力互补', '显著分叉', '温和差异']
  .every((t) => cmp.includes(t)));

/* 9.3 分组模式必须真的插组头 */
check('按卷分组模式有组头', /mode === 'group'/.test(cmp) && /cmp-mgroup/.test(cmp));
check('组头标出卷号与维度数',
  /cmp-mgroup__no/.test(cmp) && /cmp-mgroup__n/.test(cmp));

/* 9.4 单行可展开释义 */
check('行可点击 + 键盘可达',
  /role:\s*'button'/.test(cmp) && /tabindex:\s*'0'/.test(cmp));
check('Enter/Space 都能触发展开', /e\.key === 'Enter'/.test(cmp) && /e\.key === ' '/.test(cmp));
check('释义读 mirrors 明暗两面', /DATA\.mirrors\?\.\[dim\]/.test(cmp));
check('自动生成对比提示', /function contrastHint\(/.test(cmp));

/* 9.5 样式齐全 */
check('哑铃轨样式存在', css.includes('.dtrack__dot--a') && css.includes('.dtrack__dot--b'));
check('哑铃轨有 50 中位线', css.includes('.dtrack__mid'));
check('375px 下哑铃轨换行整行', /@media \(max-width: 760px\)[\s\S]{0,4000}\.cmp-mrow \.dtrack \{ grid-column: 1 \/ -1/.test(css));
check('组头样式存在', css.includes('.cmp-mgroup'));

/* ============================================================
   10 · 报告页必须一次性完整渲染（content-visibility 回归）
   ============================================================ */
hr('10 · 报告页完整渲染（禁止 content-visibility 掐死区块）');

/* 曾经在 .rsec 上写 content-visibility: auto，导致 9 个板块高度恒为 720px、
   innerText 只有 1153 字符，用户滚动也不触发 —— 表现为「报告页一片空白」。
   这条断言只检查声明块，不检查注释里提到的字样。 */
const rsecBlock = (() => {
  const i = css.indexOf('.rsec {');
  if (i < 0) return '';
  const j = css.indexOf('}', i);
  return css.slice(i, j + 1);
})();

check('.rsec 存在', rsecBlock.length > 0);
check('.rsec 不再声明 content-visibility',
  !/content-visibility\s*:/.test(rsecBlock),
  rsecBlock.replace(/\s+/g, ' ').slice(0, 80));
check('.rsec 不再声明 contain-intrinsic-size',
  !/contain-intrinsic-size\s*:/.test(rsecBlock));
check('仍保留 scroll-margin-top（吸顶偏移）',
  /scroll-margin-top\s*:/.test(rsecBlock));
check('注释里写明了为什么不能加回来',
  /已移除，不要再加回来/.test(css));

/* 报告页的 9 个板块 id 都要在 ReportView/LabView 里存在 */
const lab = read('src/components/LabView.js');
['r-dash', 'r-mirror', 'r-cross', 'r-dual', 'r-sandbox', 'r-parliament',
  'r-timeline', 'r-archives', 'r-manual', 'r-export'].forEach((id) => {
  const inReport = new RegExp(`id: '${id}'`).test(report);
  const inLab = new RegExp(`id: '${id}'`).test(lab);
  check(`板块 ${id} 有锚点`, inReport || inLab);
});

/* ============================================================
   汇总
   ============================================================ */
hr('汇总');
if (fail) {
  console.log(`  失败 ${fail} 项：`);
  failures.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
} else {
  console.log(`  全部 10 项检查通过 · ${pass} 条断言 · 0 失败`);
}
console.log(line());
process.exit(fail ? 1 : 0);
