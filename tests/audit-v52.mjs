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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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
check('门禁依据是已测维度数，而非 completedVolumes.length',
  /const measuredDims = Object\.keys\(state\.computedScores \|\| \{\}\)/.test(report)
  && /if \(!measuredDims\.length\)/.test(report));
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
   汇总
   ============================================================ */
hr('汇总');
if (fail) {
  console.log(`  失败 ${fail} 项：`);
  failures.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
} else {
  console.log(`  全部 6 项检查通过 · ${pass} 条断言 · 0 失败`);
}
console.log(line());
process.exit(fail ? 1 : 0);
