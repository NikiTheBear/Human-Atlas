#!/usr/bin/env node
/* ============================================================
   merge-volume-fragments.js — 把分片题库合并进主卷
   用途：并行写题时，子任务只输出 `_volNNa.json` 这类碎片，
        由本脚本按 id 去重后并入 `volNN.json`。
   幂等：重复运行不会产生重复题；合并后会删掉碎片文件。
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOL_DIR = path.join(ROOT, 'src', 'data', 'volumes');

const FRAG_RE = /^_(vol\d+)([a-z])\.json$/;

const frags = fs.readdirSync(VOL_DIR).filter((f) => FRAG_RE.test(f)).sort();
if (!frags.length) {
  console.log('[merge] 没有待合并的碎片');
  process.exit(0);
}

for (const frag of frags) {
  const [, volId] = frag.match(FRAG_RE);
  const target = path.join(VOL_DIR, `${volId}.json`);
  if (!fs.existsSync(target)) {
    console.warn(`[merge] ✗ ${frag} 找不到主卷 ${volId}.json，跳过`);
    continue;
  }

  const base = JSON.parse(fs.readFileSync(target, 'utf8'));
  let extra;
  try {
    extra = JSON.parse(fs.readFileSync(path.join(VOL_DIR, frag), 'utf8'));
  } catch (err) {
    console.error(`[merge] ✗ ${frag} JSON 解析失败：${err.message}`);
    process.exitCode = 1;
    continue;
  }

  const incoming = Array.isArray(extra) ? extra : (extra.questions || []);
  if (!incoming.length) {
    console.warn(`[merge] ⚠ ${frag} 没有题目，跳过`);
    continue;
  }

  const seen = new Set(base.questions.map((q) => q.id));
  let added = 0;
  for (const q of incoming) {
    if (!q || !q.id) continue;
    if (seen.has(q.id)) continue;
    base.questions.push(q);
    seen.add(q.id);
    added += 1;
  }

  // 按题目序号重新排序，保证 q01…qNN 连续
  const numOf = (id) => {
    const m = /q(\d+)$/.exec(id);
    return m ? Number(m[1]) : 9999;
  };
  base.questions.sort((a, b) => numOf(a.id) - numOf(b.id));

  fs.writeFileSync(target, `${JSON.stringify(base, null, 2)}\n`, 'utf8');
  fs.rmSync(path.join(VOL_DIR, frag));
  console.log(`[merge] ✓ ${frag} → ${volId}.json 新增 ${added} 题，现共 ${base.questions.length} 题`);
}

/* ---------- 合并后体检：题量 / id 连续性 / 维度覆盖 ---------- */
console.log('\n[merge] 卷宗体检');
for (const f of fs.readdirSync(VOL_DIR).filter((x) => /^vol\d+\.json$/.test(x)).sort()) {
  const v = JSON.parse(fs.readFileSync(path.join(VOL_DIR, f), 'utf8'));
  const ids = v.questions.map((q) => q.id);
  const nums = ids.map((id) => Number(/q(\d+)$/.exec(id)?.[1] || 0)).sort((a, b) => a - b);
  const contiguous = nums.every((n, i) => n === i + 1);
  console.log(
    `  ${v.volume_id.padEnd(6)} ${String(v.questions.length).padStart(3)} 题 · `
    + `${String(v.dimensions.length).padStart(2)} 维 · id ${contiguous ? '连续' : '✗ 不连续'}`,
  );
  if (!contiguous) process.exitCode = 1;
}
