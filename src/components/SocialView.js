/* ============================================================
   SocialView.js — Phase 4 社交拓展实验室
   · JohariView：12 题印象盲盒（他评）+ 四象限
   · SquadView：3–6 人群像星图
   ============================================================ */

import { el, round, toast, copyText, downloadText } from '../core/utils.js';
import { radarSvg } from '../viz/radarSvg.js';
import { decodeSoulCode } from '../core/storage.js';
import {
  JOHARI_DIMS, JOHARI_QUESTIONS, encodeJohari, decodeJohari, johariResult,
} from '../core/johari.js';
import {
  assignRoles, roleMeta, affinityMatrix, coverage, squadCharter, SQUAD_ROLES,
} from '../core/squad.js';

const socialHead = (no, title, hint) => el('div', { class: 'rsec__head' }, [
  el('span', { class: 'rsec__no', text: no }),
  el('h2', { text: title }),
  hint ? el('p', { text: hint }) : null,
]);

/* ============================================================
   1 · 乔哈里窗
   ============================================================ */

export function renderJohari(root, ctx) {
  const { App, DATA, go } = ctx;
  const state = App.state;

  const parts = (location.hash || '').replace(/^#\//, '').split('/').filter(Boolean);
  // #/johari            → 发起（生成邀请链接）
  // #/johari/<HA4J码>    → 好友作答
  const code = parts[1] && /^HA4J-/i.test(parts[1]) ? decodeURIComponent(parts[1]) : null;

  root.classList.add('view');
  const wrap = el('div', { class: 'express-result' });
  root.appendChild(wrap);

  /* ---------- 好友作答模式 ---------- */
  if (code) {
    const dec = decodeJohari(code);
    if (!dec.ok) {
      wrap.appendChild(el('div', { class: 'empty' }, [
        el('h3', { text: '印象码无法解析' }),
        el('p', { text: dec.error }),
        el('a', { class: 'btn', href: '#/', text: '返回大厅' }),
      ]));
      return;
    }
    renderJohariGuest(wrap, dec, DATA);
    return;
  }

  /* ---------- 发起模式 ---------- */
  const hero = el('div', { class: 'express-hero' });
  hero.appendChild(el('div', { class: 'express-hero__kicker', text: 'Johari · 印象盲盒' }));
  hero.appendChild(el('h1', { text: '别人眼中的你' }));
  hero.appendChild(el('p', {
    text: '生成一条邀请链接，让朋友凭直觉回答 12 道关于你的短题。'
      + '他不需要自己测，90 秒就能答完。提交后会立刻画出一张「乔哈里窗」：'
      + '你和好友都看见的、只有他看见的、只有你知道的，以及谁都没触及的。',
  }));
  wrap.appendChild(hero);

  const dims = JOHARI_DIMS.filter((d) => Number.isFinite(state.computedScores?.[d]));
  const stats = el('dl', { class: 'express-stats' });
  [
    ['题目', '12'],
    ['好友耗时', '约 90 秒'],
    ['可测维度', `${dims.length}`],
    ['需要你的数据', dims.length >= 8 ? '已就绪' : '不足'],
  ].forEach(([k, v]) => {
    stats.appendChild(el('div', { class: 'express-stat' }, [
      el('dt', { text: k }),
      el('dd', { text: v }),
    ]));
  });
  wrap.appendChild(stats);

  if (dims.length < 8) {
    wrap.appendChild(el('p', {
      class: 'sandbox__hint',
      style: { marginTop: '16px' },
      text: '你的核心显性维度还不够（至少需要 8 个）。先完成 2–3 卷再来生成印象盲盒。',
    }));
    wrap.appendChild(el('div', { class: 'express-actions' }, [
      el('a', { class: 'btn btn--solid', href: '#/', text: '去作答' }),
    ]));
    return;
  }

  const jCode = encodeJohari(state.computedScores, state.nickname || '');
  const url = `${location.origin}${location.pathname}#/johari/${jCode}`;

  const linkBox = el('div', { class: 'code-box', text: url });
  wrap.appendChild(linkBox);

  wrap.appendChild(el('div', { class: 'express-actions' }, [
    el('button', {
      class: 'btn btn--solid',
      type: 'button',
      text: '复制邀请链接',
      onclick: async () => {
        const ok = await copyText(url);
        toast(ok ? '已复制，发给朋友即可' : '复制失败，请手动选择');
      },
    }),
    el('button', {
      class: 'btn',
      type: 'button',
      text: '复制印象码',
      onclick: async () => {
        const ok = await copyText(jCode);
        toast(ok ? '已复制 HA4J- 短码' : '复制失败');
      },
    }),
    el('a', { class: 'btn btn--ghost', href: '#/', text: '返回大厅' }),
  ]));

  wrap.appendChild(el('p', {
    class: 'notice',
    style: { marginTop: '22px' },
    html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/></svg><span>印象码只包含你的 12 个维度分数与昵称，不含任何答题原文。好友提交后得到的回传码同样是纯本地的，不需要联网。</span>',
  }));
}

function renderJohariGuest(wrap, dec, DATA) {
  const name = dec.nickname || '这位朋友';
  const picks = {};
  let submitted = false;

  const hero = el('div', { class: 'express-hero' });
  hero.appendChild(el('div', { class: 'express-hero__kicker', text: 'Johari · 印象盲盒' }));
  hero.appendChild(el('h1', { text: `${name} 想看看你眼中的他` }));
  hero.appendChild(el('p', {
    text: '下面 12 道题都不需要你想太多，凭第一印象选一个最像他的即可。'
      + '你答的不是自己，是他。全部答完后会立刻画出一张四象限图。',
  }));
  wrap.appendChild(hero);

  const form = el('div', { class: 'johari-form' });
  wrap.appendChild(form);

  const resultBox = el('div', { class: 'johari-result' });
  wrap.appendChild(resultBox);

  JOHARI_QUESTIONS.forEach((q, qi) => {
    const card = el('div', { class: 'johari-q', dataset: { dim: q.dim } });
    card.appendChild(el('div', { class: 'johari-q__no', text: `Q ${String(qi + 1).padStart(2, '0')}` }));
    card.appendChild(el('p', { class: 'johari-q__prom', text: q.prom }));

    const opts = el('div', { class: 'johari-q__opts' });
    q.opts.forEach((text, oi) => {
      const btn = el('button', {
        class: 'johari-opt',
        type: 'button',
        text,
        onclick: () => {
          picks[q.dim] = oi;
          opts.querySelectorAll('.johari-opt').forEach((b) => b.classList.remove('is-sel'));
          btn.classList.add('is-sel');
          card.classList.add('is-done');
          checkReady();
        },
      });
      opts.appendChild(btn);
    });
    card.appendChild(opts);
    form.appendChild(card);
  });

  const submitBtn = el('button', {
    class: 'btn btn--solid',
    type: 'button',
    text: '还没答完',
    disabled: true,
    onclick: () => {
      if (submitted) return;
      submitted = true;
      const guesses = JOHARI_DIMS
        .filter((d) => picks[d] !== undefined)
        .map((d) => ({ dim: d, pick: picks[d] }));
      showQuadrants(resultBox, dec, guesses, DATA, name);
      submitBtn.disabled = true;
      submitBtn.textContent = '已完成';
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });

  wrap.appendChild(el('div', { class: 'express-actions' }, [submitBtn]));

  function checkReady() {
    const n = Object.keys(picks).length;
    if (n < JOHARI_DIMS.length) {
      submitBtn.textContent = `还剩 ${JOHARI_DIMS.length - n} 题`;
      submitBtn.disabled = true;
    } else {
      submitBtn.textContent = '揭晓四象限';
      submitBtn.disabled = false;
    }
  }
  checkReady();
}

function showQuadrants(box, dec, guesses, DATA, name) {
  box.innerHTML = '';
  const res = johariResult(dec.scores, guesses);

  const head1 = el('div', { class: 'section-head' }, [
    el('h2', { text: '乔哈里窗' }),
    el('div', {
      class: 'section-head__hint',
      text: Number.isFinite(res.agreement) ? `你眼中的他 vs 他眼中的自己，一致度 ${res.agreement}%` : '',
    }),
  ]);
  box.appendChild(head1);

  const grid = el('div', { class: 'johari-grid' });
  const cell = (key, title, sub, rows, color) => {
    const c = el('div', { class: `johari-cell is-${key}` });
    c.appendChild(el('div', { class: 'johari-cell__top' }, [
      el('span', { class: 'johari-cell__no', text: color }),
      el('h3', { text: title }),
    ]));
    c.appendChild(el('p', { class: 'johari-cell__sub', text: sub }));
    if (!rows.length) {
      c.appendChild(el('p', { class: 'sandbox__hint', text: '这一区目前是空的。' }));
    } else {
      const list = el('div', { class: 'johari-cell__list' });
      rows.forEach((r) => {
        list.appendChild(el('div', { class: 'johari-cell__row' }, [
          el('span', { text: labelOfLocal(r.dim, DATA) }),
          el('b', { text: `${r.self} / ${r.friend}` }),
        ]));
      });
      c.appendChild(list);
      c.appendChild(el('p', {
        class: 'sandbox__hint',
        style: { marginTop: '8px' },
        text: '格式为：他自己的分 / 你猜的分',
      }));
    }
    return c;
  };

  grid.appendChild(cell('open', '公开区', '你们看法一致的地方', res.open, '01'));
  grid.appendChild(cell('blind', '盲区', '你一眼看见、他自己没注意到的', res.blind, '02'));
  grid.appendChild(cell('facade', '隐藏区', '他心里很强、藏得滴水不漏的', res.facade, '03'));
  grid.appendChild(cell('unknown', '未知潜能区', '谁都没触及的留白', res.unknown, '04'));
  box.appendChild(grid);

  box.appendChild(el('p', { class: 'sandbox__lead', text: summaryOf(res, name) }));

  /* 回传码 */
  const backCode = encodeJohari(
    Object.fromEntries([...res.open, ...res.blind, ...res.facade, ...res.unknown].map((r) => [r.dim, r.friend])),
    name,
  );

  box.appendChild(el('div', { class: 'express-actions' }, [
    el('button', {
      class: 'btn btn--solid',
      type: 'button',
      text: '复制回传码',
      onclick: async () => {
        const ok = await copyText(backCode);
        toast(ok ? '已复制，把它发回给 TA' : '复制失败');
      },
    }),
    el('button', {
      class: 'btn',
      type: 'button',
      text: '下载结果',
      onclick: () => {
        downloadText(
          `johari-${Date.now()}.txt`,
          `乔哈里窗 · ${name}\n一致度 ${res.agreement}%\n\n公开区 ${res.open.length} · 盲区 ${res.blind.length} · 隐藏区 ${res.facade.length} · 未知 ${res.unknown.length}\n\n回传码：${backCode}`,
          'text/plain;charset=utf-8',
        );
        toast('已下载');
      },
    }),
  ]));
}

function labelOfLocal(dim, DATA) {
  return DATA.dimMap?.[dim]?.name || dim;
}

function summaryOf(res, name) {
  const parts = [];
  if (res.blind.length) {
    parts.push(`你看见了 ${res.blind.length} 处他自己没注意的地方——这通常是他在别人面前比在自己心里更清楚的部分。`);
  }
  if (res.facade.length) {
    parts.push(`另有 ${res.facade.length} 处他很强，但藏得比较好，你这次没接住。`);
  }
  if (res.unknown.length > 4) {
    parts.push('还有不少留白，说明这些题不足以覆盖他的全部。');
  }
  parts.unshift(`这是 ${name} 在一个人眼里的一个切面，不是结论。`);
  return parts.join('');
}

/* ============================================================
   2 · 群像星图
   ============================================================ */

export function renderSquad(root, ctx) {
  const { DATA } = ctx;

  root.classList.add('view');
  const wrap = el('div', { class: 'express-result' });
  root.appendChild(wrap);

  const hero = el('div', { class: 'express-hero' });
  hero.appendChild(el('div', { class: 'express-hero__kicker', text: 'Squad · 群像星图' }));
  hero.appendChild(el('h1', { text: '一支队伍的形状' }));
  hero.appendChild(el('p', {
    text: '把 3–6 份存档码放在一起。系统会给每个人分配一个隐形生态位，'
      + '算出一张两两之间的缘分矩阵，并指出整支队伍共同缺的那块板。',
  }));
  wrap.appendChild(hero);

  const box = el('div', { class: 'squad-input' });
  wrap.appendChild(box);

  const rows = [];
  const resultBox = el('div', { class: 'squad-result' });
  wrap.appendChild(resultBox);

  function addSlot(idx) {
    const ta = el('textarea', {
      class: 'field field--code',
      rows: '2',
      placeholder: `第 ${idx + 1} 个人的 HA4- 存档码（或昵称）`,
    });
    const nameInput = el('input', {
      class: 'field',
      type: 'text',
      maxlength: '8',
      placeholder: '称呼（可空）',
      style: { maxWidth: '140px' },
    });
    const row = el('div', { class: 'squad-slot' }, [
      el('span', { class: 'squad-slot__no', text: String(idx + 1) }),
      ta,
      nameInput,
    ]);
    rows.push({ ta, nameInput, row });
    box.appendChild(row);
  }

  for (let i = 0; i < 3; i += 1) addSlot(i);

  box.appendChild(el('div', { class: 'express-actions' }, [
    el('button', {
      class: 'btn btn--sm',
      type: 'button',
      text: '+ 加一个人',
      onclick: () => {
        if (rows.length >= 6) { toast('最多 6 人'); return; }
        addSlot(rows.length);
      },
    }),
    el('button', {
      class: 'btn btn--solid',
      type: 'button',
      text: '生成群像',
      onclick: () => build(),
    }),
  ]));

  function build() {
    const members = [];
    const dimOrder = DATA.dimOrder;

    for (const r of rows) {
      const raw = r.ta.value.trim();
      if (!raw) continue;
      const dec = decodeSoulCode(raw, dimOrder);
      if (!dec.ok) { toast(`第 ${members.length + 1} 份解析失败：${dec.error}`); return; }
      members.push({
        name: r.nameInput.value.trim() || dec.state.nickname || `成员 ${members.length + 1}`,
        state: dec.state,
      });
    }

    if (members.length < 3) { toast('至少需要 3 份有效存档码'); return; }

    resultBox.innerHTML = '';
    renderSquadResult(resultBox, members, DATA);
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderSquadResult(box, members, DATA) {
  const roles = assignRoles(members, DATA);
  const aff = affinityMatrix(members, DATA);
  const cov = coverage(members, DATA);
  const charter = squadCharter(members, roles, cov.gaps);

  /* ---- 生态位 ---- */
  box.appendChild(socialHead('01', '小队生态位', `${members.length} 人 · 六种角色自动分配`));
  const roleGrid = el('div', { class: 'squad-roles' });
  roles.forEach((m) => {
    const meta = roleMeta(m.role);
    roleGrid.appendChild(el('div', { class: 'squad-role' }, [
      el('div', { class: 'squad-role__name', text: m.name }),
      el('div', { class: 'squad-role__tag', text: meta?.name || '—' }),
      el('p', { class: 'squad-role__desc', text: meta?.desc || '' }),
      el('span', { class: 'squad-role__fit', text: `契合 ${Math.round(m.roleFit)}` }),
    ]));
  });
  box.appendChild(roleGrid);

  /* ---- 缘分矩阵 ---- */
  if (aff.pairs.length) {
    box.appendChild(socialHead('02', '缘分热力矩阵', '数值为双人契合度，深色代表更合拍'));
    const table = el('table', { class: 'affinity' });
    const thead = el('thead');
    const hr = el('tr');
    hr.appendChild(el('th', { text: '' }));
    members.forEach((m) => hr.appendChild(el('th', { text: m.name })));
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = el('tbody');
    members.forEach((m, i) => {
      const tr = el('tr');
      tr.appendChild(el('th', { text: m.name }));
      members.forEach((_, j) => {
        const v = aff.matrix[i][j];
        const td = el('td');
        if (Number.isFinite(v)) {
          td.textContent = String(Math.round(v));
          td.style.background = `color-mix(in srgb, var(--gold) ${Math.round((v - 30) * 0.9)}%, transparent)`;
          if (i === j) td.style.opacity = '0.35';
        } else {
          td.textContent = '—';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    box.appendChild(table);

    if (aff.best) {
      box.appendChild(el('p', {
        class: 'sandbox__lead',
        text: `最合拍的两人：${members[aff.best.i].name} × ${members[aff.best.j].name}（${aff.best.score}）；`
          + `最需要留意的：${members[aff.worst.i].name} × ${members[aff.worst.j].name}（${aff.worst.score}）。`,
      }));
    }
  }

  /* ---- 覆盖与短板 ---- */
  box.appendChild(socialHead('03', '群体覆盖与共同短板', '这条轴有没有人在 60 分以上'));

  const covList = el('div', { class: 'squad-cov' });
  cov.rows.forEach((r) => {
    covList.appendChild(el('div', { class: `squad-cov__row${r.covered ? '' : ' is-gap'}` }, [
      el('span', { class: 'squad-cov__name', text: r.name }),
      el('span', { class: 'squad-cov__avg', text: `均 ${r.avg}` }),
      el('span', { class: 'squad-cov__max', text: `最高 ${r.max}` }),
      el('span', { class: 'squad-cov__tag', text: r.covered ? '已覆盖' : '缺口' }),
    ]));
  });
  box.appendChild(covList);

  /* ---- 公约 ---- */
  box.appendChild(socialHead('04', '小队相处公约', '从角色与缺口自动提炼'));
  const list = el('div', { class: 'squad-charter' });
  charter.forEach((line, i) => {
    list.appendChild(el('div', { class: 'squad-charter__item' }, [
      el('span', { class: 'squad-charter__no', text: String(i + 1).padStart(2, '0') }),
      el('p', { text: line }),
    ]));
  });
  box.appendChild(list);
}
