/* ============================================================
   johari.js — 乔哈里窗「印象盲盒」

   玩法：生成一条 12 题邀请，好友不测自己，而是凭直觉猜「你」。
   提交后立刻给出四象限：公开区 / 盲区 / 隐藏区 / 未知区。

   短码 HA4J- 只装 12 个维度分数，够算四象限，不装任何答题原文。
   ============================================================ */

import { clamp, round } from './utils.js';

/** 12 项核心显性维度 —— 必须覆盖公开/盲/隐三个区 */
export const JOHARI_DIMS = [
  'big5_assert', 'big5_compassion', 'big5_order',
  'sin_pride', 'virtue_humility',
  'light_kant', 'dark_mach',
  'att_anxiety', 'att_avoidance',
  'mot_autonomy', 'mot_belonging',
  'hsp_sensory',
];

/** 12 道盲猜题：每题对应一个维度，选项从低到高 4 档 */
export const JOHARI_QUESTIONS = [
  {
    dim: 'big5_assert', prom: '如果聚餐时有人把他的话打断了三次',
    opts: ['他多半不吭声，回头也不提', '他会等个空隙把话接回去', '他会当场说「我还没说完」', '他会直接把话题主导过去'],
  },
  {
    dim: 'big5_compassion', prom: '你难过时给他发一条很长的语音',
    opts: ['他会先回一句「怎么了」再听', '他会认真听完，然后问你想要什么', '他会陪你很久，也会跟着难受', '他大概会替你把事情解决掉'],
  },
  {
    dim: 'big5_order', prom: '去他住的地方，你最先会注意到',
    opts: ['东西位置有规律，连角度都对', '整体整齐，但抽屉可能很乱', '乱得有个性，他自己找得到', '基本没有秩序可言，但他不介意'],
  },
  {
    dim: 'sin_pride', prom: '有人当面指出他一个明显的错误',
    opts: ['他会立刻承认，还会感谢你', '他嘴上接受，心里会过一遍', '他会先辩解两句再改', '他大概不会当场认'],
  },
  {
    dim: 'virtue_humility', prom: '他做成了一件很难的事，别人夸他',
    opts: ['他会把功劳分给别人', '他会说「运气好」', '他会接受，也会讲点过程', '他会坦率承认这确实是他的本事'],
  },
  {
    dim: 'light_kant', prom: '一件事对朋友有利，但违反了规则',
    opts: ['规则就是规则，他多半不做', '他会很为难，最后大概率不做', '他会先做，之后自己补救', '他会做，且不觉得需要解释'],
  },
  {
    dim: 'dark_mach', prom: '在一个需要争的场合，你觉得他最可能',
    opts: ['按道理讲，讲到对方认', '先摸清谁说了算', '会让别人替他出头', '不争，直接退出这个场'],
  },
  {
    dim: 'att_anxiety', prom: '他发出去一条消息，对方四小时没回',
    opts: ['他根本没注意', '他注意到了，但没多想', '他会反复看自己上一条', '他会开始想是不是哪里不对'],
  },
  {
    dim: 'att_avoidance', prom: '有人开始对他很主动、很黏',
    opts: ['他会很受用，甚至更主动', '他会高兴，也需要一点自己的时间', '他会有点想退', '他会明显冷下来'],
  },
  {
    dim: 'mot_autonomy', prom: '一份收入更高但要听安排的工作',
    opts: ['他会毫不犹豫接受', '他会接受，但心里会不适', '他会犹豫很久', '他大概会拒绝'],
  },
  {
    dim: 'mot_belonging', prom: '他更在意哪一种',
    opts: ['自己说了算', '身边有几个人是真的懂他', '有明确的上升空间', '生活稳、不出事'],
  },
  {
    dim: 'hsp_sensory', prom: '在一个很吵、灯很亮的房间里待两小时',
    opts: ['他完全没问题', '他会有点累，但能撑', '他会明显不适', '他会找借口先走'],
  },
];

/* ------------------------------------------------------------
   HA4J- 短码：12 个维度分数（0–100，1 字节一个）
   ------------------------------------------------------------ */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 63];
  }
  return out;
}

function fromB64(str) {
  const clean = String(str || '').replace(/[^A-Za-z0-9\-_]/g, '');
  const bytes = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const idx = B64.indexOf(ch);
    if (idx < 0) continue;
    buf = (buf << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function sum8(bytes) {
  let h = 0x2b;
  for (const b of bytes) h = (h * 31 + b) & 0xff;
  return h;
}

/** 编码：version(1) + 12 维 + 昵称 UTF8 + 校验(1) */
export function encodeJohari(scores, nickname = '') {
  const body = [1];
  for (const d of JOHARI_DIMS) {
    const v = scores?.[d];
    body.push(Number.isFinite(v) ? clamp(Math.round(v), 0, 100) : 255);
  }
  const nameBytes = [...new TextEncoder().encode(String(nickname).slice(0, 12))];
  body.push(...nameBytes);

  const bytes = new Uint8Array(body.length + 1);
  bytes.set(body, 0);
  bytes[body.length] = sum8(Uint8Array.from(body));
  return `HA4J-${toB64(bytes)}`;
}

export function decodeJohari(code) {
  const raw = String(code || '').trim();
  if (!/^HA4J-/i.test(raw)) return { ok: false, error: '不是 HA4J- 开头的印象码' };
  const bytes = fromB64(raw.slice(5));
  if (bytes.length < 14) return { ok: false, error: '印象码长度异常' };
  if (sum8(bytes.subarray(0, bytes.length - 1)) !== bytes[bytes.length - 1]) {
    return { ok: false, error: '校验失败' };
  }
  if (bytes[0] !== 1) return { ok: false, error: '不支持的印象码版本' };

  const scores = {};
  JOHARI_DIMS.forEach((d, i) => {
    const b = bytes[1 + i];
    if (b !== 255) scores[d] = b;
  });
  const nickname = new TextDecoder().decode(bytes.subarray(13, bytes.length - 1)).replace(/\u0000/g, '').trim();
  return { ok: true, scores, nickname };
}

/* ------------------------------------------------------------
   四象限
   ------------------------------------------------------------ */

/**
 * @param {Object} selfScores  本人 12 维真实分
 * @param {Array}  guesses     好友作答：[{ dim, pick(0–3) }]
 * @returns {{ quadrants, open, blind, facade, unknown, agreement }}
 */
export function johariResult(selfScores, guesses) {
  const open = [];
  const blind = [];
  const facade = [];
  const unknown = [];

  const selfMean = (() => {
    const v = JOHARI_DIMS.map((d) => selfScores?.[d]).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 50;
  })();

  const guessMap = new Map();
  for (const g of guesses || []) guessMap.set(g.dim, g.pick);

  for (const d of JOHARI_DIMS) {
    const sv = selfScores?.[d];
    const pick = guessMap.get(d);
    if (!Number.isFinite(sv) || pick === undefined) continue;

    /* 把 4 档折算成 0–100 的估计分 */
    const gv = clamp((Number(pick) / 3) * 100, 0, 100);
    const selfHigh = sv >= selfMean;
    const friendHigh = gv >= 50;

    const row = { dim: d, self: round(sv, 0), friend: round(gv, 0) };

    if (selfHigh && friendHigh) open.push(row);          // 公开区
    else if (!selfHigh && friendHigh) blind.push(row);   // 盲区：他人看见，你没看见
    else if (selfHigh && !friendHigh) facade.push(row);  // 隐藏区
    else unknown.push(row);                              // 未知区
  }

  /* 一致度：|self − friend| 的均值反推 */
  const all = [...open, ...blind, ...facade, ...unknown];
  const agreement = all.length
    ? round(100 - all.reduce((s, r) => s + Math.abs(r.self - r.friend), 0) / all.length, 1)
    : null;

  return { open, blind, facade, unknown, agreement };
}

/** 按维度名取中文，供 UI 用 */
export function labelOf(dim, dimMap) {
  return dimMap?.[dim]?.name || dim;
}
