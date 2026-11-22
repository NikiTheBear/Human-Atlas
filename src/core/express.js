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

/**
 * 由 EXPRESS 清单与原题库拼出一个虚拟卷对象。
 * 形态与 volumes/volX.json 完全一致，因此可以直接喂给 renderQuiz。
 */
export function buildExpressVolume(DATA, EXPRESS) {
  const ids = EXPRESS?.questions || [];
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
    volume_id: EXPRESS_BUCKET,
    index: 0,
    title: EXPRESS?.title || '初见微光',
    subtitle: EXPRESS?.subtitle || '28 题 · 约 4 分钟',
    theme_color: '#9A7B45',
    estimated_minutes: EXPRESS?.estimated_minutes || 4,
    intro: EXPRESS?.intro || '',
    dimensions: Array.from(dims),
    questions,
    isExpress: true,
  };
}

/** 该题是否已经在原卷里被答过 */
export function alreadyAnswered(state, srcVol, qid) {
  const rec = state.answersByVolume?.[srcVol]?.[qid];
  return rec && rec.value !== undefined;
}

/**
 * 进入极速模式前，把原卷里已答的题灌进虚拟桶。
 * 这样用户不会看到「已经答过的题又要再答一遍」。
 */
export function seedFromVolumes(state, expressVol) {
  const bucket = (state.answersByVolume[EXPRESS_BUCKET] ||= {});
  let seeded = 0;
  for (const q of expressVol.questions) {
    const src = state.answersByVolume?.[q._srcVol]?.[q.id];
    if (src && src.value !== undefined && bucket[q.id] === undefined) {
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
  const bucket = state.answersByVolume[EXPRESS_BUCKET] || {};
  let moved = 0;

  for (const q of expressVol.questions) {
    const rec = bucket[q.id];
    if (!rec || rec.value === undefined) continue;
    const target = (state.answersByVolume[q._srcVol] ||= {});
    // 不覆盖已有作答（用户可能先做了完整卷）
    if (target[q.id] && target[q.id].value !== undefined) continue;
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

  delete state.answersByVolume[EXPRESS_BUCKET];
  delete state.inProgress[EXPRESS_BUCKET];
  return moved;
}

/** 极速会话已答数（排除来自原卷的预填） */
export function expressProgress(state, expressVol) {
  const bucket = state.answersByVolume?.[EXPRESS_BUCKET] || {};
  const answered = expressVol.questions.filter((q) => bucket[q.id]?.value !== undefined).length;
  return { answered, total: expressVol.questions.length };
}

/** 本期极速作答覆盖了哪些维度（用于简报页脚） */
export function expressDimCoverage(expressVol) {
  const dims = new Set(expressVol.dimensions || []);
  return { count: dims.size, dims: Array.from(dims) };
}
