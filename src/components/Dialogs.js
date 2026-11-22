/* ============================================================
   Dialogs.js — 通用模态：昵称 / 导入存档码 / 存档码展示 / 确认
   ============================================================ */

import { el, copyText, toast } from '../core/utils.js';

let activeScrim = null;

export function closeDialog() {
  if (activeScrim) {
    activeScrim.remove();
    activeScrim = null;
    document.body.style.overflow = '';
  }
}

function openDialog({ title, sub, body, foot, wide = false }) {
  closeDialog();

  const scrim = el('div', {
    class: 'scrim',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
    onclick: (e) => { if (e.target === scrim) closeDialog(); },
  });

  const dlg = el('div', { class: `dialog${wide ? ' dialog--wide' : ''}` });

  const head = el('div', { class: 'dialog__head' }, [
    el('h2', { text: title }),
    el('button', {
      class: 'dialog__x', type: 'button', 'aria-label': '关闭',
      text: '×',
      onclick: closeDialog,
    }),
  ]);

  dlg.appendChild(head);
  if (sub) dlg.appendChild(el('p', { class: 'dialog__sub', text: sub }));
  if (body) dlg.appendChild(el('div', { class: 'dialog__body' }, [body]));
  if (foot) dlg.appendChild(el('div', { class: 'dialog__foot' }, foot));

  scrim.appendChild(dlg);
  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';
  activeScrim = scrim;

  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeDialog();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);

  return { scrim, dlg };
}

/* ------------------------------------------------------------
   昵称
   ------------------------------------------------------------ */

export function openNicknameDialog(state, onSave) {
  const input = el('input', {
    class: 'field',
    type: 'text',
    maxlength: '12',
    placeholder: '一个你愿意被称呼的名字',
    value: state.nickname || '',
  });

  const body = el('div', {}, [
    el('label', { class: 'field-label', text: '署名 / 昵称' }),
    input,
    el('p', {
      class: 'notice',
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/></svg><span>所有数据只存于这台设备的浏览器本地，不会上传到任何服务器。</span>',
    }),
  ]);

  const { dlg } = openDialog({
    title: '你的署名',
    sub: '这份档案会以这个名字归档。它只保存在本机。',
    body,
    foot: [
      el('button', { class: 'btn', type: 'button', text: '取消', onclick: closeDialog }),
      el('button', {
        class: 'btn btn--solid',
        type: 'button',
        text: '保存',
        onclick: () => {
          const v = input.value.trim().slice(0, 12);
          state.nickname = v;
          onSave?.(v);
          closeDialog();
          toast(v ? `已记下：${v}` : '已清空署名');
        },
      }),
    ],
  });

  setTimeout(() => input.focus(), 60);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = input.value.trim().slice(0, 12);
      state.nickname = v;
      onSave?.(v);
      closeDialog();
      toast(v ? `已记下：${v}` : '已清空署名');
    }
  });
  return dlg;
}

/* ------------------------------------------------------------
   导入存档码 / JSON
   ------------------------------------------------------------ */

export function openImportDialog({ importSoulCode, importJSONText, onDone }) {
  const ta = el('textarea', {
    class: 'field field--code',
    rows: '5',
    placeholder: 'HA4-xxxxxxxxxxxx……  或粘贴完整 JSON 备份',
  });

  const status = el('div', { class: 'cmp-slot__status', text: '' });

  const body = el('div', {}, [
    el('label', { class: 'field-label', text: '存档码 / 备份文件内容' }),
    ta,
    el('div', { class: 'cmp-slot__foot' }, [status]),
    el('p', {
      class: 'notice',
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg><span>存档码只包含得分、面具指数与价值排序（HA4- 为十六卷新码，HA3- 老码仍可导入），不含你的答案原文。导入时会与现有进度合并。</span>',
    }),
  ]);

  const doImport = () => {
    const raw = ta.value.trim();
    if (!raw) {
      status.textContent = '请先粘贴内容';
      status.className = 'cmp-slot__status is-err';
      return;
    }
    let res;
    if (/^HA[34]-/i.test(raw)) {
      res = importSoulCode(raw, { merge: true });
    } else {
      res = importJSONText(raw);
    }
    if (!res.ok) {
      status.textContent = res.error || '导入失败';
      status.className = 'cmp-slot__status is-err';
      return;
    }
    status.textContent = '导入成功';
    status.className = 'cmp-slot__status is-ok';
    setTimeout(() => {
      closeDialog();
      toast('存档已合并');
      onDone?.();
    }, 420);
  };

  const { dlg } = openDialog({
    title: '导入存档',
    sub: '跨设备续测、或恢复一份旧档案。导入后会与当前进度合并，不会覆盖已有作答。',
    body,
    foot: [
      el('button', { class: 'btn', type: 'button', text: '取消', onclick: closeDialog }),
      el('button', { class: 'btn btn--solid', type: 'button', text: '导入', onclick: doImport }),
    ],
  });

  setTimeout(() => ta.focus(), 60);
  return dlg;
}

/* ------------------------------------------------------------
   展示存档码
   ------------------------------------------------------------ */

export function openSoulDialog(code, state, totalVolumes = 16) {
  const box = el('div', { class: 'code-box', text: code });

  const stats = el('div', {
    style: { display: 'flex', gap: '18px', marginTop: '14px', flexWrap: 'wrap' },
  }, [
    el('span', { class: 'chip', text: `已完成 ${(state.completedVolumes || []).length}/${totalVolumes} 卷` }),
    el('span', { class: 'chip', text: `面具 ${Number.isFinite(state.maskIndex) ? Math.round(state.maskIndex) : '—'}` }),
    el('span', { class: 'chip', text: `${code.length} 字符` }),
  ]);

  const body = el('div', {}, [
    el('label', { class: 'field-label', text: '灵魂存档码' }),
    box,
    stats,
    el('p', {
      class: 'notice',
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg><span>可直接粘贴到微信 / 备忘录。在另一台设备打开本站，点「导入存档」把它粘进去，即可继续。</span>',
    }),
  ]);

  const copyBtn = el('button', {
    class: 'btn btn--solid',
    type: 'button',
    text: '复制存档码',
    onclick: async () => {
      const ok = await copyText(code);
      toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择');
      if (!ok) {
        const range = document.createRange();
        range.selectNodeContents(box);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },
  });

  return openDialog({
    title: '灵魂存档码',
    sub: '这段字符串包含你的得分向量、面具指数与核心价值排序。它不含答案原文。',
    body,
    foot: [
      el('button', { class: 'btn', type: 'button', text: '关闭', onclick: closeDialog }),
      copyBtn,
    ],
  });
}

/* ------------------------------------------------------------
   确认
   ------------------------------------------------------------ */

export function confirmDialog({ title, sub, confirmText = '确认', danger = false, onConfirm }) {
  return openDialog({
    title,
    sub,
    foot: [
      el('button', { class: 'btn', type: 'button', text: '取消', onclick: closeDialog }),
      el('button', {
        class: `btn ${danger ? 'btn--accent' : 'btn--solid'}`,
        type: 'button',
        text: confirmText,
        onclick: () => {
          closeDialog();
          onConfirm?.();
        },
      }),
    ],
  });
}
