/* ============================================================
   cloudAdapter.js — 云端数据层抽象（默认不启用）

   目的：把「将来可能接 Supabase / Cloudflare D1」这件事
   收敛到一个接口里，现在不接，将来不需要重构业务代码。

   默认实现 LocalOnlyAdapter：所有方法本地静默处理，
   不发出任何网络请求，不上传任何数据。

   如果将来启用云端，需要满足三条：
     1. 用户在 UI 里明确勾选同意（consentGiven = true）
     2. 只上传维度分与面具指数，绝不上传答题原文与身份信息
     3. 管理员密钥永远不进前端仓库（用服务端函数或边缘函数代理）
   ============================================================ */

/** 统一接口 */
export const ADAPTER_INTERFACE = [
  'saveAnonymousSample',
  'fetchNormPercentiles',
  'createInviteRoom',
  'submitGuestToRoom',
];

const LS_CONSENT = 'human-atlas::consent::anonymous';
const LS_SAMPLES = 'human-atlas::local::samples';
const LS_ROOMS = 'human-atlas::local::rooms';

/* ------------------------------------------------------------
   本地实现
   ------------------------------------------------------------ */

const readJSON = (key, fallback) => {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJSON = (key, value) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 配额满了就静默放弃，本地适配器不该影响主流程 */ }
};

/** 把 state 压缩成「只含分数」的匿名样本 */
function toSample(state, dimOrder) {
  const scores = {};
  for (const d of dimOrder || []) {
    const v = state?.computedScores?.[d];
    if (Number.isFinite(v)) scores[d] = Math.round(v);
  }
  return {
    v: 1,
    at: Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
    mask: Number.isFinite(state?.maskIndex) ? Math.round(state.maskIndex) : null,
    vols: (state?.completedVolumes || []).length,
    scores,
  };
}

export const LocalOnlyAdapter = {
  name: 'local-only',

  /** 是否已获得匿名贡献同意 */
  hasConsent() {
    return readJSON(LS_CONSENT, false) === true;
  },

  setConsent(flag) {
    writeJSON(LS_CONSENT, Boolean(flag));
    return this.hasConsent();
  },

  /**
   * 保存一条匿名样本。
   * 未同意时直接返回 { skipped: true }，不做任何事。
   */
  async saveAnonymousSample(state, dimOrder) {
    if (!this.hasConsent()) return { ok: true, skipped: true, reason: 'no-consent' };
    const list = readJSON(LS_SAMPLES, []);
    const sample = toSample(state, dimOrder);
    if (!Object.keys(sample.scores).length) return { ok: false, reason: 'empty' };
    list.push(sample);
    /* 只留最近 200 条，避免把 localStorage 撑满 */
    writeJSON(LS_SAMPLES, list.slice(-200));
    return { ok: true, sample, total: Math.min(list.length, 200) };
  },

  /**
   * 返回本地样本的粗分位（用于「你在人群里的位置」）。
   * 样本不足 30 条时返回 null，避免用噪声假装统计。
   */
  async fetchNormPercentiles(dimOrder) {
    const list = readJSON(LS_SAMPLES, []);
    if (list.length < 30) return { ok: true, percentiles: null, n: list.length };

    const out = {};
    for (const d of dimOrder || []) {
      const vals = list.map((s) => s.scores?.[d]).filter(Number.isFinite).sort((a, b) => a - b);
      if (vals.length < 30) continue;
      out[d] = {
        p10: vals[Math.floor(vals.length * 0.1)],
        p50: vals[Math.floor(vals.length * 0.5)],
        p90: vals[Math.floor(vals.length * 0.9)],
      };
    }
    return { ok: true, percentiles: out, n: list.length };
  },

  /** 创建邀请房间（本地哈希方案，零网络） */
  async createInviteRoom(hostCode) {
    const rooms = readJSON(LS_ROOMS, {});
    const id = Math.random().toString(36).slice(2, 8);
    rooms[id] = { hostCode, guests: [], at: Date.now() };
    writeJSON(LS_ROOMS, rooms);
    return { ok: true, roomId: id, url: `${location.origin}${location.pathname}#/join?id=${id}` };
  },

  /** 好友加入房间 */
  async submitGuestToRoom(roomId, guestCode) {
    const rooms = readJSON(LS_ROOMS, {});
    const room = rooms[roomId];
    if (!room) return { ok: false, reason: 'room-not-found' };
    room.guests.push({ code: guestCode, at: Date.now() });
    writeJSON(LS_ROOMS, rooms);
    return { ok: true, count: room.guests.length };
  },

  /** 清空本地所有云端适配器数据（用户行权「删除我的数据」） */
  async purge() {
    writeJSON(LS_SAMPLES, []);
    writeJSON(LS_ROOMS, {});
    writeJSON(LS_CONSENT, false);
    return { ok: true };
  },
};

/* ------------------------------------------------------------
   将来可插拔的服务端实现骨架（现在不启用）
   ------------------------------------------------------------ */

/**
 * @param {string} endpoint 例如 https://xxx.supabase.co/functions/v1/atlas
 * @returns 与 LocalOnlyAdapter 同接口的对象
 */
export function createRemoteAdapter(endpoint) {
  const call = async (action, payload) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    });
    if (!res.ok) throw new Error(`remote ${action} failed: ${res.status}`);
    return res.json();
  };

  return {
    name: 'remote',
    hasConsent: () => LocalOnlyAdapter.hasConsent(),
    setConsent: (f) => LocalOnlyAdapter.setConsent(f),
    saveAnonymousSample: (state, dimOrder) => (
      LocalOnlyAdapter.hasConsent()
        ? call('sample', toSample(state, dimOrder))
        : Promise.resolve({ ok: true, skipped: true })
    ),
    fetchNormPercentiles: (dimOrder) => call('percentiles', { dimOrder }),
    createInviteRoom: (hostCode) => call('room.create', { hostCode }),
    submitGuestToRoom: (roomId, guestCode) => call('room.join', { roomId, guestCode }),
    purge: () => call('purge', {}),
  };
}

/* ------------------------------------------------------------
   当前生效的适配器
   ------------------------------------------------------------ */

let current = LocalOnlyAdapter;

export function getAdapter() {
  return current;
}

export function setAdapter(next) {
  current = next || LocalOnlyAdapter;
  return current;
}

/** 给 UI 用的知情同意文案 */
export const CONSENT_COPY = {
  title: '是否愿意匿名贡献维度分',
  body: '勾选后，你的 127 个维度分与面具厚度会被压缩成一条匿名样本，只保存在这台设备上。'
    + '不包含任何答题原文、昵称或身份信息。你随时可以关闭并清空。',
  accept: '我愿意匿名贡献',
  decline: '暂不参与',
};
