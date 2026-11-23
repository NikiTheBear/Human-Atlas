#!/usr/bin/env node
/* ============================================================
   render-smoke.mjs — 渲染层冒烟测试（v5.2.3 新增）

   为什么需要它
   ------------
   2026-11 连续四轮出现同一类故障：**数据层全对、测试全绿、用户看不到东西**。

     · `content-visibility: auto` 把报告页 8 个板块永久掐死
       → 9 个 .rsec 都在 DOM 里，高度恒等于占位的 720px，
         innerText 只有 1153 字符，滚动也不补渲染
     · 对比页渲染抛异常 → 整页静默空白
     · `#/join` 死链 → 按钮点下去没反应

   三类问题的共同点：`tests/` 里 4160 行 Node 测试**一条都测不到**，
   因为没有任何一行碰过 `document`。
   这个文件补的就是这一层：真开一个浏览器，真数 DOM 节点，真读 innerText。

   依赖
   ----
   不装 npm 包。用 Node 内置 `node:child_process` 起本地静态服务，
   再用 CDP（Chrome DevTools Protocol）连本机已安装的 Chrome/Edge。
   找不到浏览器就 SKIP，不阻塞 CI。

   用法
   ----
     node tests/render-smoke.mjs             # 默认
     node tests/render-smoke.mjs --verbose   # 打印每条断言的实测值

   退出码
   ------
     0  全部通过（或浏览器不可用而跳过）
     1  有断言失败
   ============================================================ */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
/** --url=https://... 时直接测远端站点，不启本地服务 */
const REMOTE = (process.argv.find((a) => a.startsWith('--url=')) || '').slice(6).replace(/\/+$/, '');

let pass = 0;
let fail = 0;
const failures = [];
const line = (c = '─') => c.repeat(70);
const hr = (t) => { console.log(`\n${line()}`); console.log(`  ${t}`); console.log(line()); };

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${detail && VERBOSE ? ` · ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` · ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` · ${detail}` : ''}`);
  }
}

/* ------------------------------------------------------------
   1 · 找一个能用的浏览器
   ------------------------------------------------------------ */

let PROFILE = '';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  process.env.CHROME_PATH || '',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findBrowser() {
  for (const p of CANDIDATES) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/* ------------------------------------------------------------
   1.5 · 极简 WebSocket 客户端
   ------------------------------------------------------------
   Node 20 没有全局 WebSocket（Node 21 才加，22 才稳定）。
   CI runner 用的是 node-version: '20'，直接 new WebSocket() 会
   `WebSocket is not defined` —— 实测在 GitHub Actions 上炸过一次。
   这里手写一个够用的客户端：握手 + 帧编解码 + ping/pong + 分片。
   只用 node:http 与 node:crypto，零依赖。
   ------------------------------------------------------------ */

class MiniWs {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.onmessage = null;
    this.onclose = null;
    socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this._drain(); });
    socket.on('close', () => { if (this.onclose) this.onclose(); });
    socket.on('error', () => { if (this.onclose) this.onclose(); });
  }

  _drain() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < off + 2) return;
        len = this.buf.readUInt16BE(off); off += 2;
      } else if (len === 127) {
        if (this.buf.length < off + 8) return;
        len = Number(this.buf.readBigUInt64BE(off)); off += 8;
      }
      let maskKey = null;
      if (masked) {
        if (this.buf.length < off + 4) return;
        maskKey = this.buf.subarray(off, off + 4); off += 4;
      }
      if (this.buf.length < off + len) return;
      const payload = Buffer.from(this.buf.subarray(off, off + len));
      if (maskKey) for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i & 3];
      this.buf = this.buf.subarray(off + len);

      if (opcode === 0x9) { this._frame(payload, 0xA); continue; }   // ping → pong
      if (opcode === 0xA) continue;                                  // pong
      if (opcode === 0x8) { try { this.socket.end(); } catch { /* ignore */ } return; }

      this.frags.push(payload);
      if (fin) {
        const full = Buffer.concat(this.frags).toString('utf8');
        this.frags = [];
        if (this.onmessage) this.onmessage(full);
      }
    }
  }

  _frame(payload, opcode) {
    const maskKey = randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const body = Buffer.from(payload);
    for (let i = 0; i < body.length; i += 1) body[i] ^= maskKey[i & 3];
    this.socket.write(Buffer.concat([header, maskKey, body]));
  }

  send(str) { this._frame(Buffer.from(str, 'utf8'), 0x1); }

  close() { try { this.socket.end(); } catch { /* ignore */ } }
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 连 CDP 的 ws:// 端点，返回带 send/onmessage/close 的对象 */
function connectWs(url) {
  const u = new URL(url);
  const key = randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket) => {
      const expect = createHash('sha1').update(key + WS_GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== expect) {
        reject(new Error('WebSocket 握手校验失败'));
        return;
      }
      resolve(new MiniWs(socket));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => reject(new Error('WebSocket 连接超时')));
    req.end();
  });
}

/* ------------------------------------------------------------
   2 · 极简 CDP 客户端（不依赖 puppeteer）
   ------------------------------------------------------------ */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'cdp error'));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
  }

  send(method, params = {}, sessionId = null) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = { id, method, params };
      /* CDP 的 sessionId 是消息顶层字段，塞进 params 会变成未知参数 → 方法找不到 */
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`cdp timeout: ${method}`));
        }
      }, 20000);
    });
  }
}

/** 等一个小睡（CDP 里没有 timer，用 Promise 包一层） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------
   3 · 主流程
   ------------------------------------------------------------ */

async function main() {
  hr('渲染层冒烟测试（真浏览器 / 真 DOM）');

  /* ---- 3.0 先确认构建产物在 ---- */
  const indexHtml = path.join(ROOT, 'index.html');
  const distRoot = path.join(ROOT, 'dist');
  check('index.html 存在', existsSync(indexHtml));

  if (!existsSync(distRoot)) {
    console.log('\n  ! 没有 dist/，先跑 npm run build:pages。本次跳过浏览器部分。');
    return summary();
  }

  if (!REMOTE && !existsSync(distRoot)) {
    console.log('\n  ! 没有 dist/，先跑 npm run build:pages。本次跳过。');
    return summary({ skipped: true });
  }

  const chrome = findBrowser();
  if (!chrome) {
    console.log('\n  ! 没找到 Chrome / Chromium / Edge。');
    console.log('    这条测试需要真浏览器才能验证「元素是否真的渲染出来」。');
    console.log('    装一个，或设 CHROME_PATH 环境变量，或直接跳过（CI 里也跳过）。');
    console.log('\n  ⚠ SKIP —— 未验证');
    return summary({ skipped: true });
  }
  console.log(`  浏览器：${chrome.replace(/^.*\/([^/]+)$/, '$1')}`);

  /* ---- 3.1 起本地静态服务（或用 --url 直连远端） ---- */
  let server = { close() {} };
  let base;
  if (REMOTE) {
    base = REMOTE;
    console.log(`  直连远端：${base}`);
  } else {
    server = serveDist(distRoot);
    const port = await server.port;
    base = `http://127.0.0.1:${port}`;
    console.log(`  本地服务：${base}`);
  }

  /* ---- 3.2 起无头浏览器（每次用全新临时 profile，避免锁残留） ---- */
  PROFILE = mkdtempSync(path.join(tmpdir(), 'atlas-smoke-'));
  const browser = await launch(chrome);
  if (!browser) {
    server.close();
    return summary({ skipped: true });
  }

  try {
    await runChecks(browser, base);
  } finally {
    await browser.kill();
    server.close();
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  return summary();
}

/** 极简静态服务器：只服务 dist/，够用就行 */
function serveDist(root) {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  };
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const abs = path.join(root, p);
      if (!abs.startsWith(root)) { res.statusCode = 403; res.end(); return; }
      const buf = await readFile(abs);
      res.setHeader('content-type', MIME[path.extname(abs)] || 'application/octet-stream');
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  const port = new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
  return { port, close: () => srv.close() };
}

/** 起浏览器 + 连 CDP */
async function launch(exe) {
  const proc = spawn(exe, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    /* CI 容器里通常以 root 跑，且 /dev/shm 很小 —— 不加这两个会直接崩 */
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--user-data-dir=' + PROFILE,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  /* --remote-debugging-port=0 会把实际端口写到 stderr，格式：
     DevTools listening on ws://127.0.0.1:PORT/devtools/browser/xxx */
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('浏览器启动超时')), 25000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+/);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`浏览器退出 code=${code}`)); });
  }).catch((e) => { console.log(`  ! ${e.message}`); return null; });

  if (!wsUrl) { proc.kill(); return null; }

  /* 连 CDP：Node 20 没有全局 WebSocket，用上面的 MiniWs */
  let ws;
  try {
    ws = await connectWs(wsUrl);
  } catch (e) {
    console.log(`  ! CDP 连接失败：${e.message}`);
    proc.kill();
    return null;
  }
  const cdp = new Cdp(ws);

  /* 开一个新 page target 并 attach */
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  /* 把 sessionId 作为顶层字段带上 */
  const raw = cdp.send.bind(cdp);
  const session = {
    send: (method, params = {}) => raw(method, params, sessionId),
    _raw: raw,
    _sessionId: sessionId,
  };
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Log.enable');

  return {
    session,
    cdp,
    async kill() {
      try { ws.close(); } catch { /* ignore */ }
      proc.kill();
    },
  };
}

/* ------------------------------------------------------------
   4 · 断言
   ------------------------------------------------------------ */

async function runChecks(browser, base) {
  const s = browser.session;

  let nonce = 0;
  /**
   * 导航到某路由并等渲染真正稳定。
   *
   * 两个坑：
   *  1. 同 URL 的 Page.navigate 在 Chrome 里可能是 no-op，页面保留上一帧旧渲染
   *     —— 表现为「导入成功但页面没变」。所以每次带不同 nonce。
   *  2. 固定 sleep 在远端不可靠（GitHub Pages 首字节就慢）。
   *     改成轮询：等 #view-root 真的有子节点、且 loading 文案消失。
   */
  async function open(hash) {
    nonce += 1;
    await s.send('Page.navigate', { url: `${base}/?smoke=${nonce}${hash}` });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await sleep(150);
      const ready = await evalJson(`(() => {
        const root = document.querySelector('#view-root');
        const loading = document.querySelector('.loading');
        return {
          hasRoot: !!root,
          children: root ? root.children.length : 0,
          loading: !!loading,
          hasApi: !!(window.HumanAtlas && window.HumanAtlas.App)
        };
      })()`);
      if (ready.hasRoot && ready.children > 0 && !ready.loading) return;
    }
    console.log(`    ! ${hash || '#/'} 渲染超时（20s）`);
  }

  /** 在页面里取值 */
  async function evalJson(expr) {
    const { result, exceptionDetails } = await s.send('Runtime.evaluate', {
      expression: `(() => { try { return JSON.stringify(${expr}); } catch (e) { return JSON.stringify({__err: String(e)}); } })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) return { __err: exceptionDetails.text };
    try { return JSON.parse(result.value); } catch { return { __err: 'parse' }; }
  }

  /* ============ 4.1 空态：干净 localStorage 下 #/report 应显示空态卡 ============ */
  await open('#/report');
  await s.send('Runtime.evaluate', { expression: 'localStorage.clear()' });
  await open('#/report');

  const emptyState = await evalJson(`{
    hasEmptyCard: !!document.querySelector('.empty-dossier'),
    rsec: document.querySelectorAll('.rsec').length,
    textLen: document.body.innerText.length
  }`);
  check('空态下显示「档案尚未启封」空态卡', emptyState.hasEmptyCard === true,
    JSON.stringify(emptyState));
  check('空态下不渲染任何 .rsec 板块', emptyState.rsec === 0, `rsec=${emptyState.rsec}`);

  /* ============ 4.2 导入 8 卷存档码 → 报告页必须真的出现内容 ============ */
  const CODE8 = process.env.SMOKE_CODE || 'HA4-BP8AGgsk____OSJYCApeBl1FLg9QJjokPj4uJCAqSDMoNTw3JTQuQP8qKz8OSS0POBMTPiIRGx4lQlURMz4wUTYoID48_________________________________________________________________________________________-mqjOaUtueUslg';

  const imported = await evalJson(`(() => {
    const r = window.HumanAtlas.importSoulCode(${JSON.stringify(CODE8)}, { merge: true });
    return { ok: !!r.ok, dims: Object.values(window.HumanAtlas.App.state.computedScores || {}).filter(Number.isFinite).length };
  })()`);
  /* 8 卷实测 59 维（vol1–8 声明维度去重后）—— 阈值取 55，留一点余量 */
  check('8 卷存档码可导入', imported.ok === true && imported.dims >= 55,
    `dims=${imported.dims}`);

  await open('#/report');
  const report = await evalJson(`{
    hasEmptyCard: !!document.querySelector('.empty-dossier'),
    rsec: document.querySelectorAll('.rsec').length,
    charts: document.querySelectorAll('.chart-card').length,
    textLen: document.body.innerText.length,
    heights: [...document.querySelectorAll('.rsec')].map(function(n){ return Math.round(n.getBoundingClientRect().height); })
  }`);

  check('导入后不再显示空态卡', report.hasEmptyCard === false);
  check('导入后有 9 个报告板块', report.rsec === 9, `rsec=${report.rsec}`);
  check('导入后至少 3 张图表', (report.charts || 0) >= 3, `charts=${report.charts}`);

  /* 这一条是 content-visibility 事故的直接防线：
     当时 9 个板块高度全是 720（占位值），innerText 只有 1153。 */
  check('报告正文 ≥ 4000 字符（不是空壳）',
    (report.textLen || 0) >= 4000, `innerText=${report.textLen}`);
  check('没有任何板块高度恒等于 720 占位值',
    !(report.heights || []).every((h) => h === 720),
    `heights=${JSON.stringify(report.heights)}`);
  /* 折叠态的板块只有「标题 + 展开按钮」，实测 71px 是正常的。
     这里只要求：没有 0 高度的板块（那是真的没渲染）。 */
  check('所有板块高度都 > 40px（没有 0 高度空块）',
    (report.heights || []).every((h) => h > 40),
    `heights=${JSON.stringify(report.heights)}`);

  /* ============ 4.3 其他路由不白屏 ============ */
  const routes = [
    ['#/hub', '卷宗大厅'],
    ['#/guide', '导览'],
    ['#/compare', '双人对比'],
    ['#/express', '极速版'],
    ['#/johari', '印象盲盒'],
    ['#/squad', '群像星图'],
  ];

  for (const [hash, label] of routes) {
    await open(hash);
    const r = await evalJson(`{
      len: document.body.innerText.length,
      nodes: document.querySelectorAll('#view-root *').length,
      rootEmpty: (document.querySelector('#view-root') || {}).children.length === 0
    }`);
    check(`${label} ${hash} 有内容渲染`, r.len > 80 && r.nodes > 10 && !r.rootEmpty,
      `innerText=${r.len} nodes=${r.nodes}`);
  }

  /* ============ 4.4 单卷报告 ============ */
  await open('#/report/vol1');
  const vol1 = await evalJson(`{
    len: document.body.innerText.length,
    hasEmpty: !!document.querySelector('.empty-dossier'),
    secs: document.querySelectorAll('.rsec, .vol-report__sec').length
  }`);
  check('单卷报告 vol1 有内容', vol1.len > 800 && !vol1.hasEmpty,
    `innerText=${vol1.len}`);

  /* ============ 4.6 折叠：默认收起三块，且能展开 ============ */
  await open('#/report');   // 4.4 切走了，先切回来
  const fold0 = await evalJson(`{
    toggles: document.querySelectorAll('.rfold__toggle').length,
    opened: document.querySelectorAll('.rfold.is-open').length,
    firstExpandable: !!document.querySelector('.rfold__toggle')
  }`);
  check('报告页有 3 个可折叠板块', fold0.toggles === 3, `toggles=${fold0.toggles}`);
  check('默认全部收起', fold0.opened === 0, `opened=${fold0.opened}`);

  if (fold0.firstExpandable) {
    /* 用 .rfold__body 的实测高度判断，不用 innerText：
       折叠是靠 grid-template-rows: 0fr + overflow:hidden 做的，
       innerText 会把被裁剪的内容也算进去，测不出「有没有真的收起来」。 */
    const beforeH = await evalJson("Math.round(document.querySelector('.rfold__body').getBoundingClientRect().height)");
    await s.send('Runtime.evaluate', { expression: "document.querySelector('.rfold__toggle').click()" });
    await sleep(600);
    const after = await evalJson(`{
      h: Math.round(document.querySelector('.rfold__body').getBoundingClientRect().height),
      opened: document.querySelectorAll('.rfold.is-open').length,
      aria: document.querySelector('.rfold__toggle').getAttribute('aria-expanded')
    }`);
    check('展开后 body 从 0 高度长出来',
      beforeH <= 2 && after.h > 100 && after.opened === 1 && after.aria === 'true',
      `height ${beforeH} → ${after.h}`);
  }

  /* ============ 4.5 页面无未捕获异常 ============ */
  const errs = (browser.cdp.events || [])
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params?.exceptionDetails?.text || '');
  check('全程无未捕获 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | '));
}

/* ------------------------------------------------------------
   5 · 汇总
   ------------------------------------------------------------ */

function summary({ skipped = false } = {}) {
  hr('汇总');
  if (skipped) {
    console.log('  ⚠ 已跳过（未找到可用浏览器或未构建）');
    console.log('  这不是通过，只是没验。装个 Chrome 就能真跑。');
  } else if (fail) {
    console.log(`  失败 ${fail} 项：`);
    failures.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
  } else {
    console.log(`  全部通过 · ${pass} 条断言 · 0 失败`);
  }
  console.log(line());
  process.exit(skipped ? 0 : (fail ? 1 : 0));
}

main().catch((e) => {
  console.error('\n渲染冒烟测试异常：', e.message);
  process.exit(1);
});
