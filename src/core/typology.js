/* ============================================================
   typology.js — 单卷分型引擎

   十六卷各自有一套专业心理结构分型，由该卷已测维度动态组合生成，
   零硬编码假结果。与 36 个跨卷原型彻底分家：
     · 单卷报告 → buildVolumeTypology()
     · 全息报告 → matchArchetype()（36 原型 + 覆盖率闸门）
   ============================================================ */

import { round, clamp } from './utils.js';

const top = (map, ids) => ids
  .map((id) => ({ id, v: map[id] }))
  .filter((x) => Number.isFinite(x.v))
  .sort((a, b) => b.v - a.v);

const low = (map, ids) => top(map, ids).slice().reverse();

/** 按 Z 分取最高 / 最低两极 */
const zTop = (z, ids, n = 1) => ids
  .map((id) => ({ id, z: z?.[id] }))
  .filter((x) => Number.isFinite(x.z))
  .sort((a, b) => b.z - a.z)
  .slice(0, n);

/* ------------------------------------------------------------
   各卷分型生成器
   ------------------------------------------------------------ */

const BUILDERS = {
  /* Vol.1 · 主导美德 × 主导原罪张力型 */
  vol1(S, Z, L) {
    const virtues = ['virtue_humility', 'virtue_charity', 'virtue_chastity', 'virtue_kindness', 'virtue_temperance', 'virtue_patience', 'virtue_diligence'];
    const sins = ['sin_pride', 'sin_greed', 'sin_lust', 'sin_envy', 'sin_gluttony', 'sin_wrath', 'sin_sloth'];
    const v = top(S, virtues)[0];
    const s = top(S, sins)[0];
    if (!v && !s) return null;
    const vn = L[v?.id] || '';
    const sn = L[s?.id] || '';
    const tension = Math.abs((v?.v ?? 50) - (s?.v ?? 50));
    return {
      title: v && s ? `${vn} × ${sn}张力型` : `${vn || sn}主导型`,
      tag: v && s
        ? `主导美德「${vn}」与主导驱力「${sn}」相差 ${Math.round(tension)} 分，两股力量互为约束`
        : '本卷维度尚不足以构成张力结构',
      anchors: [v, s].filter(Boolean),
    };
  },

  /* Vol.2 · 大五高显特质双核型（取 Z 最高的正负两极） */
  vol2(S, Z, L) {
    const ids = ['big5_open', 'big5_aesthetic', 'big5_order', 'big5_industry', 'big5_social', 'big5_assert', 'big5_compassion', 'big5_compliance', 'big5_alert', 'big5_rumination'];
    const hi = zTop(Z, ids, 1)[0];
    const lo = zTop(Z, ids.map((d) => d), ids.length)
      .filter((x) => x.id !== hi?.id)
      .sort((a, b) => a.z - b.z)[0];
    if (!hi) return null;
    const hn = L[hi.id] || '';
    const ln = lo ? L[lo.id] : '';
    return {
      title: lo ? `${hn}高显 × ${ln}低显双核型` : `${hn}单极高显型`,
      tag: lo
        ? `本卷 Z 尖峰落在「${hn}」，最深的反向偏离是「${ln}」`
        : `本卷仅有一个显著尖峰「${hn}」`,
      anchors: [{ id: hi.id, v: S[hi.id] }, lo ? { id: lo.id, v: S[lo.id] } : null].filter(Boolean),
    };
  },

  /* Vol.3 · 光暗博弈位型 */
  vol3(S, Z, L) {
    const light = ['light_humanism', 'light_kant', 'light_faith'];
    const dark = ['dark_mach', 'dark_narc', 'dark_psycho'];
    const l = top(S, light)[0];
    const d = top(S, dark)[0];
    if (!l && !d) return null;
    const lAvg = light.map((x) => S[x]).filter(Number.isFinite);
    const dAvg = dark.map((x) => S[x]).filter(Number.isFinite);
    const lv = lAvg.length ? lAvg.reduce((a, b) => a + b, 0) / lAvg.length : 50;
    const dv = dAvg.length ? dAvg.reduce((a, b) => a + b, 0) / dAvg.length : 50;

    let title;
    if (lv >= 60 && dv >= 60) title = '光暗并存型 · 有底线的现实主义者';
    else if (lv >= 60 && dv < 45) title = '光明主导型 · 原则先行者';
    else if (lv < 45 && dv >= 60) title = '暗面策略型 · 结果优先者';
    else if (lv < 45 && dv < 45) title = '低度博弈型 · 不参与牌局者';
    else title = '光暗均衡型 · 情境切换者';

    if (Number.isFinite(S.covert_control) && S.covert_control >= 60) title += ' · 隐性掌控';
    return {
      title,
      tag: `光明三角 ${Math.round(lv)} / 黑暗三角 ${Math.round(dv)}，最高单项分别是「${L[l?.id] || '—'}」与「${L[d?.id] || '—'}」`,
      anchors: [l, d].filter(Boolean),
    };
  },

  /* Vol.4 · 三观坐标系定型 */
  vol4(S, Z, L) {
    const wv = top(S, ['wv_nature', 'wv_causal', 'wv_social'])[0];
    const lv = top(S, ['lv_happiness', 'lv_suffering', 'lv_anchor'])[0];
    const val = top(S, ['val_moral', 'val_boundary', 'val_standard'])[0];
    if (!wv && !lv && !val) return null;
    return {
      title: `${L[wv?.id] || '世界观未明'} × ${L[lv?.id] || '人生观未明'} × ${L[val?.id] || '价值观未明'}`,
      tag: '三观坐标由世界观、人生观、道德算法三个轴各自的最强项拼成',
      anchors: [wv, lv, val].filter(Boolean),
    };
  },

  /* Vol.5 · 认知决策架构型 */
  vol5(S, Z, L) {
    const a = top(S, ['cog_global', 'cog_diverge', 'cog_logic', 'cog_ambiguity', 'cog_independent', 'cog_speed'])[0];
    const b = top(S, ['cog_global', 'cog_diverge', 'cog_logic', 'cog_ambiguity', 'cog_independent', 'cog_speed'])[1];
    if (!a) return null;
    return {
      title: b ? `${L[a.id]} × ${L[b.id]}型` : `${L[a.id]}主导型`,
      tag: '前两位认知偏好构成你的默认决策架构，其余四项是备用通道',
      anchors: [a, b].filter(Boolean),
    };
  },

  /* Vol.6 · 核心驱动力双引擎 */
  vol6(S, Z, L) {
    const ids = ['mot_autonomy', 'mot_mastery', 'mot_belonging', 'mot_security', 'mot_purpose', 'mot_hedonism'];
    const a = top(S, ids)[0];
    const b = top(S, ids)[1];
    if (!a) return null;
    return {
      title: b ? `${L[a.id]} × ${L[b.id]}双驱` : `${L[a.id]}单引擎`,
      tag: b ? `你在「${L[a.id]}」上的投入明显高于其他，其次是「${L[b.id]}」` : '仅一个动机显著突出',
      anchors: [a, b].filter(Boolean),
    };
  },

  /* Vol.7 · 依恋类型 × 首选防御 */
  vol7(S, Z, L) {
    const anx = S.att_anxiety;
    const avo = S.att_avoidance;
    const defs = ['def_intellectual', 'def_detach', 'def_sublimate', 'def_attack', 'def_fawn', 'def_project'];
    const df = top(S, defs)[0];
    if (!Number.isFinite(anx) && !Number.isFinite(avo)) return null;

    const a = Number.isFinite(anx) ? anx : 50;
    const v = Number.isFinite(avo) ? avo : 50;
    let style;
    if (a < 52 && v < 52) style = '安全型';
    else if (a >= 52 && v < 52) style = '焦虑型';
    else if (a < 52 && v >= 52) style = '回避型';
    else style = '恐惧矛盾型';

    return {
      title: df ? `${style} × ${L[df.id]}` : style,
      tag: `依恋焦虑 ${Math.round(a)} / 依恋回避 ${Math.round(v)}，最常用的是「${L[df?.id] || '—'}」`,
      anchors: [df].filter(Boolean),
    };
  },

  /* Vol.8 · 主导压力退行态 × 社会防卫层档位 */
  vol8(S, Z, L, ctx) {
    const p = ctx?.pressure;
    const m = ctx?.mask;
    if (!p && !Number.isFinite(m)) return null;
    const names = {
      burst: '爆发火', cutoff: '断联冰', cold: '黑化刃', collapse: '坍塌雾',
    };
    const tier = Number.isFinite(m) ? (m < 30 ? '本真赤诚层' : m < 60 ? '体面调节层' : '精密防卫层') : '';
    return {
      title: `${p ? names[p.key] || p.key : '退行态未明'} × ${tier || '面具未测'}`,
      tag: p ? `高压下有 ${p.share}% 的作答落在「${names[p.key] || p.key}」` : '本卷作答尚不足以判断退行态',
      anchors: [],
    };
  },

  /* Vol.9 · 荣格阳面双功能栈 */
  vol9(S, Z, L) {
    const ids = ['jung_te', 'jung_ti', 'jung_fe', 'jung_fi', 'jung_ne', 'jung_ni', 'jung_se', 'jung_si'];
    const r = top(S, ids);
    if (r.length < 2) return null;
    const short = (id) => ({ jung_te: 'Te', jung_ti: 'Ti', jung_fe: 'Fe', jung_fi: 'Fi', jung_ne: 'Ne', jung_ni: 'Ni', jung_se: 'Se', jung_si: 'Si' }[id] || id);
    const third = r[2];
    return {
      title: `${short(r[0].id)}–${short(r[1].id)} 主导认知栈`,
      tag: third
        ? `第三功能 ${short(third.id)} 还在发育，第五至第八位构成你的阴影位`
        : '功能栈信息尚不完整',
      anchors: [r[0], r[1]].filter(Boolean),
    };
  },

  /* Vol.10 · D&D 九宫格阵营 */
  vol10(S, Z, L) {
    const o = S.dd_order;
    const g = S.dd_good;
    if (!Number.isFinite(o) && !Number.isFinite(g)) return null;
    const O = Number.isFinite(o) ? o : 50;
    const G = Number.isFinite(g) ? g : 50;

    let orderTag;
    if (O >= 62) orderTag = '守序';
    else if (O <= 38) orderTag = '混乱';
    else orderTag = '中立';

    let goodTag;
    if (G >= 62) goodTag = '善良';
    else if (G <= 38) goodTag = '冷硬';
    else goodTag = '中立';

    const map = {
      '守序善良': 'Lawful Good', '守序中立': 'Lawful Neutral', '守序冷硬': 'Lawful Evil',
      '中立善良': 'Neutral Good', '中立中立': 'True Neutral', '中立冷硬': 'Neutral Evil',
      '混乱善良': 'Chaotic Good', '混乱中立': 'Chaotic Neutral', '混乱冷硬': 'Chaotic Evil',
    };
    const name = `${orderTag}${goodTag === '中立' ? '中立' : goodTag}`;
    return {
      title: `${name} · ${map[name] || 'True Neutral'}`,
      tag: `秩序 ${Math.round(O)} / 良善 ${Math.round(G)}，坐标只是语言，不是判决书`,
      anchors: [],
    };
  },

  /* Vol.11 · 第一哲学底色 × 最高道德开关 */
  vol11(S, Z, L) {
    const phils = ['phil_stoic', 'phil_existential', 'phil_absurd', 'phil_cynic', 'phil_pragmatic', 'phil_epicurean', 'phil_nihilism', 'phil_humanist'];
    const mfts = ['mft_care', 'mft_fairness', 'mft_loyalty', 'mft_authority', 'mft_sanctity', 'mft_liberty'];
    const p = top(S, phils)[0];
    const m = top(S, mfts)[0];
    if (!p && !m) return null;
    return {
      title: `${L[p?.id] || '哲学未明'} × ${L[m?.id] || '道德未明'}底线派`,
      tag: '第一哲学是你解释痛苦的语言，最高道德开关是你无法让步的那一处',
      anchors: [p, m].filter(Boolean),
    };
  },

  /* Vol.12 · 九型主型 × 本能副型 */
  vol12(S, Z, L) {
    const enns = ['enn_1', 'enn_2', 'enn_3', 'enn_4', 'enn_5', 'enn_6', 'enn_7', 'enn_8', 'enn_9'];
    const insts = ['inst_sp', 'inst_sx', 'inst_so'];
    const e = top(S, enns)[0];
    const i = top(S, insts)[0];
    if (!e && !i) return null;
    const instLabel = { inst_sp: '自保型 (SP)', inst_sx: '一对一型 (SX)', inst_so: '社交型 (SO)' };
    return {
      title: `${L[e?.id] || '主型未明'}${i ? ` · ${instLabel[i.id]}` : ''}`,
      tag: e ? `「${L[e.id]}」这条恐惧轴在你身上最响，本能默认落在${instLabel[i?.id] || '未明'}` : '',
      anchors: [e, i].filter(Boolean),
    };
  },

  /* Vol.13 · 核心早期图式 */
  vol13(S, Z, L) {
    const ids = ['schema_abandonment', 'schema_deprivation', 'schema_defect', 'schema_mistrust', 'schema_isolation', 'schema_std', 'schema_sacrifice', 'schema_approval', 'schema_entitlement', 'schema_negativity'];
    const r = top(S, ids);
    if (!r.length) return null;
    return {
      title: r[1] ? `${L[r[0].id]}主导 · 兼${L[r[1].id]}` : `${L[r[0].id]}主导`,
      tag: `最高烈度图式是「${L[r[0].id]}」（${Math.round(r[0].v)}），它曾经保护过你，现在开始收费`,
      anchors: r.slice(0, 2),
    };
  },

  /* Vol.14 · 主导金钱脚本 × 主导时间观 */
  vol14(S, Z, L) {
    const moneys = ['money_avoid', 'money_worship', 'money_status', 'money_vigilance'];
    const times = ['time_past_neg', 'time_past_pos', 'time_present_hed', 'time_present_fate', 'time_future'];
    const m = top(S, moneys)[0];
    const t = top(S, times)[0];
    if (!m && !t) return null;
    return {
      title: `${L[m?.id] || '脚本未明'} × ${L[t?.id] || '时间观未明'}`,
      tag: '金钱脚本决定你如何避险，时间观决定你把力气放在哪一段时间',
      anchors: [m, t].filter(Boolean),
    };
  },

  /* Vol.15 · TKI 首选冲突模式 × PAC 主导自我态 */
  vol15(S, Z, L) {
    const tkis = ['tki_competing', 'tki_collaborating', 'tki_compromising', 'tki_avoiding', 'tki_accommodating'];
    const pacs = ['pac_parent', 'pac_adult', 'pac_child'];
    const t = top(S, tkis)[0];
    const p = top(S, pacs)[0];
    if (!t && !p) return null;
    return {
      title: `${L[t?.id] || '模式未明'} × ${L[p?.id] || '自我态未明'}`,
      tag: '冲突模式是你做的事，自我态是你说话时的身份',
      anchors: [t, p].filter(Boolean),
    };
  },

  /* Vol.16 · HSP × HSS 四象限 */
  vol16(S, Z, L) {
    const hsp = [S.hsp_sensory, S.hsp_emotional].filter(Number.isFinite);
    const hss = [S.hss_novelty, S.hss_intensity].filter(Number.isFinite);
    if (!hsp.length || !hss.length) return null;
    const a = hsp.reduce((x, y) => x + y, 0) / hsp.length;
    const b = hss.reduce((x, y) => x + y, 0) / hss.length;

    let title;
    if (a >= 52 && b >= 52) title = '高敏高刺激矛盾体 (HSS/HSP)';
    else if (a >= 52 && b < 52) title = '深海型 · 高超敏低寻求';
    else if (a < 52 && b >= 52) title = '引擎型 · 低敏高寻求';
    else title = '稳态型 · 低敏低寻求';

    return {
      title,
      tag: `感官敏锐 ${Math.round(a)} / 刺激寻求 ${Math.round(b)}，四象限里没有更健康的一格`,
      anchors: [],
    };
  },
};

/* ------------------------------------------------------------
   对外接口
   ------------------------------------------------------------ */

/**
 * @param {string} volId
 * @param {Object} scores  本卷相关维度分数字典
 * @param {Object} zScores 本卷相关维度 Z 分（可缺失）
 * @param {Object} dimMap  DIM_MAP（取中文名）
 * @param {Object} ctx     { pressure, mask }
 * @returns {{ title, tag, anchors } | null}
 */
export function buildVolumeTypology(volId, scores, zScores, dimMap, ctx = {}) {
  const build = BUILDERS[volId];
  if (!build) return null;

  const L = {};
  for (const [id, meta] of Object.entries(dimMap || {})) L[id] = meta?.name || id;

  const out = build(scores || {}, zScores || {}, L, ctx);
  if (!out) return null;

  return {
    title: out.title,
    tag: out.tag,
    anchors: (out.anchors || []).map((a) => ({
      id: a.id,
      name: L[a.id] || a.id,
      score: round(clamp(Number(a.v) || 0, 0, 100), 0),
    })),
  };
}

export const TYPOLOGY_VOLUMES = Object.keys(BUILDERS);
