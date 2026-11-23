/* ============================================================
   CompareView.js — 双人灵魂对比室
   · 两个密钥输入槽（A 为本人 / B 为对方）
   · 交集卷宗与维度自动计算
   · 共振 / 互补 / 阴影碰撞三段结论
   ============================================================ */

import { el, round, toast, clamp } from '../core/utils.js';
import { decodeSoulCode } from '../core/storage.js';
import { compareStates, displayName } from '../core/comparator.js';
import { radarSvg } from '../viz/radarSvg.js';
import { ecologySvg } from '../viz/ecologySvg.js';
import {
  ECOLOGIES, scoreAllEcologies, relationshipScript, subtextDecoder, chemistryBoard,
  CONFIDENCE_LABEL,
} from '../core/ecology.js';

/* 生态位数量从注册表现算 —— 加第 7、第 8 个时不用再改文案 */
const ECO_COUNT = ECOLOGIES.length;

/* A/B 两点专属色：优先读 styles/main.css 里的 --cmp-a / --cmp-b（日夜双轨），
   这里的常量只作为 getComputedStyle 不可用（如 SSR / 测试环境）时的兜底：
     #9a7b45 = tokens.css 白昼档 --gold（与 var(--gold) 同值，不是新色）；
     #8c4a32 = B 点专属陶土赭，全项目唯一新增裸 hex。 */
const SLOT_FALLBACK = { a: '#9a7b45', b: '#8c4a32' };

/* 生态位「匹配法则」小徽章文案 */
const KIND_LABEL = {
  syncHigh: '双高同频',
  tension: '互补张力',
  syncLow: '双低稳态',
  sync: '相近同步',
  bothHigh: '强强对撞',
};

function slotColors() {
  if (typeof document === 'undefined') return { ...SLOT_FALLBACK };
  const cs = getComputedStyle(document.documentElement);
  const a = cs.getPropertyValue('--cmp-a').trim() || SLOT_FALLBACK.a;
  const b = cs.getPropertyValue('--cmp-b').trim() || SLOT_FALLBACK.b;
  return { a, b };
}

/* ------------------------------------------------------------
   小工具：档位描述 / 差值状态 / 双人哑铃对照轨
   ------------------------------------------------------------ */

/** 绝对分 → 一句档位描述，用于自动生成的对比提示 */
function toneLabel(v) {
  if (!Number.isFinite(v)) return '未知';
  if (v >= 70) return '极显';
  if (v >= 58) return '偏高';
  if (v > 42) return '居中';
  if (v > 30) return '偏低';
  return '极低';
}

/**
 * 差值状态标签。
 * |Δ| ≤ 10 → 高度同频（双高≥62 → 双高共振；双低≤38 → 双低共鸣）
 * 15 ≤ |Δ| ≤ 35 → 张力互补　|Δ| > 35 → 显著分叉　其余 → 温和差异
 */
function diffBand(av, bv) {
  const d = Math.abs(av - bv);
  if (d <= 10) {
    if (av >= 62 && bv >= 62) return { key: 'resonance-high', label: '双高共振' };
    if (av <= 38 && bv <= 38) return { key: 'resonance-low', label: '双低共鸣' };
    return { key: 'sync', label: '高度同频' };
  }
  if (d >= 15 && d <= 35) return { key: 'tension', label: '张力互补' };
  if (d > 35) return { key: 'fork', label: '显著分叉' };
  return { key: 'mild', label: '温和差异' };
}

/**
 * 0–100 双人对照轨。
 * A 点用 --cmp-a（金），B 点用 --cmp-b（楚石），两点之间是一条柔色连接带。
 * 值过于接近时两点会重叠，自动向两侧微推。
 */
function dualTrack(av, bv, { numbers = true, compact = false } = {}) {
  const a = clamp(Number(av), 0, 100);
  const b = clamp(Number(bv), 0, 100);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const crowded = Math.abs(a - b) < 9;

  const track = el('span', { class: `dtrack${compact ? ' dtrack--sm' : ''}`, 'aria-hidden': 'true' });
  track.appendChild(el('span', { class: 'dtrack__rule' }));
  track.appendChild(el('span', { class: 'dtrack__mid' }));
  track.appendChild(el('span', {
    class: 'dtrack__band',
    style: { left: `${lo}%`, width: `${Math.max(1.2, hi - lo)}%` },
  }));

  const dotA = el('span', {
    class: `dtrack__dot dtrack__dot--a${crowded ? ' is-crowded' : ''}`,
    style: { left: `${a}%` },
  }, numbers ? [el('b', { text: String(Math.round(a)) })] : []);
  const dotB = el('span', {
    class: `dtrack__dot dtrack__dot--b${crowded ? ' is-crowded' : ''}`,
    style: { left: `${b}%` },
  }, numbers ? [el('b', { text: String(Math.round(b)) })] : []);
  track.appendChild(dotA);
  track.appendChild(dotB);

  return track;
}
/** 展开面板：0fr → 1fr（与 guide-card__bodywrap 同一手法） */
function disclosure(btn, panelCls, build) {
  const wrap = el('div', { class: `${panelCls}__wrap` });
  const inner = el('div', { class: `${panelCls}__inner` });
  wrap.appendChild(inner);
  let built = false;
  let open = false;

  const toggle = (next) => {
    open = next === undefined ? !open : next;
    if (open && !built) { inner.appendChild(build()); built = true; }
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    const host = btn.closest('[data-openable]') || btn.closest('.eco-card');
    if (host) host.classList.toggle('is-open', open);
    wrap.setAttribute('data-open', open ? 'true' : 'false');
  };

  btn.addEventListener('click', () => toggle());
  /* 面板内部点击不能回传给触发器（否则展开后点内容会把抽屉收起来） */
  wrap.addEventListener('click', (e) => e.stopPropagation());
  wrap.addEventListener('keydown', (e) => e.stopPropagation());
  return { wrap, toggle };
}

/* ------------------------------------------------------------
   输入槽
   ------------------------------------------------------------ */

function slotInput(key, label, initial, onParse, dimOrder = []) {
  const COLORS = slotColors();
  const color = key === 'a' ? COLORS.a : COLORS.b;

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
    const who = displayName(res.state, key === 'a' ? '我' : '对方');
    status.textContent = res.isExpressOnly
      ? `${who} · 极速速写`
      : `${who} · ${res.state.completedVolumes.length} 卷`;
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
      text: '把两份存档码放进同一个房间。系统只比较你们真正都测过的那批维度——不必强迫任何一方做满 152 题。它会算出你们的价值共振、性格互补，以及那些最容易在深夜引爆的阴影碰撞。',
    }),
  ]));

  let stateA = null;
  let stateB = null;

  const resultBox = el('div', { id: 'cmp-result' });

  /* 自己有分就自动填：completedVolumes 为空但做过 28 题极速版的人，
     同样应该能直接开合盘。 */
  const selfHasData = (App.state.completedVolumes || []).length > 0
    || Object.keys(App.state.computedScores || {}).some((d) => Number.isFinite(App.state.computedScores[d]));
  const selfCode = selfHasData ? soulCode() : '';

  const form = el('div', { class: 'cmp-form' });

  const slotA = slotInput('a', 'A · 你', selfCode, (s) => {
    stateA = s ? hydrate({ ...s, nickname: s.nickname || App.state.nickname || '' }) : null;
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
    !selfHasData
      ? el('span', { class: 'chip', style: { alignSelf: 'center', padding: '8px 14px' }, text: '先做完 28 题极速版或一卷完整卷宗，才能生成你自己的存档码' })
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
    // 任何一层渲染出错都不能让页面变成一片空白 —— 显示原因，方便定位。
    try {
      renderResult(resultBox, stateA, stateB, { DATA, col });
    } catch (err) {
      console.error('[compare] 渲染失败', err);
      resultBox.innerHTML = '';
      resultBox.appendChild(el('div', { class: 'empty', style: { marginTop: '26px' } }, [
        el('h3', { text: '这次计算没能完成' }),
        el('p', { text: `${err?.name || 'Error'}：${err?.message || '未知原因'}` }),
        el('p', { text: '两份存档码本身是有效的，问题出在渲染阶段。把这段文字发给我就能定位。' }),
      ]));
    }
    // 结果在按钮下方，滚过去，否则看起来像"点了没反应"
    const top = resultBox.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: 'smooth' });
  }
}

/* ------------------------------------------------------------
   结果
   ------------------------------------------------------------ */

function renderResult(box, A, B, { DATA, col }) {
  box.innerHTML = '';
  const res = compareStates(A, B, DATA);

  const COL = slotColors();
  const nameA = displayName(A, '我');
  const nameB = displayName(B, '对方');

  if (!res.ok) {
    box.appendChild(el('div', { class: 'empty', style: { marginTop: '30px' } }, [
      el('h3', { text: '可比维度还不够' }),
      el('p', { text: res.reason || '' }),
      el('a', { class: 'btn', href: '#/', text: '返回卷宗大厅' }),
    ]));
    return;
  }

  /* 极速档：一卷都没标记完成，但双方有几十个共同维度。
     文案不能再提「交汇卷宗」，否则会出现「交汇卷宗：」后面一片空白。 */
  const pairLabel = res.isExpressPair ? '极速速写' : `${res.common.length} 卷`;

  /* ---------- 判词 ---------- */
  const verdict = el('div', { class: 'cmp-verdict' });

  const hasOverall = Number.isFinite(res.overall);
  const basis = res.basis || null;

  verdict.appendChild(el('div', { class: `cmp-verdict__score${hasOverall ? '' : ' is-void'}` }, [
    el('b', { text: hasOverall ? `${Math.round(res.overall)}` : '—' }),
    el('span', { text: hasOverall ? '契合度 %' : '暂无法定级' }),
  ]));

  verdict.appendChild(el('div', {}, [
    el('h2', { text: `${res.grade.name} · ${res.grade.id} 级` }),
    el('p', { text: res.grade.desc }),

    /* ---------- 计算基础披露 ----------
       总契合度只用「价值观共振轴」与「性格互补轴」上的维度定级，
       而这两条轴各只覆盖 20 来个维度，远小于「可比维度」总数。
       不披露的话，用户会看到「可比维度 100」却不知道等级只由其中 15 条决定。 */
    basis ? el('div', { class: `cmp-basis is-${basis.confidence}` }, [
      el('span', { class: 'cmp-basis__label', text: '定级依据' }),
      el('span', {
        class: 'cmp-basis__text',
        text: `${basis.usedDims} / ${basis.comparable} 条维度落在核心轴上`
          + `（共振 ${basis.syncDims} · 互补 ${basis.compDims}）`,
      }),
      el('span', {
        class: 'cmp-basis__tag',
        text: basis.confidence === 'high' ? '覆盖充分'
          : basis.confidence === 'mid' ? '覆盖尚可' : '覆盖偏低',
      }),
    ]) : null,

    res.grade.caveat ? el('p', { class: 'cmp-caveat', text: res.grade.caveat }) : null,

    el('div', { class: 'cmp-metrics' }, [
      el('div', {}, [
        el('dt', { text: '交汇卷宗' }),
        el('dd', { text: pairLabel }),
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

    /* ---------- 1.2 · 同一份码自比时的说明 ----------
       「心动拉扯」61% 权重是张力轴，自己跟自己 diff=0，tension 返回 55，
       所以自比必然低分。这是设计使然，但用户会以为系统坏了。 */
    res.isSelfPair ? el('p', {
      class: 'cmp-caveat is-info',
      text: '你贴的是同一份存档码。有些生态位（心动拉扯、事业搭档、镜面宿敌）'
        + '衡量的本来就是两个人之间的差异与张力，自己跟自己比分数必然偏低 —— 这不是算法出错。',
    }) : null,
  ]));
  box.appendChild(verdict);

  /* ---------- 关系生态位（数量从 ECOLOGIES 现算，不写死） ---------- */
  {
    const eco = scoreAllEcologies(A, B, res.dims, { a: A.maskIndex, b: B.maskIndex });

    const head = el('div', { class: 'section-head' }, [
      el('h2', { text: `${ECO_COUNT} 种关系生态位` }),
      el('div', {
        class: 'section-head__hint',
        text: eco.best
          ? `你们最合拍的位置是「${eco.best.name}」`
          : '完成更多卷宗后可解锁更精准的推演',
      }),
    ]);
    box.appendChild(head);

    if (!eco.list.length) {
      box.appendChild(el('div', { class: 'res-card' }, [
        el('h4', { text: '交集维度还不足以推演生态位' }),
        el('p', { text: '每套权重矩阵都需要一定的共同维度才能给出可信结果。先各自再完成 1–2 卷。' }),
      ]));
    } else {
      /* 雷达 */
      const radarCard = el('div', { class: 'chart-card', style: { marginBottom: '18px' } });
      radarCard.appendChild(el('div', { class: 'chart-card__head' }, [
        el('h3', { text: `${ECO_COUNT} 维轮廓` }),
        el('span', { class: 'chart-card__note', text: '顶点为各自生态位得分' }),
      ]));
      const radarBody = el('div', { class: 'chart-card__body' });
      const ordered = ['partner', 'spark', 'confidant', 'cofounder', 'roommate', 'rival']
        .map((id) => eco.list.find((r) => r.id === id))
        .filter(Boolean);
      radarBody.appendChild(ecologySvg(ordered, {
        width: 520,
        color: COL.a,
        colorText: col('--text-primary'),
        colorMuted: col('--text-tertiary'),
        colorBorder: col('--border'),
        bg: col('--bg-card'),
        bestId: eco.best?.id,
      }));
      radarCard.appendChild(radarBody);
      box.appendChild(radarCard);

      /* 每张卡底部可展开逐维拆解 */
      const ecoGrid = el('div', { class: 'eco-grid' });
      ordered.forEach((r) => {
        const isBest = r.id === eco.best?.id;
        const card = el('div', { class: `eco-card${isBest ? ' is-best' : ''}` }, [
          el('div', { class: 'eco-card__top' }, [
            el('span', { class: 'eco-card__name', text: r.name }),
            el('span', { class: 'eco-card__score', text: String(Math.round(r.value)) }),
          ]),
          el('div', { class: 'eco-card__latin', text: r.latin }),
          el('p', { class: 'eco-card__sum', text: r.summary }),
          el('div', { class: 'eco-card__meta' }, [
            el('span', { text: CONFIDENCE_LABEL[r.confidence] || '' }),
            el('span', { text: `${r.dimCount} 维参与` }),
          ]),
          r.hits.length
            ? el('div', { class: 'eco-card__hits' }, r.hits.map((h) => el('span', { class: 'eco-hit', text: h.label })))
            : null,
          isBest ? el('div', { class: 'eco-card__badge', text: '最佳生态位' }) : null,
        ]);

        const toggleBtn = el('button', {
          class: 'eco-break__toggle',
          type: 'button',
          'aria-expanded': 'false',
          text: `查看 ${r.parts.length} 项拆解 ↓`,
        });

        const panel = disclosure(toggleBtn, 'eco-break', () => {
          const body = el('div', { class: 'eco-break__body' });

          /* 逐项拆解：维度名 + 匹配法则 + 双人分 + 双点对照轨 + 贡献分/权重 */
          r.parts.forEach((p) => {
            const name = DATA.dimMap[p.id]?.name || p.id;
            body.appendChild(el('div', { class: 'eco-prow' }, [
              el('div', { class: 'eco-prow__head' }, [
                el('span', { class: 'eco-prow__name', text: name }),
                el('span', { class: 'eco-prow__kind', text: KIND_LABEL[p.kind] || p.kind }),
              ]),
              el('div', { class: 'eco-prow__scores' }, [
                el('span', { class: 'eco-prow__ab' }, [
                  el('i', { class: 'is-a', text: nameA }),
                  el('b', { text: String(Math.round(p.av)) }),
                  el('em', { text: 'vs' }),
                  el('i', { class: 'is-b', text: nameB }),
                  el('b', { text: String(Math.round(p.bv)) }),
                ]),
                el('span', {
                  class: 'eco-prow__contrib',
                  text: `贡献 ${round(p.score, 1)} · 权重 ${p.w}`,
                }),
              ]),
              dualTrack(p.av, p.bv, { numbers: false, compact: true }),
            ]));
          });

          /* 扣分雷区明细 */
          if (r.hits.length) {
            body.appendChild(el('div', { class: 'eco-break__hits' }, [
              el('div', { class: 'eco-break__hits-h', text: `扣分雷区 · ${r.hits.length} 处` }),
              ...r.hits.map((h) => el('div', { class: 'eco-prow eco-prow--hit' }, [
                el('span', { class: 'eco-prow__name', text: h.label }),
                el('span', { class: 'eco-prow__contrib', text: `− ${h.w}` }),
              ])),
            ]));
          }

          body.appendChild(el('p', {
            class: 'eco-break__foot',
            text: `校准后加权 ${round(r.weighted, 1)} · 原始均值 ${round(r.raw, 1)} · 雷区合计 −${round(r.penalty, 1)} → ${round(r.value, 1)}`,
          }));

          return body;
        });

        card.appendChild(el('div', { class: 'eco-break__foot-zone' }, [toggleBtn]));
        card.appendChild(panel.wrap);
        ecoGrid.appendChild(card);
      });
      box.appendChild(ecoGrid);

      if (eco.missing.length) {
        box.appendChild(el('p', {
          style: {
            marginTop: '14px', fontSize: '11.5px', color: 'var(--text-tertiary)', lineHeight: '1.9',
          },
          text: `另有 ${eco.missing.map((m) => m.name).join(' / ')} 因共同维度不足暂未计算，完成对应卷宗后解锁。`,
        }));
      }
    }
  }

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
          { name: nameA, values: radarList.map((d) => A.computedScores[d.id]), color: COL.a, fillOpacity: 0.1 },
          { name: nameB, values: radarList.map((d) => B.computedScores[d.id]), color: COL.b, fillOpacity: 0.1 },
        ],
        labelSize: 10.5,
      },
    ));
    body.appendChild(el('div', { class: 'chart-legend' }, [
      el('span', { style: { color: COL.a }, html: `<i></i>${nameA}` }),
      el('span', { style: { color: COL.b }, html: `<i></i>${nameB}` }),
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
        el('div', { style: { fontSize: '11px', color: 'var(--text-tertiary)' }, html: `<span style="color:${COL.a}">${Math.round(av)}</span> · <span style="color:${COL.b}">${Math.round(bv)}</span>` }),
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
        el('div', { style: { fontSize: '11px', color: 'var(--text-tertiary)' }, html: `<span style="color:${COL.a}">${Math.round(r.a)}</span> ↔ <span style="color:${COL.b}">${Math.round(r.b)}</span>` }),
        el('div', { style: { fontSize: '10.5px', letterSpacing: '0.08em', color: 'var(--text-tertiary)' }, text: `差 ${Math.round(r.diff)}` }),
      ]));
    });
    box.appendChild(card);
  }

  {
    /* 全维度双人逐项显微镜 −− 放在生态位之后、三幕剧之前 */
    const micro = microSection({
      rows: res.rows || [], A, B, DATA, nameA, nameB,
    });
    if (micro) box.appendChild(micro);
  }

  /* ---------- 关系三幕剧 · 潜台词 · 红黑榜 ---------- */
  {
    const script = relationshipScript(A, B, { a: A.maskIndex, b: B.maskIndex });

    const head = el('div', { class: 'section-head' }, [
      el('h2', { text: '关系演变三幕剧' }),
      el('div', { class: 'section-head__hint', text: '按你们各自的边界与防御推演，不是预言' }),
    ]);
    box.appendChild(head);

    const timeline = el('div', { class: 'act-list' });
    script.acts.forEach((act, i) => {
      timeline.appendChild(el('div', { class: 'act' }, [
        el('div', { class: 'act__no', text: `第${['一', '二', '三'][i]}幕` }),
        el('div', { class: 'act__body' }, [
          el('h4', { class: 'act__title', text: act.title.replace(/^第.幕 · /, '') }),
          el('p', { class: 'act__text', text: act.body }),
          act.bodyPlus ? el('p', { class: 'act__plus', text: act.bodyPlus }) : null,
          act.tags.length
            ? el('div', { class: 'act__tags' }, act.tags.map((t) => el('span', { class: 'act-tag', text: t })))
            : null,
        ]),
      ]));
    });
    box.appendChild(timeline);

    /* 潜台词解码器：默认解对方那一侧 */
    const decoder = subtextDecoder(B, nameB);
    if (decoder.length) {
      const sh = el('div', { class: 'section-head' }, [
        el('h2', { text: '潜台词解码器' }),
        el('div', { class: 'section-head__hint', text: `${nameB} 说得最轻的那几句，通常最要紧` }),
      ]);
      box.appendChild(sh);

      const list = el('div', { class: 'subtext-list' });
      decoder.forEach((d) => {
        list.appendChild(el('div', { class: 'subtext' }, [
          el('div', { class: 'subtext__head' }, [
            el('span', { class: 'subtext__tag', text: d.tag }),
            el('span', { class: 'subtext__score', text: String(d.score) }),
          ]),
          el('div', { class: 'subtext__row' }, [
            el('span', { class: 'subtext__k', text: '表面台词' }),
            el('span', { class: 'subtext__v', text: d.line }),
          ]),
          el('div', { class: 'subtext__row' }, [
            el('span', { class: 'subtext__k', text: '底层诉求' }),
            el('span', { class: 'subtext__v', text: d.real }),
          ]),
          el('div', { class: 'subtext__row is-tip' }, [
            el('span', { class: 'subtext__k', text: '不踩雷的回应' }),
            el('span', { class: 'subtext__v', text: d.better }),
          ]),
        ]));
      });
      box.appendChild(list);
    }

    /* 红黑榜 */
    const board = chemistryBoard(A, B);
    if (board.green.length || board.red.length) {
      const sh = el('div', { class: 'section-head' }, [
        el('h2', { text: '相处红黑榜' }),
        el('div', { class: 'section-head__hint', text: '从欲望引擎、童年图式与道德基础自动提炼' }),
      ]);
      box.appendChild(sh);

      const grid2 = el('div', { class: 'board-grid' });
      const col1 = el('div', { class: 'board-col is-green' }, [
        el('h4', { class: 'board-col__title', text: '加分动作' }),
      ]);
      board.green.forEach((g) => {
        col1.appendChild(el('div', { class: 'board-item' }, [
          el('span', { class: 'board-item__who', text: g.for }),
          el('div', {}, [
            el('b', { text: g.title }),
            el('p', { text: g.text }),
          ]),
        ]));
      });
      const col2 = el('div', { class: 'board-col is-red' }, [
        el('h4', { class: 'board-col__title', text: '隐形禁区' }),
      ]);
      board.red.forEach((r) => {
        col2.appendChild(el('div', { class: 'board-item' }, [
          el('span', { class: 'board-item__who', text: r.for }),
          el('div', {}, [
            el('b', { text: r.title }),
            el('p', { text: r.text }),
          ]),
        ]));
      });
      grid2.appendChild(col1);
      grid2.appendChild(col2);
      box.appendChild(grid2);
    }
  }

  /* ---------- 页脚 ---------- */
  box.appendChild(el('div', {
    style: {
      marginTop: '26px', padding: '16px 0', borderTop: '1px solid var(--border)',
      fontSize: '11px', letterSpacing: '0.06em', color: 'var(--text-tertiary)',
      display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'space-between',
    },
  }, [
    el('span', {
      text: res.isExpressPair
        ? '交汇卷宗：极速速写 · 双方各自完成 28 题，按可比维度直接对齐'
        : `交汇卷宗：${res.common.map((v) => DATA.volumes[v]?.title || v).join(' · ')}`,
    }),
    el('span', { text: '全部计算在本地完成，双方数据均未离开设备' }),
  ]));
}

/* ------------------------------------------------------------
   全维度双人逐项显微镜
   · 4 种视图：按 16 卷分组 / 高度同频 / 最大反差 / 黄金互补
   · 卷宗筛选 + 关键词搜索
   · 每行 0–100 双人哑铃轨，点击展开单维深度释义
   ------------------------------------------------------------ */

/** 维度 → 所属卷短标（Vol.7） */
function volTagOf(DATA, dim) {
  const v = DATA.dimMap?.[dim]?.volume || '';
  const n = Number(String(v).replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? `Vol.${n}` : '';
}

function volIndex(DATA, dim) {
  const v = DATA.dimMap?.[dim]?.volume || '';
  const n = Number(String(v).replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 99;
}

/** 单维对比提示：一句人话 */
function contrastHint(dim, av, bv, nameA, nameB, DATA) {
  const label = DATA.dimMap?.[dim]?.name || dim;
  const d = Math.round(Math.abs(av - bv));
  const band = diffBand(av, bv);
  const tail = {
    'resonance-high': '你们都在高位，这件事上不需要解释就能对齐，也很容易一起高估风险。',
    'resonance-low': '你们都在低位，这一块是共同的空白区——没人负责，也很少有人抱怨。',
    sync: '两人读同一本书的同一页，分歧通常只发生在细节上。',
    tension: '容易在遇到此类场景时形成一攻一守的节奏差。',
    fork: '这是你们最容易互相误读的一处，同一件事会被翻译成两种完全不同的意思。',
    mild: '差异不大，但在压力大的时候会被放大成小摩擦。',
  }[band.key] || '';
  return `${nameA}在此项${toneLabel(av)}（${Math.round(av)}），${nameB}${toneLabel(bv)}（${Math.round(bv)}），差值 ${d} 分 —— ${tail}（${label} · ${band.label}）`;
}

/** 单维深度释义面板 */
function microPanel(dim, av, bv, nameA, nameB, DATA) {
  const m = DATA.mirrors?.[dim];
  const body = el('div', { class: 'cmp-mpanel__body' });

  if (!m) {
    body.appendChild(el('p', { class: 'cmp-mpanel__hint', text: '该维度暂无四面镜释义。' }));
    return body;
  }

  const faceOf = (v) => (v >= 50 ? m.high : m.low) || m.high || null;

  [
    { who: nameA, v: av, cls: 'is-a' },
    { who: nameB, v: bv, cls: 'is-b' },
  ].forEach(({ who, v, cls }) => {
    const face = faceOf(v);
    if (!face) return;
    const col = el('div', { class: `cmp-mface ${cls}` }, [
      el('div', { class: 'cmp-mface__head' }, [
        el('span', { class: 'cmp-mface__who', text: who }),
        el('span', { class: 'cmp-mface__label', text: face.label || '' }),
      ]),
      el('div', { class: 'cmp-mface__gift' }, [
        el('b', { text: face.gift_title || '' }),
        el('span', { text: face.gift_desc || '' }),
      ]),
      el('div', { class: 'cmp-mface__shadow' }, [
        el('b', { text: face.shadow_title || '' }),
        el('span', { text: face.shadow_desc || '' }),
      ]),
      face.alchemy_tip
        ? el('div', { class: 'cmp-mface__tip', text: face.alchemy_tip })
        : null,
    ]);
    body.appendChild(col);
  });

  body.appendChild(el('p', {
    class: 'cmp-mpanel__hint',
    text: contrastHint(dim, av, bv, nameA, nameB, DATA),
  }));

  return body;
}

function microSection({ rows, A, B, DATA, nameA, nameB }) {
  if (!rows || !rows.length) return null;

  const valid = rows.filter((r) => Number.isFinite(r.a) && Number.isFinite(r.b));
  if (!valid.length) return null;

  const section = el('section', { class: 'cmp-micro', id: 'cmp-micro' });

  section.appendChild(el('div', { class: 'section-head' }, [
    el('div', { class: 'cmp-micro__title' }, [
      el('h2', { text: '全维度双人逐项显微镜' }),
    ]),
    el('div', {
      class: 'section-head__hint',
      text: `${valid.length} 个可比维度 · 点击任意一行展开单维深度释义`,
    }),
  ]));

  /* ---------- 顶部固定图例条 ---------- */
  const legend = el('div', { class: 'cmp-micro__legend' }, [
    el('span', { class: 'cmp-legend__item' }, [el('i', { class: 'is-a' }), el('span', { text: nameA })]),
    el('span', { class: 'cmp-legend__item' }, [el('i', { class: 'is-b' }), el('span', { text: nameB })]),
    el('span', { class: 'cmp-legend__mid', text: '中线 50 为人群中性' }),
  ]);
  section.appendChild(legend);

  /* ---------- 工具栏 ---------- */
  const MODES = [
    { id: 'group', label: '按 16 卷分组' },
    { id: 'sync', label: '高度同频' },
    { id: 'gap', label: '最大反差' },
    { id: 'golden', label: '黄金互补' },
  ];
  let mode = 'group';
  let volFilter = 'all';
  let keyword = '';

  const toolbar = el('div', { class: 'cmp-micro__bar' });

  const pillRow = el('div', { class: 'cmp-micro__pills', role: 'group', 'aria-label': '视图切换' });
  const pillNodes = new Map();
  MODES.forEach((m) => {
    const b = el('button', {
      class: `cmp-pill${m.id === mode ? ' is-on' : ''}`,
      type: 'button',
      'aria-pressed': m.id === mode ? 'true' : 'false',
      text: m.label,
      onclick: () => {
        mode = m.id;
        pillNodes.forEach((node, id) => {
          node.classList.toggle('is-on', id === mode);
          node.setAttribute('aria-pressed', id === mode ? 'true' : 'false');
        });
        paint();
      },
    });
    pillNodes.set(m.id, b);
    pillRow.appendChild(b);
  });
  toolbar.appendChild(pillRow);

  /* 卷宗筛选：只列出双方真正有可比维度的卷 */
  const volSet = new Map();
  valid.forEach((r) => {
    const v = DATA.dimMap?.[r.dim]?.volume;
    if (!v) return;
    volSet.set(v, (volSet.get(v) || 0) + 1);
  });
  const volSorted = Array.from(volSet.keys()).sort((x, y) => volIndex(DATA, x) - volIndex(DATA, y));

  const select = el('select', { class: 'cmp-micro__select', 'aria-label': '卷宗筛选' });
  select.appendChild(el('option', { value: 'all', text: `全部卷宗 · ${valid.length} 维` }));
  volSorted.forEach((v) => {
    const n = Number(String(v).replace(/[^0-9]/g, ''));
    select.appendChild(el('option', {
      value: v,
      text: `${n ? `Vol.${n}` : v} · ${volSet.get(v)} 维`,
    }));
  });
  select.addEventListener('change', () => { volFilter = select.value; paint(); });
  toolbar.appendChild(select);

  const search = el('input', {
    class: 'cmp-micro__search',
    type: 'search',
    placeholder: '搜索维度名，例如「共情」',
    'aria-label': '按维度中文名过滤',
  });
  search.addEventListener('input', () => { keyword = search.value.trim(); paint(); });
  toolbar.appendChild(search);

  section.appendChild(toolbar);

  /* ---------- 列表 ---------- */
  const list = el('div', { class: 'cmp-micro__list' });
  const counter = el('div', { class: 'cmp-micro__count', text: '' });
  section.appendChild(list);
  section.appendChild(counter);

  function paint() {
    list.innerHTML = '';

    let picked = valid.filter((r) => {
      if (volFilter !== 'all' && DATA.dimMap?.[r.dim]?.volume !== volFilter) return false;
      if (!keyword) return true;
      const name = DATA.dimMap?.[r.dim]?.name || r.dim;
      return name.includes(keyword) || String(r.dim).includes(keyword);
    });

    if (mode === 'golden') {
      picked = picked.filter((r) => {
        const d = Math.abs(r.a - r.b);
        return d >= 15 && d <= 35;
      });
    }

    if (mode === 'sync') picked.sort((x, y) => Math.abs(x.a - x.b) - Math.abs(y.a - y.b));
    else if (mode === 'gap') picked.sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b));
    else if (mode === 'golden') picked.sort((x, y) => Math.abs(25 - Math.abs(x.a - x.b)) - Math.abs(25 - Math.abs(y.a - y.b)));
    else {
      picked.sort((x, y) => (volIndex(DATA, x.dim) - volIndex(DATA, y.dim))
        || String(DATA.dimMap?.[x.dim]?.name || x.dim).localeCompare(String(DATA.dimMap?.[y.dim]?.name || y.dim), 'zh'));
    }

    if (!picked.length) {
      list.appendChild(el('div', { class: 'cmp-micro__empty', text: mode === 'golden'
        ? '当前筛选下没有落在 15–35 分差区间的维度 —— 你们在剩下的维度上要么太像，要么分得太开。'
        : '没有匹配的维度，试试清空搜索词或切换卷宗。' }));
      counter.textContent = '';
      return;
    }

    /* 「按 16 卷分组」这一档如果只排序不加组头，视觉上就是一条长列表，
       用户根本看不出「这是 Vol.7 的了」。「分组」必须有组头才算数。
       其余三档（同频/反差/黄金互补）是按差值排的，加了组头反而打断排序语义，
       所以只在 group 模式插组头。 */
    let lastVol = null;
    picked.forEach((r) => {
      const band = diffBand(r.a, r.b);

      if (mode === 'group') {
        const v = DATA.dimMap?.[r.dim]?.volume || 'other';
        if (v !== lastVol) {
          lastVol = v;
          const n = Number(String(v).replace(/[^0-9]/g, ''));
          const title = DATA.volumes?.[v]?.title || '';
          const cnt = picked.filter((x) => (DATA.dimMap?.[x.dim]?.volume || 'other') === v).length;
          list.appendChild(el('div', { class: 'cmp-mgroup', 'data-vol': v }, [
            el('span', { class: 'cmp-mgroup__no', text: n ? `Vol.${String(n).padStart(2, '0')}` : '其他' }),
            el('span', { class: 'cmp-mgroup__name', text: title }),
            el('span', { class: 'cmp-mgroup__n', text: `${cnt} 维` }),
          ]));
        }
      }

      const row = el('div', {
        class: 'cmp-mrow',
        'data-openable': '',
        role: 'button',
        tabindex: '0',
        'aria-expanded': 'false',
      }, [
        el('div', { class: 'cmp-mrow__lead' }, [
          el('span', { class: 'cmp-mrow__name', text: DATA.dimMap?.[r.dim]?.name || r.dim }),
          el('span', { class: 'cmp-mrow__vol', text: volTagOf(DATA, r.dim) }),
        ]),
        dualTrack(r.a, r.b, { numbers: true }),
        el('div', { class: 'cmp-mrow__tail' }, [
          el('span', { class: `cmp-delta is-${band.key}`, text: `Δ ${Math.round(Math.abs(r.a - r.b))}` }),
          el('span', { class: `cmp-band is-${band.key}`, text: band.label }),
        ]),
      ]);

      const panel = disclosure(row, 'cmp-mpanel', () => microPanel(r.dim, r.a, r.b, nameA, nameB, DATA));
      row.appendChild(panel.wrap);

      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
      });

      list.appendChild(row);
    });

    counter.textContent = `显示 ${picked.length} / ${valid.length} 个可比维度`;
  }

  paint();
  return section;
}
