/* ============================================================
   dossierCore.js — 前端可共享的确定性底稿 / 行为遥测取证 / BYOK 直连引擎
   · 供 Exporter / ReportView 与本地工具链共用
   · 严格零外部依赖，默认纯本地运行；BYOK 仅在用户主动点击时直连自填端点
   ============================================================ */

import { round, clamp } from './utils.js';
import {
  readingBaseline, questionChars, isBlindPick, getTelemetry,
} from './telemetry.js';

const BYOK_META_KEY = 'human-atlas::byok::meta';
const BYOK_SECRET_KEY = 'human-atlas::byok::key';

export const TIER_LABEL = (s) => (
  s >= 80 ? '极显锋芒' : s >= 60 ? '清晰倾向' : s >= 40 ? '弹性灰度' : '反向深潜'
);

/** 把不同题型的原始作答格式化为可读中文 */
export function formatChosenOption(q, value) {
  if (!q || value === undefined || value === null) return '—';
  if (q.type === 'stealth_scale') {
    return `在 7 点量表上选了第 ${value} 档（左端：${q.scale?.left || ''} ／ 右端：${q.scale?.right || ''}）`;
  }
  if (q.type === 'budget_100') {
    const map = typeof value === 'object' ? value : {};
    return (q.items || []).map((it) => `${it.label} ${map[it.key] ?? 0} 点`).join('、');
  }
  if (q.type === 'pyramid_top3') {
    const arr = Array.isArray(value) ? value : [];
    return arr
      .map((k, i) => `第${i + 1}顺位「${(q.values || []).find((v) => v.key === k)?.label || k}」`)
      .join(' → ');
  }
  const opt = (q.options || []).find((x) => x.key === value);
  return opt ? `${value}. ${opt.text}` : String(value);
}

/**
 * 从作答记录 + 静默遥测中提取可展示/可喂给大模型的「反自陈行为证据」。
 * 会自动忽略 draft 草稿与切屏/发呆脏样本。
 */
export function extractBehavioralEvidence(state = {}, volumes = {}, { limit = 3 } = {}) {
  const answersByVolume = state.answersByVolume || {};
  const telemetry = state.telemetry || {};
  const answeredQs = [];
  const rows = [];

  for (const [vid, vol] of Object.entries(volumes || {})) {
    const ansMap = answersByVolume[vid] || {};
    for (const q of vol.questions || []) {
      const rec = ansMap[q.id];
      if (!rec || rec.draft || rec.value === undefined || rec.value === null) continue;
      answeredQs.push(q);
      const tel = telemetry[q.id] || getTelemetry(state, q.id) || rec;
      const ms = Number(tel.ms ?? rec.ms) || 0;
      const changes = Number(tel.changes ?? rec.changes) || 0;
      const dirty = Boolean(tel.dirty);
      rows.push({
        q,
        qid: q.id,
        volId: vid,
        volIndex: vol.index ?? 0,
        volTitle: vol.title || vid,
        prompt: q.prompt || '',
        context: q.context || '',
        isSensitive: Boolean(q.is_sensitive),
        type: q.type,
        value: rec.value,
        choice: formatChosenOption(q, rec.value),
        ms,
        changes,
        dirty,
        blind: isBlindPick(q, { ms }),
      });
    }
  }

  const baselineMsPerChar = round(readingBaseline({ telemetry }, answeredQs), 0);
  const validRows = rows.filter((r) => !r.dirty && r.ms > 0).map((r) => {
    const chars = questionChars(r.q);
    const expectedMs = Math.max(400, baselineMsPerChar * chars);
    const ratio = round(r.ms / expectedMs, 2);
    // 矛盾显著度得分：敏感题 / 改选次数 / 相对自身基线的停留倍数
    const conflictScore = (r.isSensitive ? 1.15 : 1)
      * (Math.max(0, ratio - 1) + r.changes * 0.9);
    return {
      ...r,
      chars,
      expectedMs: Math.round(expectedMs),
      ratio,
      conflictScore: round(conflictScore, 2),
    };
  });

  const slowest = [...validRows].sort((a, b) => b.ms - a.ms).slice(0, limit);
  const mostChanged = [...validRows]
    .filter((r) => r.changes > 0)
    .sort((a, b) => b.changes - a.changes || b.ms - a.ms)
    .slice(0, limit);

  // 高张力行为证据榜：优先异常慢选或反复改选，不限制是否含敏感标记
  const spotlight = [...validRows]
    .filter((r) => r.ratio >= 1.7 || r.changes >= 1)
    .sort((a, b) => b.conflictScore - a.conflictScore)
    .slice(0, limit);

  const avgMs = validRows.length
    ? Math.round(validRows.reduce((s, r) => s + r.ms, 0) / validRows.length)
    : 0;
  const blindCount = rows.filter((r) => r.blind).length;
  const changedCount = rows.filter((r) => r.changes > 0).length;
  const dirtyCount = rows.filter((r) => r.dirty).length;

  return {
    hasTelemetry: validRows.length > 0,
    totalAnswered: rows.length,
    measuredCount: validRows.length,
    baselineMsPerChar,
    avgMs,
    blindCount,
    changedCount,
    dirtyCount,
    slowest,
    mostChanged,
    spotlight: spotlight.length ? spotlight : slowest,
  };
}

/**
 * 拼装面向大模型的确定性个人分析密文（含全维分、Z 尖峰、面具三分量、行为犹豫原文）。
 */
export function buildStructuredPrompt(report, opt = {}) {
  const {
    nickname = '',
    telemetry = {},
    answersByVolume = {},
    volumes = {},
    mask = null,
    topValues = [],
    focusQuestion = '',
    style = 'deep',
  } = opt;

  const scores = report.scores || {};
  const zs = report.zScores || {};
  const nameOf = Object.fromEntries((report.dimRows || []).map((d) => [d.id, d.name]));
  const evidence = extractBehavioralEvidence({ answersByVolume, telemetry }, volumes, { limit: 3 });

  const L = [];
  L.push('你是我的私人心理分析师。下面是我在一个分卷式潜行测评里的完整计分与行为遥测结果。');
  L.push(
    style === 'commercial'
      ? '请用克制、专业、可执行的第二人称做结构化解析，不吹捧也不过度戏剧化。'
      : '请不要复述这些数字，也不要给我泛泛的鼓励或星座鸡汤。我要的是一次穿透自我美化的深谈。',
  );
  L.push('');
  L.push('## 我的档案');
  L.push(`- 署名：${nickname || '（未署名）'}`);
  L.push(`- 已完成：${(report.completed || []).length} 卷`);
  if (Number.isFinite(report.mask?.value)) {
    L.push(`- 社会面具厚度 M：${Math.round(report.mask.value)} / 100（${report.mask.tier?.name || TIER_LABEL(report.mask.value)}）`);
    const bits = [];
    if (Number.isFinite(mask?.dsd)) bits.push(`社会期许偏移 D_sd=${Math.round(mask.dsd)}`);
    if (Number.isFinite(mask?.hlat)) bits.push(`犹豫修饰 H_lat=${Math.round(mask.hlat)}`);
    if (Number.isFinite(mask?.mirror)) bits.push(`跨卷镜像撕裂 G_mirror=${Math.round(mask.mirror)}`);
    if (bits.length) L.push(`  - ${bits.join(' · ')}`);
  }
  if (topValues.length) {
    L.push(`- 核心价值金字塔：${topValues.map((v) => v.name || v).join(' > ')}`);
  }

  const gifts = (report.gifts || []).slice(0, 4);
  const shadows = (report.shadows || []).slice(0, 3);
  if (gifts.length) L.push(`- 王牌天赋：${gifts.map((g) => g.gift_title).join(' / ')}`);
  if (shadows.length) L.push(`- 阴影预警：${shadows.map((s) => s.shadow_title).join(' / ')}`);
  if (report.archetype?.best?.name) {
    L.push(`- 原型匹配：${report.archetype.best.name}（拟合度 ${report.archetype.best.fit}）`);
  }
  if (evidence.hasTelemetry) {
    L.push(`- 阅读基线：${evidence.baselineMsPerChar} 毫秒/字 · 改选总次数：${evidence.changedCount} 题 · 快选低信度：${evidence.blindCount} 题`);
  }

  L.push('');
  L.push('## 全维得分（0–100，50 为中性；Z 是我个人内部的相对尖峰）');
  const rows = Object.entries(scores)
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => (zs[b[0]] ?? 0) - (zs[a[0]] ?? 0));
  rows.forEach(([id, v]) => {
    const z = zs[id];
    const zPart = Number.isFinite(z) ? `  Z=${z > 0 ? '+' : ''}${z}` : '';
    L.push(`- ${nameOf[id] || id}：${v} （${TIER_LABEL(v)}）${zPart}`);
  });

  if (evidence.slowest.length) {
    L.push('');
    L.push('## 我停留最久的三道题（可能是真正的内心冲突点）');
    evidence.slowest.forEach((r, i) => {
      L.push(`${i + 1}. [${r.volTitle}] ${r.context || ''}`);
      L.push(`   问：${r.prompt}`);
      L.push(`   我选：${r.choice}`);
      L.push(`   耗时：${(r.ms / 1000).toFixed(1)} 秒（约个人阅读基线的 ${r.ratio}x）`);
    });
  }

  if (evidence.mostChanged.length) {
    L.push('');
    L.push('## 我改选最多的题（可能是被压下去的那个第一反应）');
    evidence.mostChanged.forEach((r, i) => {
      L.push(`${i + 1}. ${r.prompt}`);
      L.push(`   最终选：${r.choice}`);
      L.push(`   改选次数：${r.changes}`);
    });
  }

  if (report.cross?.length) {
    L.push('');
    L.push('## 已触发跨卷化学反应');
    report.cross.slice(0, 8).forEach((c, i) => {
      L.push(`${i + 1}. 「${c.title}」（${c.tag}）：${c.insight}`);
    });
  }

  L.push('');
  L.push('## 我要你做的事');
  L.push('1. 先指出三个我在自我叙述里最可能在回避的东西，并给出支撑它的具体分数组合（不要空谈）。');
  L.push('2. 找出我得分里最矛盾的一组：哪两个高分放在同一个人身上会互相拉扯？它在我生活里可能长什么样？');
  L.push('3. 结合「停留最久」和「改选最多」的题，说出那个我没选、但其实很想选的答案是什么。');
  L.push('4. 给我三条未来 30 天可验证的小实验，每条都要能被我自己判定成功或失败。');
  L.push('5. 最后用不超过 80 字，写一句只说给我听的话。不要鼓励，要准确。');
  if (focusQuestion && focusQuestion.trim()) {
    L.push('');
    L.push(`## 我当前最想追问的现实困惑\n${focusQuestion.trim()}`);
  }

  return L.join('\n');
}

/* ------------------------------------------------------------
   浏览器端可选 BYOK 配置（不入存档码、不主动联网）
   ------------------------------------------------------------ */

export const BYOK_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'ollama', label: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:14b' },
];

export function loadByokConfig() {
  const def = { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '', rememberKey: false };
  try {
    const meta = typeof localStorage !== 'undefined'
      ? JSON.parse(localStorage.getItem(BYOK_META_KEY) || 'null')
      : null;
    const sessKey = typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem(BYOK_SECRET_KEY) || '') : '';
    const lsKey = typeof localStorage !== 'undefined' ? (localStorage.getItem(BYOK_SECRET_KEY) || '') : '';
    return {
      baseUrl: String(meta?.baseUrl || def.baseUrl),
      model: String(meta?.model || def.model),
      rememberKey: Boolean(meta?.rememberKey),
      apiKey: sessKey || (meta?.rememberKey ? lsKey : ''),
    };
  } catch {
    return def;
  }
}

export function saveByokConfig({ baseUrl, model, apiKey = '', rememberKey = false }) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BYOK_META_KEY, JSON.stringify({
        baseUrl: String(baseUrl || '').trim(),
        model: String(model || '').trim(),
        rememberKey: Boolean(rememberKey),
      }));
      if (rememberKey && apiKey) localStorage.setItem(BYOK_SECRET_KEY, String(apiKey));
      else localStorage.removeItem(BYOK_SECRET_KEY);
    }
    if (typeof sessionStorage !== 'undefined') {
      if (apiKey) sessionStorage.setItem(BYOK_SECRET_KEY, String(apiKey));
      else sessionStorage.removeItem(BYOK_SECRET_KEY);
    }
  } catch { /* 隐私模式忽略 */ }
}

export function clearByokKey() {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(BYOK_SECRET_KEY);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(BYOK_SECRET_KEY);
  } catch { /* ignore */ }
}

/**
 * 直连 OpenAI 兼容接口（支持流式 SSE 与普通 JSON 回落）。
 * 仅由用户在报告页点击「开始 AI 深谈」时调用，日常评测零网络请求。
 */
export async function streamOpenAICompatible({
  baseUrl,
  apiKey = '',
  model,
  messages,
  signal,
  onToken,
}) {
  const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!cleanBase) throw new Error('请填写 API Base URL');
  const cleanModel = String(model || '').trim();
  if (!cleanModel) throw new Error('请填写模型名称');

  const endpoint = /\/chat\/completions$/.test(cleanBase)
    ? cleanBase
    : `${cleanBase}/chat/completions`;

  const headers = { 'Content-Type': 'application/json' };
  const trimmedKey = String(apiKey || '').trim();
  if (trimmedKey) headers.Authorization = `Bearer ${trimmedKey}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: cleanModel,
      messages,
      temperature: 0.55,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${errText ? `：${errText.slice(0, 160)}` : ''}`);
  }

  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  if (!res.body || ctype.includes('application/json')) {
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || data?.message?.content || '';
    if (content && onToken) onToken(content, content);
    return content;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      try {
        const obj = JSON.parse(payload);
        const delta = obj?.choices?.[0]?.delta?.content
          ?? obj?.choices?.[0]?.message?.content
          ?? '';
        if (delta) {
          full += delta;
          if (onToken) onToken(delta, full);
        }
      } catch { /* 忽略半包 JSON 行 */ }
    }
  }
  return full;
}

export function clampScore(v) {
  return clamp(Number(v) || 0, 0, 100);
}
