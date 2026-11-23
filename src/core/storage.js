/* ============================================================
   storage.js — 本地存档 / 断点续存 / HA3- 灵魂存档码编解码
   ============================================================ */

const LS_KEY = 'human-atlas::state::v4';
const LS_LEGACY_KEY = 'human-atlas::state::v3';
const LS_THEME = 'human-atlas::theme';
const LS_META = 'human-atlas::meta';
export const SCHEMA_VERSION = '4.0';
export const CODE_PREFIX = 'HA4-';
export const LEGACY_PREFIX = 'HA3-';

/** 十六卷全集（编码顺序 = bit 位序，禁止重排） */
export const ALL_VOLUMES = [
  'vol1', 'vol2', 'vol3', 'vol4', 'vol5', 'vol6', 'vol7', 'vol8',
  'vol9', 'vol10', 'vol11', 'vol12', 'vol13', 'vol14', 'vol15', 'vol16',
];

/** 第一辑 · 本源八卷 / 第二辑 · 破圈深水八卷 */
export const CORE_VOLUMES = ALL_VOLUMES.slice(0, 8);
export const EXPANSION_VOLUMES = ALL_VOLUMES.slice(8);

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    nickname: '',
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

function safeParse(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------
   基础读写
   ------------------------------------------------------------ */

export function load() {
  if (typeof localStorage === 'undefined') return emptyState();
  // v4 起换 key，但会尝试读取 v3 的存档并迁移（老用户不该因为加了 8 卷就丢进度）
  let raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    raw = localStorage.getItem(LS_LEGACY_KEY);
     if (raw) localStorage.setItem(LS_KEY, raw);
  }
  const parsed = raw ? safeParse(raw, null) : null;
  if (!parsed || typeof parsed !== 'object') return emptyState();

  /* 先迁移（语义层），再做形状纠偏（结构层）—— 顺序不能反，
     否则新版字段在被读到之前就被 sanitize 成默认值了。 */
  const migrated = migrate({ ...emptyState(), ...parsed });
  const state = { ...emptyState(), ...migrated };

  // 结构纠偏：任何字段形态不合规即重置为安全默认值
  if (!Array.isArray(state.completedVolumes)) state.completedVolumes = [];
  if (!state.inProgress || typeof state.inProgress !== 'object') state.inProgress = {};
  if (!state.answersByVolume || typeof state.answersByVolume !== 'object') state.answersByVolume = {};
  if (!state.computedScores || typeof state.computedScores !== 'object') state.computedScores = {};
  if (!Array.isArray(state.topValues)) state.topValues = [];
  if (!state.telemetry || typeof state.telemetry !== 'object') state.telemetry = {};
  if (!state.flags || typeof state.flags !== 'object') state.flags = {};

  state.completedVolumes = state.completedVolumes.filter((v) => ALL_VOLUMES.includes(v));
  // 初印象快照：结构纠偏
  if (!state.initialSnapshot || typeof state.initialSnapshot !== 'object') state.initialSnapshot = {};
  return state;
}

/* ------------------------------------------------------------
   存档写入
   每次作答都会调用 save()。全量 JSON.stringify + localStorage.setItem
   在 152 题全部答完后约 2.1MB 的字符串处理，是长会话里主要的抖动源。
   这里做两件事：
     1. 串行化结果缓存 —— 内容没变就不重复 stringify
     2. 合并写入 —— 用 requestIdleCallback 把写盘推到空闲帧
   ------------------------------------------------------------ */

let saveTimer = 0;
let lastSerialized = '';

function serialize(state) {
  // answersByVolume / telemetry 是对象，键序由写入顺序决定，
  // 同一份 state 的两次 stringify 结果稳定，因此可以直接比字符串。
  return JSON.stringify(state);
}

function writeNow(state) {
  const payload = serialize(state);
  if (payload === lastSerialized) return;
  try {
    localStorage.setItem(LS_KEY, payload);
    lastSerialized = payload;
  } catch (err) {
    console.warn('[storage] 写入失败', err);
  }
}

export function save(state, { immediate = false } = {}) {
  if (typeof localStorage === 'undefined') return state;
  state.updatedAt = Date.now();

  clearTimeout(saveTimer);

  if (immediate) {
    writeNow(state);
    return state;
  }

  // 空闲时再写：滚动、输入、过渡动画期间不阻塞主线程
  const idle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (fn) => setTimeout(fn, 60);

  saveTimer = setTimeout(() => {
    idle(() => writeNow(state), { timeout: 400 });
  }, 160);

  return state;
}

export function reset() {
  if (typeof localStorage === 'undefined') return emptyState();
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_META);
  return emptyState();
}

export function clearVolumeProgress(state, volId) {
  state.completedVolumes = state.completedVolumes.filter((v) => v !== volId);
  delete state.inProgress[volId];
  delete state.answersByVolume[volId];
  return state;
}

/* ------------------------------------------------------------
   主题 / 元信息
   ------------------------------------------------------------ */

export function loadTheme() {
  if (typeof localStorage === 'undefined') return 'light';
  const t = localStorage.getItem(LS_THEME);
  if (t === 'light' || t === 'dark') return t;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function saveTheme(theme) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_THEME, theme);
}

export function loadMeta() {
  if (typeof localStorage === 'undefined') return { archives: [] };
  return safeParse(localStorage.getItem(LS_META), { archives: [] });
}

export function saveMeta(meta) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_META, JSON.stringify(meta));
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------
   Base64url helpers（兼容无 padding）
   ------------------------------------------------------------ */

const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToB64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64U[b0 >> 2];
    out += B64U[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64U[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64U[b2 & 63];
  }
  return out;
}

function b64urlToBytes(str) {
  const clean = str.replace(/[^A-Za-z0-9\-_]/g, '');
  const bytes = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const idx = B64U.indexOf(ch);
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

const enc = (str) => new TextEncoder().encode(str);
const dec = (bytes) => new TextDecoder().decode(bytes);

function checksum(bytes) {
  let h = 0x1f;
  for (let i = 0; i < bytes.length; i += 1) {
    h = (h * 31 + bytes[i]) & 0xff;
  }
  return h;
}

/* ------------------------------------------------------------
   HA4- 灵魂存档码（v4 · 十六卷 127 维）

   布局（字节）：
     0        : 版本号 4
     1,2      : 已完成卷位掩码（uint16 LE，bit0=vol1 … bit15=vol16）
     3        : 年月戳高字节 —— year - 2000
     4        : 年月戳低字节 —— month (1-12)
     5        : 面具厚度 M（0-100，255 = 未知）
     6,7,8    : Top3 价值索引（0-7，255 = 空）
     9..9+N-1 : N 个维度分数（0-100，255 = 未测，顺序 = dimensions.dims）
     其后      : 昵称 UTF-8（≤12 字符，中文占 3 字节）
     末尾      : 校验和 1 byte

   时间胶囊：3、4 字节存「年月」，跨年对照时能画「过去的我 vs. 现在的我」。

   HA3- 仍可解码（老用户/老分享码），按 60 维 + 1 字节卷掩码读取，
   因为注册表前 60 位就是本源八卷的维度，位序完全对齐。
   ------------------------------------------------------------ */

const VALUE_IDS = ['freedom', 'dignity', 'wealth', 'intimacy', 'security', 'breakthrough', 'fairness', 'ease'];

function stampBytes(state) {
  const t = Number.isFinite(state.createdAt) ? new Date(state.createdAt) : new Date();
  const y = Math.max(0, Math.min(255, t.getFullYear() - 2000));
  const m = Math.max(1, Math.min(12, t.getMonth() + 1));
  return [y, m];
}

export function encodeSoulCode(state, dimOrder = []) {
  let doneMask = 0;
  ALL_VOLUMES.forEach((v, i) => {
    if ((state.completedVolumes || []).includes(v)) doneMask |= 1 << i;
  });

  const body = [4, doneMask & 0xff, (doneMask >> 8) & 0xff];

  const [yy, mm] = stampBytes(state);
  body.push(yy, mm);

  body.push(Number.isFinite(state.maskIndex) ? Math.round(state.maskIndex) : 255);

  const top3 = (state.topValues || []).slice(0, 3).map((v) => {
    const idx = VALUE_IDS.indexOf(v);
    return idx >= 0 ? idx : 255;
  });
  while (top3.length < 3) top3.push(255);
  body.push(...top3);

  const scores = dimOrder.map((id) => {
    const s = state.computedScores?.[id];
    if (!Number.isFinite(s)) return 255;
    return Math.max(0, Math.min(100, Math.round(s)));
  });
  body.push(...scores);

  const nameBytes = enc((state.nickname || '').slice(0, 12));
  body.push(...nameBytes);

  const bytes = new Uint8Array(body.length + 1);
  bytes.set(body, 0);
  bytes[body.length] = checksum(Uint8Array.from(body));

  return CODE_PREFIX + bytesToB64url(bytes);
}

function decodeHA3(payload, dimOrder) {
  const bytes = b64urlToBytes(payload);
  if (bytes.length < 67) return { ok: false, error: '存档码长度异常，可能被截断' };
  if (checksum(bytes.subarray(0, bytes.length - 1)) !== bytes[bytes.length - 1]) {
    return { ok: false, error: '校验失败，请检查是否完整复制' };
  }
  if (bytes[0] !== 3) return { ok: false, error: `不支持的存档版本 v${bytes[0]}` };

  const doneMask = bytes[1];
  const completedVolumes = ALL_VOLUMES.filter((_, i) => i < 8 && (doneMask & (1 << i)));

  const computedScores = {};
  for (let i = 0; i < 60; i += 1) {
    const b = bytes[6 + i];
    if (b !== 255 && dimOrder[i]) computedScores[dimOrder[i]] = b;
  }

  /* HA3- 老码同样可能只带分数、不带卷位（极速版的祖先形态） */
  const isExpressOnly = completedVolumes.length === 0
    && Object.values(computedScores).filter(Number.isFinite).length >= 10;

  return {
    ok: true,
    legacy: true,
    isExpressOnly,
    state: {
      version: SCHEMA_VERSION,
      nickname: dec(bytes.subarray(66, bytes.length - 1)).replace(/\u0000/g, '').trim(),
      updatedAt: Date.now(),
      createdAt: Date.now(),
      completedVolumes,
      inProgress: {},
      answersByVolume: {},
      computedScores,
      maskIndex: bytes[2] === 255 ? null : bytes[2],
      topValues: [bytes[3], bytes[4], bytes[5]]
        .filter((i) => i !== 255 && i < VALUE_IDS.length)
        .map((i) => VALUE_IDS[i]),
      initialSnapshot: {},
      flags: {},
      telemetry: {},
    },
  };
}

export function decodeSoulCode(code, dimOrder = []) {
  const raw = String(code || '').trim().replace(/\s+/g, '');
  const upper = raw.toUpperCase();

  if (upper.startsWith(LEGACY_PREFIX)) return decodeHA3(raw.slice(4), dimOrder);
  if (!upper.startsWith(CODE_PREFIX)) {
    return { ok: false, error: `存档码需以 ${CODE_PREFIX} 开头` };
  }

  const bytes = b64urlToBytes(raw.slice(4));
  const headerLen = 9;
  if (bytes.length < headerLen + 1) return { ok: false, error: '存档码长度异常，可能被截断' };

  if (checksum(bytes.subarray(0, bytes.length - 1)) !== bytes[bytes.length - 1]) {
    return { ok: false, error: '校验失败，请检查是否完整复制' };
  }
  if (bytes[0] !== 4) return { ok: false, error: `不支持的存档版本 v${bytes[0]}` };

  const dimCount = Math.max(0, Math.min(dimOrder.length, bytes.length - headerLen - 1));

  const doneMask = bytes[1] | (bytes[2] << 8);

  const year = 2000 + bytes[3];
  const month = Math.max(1, Math.min(12, bytes[4] || 1));
  const createdAt = new Date(year, month - 1, 15).getTime();

  const computedScores = {};
  for (let i = 0; i < dimCount; i += 1) {
    const b = bytes[headerLen + i];
    if (b !== 255 && dimOrder[i]) computedScores[dimOrder[i]] = b;
  }

  const tail = bytes.subarray(headerLen + dimCount, bytes.length - 1);
  const completedVolumes = ALL_VOLUMES.filter((_, i) => doneMask & (1 << i));

  /* 「只做了 28 题极速版」的合法档：一卷都没标记完成，但有≥10 个维度分。
     极速版有意不写 completedVolumes（28 题≠完成一整卷），旧版合盘却拿
     «有没有共同卷» 当门禁，于是极速用户永远被拦在外面。
     这里不拒绝任何空卷存档码（字节布局与空态往返完全不变），
     只额外打一个标记，让下游 UI 自己决定文案与放行。 */
  const finiteCount = Object.values(computedScores).filter(Number.isFinite).length;
  const isExpressOnly = completedVolumes.length === 0 && finiteCount >= 10;

  return {
    ok: true,
    legacy: false,
    isExpressOnly,
    state: {
      version: SCHEMA_VERSION,
      nickname: dec(tail).replace(/\u0000/g, '').trim(),
      updatedAt: createdAt,
      createdAt,
      stamp: `${year}-${String(month).padStart(2, '0')}`,
      completedVolumes,
      inProgress: {},
      answersByVolume: {},
      computedScores,
      maskIndex: bytes[5] === 255 ? null : bytes[5],
      topValues: [bytes[6], bytes[7], bytes[8]]
        .filter((i) => i !== 255 && i < VALUE_IDS.length)
        .map((i) => VALUE_IDS[i]),
      initialSnapshot: {},
      flags: {},
      telemetry: {},
    },
  };
}

/* ------------------------------------------------------------
   全量 JSON 备份
   ------------------------------------------------------------ */

export function exportJSON(state) {
  return JSON.stringify(
    {
      app: 'human-atlas',
      schema: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      state,
    },
    null,
    2,
  );
}

export function importJSON(text) {
  const parsed = safeParse(text, null);
  if (!parsed) return { ok: false, error: 'JSON 解析失败' };
  const state = parsed.state ?? parsed;
  if (!state || typeof state !== 'object' || !state.version) {
    return { ok: false, error: '不是有效的图谱备份文件' };
  }
  const merged = { ...emptyState(), ...state, version: SCHEMA_VERSION };
  if (!Array.isArray(merged.completedVolumes)) merged.completedVolumes = [];
  if (!merged.answersByVolume || typeof merged.answersByVolume !== 'object') merged.answersByVolume = {};
  if (!merged.inProgress || typeof merged.inProgress !== 'object') merged.inProgress = {};
  return { ok: true, state: merged };
}

/* ------------------------------------------------------------
   统计辅助
   ------------------------------------------------------------ */

export function completion(state) {
  return (state.completedVolumes?.length || 0) / ALL_VOLUMES.length;
}

export function answeredCount(state, volumeId) {
  const ans = state.answersByVolume?.[volumeId];
  return ans ? Object.keys(ans).length : 0;
}

export function hasProgress(state, volumeId) {
  const prog = state.inProgress?.[volumeId];
  if (prog && Number.isFinite(prog.currentIdx)) return true;
  return answeredCount(state, volumeId) > 0;
}

/* ------------------------------------------------------------
   初印象快照
   每卷首次完成时封存一份只读副本，重测后可以对照「本能态 / 修正态」。
   ------------------------------------------------------------ */

export function hasInitialSnapshot(state, volumeId) {
  return Boolean(state.initialSnapshot?.[volumeId]?.scores);
}

export function sealInitialSnapshot(state, volumeId, dimIds) {
  if (hasInitialSnapshot(state, volumeId)) return state.initialSnapshot[volumeId];
  const scores = {};
  for (const d of dimIds || []) {
    const v = state.computedScores?.[d];
    if (Number.isFinite(v)) scores[d] = v;
  }
  if (!Object.keys(scores).length) return null;
  state.initialSnapshot ||= {};
  state.initialSnapshot[volumeId] = {
    sealedAt: Date.now(),
    scores,
    maskIndex: Number.isFinite(state.maskIndex) ? state.maskIndex : null,
    topValues: [...(state.topValues || [])],
  };
  return state.initialSnapshot[volumeId];
}

export function initialSnapshotOf(state, volumeId) {
  return state.initialSnapshot?.[volumeId] || null;
}

/* ------------------------------------------------------------
   Schema 迁移（v5.2.3）
   ------------------------------------------------------------ */

/**
 * 旧版 load() 只做「形状纠偏」，然后无条件 `state.version = SCHEMA_VERSION`。
 * 这意味着：如果某个字段的语义变了（比如 maskIndex 从 0–100 改成 0–1），
 * 老存档会被静默读成错误值，而且版本号已经被改写成新版，再也认不出它是老档。
 *
 * 这里补一张迁移表：按 state.version 逐级跑，每步只做「语义」转换，
 * 形状纠偏交给后面的 sanitize。
 *
 * 目前 3.0 → 4.0 只是加字段（vol9–16、topValues、initialSnapshot），
 * 形状纠偏已经能覆盖，所以迁移函数是空操作 —— 但表先建好，
 * 下次真动结构时不必再想「迁移逻辑该放哪」。
 */
const MIGRATIONS = {
  /* '3.0': (state) => { ... 语义转换 ... return state; } */
};

function migrate(state) {
  const from = String(state?.version || '3.0');
  const to = SCHEMA_VERSION;
  if (from === to) return state;

  const chain = Object.keys(MIGRATIONS).sort();
  let cur = { ...state };
  for (const ver of chain) {
    /* 只跑「比当前版本新」的迁移步骤 */
    if (ver <= from) continue;
    try {
      cur = MIGRATIONS[ver](cur) || cur;
    } catch {
      /* 迁移失败时宁可丢掉这一档的语义转换，也不让整个存档打不开 */
    }
  }
  cur.version = to;
  return cur;
}

/** 清空某卷作答（保留初印象快照），用于「封存初印象并重测」
 *
 * v5.2.2：recompute() 改为「已有分数为底盘」的双源融合后，
 * 光删作答已经不能把该卷旧分洗掉（live 为空，底盘里仍然有它）。
 * 这里同步删除该卷维度的 computedScores / zScores，保证重测语义不变。
 * 字节布局与存档码编解码不受影响。
 */
export function retakeVolume(state, volumeId, dimIds = null) {
  state.completedVolumes = (state.completedVolumes || []).filter((v) => v !== volumeId);
  if (state.inProgress) delete state.inProgress[volumeId];
  if (state.answersByVolume) delete state.answersByVolume[volumeId];
  if (Array.isArray(dimIds)) {
    for (const d of dimIds) {
      if (state.computedScores) delete state.computedScores[d];
      if (state.zScores) delete state.zScores[d];
    }
  }
  return state;
}

export function snapshotForArchive(state) {
  return {
    nickname: state.nickname,
    savedAt: Date.now(),
    completedVolumes: [...(state.completedVolumes || [])],
    answersByVolume: JSON.parse(JSON.stringify(state.answersByVolume || {})),
    computedScores: { ...(state.computedScores || {}) },
    maskIndex: state.maskIndex,
    topValues: [...(state.topValues || [])],
    flags: { ...(state.flags || {}) },
    telemetry: JSON.parse(JSON.stringify(state.telemetry || {})),
  };
}
