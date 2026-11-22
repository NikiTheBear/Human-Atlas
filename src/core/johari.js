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

/**
 * 12 道盲猜题。
 *
 * 【极性约定】每题 4 个选项 **严格由低到高**排列 —— 索引 0 = 该维度最低，
 * 索引 3 = 该维度最高。johariResult() 直接按 `pick / 3 * 100` 折算，
 * 所以任何一题倒序都会让该维度「盲区」与「隐藏区」判反。
 * 每题用 `scale: [低端描述, 高端描述]` 写明两端含义，测试会检查这个字段存在。
 *
 * 【人称】统一用中性「TA」，不预设被猜人的性别。UI 层可用 fillName()
 * 把 TA 替换成真实昵称。
 */
export const JOHARI_QUESTIONS = [
  {
    dim: 'big5_assert',
    scale: ['打断三次也不吭声', '直接把话题主导过去'],
    prom: '如果聚餐时有人把TA的话打断了三次',
    opts: [
      'TA多半不吭声，回头也不提',
      'TA会等个空隙把话接回去',
      'TA会当场说「我还没说完」',
      'TA会直接把话题主导过去',
    ],
  },
  {
    dim: 'big5_compassion',
    scale: ['先给方案，不太接情绪', '陪着一起难受'],
    prom: '你难过时给TA发一条很长的语音',
    opts: [
      'TA大概会先给你一个解决方案',
      'TA会简短问一句「怎么了」，然后给建议',
      'TA会认真听完，再问你需要什么',
      'TA会陪你很久，也会跟着一起难受',
    ],
  },
  {
    dim: 'big5_order',
    scale: ['完全没有秩序也不介意', '连角度都对'],
    prom: '去TA住的地方，你最先会注意到',
    opts: [
      '基本没有秩序可言，但TA不介意',
      '乱得有个性，TA自己找得到',
      '整体整齐，但抽屉可能很乱',
      '东西位置有规律，连角度都对',
    ],
  },
  {
    dim: 'sin_pride',
    scale: ['立刻承认还道谢', '当场不认'],
    prom: '有人当面指出TA一个明显的错误',
    opts: [
      'TA会立刻承认，还会谢谢对方',
      'TA嘴上接受，心里会过一遍',
      'TA会先辩解两句再改',
      'TA大概不会当场认',
    ],
  },
  {
    dim: 'virtue_humility',
    scale: ['坦率承认是自己的本事', '把功劳分给别人'],
    prom: 'TA做成了一件很难的事，别人夸TA',
    opts: [
      'TA会坦率承认这确实是TA的本事',
      'TA会接受，也会讲点过程',
      'TA会说「运气好」',
      'TA会把功劳分给别人',
    ],
  },
  {
    dim: 'light_kant',
    scale: ['会做，且不觉得需要解释', '规则就是规则'],
    prom: '一件事对朋友有利，但违反了规则',
    opts: [
      'TA会做，且不觉得需要解释',
      'TA会先做，之后自己补救',
      'TA会很为难，最后大概率不做',
      '规则就是规则，TA多半不做',
    ],
  },
  {
    dim: 'dark_mach',
    scale: ['直来直去，谁有理听谁的', '先不表态，看清局面再动'],
    prom: '在一个需要争的场合，你觉得TA最可能',
    opts: [
      '直接把道理摆出来，谁有理听谁的',
      '先按规矩走一遍，走不通再说',
      '先摸清这件事是谁拍板',
      '先不表态，等别人亮完牌再决定站哪边',
    ],
  },
  {
    dim: 'att_anxiety',
    scale: ['根本没注意', '开始怀疑是不是哪里不对'],
    prom: 'TA发出去一条消息，对方四小时没回',
    opts: [
      'TA根本没注意',
      'TA注意到了，但没多想',
      'TA会反复看自己上一条',
      'TA会开始想是不是哪里不对',
    ],
  },
  {
    dim: 'att_avoidance',
    scale: ['很受用，甚至更主动', '明显冷下来'],
    prom: '有人开始对TA很主动、很黏',
    opts: [
      'TA会很受用，甚至更主动',
      'TA会高兴，也需要一点自己的时间',
      'TA会有点想退',
      'TA会明显冷下来',
    ],
  },
  {
    dim: 'mot_autonomy',
    scale: ['毫不犹豫接受被安排', '大概会拒绝'],
    prom: '一份收入更高、但要处处听安排的工作',
    opts: [
      'TA会毫不犹豫接受',
      'TA会接受，但心里会不适',
      'TA会犹豫很久',
      'TA大概会拒绝',
    ],
  },
  {
    dim: 'mot_belonging',
    scale: ['完全自在，甚至挺享受', '明显觉得空，想找最熟的人'],
    prom: '连续两周没什么人主动联系TA，你觉得TA会',
    opts: [
      '完全自在，甚至挺享受这种清静',
      '有点空，但自己找点事就过去了',
      '会主动找人聊两句',
      '会明显觉得空，很想找最熟的人待一会儿',
    ],
  },
  {
    dim: 'hsp_sensory',
    scale: ['完全没问题', '会找借口先走'],
    prom: '在一个很吵、灯很亮的房间里待两小时',
    opts: [
      'TA完全没问题',
      'TA会有点累，但能撑',
      'TA会明显不适',
      'TA会找借口先走',
    ],
  },
];

/**
 * 把题目文案里的中性「TA」替换成被猜人的昵称。
 * 无昵称时原样返回，保持「TA」这个中性写法。
 */
export function fillName(text, name = '') {
  const n = String(name || '').trim();
  if (!n || n === '这位朋友') return String(text || '');
  return String(text || '').replace(/TA/g, n);
}

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
