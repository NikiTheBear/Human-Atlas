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

/* 7. 资源指纹（cache-busting）
   ------------------------------------------------------------
   GitHub Pages 给静态资源发的是 `cache-control: max-age=600`。
   这意味着每次部署后的 10 分钟内，老访客仍会命中旧 CSS/JS ——
   实测过一次：content-visibility 那个白屏 Bug 明明已修复并部署，
   用户刷新仍看到旧样式，于是以为「部署没同步」。

   这里给 index.html / 404.html 里引用的本地 css/js 追加内容指纹
   `?v=<8位hash>`：文件内容一变，URL 就变，浏览器必然重新拉。 */
{
  const cryptoMod = await import('node:crypto');
  const hash8 = (buf) => cryptoMod.createHash('sha256').update(buf).digest('hex').slice(0, 8);

  const stampHtml = (htmlPath) => {
    let html = fs.readFileSync(htmlPath, 'utf8');
    const re = /(?:href|src)="((?!https?:|data:|#)[^"?]+?\.(?:css|js|mjs))"/g;
    const seen = new Map();
    html = html.replace(re, (m, rel) => {
      if (seen.has(rel)) {
        return m.replace(`"${rel}"`, `"${rel}?v=${seen.get(rel)}"`);
      }
      const abs = path.join(DIST, rel);
      if (!fs.existsSync(abs)) return m;
      const v = hash8(fs.readFileSync(abs));
      seen.set(rel, v);
      return m.replace(`"${rel}"`, `"${rel}?v=${v}"`);
    });
    fs.writeFileSync(htmlPath, html);
    return seen.size;
  };

  const n1 = stampHtml(path.join(DIST, 'index.html'));
  fs.copyFileSync(path.join(DIST, 'index.html'), path.join(DIST, '404.html'));
  console.log(`[build] 资源指纹：${n1} 个 css/js 已加 ?v=`);
}

// 8. 体积统计
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
