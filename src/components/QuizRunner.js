/* ============================================================
   QuizRunner.js — 答题舱
   · 5 种潜行题型渲染
   · 返回修改 + 改选计数
   · 每 6 题一句极简哲思微缓冲
   · 键盘快捷键 1-4 / Backspace
   · 逐题即时存档
   ============================================================ */

import { el, clamp, toast } from '../core/utils.js';
import { save, answeredCount, sealInitialSnapshot } from '../core/storage.js';
import { recordAnswer, addChange, createFocusTimer } from '../core/telemetry.js';

const INTERLUDES = [
  '你刚才的选择里，藏着你不常说出口的那部分。',
  '不必急着解释自己。继续。',
  '有些偏好不是理由充足的，它只是你。',
  '人对自己的描述，常常比对别人的观察更客气。',
  '再往下一点，面具会变得很薄。',
  '到这里，答案开始像你了。',
  '没有更好的那一面，只有更真实的那一面。',
  '你已经走得比大多数愿意面对自己的人都远。',
];

const TYPE_LABEL = {
  forced_choice: '等值迫选',
  stealth_scale: '潜行量表',
  impulse_3s: '三秒直觉',
  budget_100: '筹码分配',
  pyramid_top3: '价值金字塔',
};

const TYPE_HINT = {
  impulse_3s: '凭第一直觉作答，不必权衡',
  stealth_scale: '',
  forced_choice: '',          // 按选项数量动态生成，见 hintOf()
  budget_100: '总分必须恰好为 100',
  pyramid_top3: '顺序本身就是答案',
};

/**
 * 题目提示语。
 * 选择题的「两项 / 每项」必须跟着选项数量走 —— 四个选项下面写「两项都可以是体面的」
 * 会立刻露怯，是很容易被一眼识破的穿帮。
 */
function hintOf(q) {
  if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
    const n = (q.options || []).length;
    if (q.type === 'impulse_3s') return '凭第一直觉作答，不必权衡';
    if (n === 2) return '两点都可以是体面的，选更贴近你的那个';
    if (n === 3) return '三种都说得通，选更像你的那个';
    return '每个选项都是体面的，选更贴近你的那个';
  }
  return TYPE_HINT[q.type] || '';
}

/* ------------------------------------------------------------
   卷首
   ------------------------------------------------------------ */

export function renderVolumeIntro(root, ctx) {
  const { App, DATA, volId, go: nav } = ctx;
  const vol = DATA.volumes[volId];
  if (!vol) { nav('#/'); return; }

  const state = App.state;
  const done = state.completedVolumes.includes(volId);
  const ans = answeredCount(state, volId);
  const total = vol.questions.length;

  root.classList.add('view');
  const wrap = el('div', { class: 'vol-intro', style: { '--vc': vol.theme_color } });

  wrap.appendChild(el('div', { class: 'vol-intro__no', text: `VOL. ${String(vol.index).padStart(2, '0')} / ${String(Object.keys(DATA.volumes).length).padStart(2, '0')}` }));
  wrap.appendChild(el('h1', { text: vol.title }));
  wrap.appendChild(el('div', { class: 'vol-intro__sub', text: vol.subtitle }));
  wrap.appendChild(el('p', { class: 'vol-intro__desc', text: vol.intro || '' }));

  const stats = el('div', { class: 'vol-intro__stats' }, [
    el('div', { class: 'vol-intro__stat' }, [
      el('b', { text: `${total}` }),
      el('span', { text: '题目' }),
    ]),
    el('div', { class: 'vol-intro__stat' }, [
      el('b', { text: `约 ${vol.estimated_minutes}` }),
      el('span', { text: '分钟' }),
    ]),
    el('div', { class: 'vol-intro__stat' }, [
      el('b', { text: `${vol.dimensions.length}` }),
      el('span', { text: '维度' }),
    ]),
  ]);
  wrap.appendChild(stats);

  const actions = el('div', {
    style: { display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' },
  }, [
    el('button', {
      class: 'btn btn--solid',
      type: 'button',
      text: done ? '重新作答' : ans > 0 ? `继续（已答 ${ans}/${total}）` : '开始作答',
      onclick: () => { nav(`#/quiz/${volId}`); },
    }),
    done ? el('a', { class: 'btn', href: `#/report/${volId}`, text: '查看本卷报告' }) : null,
    el('a', { class: 'btn btn--ghost', href: '#/', text: '返回大厅' }),
  ]);
  wrap.appendChild(actions);

  wrap.appendChild(el('p', {
    class: 'notice',
    style: { textAlign: 'left', maxWidth: '46ch', margin: '30px auto 0' },
    html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/></svg><span>每答一题即时保存。中途离开或刷新页面，回来会停在同一题。作答耗时会被静默记录，仅用于校准你的作答信度。</span>',
  }));

  root.appendChild(wrap);
}

/* ------------------------------------------------------------
   题型渲染
   ------------------------------------------------------------ */

function renderForcedChoice(q, value, onPick, vc) {
  const list = el('div', { class: 'opt-list' });

  (q.options || []).forEach((o, i) => {
    const isSel = value === o.key;
    const btn = el('button', {
      class: `opt${isSel ? ' is-sel' : ''}`,
      type: 'button',
      onclick: () => onPick(o.key),
    }, [
      el('span', { class: 'opt__key', text: o.key }),
      el('span', { class: 'opt__text', text: o.text }),
    ]);
    btn.dataset.k = o.key;
    list.appendChild(btn);
  });

  return list;
}

/** 7 档语义：让用户在悬停 / 选中时立刻知道这一档意味着什么 */
const SCALE_WORDS = [
  '强烈偏向左侧',
  '明显偏向左侧',
  '略偏左侧',
  '居中平衡',
  '略偏右侧',
  '明显偏向右侧',
  '强烈偏向右侧',
];

function renderStealthScale(q, value, onPick) {
  // 当前已选档位：唯一事实来源。悬停只做「预览」，不改这个值。
  let selected = Number.isFinite(Number(value)) ? Number(value) : null;
  let hovering = null;

  const wrap = el('div', { class: 'scale-wrap' });

  const poles = el('div', { class: 'scale-poles' }, [
    el('div', { class: 'scale-pole', text: q.scale?.left || '偏向左侧' }),
    el('div', { class: 'scale-pole scale-pole--r', text: q.scale?.right || '偏向右侧' }),
  ]);
  wrap.appendChild(poles);

  const dots = el('div', { class: 'scale-dots' });
  const caption = el('div', { class: 'scale-caption' });

  /* 提示文字只能由「悬停预览」或「已选档位」推导，不允许留任何残留状态。
     早期版本只监听 pointerenter，键盘按 6 时 caption 会停在之前悬停的第 3 档，
     出现「选中第 6 个点却写略偏左侧」的错位。 */
  const syncCaption = () => {
    const shown = hovering !== null ? hovering : selected;
    if (shown === null) {
      caption.textContent = '在两端之间，点选更贴近你的位置';
      caption.classList.remove('is-live');
    } else {
      caption.textContent = SCALE_WORDS[shown - 1] || '';
      caption.classList.add('is-live');
    }
  };

  const syncDots = () => {
    dots.querySelectorAll('.scale-dot').forEach((d) => {
      d.classList.toggle('is-sel', Number(d.dataset.k) === selected);
    });
  };

  for (let i = 1; i <= 7; i += 1) {
    const dot = el('button', {
      class: `scale-dot${selected === i ? ' is-sel' : ''}`,
      type: 'button',
      'aria-label': `第 ${i} 档：${SCALE_WORDS[i - 1]}`,
      onclick: () => onPick(i),
    }, [el('span')]);
    dot.dataset.k = String(i);
    dot.addEventListener('pointerenter', () => { hovering = i; syncCaption(); });
    dot.addEventListener('pointerleave', () => { hovering = null; syncCaption(); });
    dot.addEventListener('focus', () => { hovering = i; syncCaption(); });
    dot.addEventListener('blur', () => { hovering = null; syncCaption(); });
    dots.appendChild(dot);
  }
  wrap.appendChild(dots);

  /* 对外暴露：鼠标点击、键盘数字键、回退修改都走这条路，
     保证「选中态」与「提示文字」永远同步。 */
  wrap.setScale = (next) => {
    const n = Number(next);
    selected = Number.isFinite(n) && n >= 1 && n <= 7 ? n : null;
    hovering = null;
    syncDots();
    syncCaption();
  };

  // 容器整体离开时兜底清空悬停预览，避免极端情况下残留
  wrap.addEventListener('pointerleave', () => { hovering = null; syncCaption(); });

  syncCaption();
  wrap.appendChild(caption);

  return wrap;
}

function renderImpulse(q, value, onPick) {
  let locked = value !== undefined && value !== null;
  const holder = el('div', { class: `impulse-halo${locked ? ' is-locked' : ' is-live'}` });

  const meter = el('div', { class: 'impulse-meter' }, [el('i')]);
  holder.appendChild(meter);

  const hintText = el('span', {
    text: locked
      ? '已捕捉第一直觉（直觉题为防反复润色已锁定）'
      : '这是发生在头三秒的事，不是深思熟虑后的结论',
  });
  const hint = el('div', { class: 'q-hint' }, [
    el('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' }),
    hintText,
  ]);
  holder.appendChild(hint);

  let fc = null;
  let unlockBtn = null;

  const syncLock = (pickedVal) => {
    holder.classList.toggle('is-locked', locked);
    if (locked) holder.classList.remove('is-live');
    hintText.textContent = locked
      ? '已捕捉第一直觉（直觉题为防反复润色已锁定）'
      : '已临时解锁：请重选你的真实第一反应（本次修改将记入摇摆校准）';
    if (fc) {
      fc.querySelectorAll('.opt').forEach((btn) => {
        btn.disabled = locked;
        if (pickedVal !== undefined) {
          btn.classList.toggle('is-sel', btn.dataset.k === String(pickedVal));
        }
      });
    }
    if (unlockBtn) {
      unlockBtn.style.display = locked ? 'inline-flex' : 'none';
    }
  };

  fc = renderForcedChoice(q, value, (pickedVal) => {
    if (locked) return;
    locked = true;
    syncLock(pickedVal);
    onPick(pickedVal);
  });
  holder.appendChild(fc);

  unlockBtn = el('button', {
    type: 'button',
    class: 'btn btn--xs btn--ghost impulse-unlock',
    text: '手滑改选（记入摇摆校准）',
    onclick: () => {
      locked = false;
      syncLock();
    },
  });
  holder.appendChild(el('div', { class: 'impulse-foot' }, [unlockBtn]));

  syncLock(value);

  const timer = setTimeout(() => holder.classList.remove('is-live'), 5400);
  holder.isLocked = () => locked;
  holder.lockWith = (pickedVal) => {
    locked = true;
    syncLock(pickedVal);
  };
  holder.dispose = () => clearTimeout(timer);
  return holder;
}

function renderBudget(q, value, onChange) {
  const map = {};
  (q.items || []).forEach((it) => {
    map[it.key] = Number(value?.[it.key] ?? 0);
  });

  const wrap = el('div', { class: 'budget' });

  const totalBox = el('div', { class: 'budget__total' });
  const totalVal = el('b', { text: '0' });
  const totalUnit = el('span', { text: '/ 100 点' });
  const totalMsg = el('div', { class: 'budget__msg', text: '' });
  totalBox.appendChild(totalVal);
  totalBox.appendChild(totalUnit);
  totalBox.appendChild(totalMsg);
  wrap.appendChild(totalBox);

  const rows = [];

  const update = (notify = true) => {
    const total = Object.values(map).reduce((a, b) => a + Number(b || 0), 0);
    totalVal.textContent = `${total}`;
    totalBox.className = `budget__total ${total === 100 ? 'is-ok' : 'is-off'}`;
    totalMsg.textContent = total === 100
      ? '已用尽'
      : total > 100
        ? `超出 ${total - 100} 点`
        : `还剩 ${100 - total} 点`;
    rows.forEach((r) => { r.val.textContent = `${map[r.key]}`; });
    if (notify) onChange({ ...map });
  };

  // 把某一项设为 next：超出 100 时按其它非零项当前占比等比回吸；不足 100 时保留余量由用户分配
  const applyValue = (key, next) => {
    map[key] = Math.max(0, Math.min(100, Math.round(next)));

    const total = Object.values(map).reduce((a, b) => a + Number(b || 0), 0);
    if (total > 100) {
      let over = total - 100;
      const others = (q.items || []).map((x) => x.key).filter((k) => k !== key && map[k] > 0);
      const othersSum = others.reduce((acc, k) => acc + map[k], 0);
      if (othersSum > 0) {
        let taken = 0;
        for (const k of others) {
          const share = Math.min(map[k], Math.floor((map[k] / othersSum) * over));
          map[k] -= share;
          taken += share;
        }
        let rem = over - taken;
        for (const k of others) {
          if (rem <= 0) break;
          const extra = Math.min(map[k], rem);
          map[k] -= extra;
          rem -= extra;
        }
      }
    }
    rows.forEach((r) => { if (r.input.value !== String(map[r.key])) r.input.value = String(map[r.key]); });
    update(true);
  };

  (q.items || []).forEach((it) => {
    const val = el('div', { class: 'budget-row__val', text: `${map[it.key]}` });

    const input = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(map[it.key] || 0),
      'aria-label': it.label,
    });

    input.addEventListener('input', () => applyValue(it.key, Number(input.value)));

    const dec = el('button', {
      class: 'budget-nudge',
      type: 'button',
      text: '−5',
      'aria-label': `${it.label} 减 5`,
      onclick: () => applyValue(it.key, map[it.key] - 5),
    });

    const inc = el('button', {
      class: 'budget-nudge',
      type: 'button',
      text: '+5',
      'aria-label': `${it.label} 加 5`,
      onclick: () => applyValue(it.key, map[it.key] + 5),
    });

    const row = el('div', { class: 'budget-row' }, [
      el('div', { class: 'budget-row__label', text: it.label }),
      el('div', { class: 'budget-row__track' }, [
        dec,
        el('div', { class: 'budget-row__range' }, [input]),
        inc,
      ]),
      val,
    ]);

    rows.push({ key: it.key, input, val, row });
    wrap.appendChild(row);
  });

  update(false);

  const tools = el('div', {
    style: { display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap' },
  }, [
    el('button', {
      class: 'btn btn--xs',
      type: 'button',
      text: '平均分配',
      onclick: () => {
        const n = (q.items || []).length;
        const base = Math.floor(100 / n);
        const rest = 100 - base * n;
        (q.items || []).forEach((it, i) => {
          map[it.key] = base + (i < rest ? 1 : 0);
        });
        rows.forEach((r) => { r.input.value = String(map[r.key]); });
        update(true);
      },
    }),
    el('button', {
      class: 'btn btn--xs',
      type: 'button',
      text: '全部清零',
      onclick: () => {
        (q.items || []).forEach((it) => { map[it.key] = 0; });
        rows.forEach((r) => { r.input.value = '0'; });
        update(true);
      },
    }),
  ]);
  wrap.appendChild(tools);

  return wrap;
}

function renderPyramid(q, value, onChange) {
  let picked = Array.isArray(value) ? [...value] : [];
  const items = q.values || [];

  const wrap = el('div', { class: 'pyramid' });

  const pool = el('div', { class: 'pyramid__pool' });
  const slotsBox = el('div', { class: 'pyramid__slots' });

  const refresh = () => {
    // 池子
    pool.innerHTML = '';
    items.forEach((it) => {
      const isPicked = picked.includes(it.key);
      const btn = el('button', {
        class: `pyr-item${isPicked ? ' is-picked' : ''}`,
        type: 'button',
        text: it.label,
        onclick: () => {
          const idx = picked.indexOf(it.key);
          if (idx >= 0) picked.splice(idx, 1);
          else if (picked.length < 3) picked.push(it.key);
          else toast('只能选三项，先取消一个');
          refresh();
          onChange([...picked]);
        },
      });
      pool.appendChild(btn);
    });

    // 槽位
    slotsBox.innerHTML = '';
    for (let i = 0; i < 3; i += 1) {
      const key = picked[i];
      const item = items.find((x) => x.key === key);
      const slot = el('div', { class: `pyr-slot${item ? ' is-filled' : ' is-empty'}` }, [
        el('span', { class: 'pyr-slot__rank', text: `0${i + 1}` }),
        el('span', {
          class: 'pyr-slot__text',
          text: item ? item.label : ['最重要的', '其次', '再一次'][i],
        }),
        item
          ? el('button', {
            class: 'pyr-slot__del',
            type: 'button',
            text: '×',
            'aria-label': `移除 ${item.label}`,
            onclick: () => {
              picked.splice(i, 1);
              refresh();
              onChange([...picked]);
            },
          })
          : el('span'),
      ]);
      slotsBox.appendChild(slot);
    }
  };

  // 键盘操作专用：就地更新，不重建整张题卡（原先会重置计时器）
  wrap.setPicked = (next) => {
    const cleaned = (Array.isArray(next) ? next : []).slice(0, 3);
    picked.length = 0;
    picked.push(...cleaned);
    refresh();
  };

  refresh();
  wrap.appendChild(pool);
  wrap.appendChild(slotsBox);

  return wrap;
}

/* ------------------------------------------------------------
   主视图
   ------------------------------------------------------------ */

export function renderQuiz(root, ctx) {
  const { App, DATA, volId, mode, go: nav, recompute } = ctx;
  const vol = DATA.volumes[volId];
  if (!vol) { nav('#/'); return; }

  if (mode === 'intro') { renderVolumeIntro(root, ctx); return; }

  const state = App.state;
  const qs = vol.questions;
  const answers = () => (state.answersByVolume[volId] ||= {});

  // 定位到续测位置
  let idx = 0;
  const prog = state.inProgress[volId];
  const stored = answers();
  if (prog && Number.isFinite(prog.currentIdx)) {
    idx = clamp(prog.currentIdx, 0, qs.length - 1);
  } else {
    const firstUnanswered = qs.findIndex((q) => {
      const rec = stored[q.id];
      return !rec || rec.draft || rec.value === undefined;
    });
    idx = firstUnanswered < 0 ? 0 : firstUnanswered;
  }

  let current = idx;
  let focus = createFocusTimer();   // 自动扣除切屏 / 失焦时长
  let changesInQuestion = 0;
  let lastInterlude = -1;
  let activeImpulse = null;
  let disposed = false;
  /* 当前题的作答入口。鼠标点击 / 键盘数字键 / 回退修改共用同一条路径，
     保证「选中态」与「下方语义提示」永远同步。
     不能直接在 onKey 里引用 renderQuestion 内的 onPick —— 那会越出作用域。 */
  let pickHandler = null;

  // 自动切题：默认开启，可随时切换；回退修改时不触发
  const AUTO_KEY = 'human-atlas::autoAdvance';
  let autoAdvance = localStorage.getItem(AUTO_KEY) !== '0';
  let advanceTimer = 0;
  let leaveTimer = 0;

  const cancelAdvance = () => {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = 0; }
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = 0; }
  };

  const scheduleAdvance = () => {
    cancelAdvance();
    advanceTimer = setTimeout(() => {
      advanceTimer = 0;
      if (disposed || !autoAdvance) return;
      const card = cardHolder.querySelector('.q-card');
      if (!card) return;
      card.classList.add('is-leaving');
      leaveTimer = setTimeout(() => {
        leaveTimer = 0;
        if (disposed) return;
        if (current < qs.length - 1) move(1);
        else commit({ advance: true });
      }, 220);
    }, 240);
  };

  const quiz = el('div', { class: 'quiz', style: { '--vc': vol.theme_color, '--accent-vol': vol.theme_color } });
  root.classList.add('view');
  root.appendChild(quiz);

  /* ---------- 顶栏 ---------- */
  const bar = el('div', { class: 'quiz__bar' });
  const barTop = el('div', { class: 'quiz__bar-top' });

  // 极简「← 大厅」图标按钮，与卷名同排，省掉一整行垂直占位
  const backToHub = el('button', {
    class: 'quiz__back',
    type: 'button',
    'aria-label': '返回卷宗大厅',
    title: '返回大厅',
    onclick: () => { commit({ advance: false }); nav('#/'); },
  });
  backToHub.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 5l-7 7 7 7"/></svg><span>大厅</span>`;

  const volLabel = el('div', { class: 'quiz__vol' }, vol.isExpress
    ? [
      el('b', { text: vol.title }),
      el('span', { text: 'EXPRESS · 28' }),
    ]
    : [
      el('b', { text: vol.title }),
      el('span', { text: `VOL.${String(vol.index).padStart(2, '0')}` }),
    ]);
  const countLabel = el('div', { class: 'quiz__count' });

  barTop.appendChild(backToHub);
  barTop.appendChild(volLabel);
  barTop.appendChild(countLabel);
  bar.appendChild(barTop);

  const track = el('div', { class: 'track' }, [el('i')]);
  bar.appendChild(track);
  quiz.appendChild(bar);

  /* ---------- 题面容器 ---------- */
  const cardHolder = el('div');
  quiz.appendChild(cardHolder);

  /* ---------- 底部 ---------- */
  const foot = el('div', { class: 'quiz__foot' });
  const backBtn = el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: '← 上一题',
    onclick: () => move(-1),
  });
  const nextBtn = el('button', {
    class: 'btn btn--solid',
    type: 'button',
    text: '下一题 →',
    onclick: () => {
      if (!commit({ advance: true })) return;
    },
  });
  const exitBtn = el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: '暂时离开',
    onclick: () => {
      commit({ advance: false });
      toast('进度已保存');
      nav('#/');
    },
  });

  foot.appendChild(backBtn);
  foot.appendChild(nextBtn);
  foot.appendChild(el('div', { class: 'spacer' }));
  foot.appendChild(exitBtn);
  const autoBtn = el('button', {
    class: `auto-toggle${autoAdvance ? ' is-on' : ''}`,
    type: 'button',
    'aria-pressed': String(autoAdvance),
    text: autoAdvance ? '自动切题' : '手动确认',
    onclick: () => {
      autoAdvance = !autoAdvance;
      localStorage.setItem(AUTO_KEY, autoAdvance ? '1' : '0');
      cancelAdvance();
      autoBtn.textContent = autoAdvance ? '自动切题' : '手动确认';
      autoBtn.classList.toggle('is-on', autoAdvance);
      autoBtn.setAttribute('aria-pressed', String(autoAdvance));
      toast(autoAdvance ? '选中后自动进入下一题' : '改为手动确认');
    },
  });
  foot.appendChild(autoBtn);

  // 快捷键提示随题型动态变化（选择题 N 项 / 量表 1–7 / 筹码题隐藏数字键）
  const keyPick = el('span', { html: '<kbd>1</kbd>—<kbd>4</kbd> 选择' });
  foot.appendChild(el('div', { class: 'quiz__keyhint' }, [
    keyPick,
    el('span', { html: '<kbd>Enter</kbd> 下一题' }),
    el('span', { html: '<kbd>⌫</kbd> 回退' }),
  ]));
  quiz.appendChild(foot);

  /* ---------- 状态写入 ---------- */
  function persist() {
    save(state, { immediate: true });
  }

  function setValue(q, value) {
    const a = answers();
    const prev = a[q.id];
    if (prev && JSON.stringify(prev.value) === JSON.stringify(value)) return;
    if (prev && prev.value !== undefined) {
      changesInQuestion += 1;
      addChange(state, q.id);
    }
    const elapsed = focus.net();
    const hidden = focus.hidden();
    a[q.id] = {
      value,
      ms: elapsed,
      changes: changesInQuestion,
      at: Date.now(),
    };
    recordAnswer(state, {
      questionId: q.id,
      question: q,          // 用于按题面长度计算动态发呆阈值
      ms: elapsed,
      changes: changesInQuestion,
      readMs: elapsed,
      hiddenMs: hidden,
    });
    state.inProgress[volId] = { currentIdx: current, updatedAt: Date.now() };
    persist();
  }

  function commit({ advance }) {
    const q = qs[current];
    const a = answers();
    const rec = a[q.id];

    const hasValue = rec && rec.value !== undefined
      && !(q.type === 'pyramid_top3' && (!Array.isArray(rec.value) || rec.value.length < 3))
      && !(q.type === 'budget_100' && (!rec.value || Object.values(rec.value).reduce((x, y) => x + Number(y || 0), 0) !== 100));

    if (advance && !hasValue) {
      if (q.type === 'budget_100') toast('把所有 100 点都用完再继续');
      else if (q.type === 'pyramid_top3') toast('请选出三项并排出顺序');
      else toast('先选一个更贴近你的选项');
      return false;
    }

    state.inProgress[volId] = { currentIdx: current, updatedAt: Date.now() };

    if (advance) {
      if (current < qs.length - 1) {
        current += 1;
        changesInQuestion = 0;
        persist();
        renderQuestion();
      } else {
        finish();
      }
    }
    return true;
  }

  function move(delta) {
    cancelAdvance();
    const target = current + delta;
    if (target < 0) return;
    if (target > qs.length - 1) {
      finish();
      return;
    }
    current = target;
    changesInQuestion = 0;
    state.inProgress[volId] = { currentIdx: current, updatedAt: Date.now() };
    persist();
    renderQuestion();
  }

  function finish() {
    const a = answers();
    const answeredNow = qs.filter((q) => {
      const rec = a[q.id];
      if (!rec || rec.draft || rec.value === undefined || rec.value === null) return false;
      if (q.type === 'pyramid_top3') return Array.isArray(rec.value) && rec.value.length >= 3;
      if (q.type === 'budget_100') {
        return typeof rec.value === 'object'
          && Object.values(rec.value).reduce((x, y) => x + Number(y || 0), 0) === 100;
      }
      return true;
    }).length;
    if (answeredNow < qs.length) {
      toast(`还有 ${qs.length - answeredNow} 题未作答，先把它们完成`);
      return;
    }

    // 极速模式：把虚拟桶的答案写回原卷，然后进简报页。
    // 不写 completedVolumes —— 28 题不等于完成了任何一整卷。
    if (vol.isExpress) {
      delete state.inProgress[volId];
      persist();
      nav(vol.resultRoute || '#/express/result');
      return;
    }

    const firstTime = !state.completedVolumes.includes(volId);
    if (firstTime) {
      state.completedVolumes.push(volId);
    }
    delete state.inProgress[volId];
    persist();
    recompute({ silent: true });
    // 首次完成即封存「初印象快照」，重测后可以对照本能态与修正态
    if (firstTime) {
      sealInitialSnapshot(state, volId, vol.dimensions || []);
      persist();
    }
    nav(`#/report/${volId}`);
  }

  /* ---------- 渲染当前题 ---------- */
  function renderQuestion() {
    const q = qs[current];
    const a = answers();
    const savedValue = a[q.id]?.value;

    // 每题一个全新的计时器，切屏时长不计入
    if (activeImpulse?.dispose) { activeImpulse.dispose(); activeImpulse = null; }
    focus.dispose();
    focus = createFocusTimer();
    changesInQuestion = a[q.id]?.changes || 0;

    countLabel.innerHTML = `<b>${String(current + 1).padStart(2, '0')}</b> / ${String(qs.length).padStart(2, '0')}`;
    track.firstElementChild.style.width = `${((current + 1) / qs.length) * 100}%`;

    backBtn.disabled = current === 0;
    nextBtn.textContent = current === qs.length - 1 ? '完成本卷 →' : '下一题 →';

    cardHolder.innerHTML = '';

    // 微缓冲
    const showInterlude = current > 0 && current % 6 === 0 && lastInterlude !== current;
    if (showInterlude) {
      lastInterlude = current;
      const text = INTERLUDES[(current / 6 - 1) % INTERLUDES.length];
      const inter = el('div', { class: 'interlude' }, [
        el('div', { class: 'interlude__mark' }),
        el('p', { text }),
        el('small', { text: `— ${current} / ${qs.length} —` }),
      ]);
      cardHolder.appendChild(inter);
    }

    const card = el('div', { class: 'q-card' });

    const meta = el('div', { class: 'q-meta' }, [
      el('span', { class: 'q-meta__no', text: `Q ${String(current + 1).padStart(2, '0')}` }),
      el('span', { class: 'q-meta__sep' }),
      el('span', { class: 'q-meta__type', text: TYPE_LABEL[q.type] || q.type }),
      // 极速模式标注题目出处，让人知道这是从哪一卷抽出来的
      vol.isExpress && q._srcTitle
        ? el('span', { class: 'q-meta__src', text: `摘自 ${q._srcTitle}` })
        : null,
    ]);
    card.appendChild(meta);

    if (q.context) {
      const ctxBox = el('div', { class: 'q-context' });
      ctxBox.textContent = q.context;
      card.appendChild(ctxBox);
    }

    card.appendChild(el('h2', { class: 'q-prompt', text: q.prompt }));

    const hint = hintOf(q);
    if (hint) {
      card.appendChild(el('div', { class: 'q-hint' }, [el('span', { text: hint })]));
    }

    // 快捷键提示与当前题型对齐
    if (q.type === 'stealth_scale') {
      keyPick.innerHTML = '<kbd>1</kbd>—<kbd>7</kbd> 选择';
    } else if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
      const n = (q.options || []).length;
      keyPick.innerHTML = n > 1 ? `<kbd>1</kbd>—<kbd>${n}</kbd> 选择` : '';
    } else if (q.type === 'budget_100') {
      keyPick.innerHTML = '拖动滑块分配点数';
    } else if (q.type === 'pyramid_top3') {
      keyPick.innerHTML = '点选顺序即排名';
    }

    let scaleWidget = null;

    const onPick = (value) => {
      setValue(q, value);
      if (activeImpulse?.lockWith) activeImpulse.lockWith(value);
      // 立即反映选中态
      cardHolder.querySelectorAll('.opt').forEach((o) => {
        o.classList.toggle('is-sel', o.dataset.k === String(value));
      });
      cardHolder.querySelectorAll('.scale-dot').forEach((d) => {
        d.classList.toggle('is-sel', d.dataset.k === String(value));
      });
      // 量表还要同步下方语义提示（点击 / 键盘 / 回退三条路径共用）
      if (scaleWidget && typeof scaleWidget.setScale === 'function') {
        scaleWidget.setScale(value);
      }

      // 240ms 柔和高亮后自动切题（可在底部开关关闭）
      if (autoAdvance) scheduleAdvance();
    };

    // 交给键盘分支复用
    pickHandler = onPick;

    if (q.type === 'forced_choice') {
      card.appendChild(renderForcedChoice(q, savedValue, onPick));
    } else if (q.type === 'impulse_3s') {
      const wrap = renderImpulse(q, savedValue, onPick);
      activeImpulse = wrap;
      card.appendChild(wrap);
    } else if (q.type === 'stealth_scale') {
      const wrap = renderStealthScale(q, savedValue, (v) => {
        onPick(v);
      });
      scaleWidget = wrap;
      card.appendChild(wrap);
    } else if (q.type === 'budget_100') {
      card.appendChild(renderBudget(q, savedValue, (map) => {
        const total = Object.values(map).reduce((x, y) => x + Number(y || 0), 0);
        if (total === 100) setValue(q, { ...map });
        else {
          // 未满 100 仅存草稿（不覆盖已完成的合法值，且计分/统计统一忽略 draft）
          state.inProgress[volId] = { currentIdx: current, updatedAt: Date.now() };
          const a2 = answers();
          if (!a2[q.id] || a2[q.id].draft || a2[q.id].value === undefined) {
            a2[q.id] = { value: { ...map }, draft: true, ms: focus.net() };
          }
          persist();
        }
      }));
    } else if (q.type === 'pyramid_top3') {
      card.appendChild(renderPyramid(q, savedValue, (arr) => {
        setValue(q, arr);
      }));
    }

    cardHolder.appendChild(card);

    cardHolder.scrollIntoView({ block: 'nearest' });
    cancelAdvance();
  }

  /* ---------- 键盘 ---------- */
  const onKey = (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const q = qs[current];

    if (e.key === 'Backspace') {
      e.preventDefault();
      move(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit({ advance: true });
      return;
    }
    if (e.key === 'ArrowRight') { commit({ advance: true }); return; }
    if (e.key === 'ArrowLeft') { move(-1); return; }

    const n = Number(e.key);
    if (!Number.isFinite(n) || n < 1) return;

    if (q.type === 'forced_choice' || q.type === 'impulse_3s') {
      const opt = q.options?.[n - 1];
      if (!opt || activeImpulse?.isLocked?.()) return;
      e.preventDefault();
      if (pickHandler) pickHandler(opt.key);
    } else if (q.type === 'stealth_scale') {
      if (n > 7) return;
      e.preventDefault();
      // 走统一入口：选中态 + 语义提示 + 自动切题全部对齐
      if (pickHandler) pickHandler(n);
    } else if (q.type === 'pyramid_top3') {
      const item = q.values?.[n - 1];
      if (!item) return;
      e.preventDefault();
      const cur = answers()[q.id]?.value;
      const arr = Array.isArray(cur) ? [...cur] : [];
      const at = arr.indexOf(item.key);
      if (at >= 0) arr.splice(at, 1);
      else if (arr.length < 3) arr.push(item.key);
      else return;

      setValue(q, arr);
      // 就地刷新金字塔，不重建题卡 ⇒ 计时器不重置，遥测数据保持连续
      const pyr = cardHolder.querySelector('.pyramid');
      if (pyr && typeof pyr.setPicked === 'function') pyr.setPicked(arr);
    }
  };
  window.addEventListener('keydown', onKey);

  // 离开页面时释放所有计时器与全局监听
  const cleanup = () => {
    disposed = true;
    cancelAdvance();
    if (activeImpulse?.dispose) { activeImpulse.dispose(); activeImpulse = null; }
    focus.dispose();
    window.removeEventListener('keydown', onKey);
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  renderQuestion();
}
