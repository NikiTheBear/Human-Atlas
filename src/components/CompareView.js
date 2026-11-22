/* ============================================================
   CompareView.js — 双人灵魂对比室
   · 两个密钥输入槽（A 为本人 / B 为对方）
   · 交集卷宗与维度自动计算
   · 共振 / 互补 / 阴影碰撞三段结论
   ============================================================ */

import { el, round, toast } from '../core/utils.js';
import { decodeSoulCode } from '../core/storage.js';
import { compareStates, displayName } from '../core/comparator.js';
import { radarSvg } from '../viz/radarSvg.js';

const SLOT_COLORS = { a: '#8C4A32', b: '#3B4D70' };

/* ------------------------------------------------------------
   输入槽
   ------------------------------------------------------------ */

function slotInput(key, label, initial, onParse, dimOrder = []) {
  const color = SLOT_COLORS[key];

  const ta = el('textarea', {
    class: 'field field--code',
    rows: '4',
    placeholder: '粘贴 HA4- 开头的存档码（HA3- 亦可）',
  });
  if (initial) ta.value = initial;

  const status = el('div', { class: 'cmp-slot__status', text: initial ? '已载入' : '等待输入' });
  if (initial) status.classList.add('is-ok');

  const pasteBtn = el('button', {
    class: 'btn btn--xs btn--gold',
    type: 'button',
    text: '粘贴',
    onclick: async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          ta.value = text.trim();
          ta.dispatchEvent(new Event('input'));
        }
      } catch {
        toast('无法读取剪贴板，请手动粘贴');
      }
    },
  });

  const slot = el('div', { class: 'cmp-slot', style: { '--slot-c': color } });
  slot.appendChild(el('div', { class: 'cmp-slot__head' }, [
    el('span', { class: 'cmp-slot__dot' }),
    el('h3', { text: label }),
    el('span', { class: 'cmp-slot__badge', text: key.toUpperCase() }),
  ]));
  slot.appendChild(ta);
  slot.appendChild(el('div', { class: 'cmp-slot__foot' }, [pasteBtn, status]));

  const handle = () => {
    const raw = ta.value.trim();
    if (!raw) {
      status.textContent = '等待输入';
      status.className = 'cmp-slot__status';
      onParse(null);
      return;
    }
    const res = decodeSoulCode(raw, dimOrder);
    if (!res.ok) {
      status.textContent = res.error || '无法解析';
      status.className = 'cmp-slot__status is-err';
      onParse(null);
      return;
    }
    status.textContent = `${displayName(res.state)} · ${res.state.completedVolumes.length} 卷`;
    status.className = 'cmp-slot__status is-ok';
    onParse(res.state);
  };

  let timer = 0;
  ta.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(handle, 320);
  });

  if (initial) handle();

  return { node: slot, ta, status, getValue: () => ta.value };
}

/* ------------------------------------------------------------
   主渲染
   ------------------------------------------------------------ */

export function renderCompare(root, ctx) {
  const { App, DATA, soulCode } = ctx;
  const C = getComputedStyle(document.documentElement);
  const col = (k) => C.getPropertyValue(k).trim();

  root.classList.add('view');
  const wrap = el('div');
  root.appendChild(wrap);

  wrap.appendChild(el('div', { class: 'cmp-intro' }, [
    el('div', { class: 'eyebrow', style: { marginBottom: '14px' }, text: 'Soul Alignment · 双人对比' }),
    el('h1', { text: '两个人的暗线' }),
    el('p', {
      text: '把两份存档码放进同一个房间。系统只比较你们共同完成的卷宗——不必强迫任何一方做满 152 题。它会算出你们的价值共振、性格互补，以及那些最容易在深夜引爆的阴影碰撞。',
    }),
  ]));

  let stateA = null;
  let stateB = null;

  const resultBox = el('div', { id: 'cmp-result' });

  const selfCode = App.state.completedVolumes.length ? soulCode() : '';

  const form = el('div', { class: 'cmp-form' });

  const slotA = slotInput('a', 'A · 你', selfCode, (s) => {
    stateA = s ? hydrate({ ...s, nickname: s.nickname || App.state.nickname || '你' }) : null;
    maybeRender();
  }, DATA.dimOrder);
  const slotB = slotInput('b', 'B · 对方', '', (s) => {
    stateB = s;
    maybeRender();
  }, DATA.dimOrder);

  form.appendChild(slotA.node);
  form.appendChild(slotB.node);
  wrap.appendChild(form);

  const actions = el('div', {
    style: { display: 'flex', gap: '10px', marginTop: '18px', flexWrap: 'wrap' },
  }, [
    el('button', {
      class: 'btn btn--solid',
      type: 'button',
      text: '计算契合度',
      onclick: () => maybeRender(true),
    }),
    el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: '清空',
      onclick: () => {
        slotB.ta.value = '';
        slotB.ta.dispatchEvent(new Event('input'));
        resultBox.innerHTML = '';
      },
    }),
    !App.state.completedVolumes.length
      ? el('span', { class: 'chip', style: { alignSelf: 'center', padding: '8px 14px' }, text: '先完成至少一卷，才能生成你自己的存档码' })
      : null,
  ]);
  wrap.appendChild(actions);

  wrap.appendChild(resultBox);

  function hydrate(s) {
    // 存档码只带分数，这里补齐 computedScores 结构
    const out = { ...s };
    out.computedScores = { ...(s.computedScores || {}) };
    if (!out.completedVolumes) out.completedVolumes = [];
    return out;
  }

  function maybeRender(force = false) {
    if (!stateA || !stateB) {
      if (force) toast('需要两份有效的存档码');
      resultBox.innerHTML = '';
      return;
    }
    renderResult(resultBox, stateA, stateB, { DATA, col });
  }
}

/* ------------------------------------------------------------
   结果
   ------------------------------------------------------------ */

function renderResult(box, A, B, { DATA, col }) {
  box.innerHTML = '';
  const res = compareStates(A, B, DATA);

  const nameA = displayName(A, 'A');
  const nameB = displayName(B, 'B');

  if (!res.ok) {
    box.appendChild(el('div', { class: 'empty', style: { marginTop: '30px' } }, [
      el('h3', { text: '还没有可比较的交集' }),
      el('p', { text: res.reason || '' }),
      el('a', { class: 'btn', href: '#/', text: '返回卷宗大厅' }),
    ]));
    return;
  }

  /* ---------- 判词 ---------- */
  const verdict = el('div', { class: 'cmp-verdict' });

  verdict.appendChild(el('div', { class: 'cmp-verdict__score' }, [
    el('b', { text: `${Math.round(res.overall)}` }),
    el('span', { text: '契合度 %' }),
  ]));

  verdict.appendChild(el('div', {}, [
    el('h2', { text: `${res.grade.name} · ${res.grade.id} 级` }),
    el('p', { text: res.grade.desc }),
    el('div', { class: 'cmp-metrics' }, [
      el('div', {}, [
        el('dt', { text: '交汇卷宗' }),
        el('dd', { text: `${res.common.length} 卷` }),
      ]),
      el('div', {}, [
        el('dt', { text: '可比维度' }),
        el('dd', { text: `${res.dims.length}` }),
      ]),
      el('div', {}, [
        el('dt', { text: '价值观共振' }),
        el('dd', { text: res.sync ? `${Math.round(res.sync.value)}` : '—' }),
      ]),
      el('div', {}, [
        el('dt', { text: '性格互补' }),
        el('dd', { text: res.complement ? `${Math.round(res.complement.value)}` : '—' }),
      ]),
      el('div', {}, [
        el('dt', { text: '阴影预警' }),
        el('dd', { text: `${res.collisions.length} 处` }),
      ]),
    ]),
  ]));
  box.appendChild(verdict);

  /* ---------- 双人雷达 ---------- */
  const radarDims = [
    'big5_open', 'big5_order', 'big5_assert', 'big5_compassion',
  ];

  // 优先用大五 + 思维的短标签；若交集不足，再按「差异最大」补齐，
  // 这样十二卷之后仍能画出有信息量的双人雷达。
  const PREFERRED = [
    { id: 'big5_open', label: '探索' },
    { id: 'big5_order', label: '秩序' },
    { id: 'big5_assert', label: '表达' },
    { id: 'big5_compassion', label: '共情' },
    { id: 'big5_compliance', label: '妥协' },
    { id: 'big5_rumination', label: '反刍' },
    { id: 'cog_global', label: '抽象' },
    { id: 'cog_speed', label: '决断' },
    { id: 'mot_autonomy', label: '主权' },
    { id: 'mot_belonging', label: '羁绊' },
  ];

  let radarList = PREFERRED.filter((d) => res.dims.includes(d.id));

  if (radarList.length < 6) {
    const gaps = (res.topGaps || [])
      .map((g) => ({ id: g.dim, label: (DATA.dimMap[g.dim]?.name || g.dim).slice(0, 4) }))
      .filter((d) => res.dims.includes(d.id) && !radarList.some((x) => x.id === d.id));
    radarList = [...radarList, ...gaps];
  }

  if (radarList.length < 6) {
    const extra = res.dims
      .filter((d) => !radarList.some((x) => x.id === d))
      .map((d) => ({ id: d, label: (DATA.dimMap[d]?.name || d).slice(0, 4) }));
    radarList = [...radarList, ...extra];
  }

  radarList = radarList.slice(0, 10);

  if (radarList.length >= 3) {
    const card = el('div', { class: 'chart-card', style: { marginBottom: '18px' } });
    card.appendChild(el('div', { class: 'chart-card__head' }, [
      el('h3', { text: '轮廓叠加' }),
      el('span', { class: 'chart-card__note', text: '仅显示双方共同完成的维度' }),
    ]));

    const body = el('div', { class: 'chart-card__body' });
    body.appendChild(radarSvg(
      radarList.map((d) => ({ ...d, value: A.computedScores[d.id] })),
      {
        width: 560,
        colorText: col('--text-primary'),
        colorMuted: col('--text-tertiary'),
        colorBorder: col('--border'),
        bg: col('--bg-card'),
        series: [
          { name: nameA, values: radarList.map((d) => A.computedScores[d.id]), color: SLOT_COLORS.a, fillOpacity: 0.1 },
          { name: nameB, values: radarList.map((d) => B.computedScores[d.id]), color: SLOT_COLORS.b, fillOpacity: 0.1 },
        ],
        labelSize: 10.5,
      },
    ));
    body.appendChild(el('div', { class: 'chart-legend' }, [
      el('span', { style: { color: SLOT_COLORS.a }, html: `<i></i>${nameA}` }),
      el('span', { style: { color: SLOT_COLORS.b }, html: `<i></i>${nameB}` }),
    ]));
    card.appendChild(body);
    box.appendChild(card);
  }

  /* ---------- 共振 ---------- */
  if (res.resonances.length) {
    const head = el('div', { class: 'section-head' }, [
      el('h2', { text: '深度共振点' }),
      el('div', { class: 'section-head__hint', text: '你们在这些地方，不需要解释就能彼此理解' }),
    ]);
    box.appendChild(head);

    res.resonances.forEach((r) => {
      box.appendChild(el('div', { class: 'res-card' }, [
        el('h4', { text: r.title }),
        el('p', { text: r.text }),
      ]));
    });
  }

  /* ---------- 互补 ---------- */
  if (res.complement?.golden?.length) {
    const head = el('div', { class: 'section-head' }, [
      el('h2', { text: '黄金互补带' }),
      el('div', { class: 'section-head__hint', text: '差异落在 20–45 分之间：足够不同，又不至于无法理解' }),
    ]);
    box.appendChild(head);

    const card = el('div', { class: 'chart-card' });
    const rows = res.complement.golden.slice(0, 6);
    rows.forEach((r) => {
      const name = DATA.dimMap[r.dim]?.name || r.dim;
      const av = A.computedScores[r.dim];
      const bv = B.computedScores[r.dim];
      card.appendChild(el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: '100px 1fr auto',
          gap: '14px',
          alignItems: 'center',
          padding: '10px 0',
          borderBottom: '1px solid var(--border-hair)',
        },
      }, [
        el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)' }, text: name }),
        el('div', { style: { fontSize: '11px', color: 'var(--text-tertiary)' }, html: `<span style="color:${SLOT_COLORS.a}">${Math.round(av)}</span> · <span style="color:${SLOT_COLORS.b}">${Math.round(bv)}</span>` }),
        el('div', { style: { fontSize: '10.5px', letterSpacing: '0.08em', color: 'var(--text-tertiary)' }, text: `差 ${Math.round(r.diff)}` }),
      ]));
    });
    box.appendChild(card);
  }

  /* ---------- 阴影碰撞 ---------- */
  if (res.collisions.length) {
    const head = el('div', { class: 'section-head' }, [
      el('h2', { text: '阴影碰撞预警' }),
      el('div', { class: 'section-head__hint', text: '这些不是「你们不适合」，而是「你们的吵架会以这种方式开始」' }),
    ]);
    box.appendChild(head);

    res.collisions.forEach((c) => {
      box.appendChild(el('div', { class: 'warn-card' }, [
        el('h4', { text: `${c.severity === 'high' ? '⚠ ' : ''}${c.title}` }),
        el('p', { text: c.text }),
        el('div', {
          style: { marginTop: '10px', fontSize: '12px', lineHeight: '1.85', color: 'var(--text-secondary)', padding: '10px 14px', background: 'var(--bg-inset)', borderRadius: '3px' },
          html: `<b style="color:var(--text-primary)">降温指南</b><br>${c.guide}`,
        }),
      ]));
    });
  } else {
    box.appendChild(el('div', { class: 'res-card' }, [
      el('h4', { text: '未触发已知的阴影碰撞模式' }),
      el('p', { text: '在你们共同完成的维度里，没有形成灾难性的闭环组合。这不代表没有冲突，只代表你们的冲突不会以最危险的那种方式展开。' }),
    ]));
  }

  /* ---------- 差异最大 ---------- */
  if (res.topGaps?.length) {
    const head = el('div', { class: 'section-head' }, [
      el('h2', { text: '差异最大的五处' }),
      el('div', { class: 'section-head__hint', text: '差异本身不是问题，问题是有没有人愿意先解释' }),
    ]);
    box.appendChild(head);

    const card = el('div', { class: 'chart-card' });
    res.topGaps.forEach((r) => {
      const name = DATA.dimMap[r.dim]?.name || r.dim;
      card.appendChild(el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: '100px 1fr auto',
          gap: '14px',
          alignItems: 'center',
          padding: '10px 0',
          borderBottom: '1px solid var(--border-hair)',
        },
      }, [
        el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)' }, text: name }),
        el('div', { style: { fontSize: '11px', color: 'var(--text-tertiary)' }, html: `<span style="color:${SLOT_COLORS.a}">${Math.round(r.a)}</span> ↔ <span style="color:${SLOT_COLORS.b}">${Math.round(r.b)}</span>` }),
        el('div', { style: { fontSize: '10.5px', letterSpacing: '0.08em', color: 'var(--text-tertiary)' }, text: `差 ${Math.round(r.diff)}` }),
      ]));
    });
    box.appendChild(card);
  }

  /* ---------- 页脚 ---------- */
  box.appendChild(el('div', {
    style: {
      marginTop: '26px', padding: '16px 0', borderTop: '1px solid var(--border)',
      fontSize: '11px', letterSpacing: '0.06em', color: 'var(--text-tertiary)',
      display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'space-between',
    },
  }, [
    el('span', { text: `交汇卷宗：${res.common.map((v) => DATA.volumes[v]?.title || v).join(' · ')}` }),
    el('span', { text: '全部计算在本地完成，双方数据均未离开设备' }),
  ]));
}
