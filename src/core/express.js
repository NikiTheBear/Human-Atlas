/* ============================================================
   express.js — 28 题「初见微光」极速模式

   设计要点：
   1. 题目不复制，只引用原卷题目 id。作答完成后写回**原卷**的
      answersByVolume，因此与十六卷完整模式 100% 互通：
       · 极速版答过的题，进完整卷时自动显示为已答
       · 完整卷答过的题，进极速版时自动跳过
   2. 会话期间答案暂存在 state.answersByVolume.__express 这个
      虚拟桶里，避免污染任何真实卷的「进度」与「完成度」。
   3. 极速模式不写 completedVolumes，因此不会误触发跨卷解锁门槛。
   ============================================================ */

export const EXPRESS_BUCKET = '__express';

/** 主题切面微诊断（每组 10 题 · 从十六卷精选真实题目，共用写回机制） */
export const THEMATIC_PACKS = [
  {
    id: 'rel',
    title: '亲密与依恋剧本',
    badge: '亲密 · 10 题',
    subtitle: '10 题 · 约 2 分钟',
    estimated_minutes: 2,
    intro: '聚焦依恋防线、早期退让图式与亲密冲突中的真实第一反应。做完即可生成 HA4 存档码用于合盘，作答自动同步至对应正卷。',
    questions: [
      'v7_q01', 'v7_q02', 'v7_q04', 'v7_q05',
      'v13_q01', 'v13_q02', 'v13_q05',
      'v15_q01', 'v15_q02', 'v15_q05',
    ],
  },
  {
    id: 'pressure',
    title: '压力反应与情绪防御',
    badge: '抗压 · 10 题',
    subtitle: '10 题 · 约 2 分钟',
    estimated_minutes: 2,
    intro: '聚焦高压剧场、战逃冻结顺从反应、感官过载与内在完美主义陷阱。10 道高频情境题快速勾勒你的高压刹车线，作答自动同步至对应正卷。',
    questions: [
      'v7_q03', 'v7_q06', 'v8_q01', 'v8_q02', 'v8_q03',
      'v11_q01', 'v12_q02', 'v12_q05', 'v16_q01', 'v16_q04',
    ],
  },
  {
    id: 'drive',
    title: '内驱力、欲望与博弈',
    badge: '欲望 · 10 题',
    subtitle: '10 题 · 约 2 分钟',
    estimated_minutes: 2,
    intro: '聚焦精力分配、马基雅维利博弈感度、自主退路与金钱潜意识。适合快速洞察工作、财富与野心底色，作答自动同步至对应正卷。',
    questions: [
      'v3_q01', 'v3_q03', 'v3_q04', 'v3_q05',
      'v6_q01', 'v6_q02', 'v6_q03', 'v6_q05',
      'v14_q01', 'v14_q02',
    ],
  },
];

export function getThematicPack(packId) {
  return packId ? THEMATIC_PACKS.find((p) => p.id === packId) || null : null;
}

/**
 * 由 EXPRESS 清单（或主题微诊断包）与原题库拼出一个虚拟卷对象。
 * 形态与 volumes/volX.json 完全一致，因此可以直接喂给 renderQuiz。
 */
export function buildExpressVolume(DATA, EXPRESS, packId = null) {
  const pack = getThematicPack(packId);
  const ids = pack ? pack.questions : (EXPRESS?.questions || []);
  const questions = [];

  for (const vol of Object.values(DATA.volumes)) {
    for (const q of vol.questions || []) {
      if (!ids.includes(q.id)) continue;
      questions.push({ ...q, _srcVol: vol.volume_id, _srcTitle: vol.title });
    }
  }
  // 按清单顺序排列，保证每次进入顺序一致
  questions.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  const dims = new Set();
  for (const q of questions) {
    for (const o of q.options || []) {
      Object.keys(o.effects || {}).forEach((k) => dims.add(k));
    }
    Object.keys(q.effects || {}).forEach((k) => dims.add(k));
  }

  return {
    volume_id: pack ? `__express_pack_${pack.id}` : EXPRESS_BUCKET,
    packId: pack ? pack.id : null,
    packTitle: pack ? pack.title : null,
    introRoute: pack ? `#/express/pack/${pack.id}` : '#/express',
    quizRoute: pack ? `#/express/pack/${pack.id}/quiz` : '#/express/quiz',
    resultRoute: pack ? `#/express/pack/${pack.id}/result` : '#/express/result',
    index: 0,
    title: pack?.title || EXPRESS?.title || '初见微光',
    subtitle: pack?.subtitle || EXPRESS?.subtitle || '28 题 · 约 4 分钟',
    theme_color: '#9A7B45',
    estimated_minutes: pack?.estimated_minutes || EXPRESS?.estimated_minutes || 4,
    intro: pack?.intro || EXPRESS?.intro || '',
    dimensions: Array.from(dims),
    questions,
    isExpress: true,
  };
}

/** 该题是否已经在原卷里被答过 */
export function alreadyAnswered(state, srcVol, qid) {
  const rec = state.answersByVolume?.[srcVol]?.[qid];
  return Boolean(rec && !rec.draft && rec.value !== undefined);
}

/**
 * 进入极速模式前，把原卷里已答的题灌进虚拟桶。
 * 这样用户不会看到「已经答过的题又要再答一遍」。
 */
export function seedFromVolumes(state, expressVol) {
  const bucketId = expressVol?.volume_id || EXPRESS_BUCKET;
  const bucket = (state.answersByVolume[bucketId] ||= {});
  let seeded = 0;
  for (const q of expressVol.questions) {
    const src = state.answersByVolume?.[q._srcVol]?.[q.id];
    if (src && !src.draft && src.value !== undefined && bucket[q.id] === undefined) {
      bucket[q.id] = { ...src };
      seeded += 1;
    }
  }
  return seeded;
}

/**
 * 收卷：把虚拟桶里的答案按来源卷写回真实卷。
 * 写完删除虚拟桶，避免它出现在存档码维度之外的任何统计里。
 */
export function commitExpress(state, expressVol) {
  const bucketId = expressVol?.volume_id || EXPRESS_BUCKET;
  const bucket = state.answersByVolume[bucketId] || {};
  let moved = 0;

  for (const q of expressVol.questions) {
    const rec = bucket[q.id];
    if (!rec || rec.draft || rec.value === undefined) continue;
    const target = (state.answersByVolume[q._srcVol] ||= {});
    // 不覆盖已有有效作答（用户可能先做了完整卷）
    if (target[q.id] && !target[q.id].draft && target[q.id].value !== undefined) continue;
    target[q.id] = rec;
    if (state.telemetry && rec.ms) {
      state.telemetry[q.id] = {
        ...(state.telemetry[q.id] || {}),
        ms: rec.ms,
        changes: rec.changes || 0,
      };
    }
    moved += 1;
  }

  delete state.answersByVolume[bucketId];
  delete state.inProgress[bucketId];
  return moved;
}

/**
 * 清空 28 题极速版作答（含虚拟桶与已写回原卷的这批答案），
 * 并对被掏空导致不再完整的卷解除 completedVolumes 标记，保证真正能重做。
 */
export function resetExpress(state, expressVol, DATA = null) {
  const bucketId = expressVol?.volume_id || EXPRESS_BUCKET;
  delete state.answersByVolume[bucketId];
  delete state.inProgress[bucketId];
  const touchedVols = new Set();

  for (const q of expressVol.questions || []) {
    const src = state.answersByVolume?.[q._srcVol];
    if (src && q.id in src) {
      delete src[q.id];
      touchedVols.add(q._srcVol);
    }
    if (state.inProgress?.[q._srcVol]) {
      delete state.inProgress[q._srcVol];
    }
    if (state.telemetry && q.id in state.telemetry) {
      delete state.telemetry[q.id];
    }
  }

  if (Array.isArray(state.completedVolumes) && touchedVols.size) {
    state.completedVolumes = state.completedVolumes.filter((vid) => {
      if (!touchedVols.has(vid)) return true;
      const vol = DATA?.volumes?.[vid];
      if (!vol) return false;
      const ans = state.answersByVolume?.[vid] || {};
      const total = (vol.questions || []).length;
      const done = (vol.questions || []).filter((q) => ans[q.id] && !ans[q.id].draft && ans[q.id].value !== undefined).length;
      return total > 0 && done >= total;
    });
  }
}

/** 极速会话已答数（排除未完成草稿） */
export function expressProgress(state, expressVol) {
  const bucketId = expressVol?.volume_id || EXPRESS_BUCKET;
  const bucket = state.answersByVolume?.[bucketId] || {};
  const answered = expressVol.questions.filter((q) => {
    const rec = bucket[q.id];
    return Boolean(rec && !rec.draft && rec.value !== undefined);
  }).length;
  return { answered, total: expressVol.questions.length };
}

/** 本期极速作答覆盖了哪些维度（用于简报页脚） */
export function expressDimCoverage(expressVol) {
  const dims = new Set(expressVol.dimensions || []);
  return { count: dims.size, dims: Array.from(dims) };
}
