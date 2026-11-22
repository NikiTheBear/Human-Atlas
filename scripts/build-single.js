#!/usr/bin/env node
/* ============================================================
   build-single.js — 把整个应用内联成一个自包含 HTML

   为什么需要它：
   Chrome / Safari 在 file:// 协议下会拦截 <script type="module">，
   页面会静默卡在加载态。把模块全部内联成普通脚本后，
   双击 HTML 即可运行，不再经过模块加载器。

   产物：
     human-atlas.html      （项目根，双击即用）
     dist/index.html       （部署用，单文件）
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const ENTRY = path.join(SRC, 'main.js');

/* ---------- 依赖解析 ---------- */

const IMPORT_RE = /^import\s[\s\S]*?from\s*['"]([^'"]+)['"];?[ \t]*$/gm;

function readModule(file) {
  // 数据文件优先读紧凑版（体积小 30%，内容完全一致）
  if (file.endsWith(path.join('data', 'bundle.js'))) {
    const compact = file.replace(/bundle\.js$/, 'bundle.compact.js');
    if (fs.existsSync(compact)) return { file, code: fs.readFileSync(compact, 'utf8') };
  }
  return { file, code: fs.readFileSync(file, 'utf8') };
}

function depsOf(code, fromFile) {
  const out = [];
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(code)) !== null) {
    out.push(path.resolve(path.dirname(fromFile), m[1]));
  }
  return out;
}

/* ---------- 拓扑排序（DFS 后序） ---------- */

const order = [];
const mark = new Map();

function visit(file) {
  if (mark.get(file) === 2) return;
  if (mark.get(file) === 1) throw new Error(`检测到循环依赖：${file}`);
  mark.set(file, 1);

  const { code } = readModule(file);
  for (const dep of depsOf(code, file)) {
    if (!fs.existsSync(dep)) throw new Error(`找不到依赖：${dep}`);
    visit(dep);
  }

  mark.set(file, 2);
  order.push(file);
}

visit(ENTRY);

/* ---------- 拼接 ---------- */

const chunks = [];

for (const file of order) {
  const { code: raw } = readModule(file);
  const rel = path.relative(ROOT, file).split(path.sep).join('/');

  /* 内联是把所有模块拼进同一个 IIFE 作用域，import 整行被删掉。
     如果某个 import 带别名（`import { A as B }`），B 在单文件里就无从定义，
     运行时直接 ReferenceError —— 而开发态（ES module）完全正常，
     所以这类 bug 只在双击 html 时暴露。这里在构建期就拦下来。 */
  const aliasImport = raw.match(/import\s*\{[^}]*\bas\s+[A-Za-z_$][\w$]*[^}]*\}/);
  if (aliasImport) {
    throw new Error(`[single] ${rel} 使用了带别名的 import，内联后会丢失：${aliasImport[0]}`);
  }

  let code = raw
    .replace(IMPORT_RE, '')                                   // 去掉 import
    // 去掉 export 关键字。不能用 ^ 锚定行首：源码里存在
    // `/** 注释 */export function foo` 这种同行写法。
    // 前瞻确保只匹配语句位的 export，不会误伤 exportJSON / exportPoster 这类标识符。
    .replace(/\bexport\s+default\s+/g, '')       // export default xxx → xxx
    .replace(/\bexport\s+(?=(?:const|let|var|function|class|async\s+function))/g, '');

  code = code.replace(/^\s*\n/, '').replace(/\s+$/, '');

  chunks.push(`/* ───────── ${rel} ───────── */\n${code}`);
}

const appCode = chunks.join('\n\n');

/* ---------- 样式 ---------- */

const css = (name) => fs.readFileSync(path.join(ROOT, 'styles', name), 'utf8');

const styleBlock = `
<style>/* tokens.css */
${css('tokens.css')}
</style>
<style>/* main.css */
${css('main.css')}
</style>
<style>/* print.css（内部已自带 @media print 作用域） */
${css('print.css')}
</style>`.trim();

/* ---------- 载入提示（模块被拦截时的兜底） ---------- */

const guardScript = `
<script>
(function () {
  // 兜底：若 2.5 秒后应用仍未挂载，说明模块脚本被浏览器拦截了
  setTimeout(function () {
    var app = document.getElementById('app');
    var stillLoading = app && app.querySelector('.loading');
    var hasShell = app && app.querySelector('.masthead');
    if (!stillLoading || hasShell) return;

    app.innerHTML =
      '<div style="max-width:40em;margin:0 auto;padding:9vh 24px;line-height:2.05">' +
        '<div style="font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:var(--gold);margin-bottom:18px">Diagnostic</div>' +
        '<div style="font-family:var(--font-serif);font-size:22px;color:var(--text-primary);margin-bottom:16px">应用没有启动</div>' +
        '<div style="font-size:13px;color:var(--text-secondary)">' +
          '浏览器的安全策略拦截了本地模块脚本（<code style="font-family:var(--font-mono);font-size:.9em">file://</code> 下的 ES module 受限），' +
          '所以 <code style="font-family:var(--font-mono);font-size:.9em">src/main.js</code> 没有执行。这不是加载慢。' +
        '</div>' +
        '<div style="margin-top:26px;padding-top:22px;border-top:1px solid var(--border);font-size:12.5px;line-height:2.1;color:var(--text-secondary)">' +
          '<div style="margin-bottom:14px"><b style="color:var(--text-primary)">方式一 · 最简单</b><br>' +
          '双击本目录下的 <code style="font-family:var(--font-mono);font-size:.9em;color:var(--gold)">human-atlas.html</code>（单文件版，已内联，无模块限制）</div>' +
          '<div style="margin-bottom:14px"><b style="color:var(--text-primary)">方式二 · 保持可编辑</b><br>' +
          '双击 <code style="font-family:var(--font-mono);font-size:.9em;color:var(--gold)">启动.command</code>，会启动本地服务并自动打开浏览器</div>' +
          '<div><b style="color:var(--text-primary)">方式三 · 终端</b><br>' +
          '在本目录执行 <code style="font-family:var(--font-mono);font-size:.9em;color:var(--gold)">npm start</code>，再访问 localhost:4173</div>' +
        '</div>' +
      '</div>';
  }, 2500);
})();
</script>`.trim();

/* ---------- 生成 HTML ---------- */

const template = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let html = template
  .replace(/\s*<link rel="stylesheet"[^>]*>/g, '')
  .replace('</head>', `${styleBlock}\n</head>`)
  .replace(
    /\s*<script type="module" src="src\/main\.js"><\/script>/,
    `\n<script>\n(function () {\n'use strict';\n\n${appCode}\n\n})();\n</script>`,
  )
  .replace('</body>', `${guardScript}\n</body>`);

/* ---------- 语法自检：把内联代码单独拿出来让 Node 解析一遍 ---------- */

const probe = path.join(ROOT, '.build-probe.js');
fs.writeFileSync(probe, `(function () {\n'use strict';\n\n${appCode}\n\n})();\n`, 'utf8');
try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' });
} catch (err) {
  const detail = (err.stderr || err.stdout || '').toString().split('\n').slice(0, 12).join('\n');
  fs.rmSync(probe, { force: true });
  console.error('[single] 内联代码语法校验失败：\n' + detail);
  process.exit(1);
}
fs.rmSync(probe, { force: true });

const outFile = path.join(ROOT, 'human-atlas.html');
fs.writeFileSync(outFile, html, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`[single] 模块 ${order.length} 个已内联`);
console.log(`[single] human-atlas.html ${kb(Buffer.byteLength(html))}  (gzip ${kb(Buffer.byteLength(html, 'utf8') / 3.2)})`);
