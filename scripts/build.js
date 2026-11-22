#!/usr/bin/env node
/* ============================================================
   build.js — 生成可直接部署的静态产物（dist/）
   纯前端：无打包器、无依赖，仅复制 + 重写资源引用。
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rmrf(DIST);
fs.mkdirSync(DIST, { recursive: true });

// 1. 入口
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));

// 2. 样式
copyDir(path.join(ROOT, 'styles'), path.join(DIST, 'styles'));

// 3. 脚本与数据（bundle.js 已由 build-data 生成）
for (const dir of ['src']) {
  copyDir(path.join(ROOT, dir), path.join(DIST, dir));
}

// 4. 剔除源码级的可编辑 JSON，只保留编译后的 bundle（减小体积）
const dataDir = path.join(DIST, 'src', 'data');
for (const name of fs.readdirSync(dataDir)) {
  if (name.endsWith('.json') || name.endsWith('.md')) {
    fs.rmSync(path.join(dataDir, name), { recursive: true, force: true });
  }
}

// 5. 404 兜底（GitHub Pages / Vercel 静态托管均可用）
fs.copyFileSync(path.join(DIST, 'index.html'), path.join(DIST, '404.html'));

// 6. 单文件版（可直接双击，无需服务器）
const single = path.join(ROOT, 'human-atlas.html');
if (fs.existsSync(single)) {
  fs.copyFileSync(single, path.join(DIST, 'human-atlas.html'));
}

// 7. 体积统计
let bytes = 0;
let files = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else { bytes += fs.statSync(p).size; files += 1; }
  }
})(DIST);

console.log(`[build] dist/ → ${files} files, ${(bytes / 1024).toFixed(1)} KB`);
