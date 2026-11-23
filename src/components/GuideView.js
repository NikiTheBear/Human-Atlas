/* ============================================================
   GuideView.js — 档案馆导览页（#/guide）

   结构：
     顶部策展宣言（星盘徽章 + 动态数据胶囊 + 双主按钮）
     6 个「点击展开」Bento 模块
     底部三路分流行动舱

   数据全部从 DATA 动态读，不写死任何卷数 / 题数 / 维度数。
   ============================================================ */

import { el, go, round } from '../core/utils.js';
import { emblemSvg } from '../viz/emblemsSvg.js';

/* ------------------------------------------------------------
   小工具
   ------------------------------------------------------------ */

const ICONS = {
  philosophy: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="16" cy="16" r="12"/><path d="M16 4v24M4 16h24"/>
    <circle cx="16" cy="16" r="4.5"/></svg>`,
  atlas: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 8l8-3 8 3 8-3v19l-8 3-8-3-8 3Z"/><path d="M12 5v19M20 8v19"/></svg>`,
  scoring: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 24l6-8 5 5 4-7 7 10"/><circle cx="11" cy="16" r="1.6"/><circle cx="20" cy="14" r="1.6"/></svg>`,
  lab: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 4h8M14 4v8l-6 12a3 3 0 0 0 2.7 4.3h10.6A3 3 0 0 0 24 24l-6-12V4"/><path d="M9.5 20h13"/></svg>`,
  social: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="12" r="4"/><circle cx="21" cy="12" r="4"/>
    <path d="M4 26c0-3.6 3.1-6 7-6M28 26c0-3.6-3.1-6-7-6"/></svg>`,
  vault: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="6" width="22" height="20" rx="2.5"/><circle cx="16" cy="16" r="5"/>
    <path d="M16 11v2M16 19v2M11 16h2M19 16h2"/></svg>`,
};

const kwChip = (text) => el('span', { class: 'guide-kw', text });

const detailRow = (title, body) => el('div', { class: 'guide-detail-row' }, [
  el('b', { text: title }),
  el('p', { text: body }),
]);

/* ------------------------------------------------------------
   模块 01 · 设计哲学与反伪装
   ------------------------------------------------------------ */

function panel01(DATA) {
  const box = el('div', { class: 'guide-panel' });

  box.appendChild(detailRow(
    '双面镜视角',
    '任何一项特质都不判优劣。同一个「高门槛的孤傲」，在资源充足时是专业骨气，在耗竭时是听不进劝。'
      + '所以每一维都拆成「优势面 / 阴影面」两面，并附一句可执行的炼金处方。',
  ));

  box.appendChild(el('h4', { class: 'guide-panel__h', text: '五种潜行题型' }));
  const types = [
    ['等值迫选', '所有选项同样体面，打破政治正确，逼出真实偏好。'],
    ['三秒直觉', '捕捉理智介入之前的第一本能，不计后果。'],
    ['潜行量表', '七档渐进触感圆点，无对错暗示，靠直径传达强度。'],
    ['100 点筹码', '有限资源必须分完，机会成本逼出真实优先级。'],
    ['价值金字塔', '8 选 3 排序，顺序本身就是答案。'],
  ];
  const grid = el('div', { class: 'guide-type-grid' });
  types.forEach(([name, desc]) => {
    grid.appendChild(el('div', { class: 'guide-type' }, [
      el('b', { text: name }),
      el('p', { text: desc }),
    ]));
  });
  box.appendChild(grid);

  box.appendChild(el('h4', { class: 'guide-panel__h', text: '五阶渐进解锁' }));
  const stages = [
    ['1 卷', '单维透视', '单卷报告 · 四面镜 · 9:16 海报'],
    ['3 卷', '交叉读心', '跨卷化学反应引擎激活'],
    ['5 卷', '面具显影', '常态 / 高压叠层与面具校准'],
    ['8 卷', '宇宙大成', '核心八卷闭环 · 全息白皮书'],
    ['16 卷', '破圈全启', '十六卷全通 · 终极典藏版'],
  ];
  const ladder = el('div', { class: 'guide-ladder' });
  stages.forEach(([need, name, desc], i) => {
    ladder.appendChild(el('div', { class: 'guide-step', dataset: { i } }, [
      el('span', { class: 'guide-step__no', text: String(i + 1).padStart(2, '0') }),
      el('div', {}, [
        el('b', { text: `${need} · ${name}` }),
        el('p', { text: desc }),
      ]),
    ]));
  });
  box.appendChild(ladder);

  void DATA;
  return box;
}

/* ------------------------------------------------------------
   模块 02 · 双季十六卷全景
   ------------------------------------------------------------ */

const THEORY = {
  vol1: '七宗罪（Gregory the Great 整理）与七美德的对偶结构；本卷把「罪」还原为七种过量的生存策略。',
  vol2: '大五人格（Big Five / OCEAN），在每一条主轴上再拆两个可观测的微观子维。',
  vol3: '光明三角（Kaufman）与黑暗三角（Paulhus & Williams, 2002），外加隐性掌控（covert control）。',
  vol4: '世界观 / 人生观 / 价值观三轴，配合施瓦茨基本价值理论的排序法。',
  vol5: '认知风格（Cognitive Style）：场依存—独立、发散—收敛、模糊耐受度等经典构念。',
  vol6: '自我决定论（Ryan & Deci）的内在动机六分类，用 100 点筹码做有限资源分配。',
  vol7: '成人依恋双轴（Bartholomew & Horowitz: 焦虑 × 回避）+ 精神分析六种防御机制。',
  vol8: '压力下的退行（regression）：爆发 / 断联 / 黑化 / 坍塌四态，同时充当跨卷明暗镜像校验层。',
  vol9: '荣格八维认知功能（Beebe 的八功能模型）：Te / Ti / Fe / Fi / Ne / Ni / Se / Si，含第 5–8 阴影位。',
  vol10: 'D&D 阵营九宫格（1974 年原版规则）：秩序—混乱 × 善良—邪恶两条轴形成九种位置。',
  vol11: '八大哲学流派底色 + 海特道德基础理论（Moral Foundations Theory），两侧各自测绘。',
  vol12: '九型人格（Enneagram）的核心恐惧与侧翼，加上三大本能副型（SP / SX / SO）。',
  vol13: '杨氏早期适应不良图式（Young, 1990）中 10 个高影响图式。',
  vol14: 'Klontz 四大金钱脚本 + 津巴多时间观量表（ZTPI）五维。',
  vol15: 'Thomas–Kilmann 五模式（TKI）+ 沟通分析（Berne）的 PAC 自我状态。',
  vol16: '高敏感特质（Elaine Aron, HSP）与刺激寻求（Zuckerman, HSS）的双轴四象限。',
};

const CHART_OF = {
  vol1: '双翼蝶形图',
  vol2: '大五雷达',
  vol3: '光暗双三角',
  vol4: '九维双极光谱',
  vol5: '六棱面光谱',
  vol6: '动机雷达 + 筹码条',
  vol7: '依恋四象限 + 防御光谱',
  vol8: '退行态分布 + 面具三分量',
  vol9: '荣格八维功能栈',
  vol10: '阵营九宫格',
  vol11: '十四维光谱',
  vol12: '十二维光谱',
  vol13: '十维图式光谱',
  vol14: '金钱脚本光谱',
  vol15: '冲突模式光谱',
  vol16: 'HSP × HSS 四象限',
};

function panel02(DATA, VOL_IDS) {
  const box = el('div', { class: 'guide-panel' });

  const coreIds = VOL_IDS.filter((v) => DATA.volumes[v].index <= 8);
  const expIds = VOL_IDS.filter((v) => DATA.volumes[v].index > 8);

  let activeSeries = 'core';
  const listBox = el('div', { class: 'guide-vol-list' });

  const tabs = el('div', { class: 'guide-vol-tabs' });
  [
    ['core', `第一辑 · 本源八卷`, coreIds.length],
    ['exp', `第二辑 · 破圈深水`, expIds.length],
  ].forEach(([key, label, n]) => {
    tabs.appendChild(el('button', {
      class: `guide-vol-tab${key === activeSeries ? ' is-on' : ''}`,
      type: 'button',
      dataset: { key },
      text: `${label} ${n}`,
      onclick: (e) => {
        activeSeries = key;
        tabs.querySelectorAll('.guide-vol-tab').forEach((b) => b.classList.toggle('is-on', b.dataset.key === key));
        renderList();
        void e;
      },
    }));
  });
  box.appendChild(tabs);
  box.appendChild(listBox);

  function renderList() {
    listBox.innerHTML = '';
    const ids = activeSeries === 'core' ? coreIds : expIds;

    ids.forEach((vid) => {
      const vol = DATA.volumes[vid];
      const dims = (vol.dimensions || [])
        .map((d) => DATA.dimMap[d]?.name)
        .filter(Boolean);

      const row = el('div', { class: 'guide-vol', style: { '--vc': vol.theme_color } });

      const head = el('button', {
        class: 'guide-vol__head',
        type: 'button',
        'aria-expanded': 'false',
        onclick: () => {
          const on = row.classList.toggle('is-open');
          head.setAttribute('aria-expanded', String(on));
        },
      }, [
        el('span', { class: 'guide-vol__dot' }),
        (() => {
          const emb = emblemSvg(vid, { class: 'guide-vol__emblem', strokeWidth: 1.05 });
          return emb;
        })(),
        el('span', { class: 'guide-vol__no', text: `VOL ${String(vol.index).padStart(2, '0')}` }),
        el('span', { class: 'guide-vol__title', text: vol.title }),
        el('span', { class: 'guide-vol__meta', text: `${vol.questions.length} 题 · ${dims.length} 维` }),
        el('span', { class: 'guide-vol__chev', text: '⌄' }),
      ]);

      const body = el('div', { class: 'guide-vol__body' });
      body.appendChild(el('p', { class: 'guide-vol__theory', text: THEORY[vid] || '' }));
      body.appendChild(el('div', { class: 'guide-vol__dims' }, dims.map((n) => kwChip(n))));
      body.appendChild(el('div', { class: 'guide-vol__foot' }, [
        el('span', { text: `专属图表：${CHART_OF[vid] || '光谱'}` }),
        el('span', { text: `约 ${vol.estimated_minutes} 分钟` }),
        el('button', {
          class: 'btn btn--sm btn--solid',
          type: 'button',
          text: '启封此卷 →',
          onclick: () => go(`#/vol/${vid}`),
        }),
      ]));

      row.appendChild(head);
      row.appendChild(body);
      listBox.appendChild(row);
    });
  }

  renderList();
  return box;
}

/* ------------------------------------------------------------
   模块 03 · 计分与面具算法
   ------------------------------------------------------------ */

function panel03() {
  const box = el('div', { class: 'guide-panel' });

  box.appendChild(detailRow(
    '全局权重池 · 按振幅加权',
    '所有已答题进入同一个池子，按「该题在该维度上的振幅 hi−lo」加权。'
      + '主测题振幅 4.0，附加题 0.8，天然拥有五倍话语权，不会被稀释。'
      + '盲选（题干 >45 字却 1.2 秒内作答）权重自动降到 0.4 倍。',
  ));

  box.appendChild(detailRow(
    '期望值居中 · 随机作答等于 50 分',
    '每题的中心不是区间中点，而是「该题选项上的期望值」。'
      + '这样「没提这件事」只算轻微反向证据，不会等于强烈否认；'
      + '随机乱选的数学期望严格落在 50 分。'
      + '筹码题同维多滑块先合并点数，基准取 100×k/N，再围绕期望值拉伸。',
  ));

  box.appendChild(detailRow(
    '贝叶斯证据收缩 · 单题不会虚高到 100',
    '只被 1–2 道题测到的维度，会向 50 分收缩（先验权重 1.2）。'
      + '答对一次不再等于满分，低证据维度的可信度也会在报告里标出来。',
  ));

  box.appendChild(detailRow(
    '个人内部尖峰 Z · 打破中庸魔咒',
    '光有绝对分不够：温和型用户所有维度都挤在 45–60 之间，报告会很平淡。'
      + 'Z_d = (S_d − μ) / max(σ, 6) 会把「这个人身上真正突出的那一处」翻出来，'
      + '王牌天赋卡与阴影预警卡按绝对分与 |Z| 综合排序。',
  ));

  /* 面具三分量比例条 */
  box.appendChild(el('h4', { class: 'guide-panel__h', text: '社会面具厚度 M 的三分量' }));
  const parts = [
    ['社会期许偏移', 35, 'var(--vol1)'],
    ['敏感题犹豫', 25, 'var(--gold)'],
    ['跨卷镜像撕裂', 40, 'var(--vol5)'],
  ];
  const bar = el('div', { class: 'guide-maskbar' });
  parts.forEach(([name, pct, color]) => {
    const seg = el('span', { class: 'guide-maskbar__seg' });
    seg.style.width = `${pct}%`;
    seg.style.background = color;
    seg.title = `${name} ${pct}%`;
    bar.appendChild(seg);
  });
  box.appendChild(bar);
  box.appendChild(el('div', { class: 'guide-maskbar__legend' }, parts.map(([name, pct, color]) => {
    const s = el('span', {}, [el('i'), el('b', { text: `${name} ${pct}%` })]);
    s.querySelector('i').style.background = color;
    return s;
  })));

  box.appendChild(el('div', { class: 'guide-tiers' }, [
    el('div', {}, [el('b', { text: 'M < 30 · 本真赤诚层' }), el('p', { text: '表里高度一致，极少为了迎合而扭曲自我。' })]),
    el('div', {}, [el('b', { text: 'M 30–60 · 体面调节层' }), el('p', { text: '有成熟的社交分寸，能切换职场外衣与私下本我。' })]),
    el('div', {}, [el('b', { text: 'M ≥ 60 · 精密防卫层' }), el('p', { text: '对外克制得体，内心有强烈反差张力。' })]),
  ]));
  return box;
}

/* ------------------------------------------------------------
   模块 04 · 个人深度实验室
   ------------------------------------------------------------ */

function panel04() {
  const box = el('div', { class: 'guide-panel' });
  const items = [
    ['优势 / 劣势 双面镜', '每一项特质的正反显影，配一句可执行的炼金处方。'],
    ['压力变形沙盒', '拖动压力滑杆（顺境 ↔ 常态 ↔ 极度耗竭），看雷达实时形变与刹车提醒。'],
    ['内在议会', '自动揪出同时偏高却互相打架的两股驱动力，生成双声部对话与调解建议。'],
    ['时间胶囊', '封存首次作答的本能态，或导入半年前的存档码，对照「过去的我 vs 此刻的我」。'],
    ['导出工作室', '9:16 藏书票海报、A4 白皮书 PDF、Markdown 笔记，以及一键生成「AI 深度心理分析师精读密文」。'],
  ];
  const grid = el('div', { class: 'guide-lab-grid' });
  items.forEach(([name, desc]) => {
    grid.appendChild(el('div', { class: 'guide-lab' }, [
      el('b', { text: name }),
      el('p', { text: desc }),
    ]));
  });
  box.appendChild(grid);
  box.appendChild(el('div', { class: 'guide-actions' }, [
    el('a', { class: 'btn btn--sm', href: '#/report', text: '前往个人报告 →' }),
  ]));
  return box;
}

/* ------------------------------------------------------------
   模块 05 · 社交与关系实验室
   ------------------------------------------------------------ */

function panel05() {
  const box = el('div', { class: 'guide-panel' });

  box.appendChild(el('h4', { class: 'guide-panel__h', text: '关系生态位' }));
  const eco = [
    ['长期伴侣', '底线一致 + 依恋稳态；扣分雷区是焦虑 × 回避的追逃。'],
    ['心动拉扯', '异质张力 + 推进度；双方都躲就没人破冰。'],
    ['灵魂知己', '精神底色同频；双方都高才满分，「一起不在乎」不算。'],
    ['事业搭档', '认知互补 + 契约底线；空想无落地是主要减分项。'],
    ['日常合住', '节律与边界同频；极高秩序 × 极低秩序会互相折磨。'],
    ['镜面宿敌', '锋芒对撞，双方都高才得分，代表戏剧性而非敌意。'],
  ];
  const ecoGrid = el('div', { class: 'guide-eco-grid' });
  eco.forEach(([name, desc]) => {
    ecoGrid.appendChild(el('div', { class: 'guide-eco' }, [
      el('b', { text: name }),
      el('p', { text: desc }),
    ]));
  });
  box.appendChild(ecoGrid);

  box.appendChild(el('div', { class: 'guide-other' }, [
    detailRow('关系三幕剧', '按双方的边界与防御推演初识、升温、首次摩擦三幕，附破冰口令。'),
    detailRow('潜台词解码器', '对方说得最轻的那几句，通常最要紧。给出「表面台词 → 底层诉求 → 不踩雷的回应」。'),
    detailRow('28 题极速合盘', '4 分钟低门槛邀请朋友完成，答完自动合并对比，无需手动复制长代码。'),
    detailRow('乔哈里窗 12 题印象盲盒', '好友 90 秒凭印象替你作答，画出公开区 / 盲区 / 隐藏区 / 未知区。'),
    detailRow('3–6 人群像星图', '导入小圈子存档码，生成生态位分工、N×N 缘分矩阵与团队避雷公约。'),
  ]));

  box.appendChild(el('div', { class: 'guide-actions' }, [
    el('a', { class: 'btn btn--sm', href: '#/compare', text: '前往关系实验室 →' }),
    el('a', { class: 'btn btn--sm btn--ghost', href: '#/johari', text: '发起印象盲盒' }),
    el('a', { class: 'btn btn--sm btn--ghost', href: '#/squad', text: '群像星图' }),
  ]));
  return box;
}

/* ------------------------------------------------------------
   模块 06 · HA4- 存档码与隐私
   ------------------------------------------------------------ */

function panel06() {
  const box = el('div', { class: 'guide-panel' });

  box.appendChild(el('h4', { class: 'guide-panel__h', text: 'HA4- 字节火车' }));
  const segs = [
    ['版本号', '1B'],
    ['16 卷位掩码', '2B'],
    ['年月时间胶囊', '2B'],
    ['面具厚度', '1B'],
    ['Top3 价值', '3B'],
    ['127 维压缩分', '127B'],
    ['昵称 + 校验和', '≤13B'],
  ];
  const train = el('div', { class: 'guide-train' });
  segs.forEach(([name, bytes]) => {
    train.appendChild(el('div', { class: 'guide-train__car' }, [
      el('b', { text: bytes }),
      el('span', { text: name }),
    ]));
  });
  box.appendChild(train);
  box.appendChild(el('p', { class: 'guide-note', text: 'Base64url 编码后约 195 字符，100% 向下兼容旧版 HA3- 存档码（注册表前 60 位顺序未变）。' }));

  box.appendChild(el('h4', { class: 'guide-panel__h', text: '三重隐私承诺' }));
  const promises = [
    ['只在本地', '298 道题的原始作答与耗时遥测，仅存于当前浏览器的 localStorage，不上传任何服务器。'],
    ['分享不含答案', 'HA4- 短码只含压缩后的维度得分向量，绝不包含你的具体题目答案原文。'],
    ['随时可清除', '支持一键导出完整 JSON 本地备份，也支持彻底清空所有数据。'],
  ];
  const list = el('div', { class: 'guide-promise' });
  promises.forEach(([t, d], i) => {
    list.appendChild(el('div', { class: 'guide-promise__item' }, [
      el('span', { class: 'guide-promise__no', text: String(i + 1).padStart(2, '0') }),
      el('div', {}, [el('b', { text: t }), el('p', { text: d })]),
    ]));
  });
  box.appendChild(list);
  return box;
}

/* ------------------------------------------------------------
   主渲染
   ------------------------------------------------------------ */

export function renderGuide(root, ctx) {
  const { DATA, VOL_IDS, go: nav } = ctx;

  const volCount = VOL_IDS.length;
  const qCount = VOL_IDS.reduce((a, v) => a + DATA.volumes[v].questions.length, 0);
  const dimCount = DATA.dimOrder.length;
  const ruleCount = (DATA.crossRules || []).length;

  root.classList.add('view');
  const wrap = el('div', { class: 'guide' });
  root.appendChild(wrap);

  /* ---------- Hero ---------- */
  const hero = el('section', { class: 'guide-hero' });

  const mark = el('div', { class: 'guide-hero__mark' });
  mark.innerHTML = `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="0.9">
    <circle cx="60" cy="60" r="52" opacity="0.35"/>
    <circle cx="60" cy="60" r="40" opacity="0.5"/>
    <circle cx="60" cy="60" r="26" opacity="0.7"/>
    <circle cx="60" cy="60" r="9"/>
    <path d="M60 8v18M60 94v18M8 60h18M94 60h18" opacity="0.6"/>
    <path d="M60 20v80M20 60h80" opacity="0.16"/>
    <circle cx="60" cy="20" r="2.1" fill="currentColor" stroke="none"/>
    <circle cx="100" cy="60" r="2.1" fill="currentColor" stroke="none"/>
    <circle cx="60" cy="100" r="2.1" fill="currentColor" stroke="none"/>
    <circle cx="20" cy="60" r="2.1" fill="currentColor" stroke="none"/>
  </svg>`;
  hero.appendChild(mark);

  hero.appendChild(el('div', { class: 'guide-hero__kicker', text: 'THE HUMAN ATLAS · 档案馆序言' }));
  hero.appendChild(el('h1', { class: 'guide-hero__title', text: '一座关于人性的精密档案馆' }));
  hero.appendChild(el('p', {
    class: 'guide-hero__sub',
    text: '不给任何人贴好坏标签，也不用「你是哪种类型」这种娱乐化结论。'
      + '它用潜行式题面绕过理性修饰，只把你在具体处境里的真实偏向记下来。',
  }));
  hero.appendChild(el('p', {
    class: 'guide-hero__sub',
    text: '全部计算在你的浏览器里完成，没有服务器，也没有任何数据上传。',
  }));

  const capsule = el('div', { class: 'guide-capsule' });
  [
    `${volCount} 卷`,
    `${qCount} 情境`,
    `${dimCount} 维度`,
    `${ruleCount} 条跨卷规则`,
    '100% 本地运算',
  ].forEach((t) => capsule.appendChild(el('span', { text: t })));
  hero.appendChild(capsule);

  hero.appendChild(el('div', { class: 'guide-hero__actions' }, [
    el('button', {
      class: 'btn btn--solid',
      type: 'button',
      text: '4 分钟极速初见（28 题）→',
      onclick: () => { markSeen(); nav('#/express'); },
    }),
    el('button', {
      class: 'btn',
      type: 'button',
      text: '直接进入十六卷大厅',
      onclick: () => { markSeen(); nav('#/'); },
    }),
  ]));

  hero.appendChild(el('p', { class: 'guide-hero__hint', text: '↓ 点击下方任意模块，展开了解图谱结构、算法原理与隐藏玩法' }));
  wrap.appendChild(hero);

  /* ---------- 六大模块 ---------- */
  const MODULES = [
    {
      no: '01',
      icon: ICONS.philosophy,
      title: '设计哲学与反伪装机制',
      hook: '这里不给任何人贴好坏标签——五种潜行题型，绕过理性修饰。',
      kws: ['双面镜', '五种题型', '五阶解锁'],
      render: () => panel01(DATA),
    },
    {
      no: '02',
      icon: ICONS.atlas,
      title: '双季十六卷全景图谱',
      hook: '从古典七宗罪到荣格八维、金钱脚本与高敏感神经边缘，127 维完整坐标。',
      kws: ['16 卷', '理论溯源', '维度胶囊'],
      render: () => panel02(DATA, VOL_IDS),
    },
    {
      no: '03',
      icon: ICONS.scoring,
      title: '六层科学计分与面具算法',
      hook: '拒绝简单加减分——贝叶斯收缩、期望值居中与三维度静默防卫测算。',
      kws: ['振幅加权', '证据收缩', 'Z 尖峰'],
      render: () => panel03(),
    },
    {
      no: '04',
      icon: ICONS.lab,
      title: '个人深度实验室',
      hook: '不只是静态分数表——双面镜、压力变形沙盒、内在议会与时间胶囊。',
      kws: ['压力沙盒', '内在议会', 'AI 密文'],
      render: () => panel04(),
    },
    {
      no: '05',
      icon: ICONS.social,
      title: '多维社交与关系实验室',
      hook: '测出你们最适合当什么关系——关系生态位、印象盲猜与小圈子群像。',
      kws: ['关系生态位', '乔哈里窗', '群像星图'],
      render: () => panel05(),
    },
    {
      no: '06',
      icon: ICONS.vault,
      title: 'HA4- 灵魂存档码与绝对隐私',
      hook: '195 个字符装下 127 维全息人生——纯前端本地运算，无任何数据上传。',
      kws: ['字节火车', 'HA3- 兼容', '零上传'],
      render: () => panel06(),
    },
  ];

  const grid = el('div', { class: 'guide-grid' });

  MODULES.forEach((m) => {
    const card = el('article', { class: 'guide-card' });

    const btn = el('button', {
      class: 'guide-card__head',
      type: 'button',
      'aria-expanded': 'false',
      onclick: () => toggle(card),
    }, [
      el('span', { class: 'guide-card__no', text: m.no }),
      el('span', { class: 'guide-card__icon', html: m.icon }),
      el('span', { class: 'guide-card__title', text: m.title }),
      el('span', { class: 'guide-card__hook', text: m.hook }),
      el('span', { class: 'guide-card__kws' }, m.kws.map(kwChip)),
      el('span', { class: 'guide-card__more', text: '展开详情 ↓' }),
    ]);

    const bodyWrap = el('div', { class: 'guide-card__bodywrap' });
    const bodyInner = el('div', { class: 'guide-card__bodyinner' });
    bodyWrap.appendChild(bodyInner);

    card.appendChild(btn);
    card.appendChild(bodyWrap);
    card._built = false;
    card._module = m;

    grid.appendChild(card);
  });

  function toggle(card) {
    const isOpen = card.classList.contains('is-open');

    // 互斥：先收起其他
    grid.querySelectorAll('.guide-card.is-open').forEach((other) => {
      if (other === card) return;
      other.classList.remove('is-open');
      other.querySelector('.guide-card__head')?.setAttribute('aria-expanded', 'false');
    });

    if (isOpen) {
      card.classList.remove('is-open');
      card.querySelector('.guide-card__head')?.setAttribute('aria-expanded', 'false');
      return;
    }

    if (!card._built) {
      card.querySelector('.guide-card__bodyinner').appendChild(card._module.render());
      card._built = true;
    }
    card.classList.add('is-open');
    card.querySelector('.guide-card__head')?.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  wrap.appendChild(grid);

  /* ---------- 底部三路分流 ---------- */
  const tail = el('section', { class: 'guide-tail' });
  tail.appendChild(el('h2', { class: 'guide-tail__title', text: '从哪里开始' }));
  tail.appendChild(el('p', { class: 'guide-tail__sub', text: '三种心态，三条入口。都不必一次做完。' }));

  const ways = el('div', { class: 'guide-ways' });
  [
    {
      tag: '只有 4 分钟 / 刚收到朋友安利',
      title: '28 题初见微光',
      desc: '极速合盘版。答完立刻拿到简报与存档码，之后做完整卷不会重复作答。',
      action: { text: '开始极速版 →', run: () => { markSeen(); go('#/express'); } },
    },
    {
      tag: '想重点测清关系与情绪模式',
      title: '三卷关系内核',
      desc: '三观 · 亲密防线 · 冲突剧场。三卷闭环即可解锁关系生态位合盘。',
      action: { text: '先去 Vol.4 三观 →', run: () => { markSeen(); go('#/vol/vol4'); } },
      extra: [
        { text: 'Vol.7', href: '#/vol/vol7' },
        { text: 'Vol.15', href: '#/vol/vol15' },
      ],
    },
    {
      tag: '想完整建立个人全息档案',
      title: '从第一册启封',
      desc: '十六卷任意顺序可做，每卷独立闭环。全部完成解锁 36 原型与全息白皮书。',
      action: { text: '从 Vol.1《光影圣殿》启封 →', run: () => { markSeen(); go('#/vol/vol1'); } },
      extra: [{ text: '十六卷大厅', href: '#/' }],
    },
  ].forEach((w) => {
    const card = el('div', { class: 'guide-way' });
    card.appendChild(el('span', { class: 'guide-way__tag', text: w.tag }));
    card.appendChild(el('h3', { text: w.title }));
    card.appendChild(el('p', { text: w.desc }));
    const acts = el('div', { class: 'guide-way__acts' }, [
      el('button', {
        class: 'btn btn--sm btn--solid',
        type: 'button',
        text: w.action.text,
        onclick: w.action.run,
      }),
    ]);
    (w.extra || []).forEach((x) => {
      acts.appendChild(el('a', { class: 'btn btn--sm btn--ghost', href: x.href, text: x.text }));
    });
    card.appendChild(acts);
    ways.appendChild(card);
  });
  tail.appendChild(ways);
  wrap.appendChild(tail);

  wrap.appendChild(el('footer', { class: 'colophon' }, [
    el('span', { text: 'THE HUMAN ATLAS · 纯前端本地运算，无任何数据上传' }),
    el('span', { text: `数据版本 v${DATA.dimensions.version} · ${dimCount} 维 · ${qCount} 题` }),
  ]));

  void round;
}

/* ------------------------------------------------------------
   首屏分流用
   ------------------------------------------------------------ */

const GUIDE_SEEN_KEY = 'human-atlas::guideSeen';

export function guideSeen() {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markSeen() {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, '1');
  } catch { /* 忽略 */ }
}
