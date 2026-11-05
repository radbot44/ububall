'use strict';
// Game-styled UI shared by every screen: Tabler icons, dropdowns anchored to the control that
// opens them (never pushing content), confirm and name dialogs, and a custom select. ububall
// runs inside Discord Activities and as a phone app, so nothing here falls back to browser UI.
(function(root) {
  // Tabler outline icons (MIT), from uburoom's icon set.
  const ICONS = {
    shield: ['M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3'],
    rotate: ['M19.95 11a8 8 0 1 0 -.5 4m.5 5v-5h-5'],
    heart: ['M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572'],
    'info-circle': ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 9h.01', 'M11 12h1v4h1'],
    help: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M12 17l0 .01', 'M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4'],
    'arrows-shuffle': ['M18 4l3 3l-3 3', 'M18 20l3 -3l-3 -3', 'M3 7h3a5 5 0 0 1 5 5a5 5 0 0 0 5 5h5', 'M21 7h-5a4.978 4.978 0 0 0 -3 1m-4 8a4.984 4.984 0 0 1 -3 1h-3'],
    'arrows-left-right': ['M21 17l-18 0', 'M6 10l-3 -3l3 -3', 'M3 7l18 0', 'M18 20l3 -3l-3 -3'],
    'arrows-sort': ['M3 9l4 -4l4 4m-4 -4v14', 'M21 15l-4 4l-4 -4m4 4v-14'],
    'chart-bar': ['M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6', 'M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10', 'M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14', 'M4 20h14'],
    'arrow-left': ['M5 12l14 0', 'M5 12l6 6', 'M5 12l6 -6'],
    'arrow-narrow-right': ['M5 12l14 0', 'M15 16l4 -4', 'M15 8l4 4'],
    check: ['M5 12l5 5l10 -10'],
    'chevron-down': ['M6 9l6 6l6 -6'],
    'columns-2': ['M3 4a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-16', 'M12 3v18'],
    'chevron-left': ['M15 6l-6 6l6 6'],
    'chevron-right': ['M9 6l6 6l-6 6'],
    dots: ['M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'],
    x: ['M18 6l-12 12', 'M6 6l12 12'],
    trophy: ['M8 21l8 0', 'M12 17l0 4', 'M7 4l10 0', 'M17 4v8a5 5 0 0 1 -10 0v-8', 'M3 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M17 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'],
    target: ['M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0', 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0']
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('icon');
    for (const d of ICONS[name]) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d); svg.append(path);
    }
    return svg;
  }
  // Markup asks for an icon with <i data-icon="name"></i>.
  function fillIcons(scope = document) {
    for (const holder of scope.querySelectorAll('i[data-icon]')) holder.replaceWith(icon(holder.dataset.icon));
  }

  const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };

  let uiScale = 1;
  function updateScale() {
    uiScale = (typeof document !== 'undefined' && parseFloat(getComputedStyle(document.documentElement).fontSize) / 16) || 1;
    return uiScale;
  }
  updateScale();
  if (typeof addEventListener === 'function') addEventListener('resize', updateScale);
  if (typeof matchMedia === 'function') {
    try { matchMedia('(orientation: portrait)').addEventListener('change', updateScale); } catch {}
  }

  // A popover placed under its anchor (or above, when there is no room below), kept on screen.
  // `align: 'end'` lines its right edge up with the anchor's.
  function place(popover, anchor, align = 'start') {
    const a = anchor.getBoundingClientRect(), gap = 6 * uiScale, margin = 8 * uiScale;
    if (popover.classList.contains('game-select-list')) popover.style.minWidth = a.width + 'px';
    const width = Math.min(popover.offsetWidth, innerWidth - margin * 2), height = popover.offsetHeight;
    let left = align === 'end' ? a.right - width : a.left;
    left = Math.max(margin, Math.min(left, innerWidth - margin - width));
    let top = a.bottom + gap;
    if (top + height > innerHeight - margin && a.top - gap - height >= margin) top = a.top - gap - height;
    popover.style.left = left + 'px';
    popover.style.top = Math.max(margin, Math.min(top, innerHeight - margin - height)) + 'px';
  }
  // Wires a button to a popover: the button toggles it (light dismiss closes it), and it opens
  // anchored to whichever button opened it last. `prepare` runs before it shows.
  function dropdown(button, popover, { align = 'start', prepare } = {}) {
    popover.classList.add('game-popover');
    if (!popover.hasAttribute('popover')) popover.popover = 'auto';
    button.popoverTargetElement = popover; button.popoverTargetAction = 'toggle';
    button.setAttribute('aria-haspopup', 'true');
    button.addEventListener('click', () => { popover.anchor = button; popover.align = align; if (!popover.matches(':popover-open')) prepare?.(); });
    if (!popover.dataset.placed) {
      popover.dataset.placed = '1';
      popover.addEventListener('toggle', event => {
        const open = event.newState === 'open';
        if (popover.anchor) popover.anchor.setAttribute('aria-expanded', String(open));
        if (open && popover.anchor) place(popover, popover.anchor, popover.align);
      });
      addEventListener('resize', () => { if (popover.matches(':popover-open') && popover.anchor) place(popover, popover.anchor, popover.align); });
    }
    button.setAttribute('aria-expanded', 'false');
  }

  // Confirm and name dialogs, styled as game panels. Each resolves when the player answers.
  let dialog = null;
  function panel({ title, message, input, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
    dialog ||= document.body.appendChild(el('dialog', { className: 'game-dialog' }));
    const field = input ? el('input', { className: 'game-dialog-input', value: input.value || '', maxLength: input.maxLength || 40, required: true }) : null;
    if (field) {
      field.setAttribute('aria-label', input.label || title);
      field.readOnly = Boolean(input.readOnly);
    }
    const confirm = el('button', { type: 'submit', className: danger ? 'game-dialog-danger' : 'primary', textContent: confirmLabel });
    const cancel = el('button', { type: 'button', className: 'quiet', textContent: cancelLabel });
    const form = el('form', { method: 'dialog' }, el('h2', { textContent: title }), ...(message ? [el('p', { textContent: message })] : []),
      ...(field ? [field] : []), el('div', { className: 'game-dialog-actions' }, cancel, confirm));
    dialog.replaceChildren(form);
    dialog.setAttribute('aria-label', title);
    return new Promise(resolve => {
      let answer = null;
      cancel.onclick = () => dialog.close();
      form.onsubmit = event => {
        event.preventDefault();
        if (field && !field.value.trim()) { field.focus(); return; }
        answer = field ? field.value : true; dialog.close();
      };
      dialog.addEventListener('close', () => resolve(answer ?? (field ? null : false)), { once: true });
      dialog.showModal();
      (field || confirm).focus();
      field?.select();
    });
  }
  const confirm = options => panel(options);
  const ask = options => panel({ confirmLabel: 'Save', ...options, input: options.input || {} });

  // Replaces a <select>'s browser popup with a game dropdown. The select stays the source of
  // truth (value, options, change events); call sync() after changing it in code.
  function select(native) {
    const label = el('span', { className: 'game-select-label' });
    const button = el('button', { type: 'button', className: 'game-select ' + native.className }, label, icon('chevron-down'));
    button.setAttribute('aria-label', native.getAttribute('aria-label') || '');
    if (native.id) button.dataset.for = native.id;
    const list = el('div', { className: 'game-select-list' });
    list.setAttribute('role', 'listbox');
    native.hidden = true; native.tabIndex = -1;
    native.after(button, list);
    function option(o) {
      const item = el('button', { type: 'button', className: 'game-select-option', textContent: o.textContent, disabled: o.disabled });
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(o.value === native.value));
      item.onclick = () => {
        list.hidePopover();
        if (native.value === o.value) return;
        native.value = o.value; sync(); native.dispatchEvent(new Event('change', { bubbles: true }));
      };
      return item;
    }
    function fill() {
      list.replaceChildren(...[...native.children].map(child => child.tagName === 'OPTGROUP'
        ? el('div', { className: 'game-select-group' }, el('span', { textContent: child.label }), ...[...child.children].map(option))
        : option(child)));
    }
    function sync() {
      label.textContent = native.selectedOptions[0]?.textContent || '';
      button.disabled = native.disabled;
    }
    dropdown(button, list, { prepare: fill });
    list.addEventListener('toggle', event => { if (event.newState === 'open') (list.querySelector('[aria-selected="true"]') || list.querySelector('button'))?.focus(); });
    // Arrow keys move through the options; Escape closes (light dismiss).
    list.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const items = [...list.querySelectorAll('button:not(:disabled)')], at = items.indexOf(document.activeElement);
      items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    });
    native.addEventListener('change', sync);
    new MutationObserver(sync).observe(native, { childList: true, subtree: true, attributes: true });
    sync();
    return { button, sync };
  }

  // Tooltips: any element with data-tip names itself on hover, keyboard focus or a long press on
  // touch, above the element (below when there is no room). A long press swallows the tap that
  // ends it, so naming a super on a tile never picks the tile.
  let tip = null, tipFor = null, pressTimer = 0, hideTimer = 0, pressed = null, swallow = false;
  function showTip(target) {
    tip ||= document.body.appendChild(el('div', { className: 'game-tip', popover: 'manual' }));
    clearTimeout(hideTimer);
    tip.textContent = target.dataset.tip; tipFor = target;
    if (tip.matches(':popover-open')) tip.hidePopover();
    tip.showPopover();
    tip.style.left = tip.style.top = '0';
    const a = target.getBoundingClientRect(), gap = 6 * uiScale, margin = 8 * uiScale, width = tip.offsetWidth, height = tip.offsetHeight;
    const top = a.top - gap - height >= margin ? a.top - gap - height : a.bottom + gap;
    tip.style.left = Math.max(margin, Math.min(a.left + a.width / 2 - width / 2, innerWidth - margin - width)) + 'px';
    tip.style.top = Math.max(margin, Math.min(top, innerHeight - margin - height)) + 'px';
  }
  function hideTip(delay = 0) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (tip?.matches(':popover-open')) tip.hidePopover(); tipFor = null; }, delay);
  }
  const tipTarget = event => event.target.closest?.('[data-tip]');
  addEventListener('pointerover', event => { const t = tipTarget(event); if (event.pointerType === 'mouse' && t && t !== tipFor) showTip(t); });
  addEventListener('pointerout', event => { const t = tipTarget(event); if (event.pointerType === 'mouse' && t && !t.contains(event.relatedTarget)) hideTip(); });
  addEventListener('focusin', event => { const t = tipTarget(event); if (t?.matches(':focus-visible')) showTip(t); });
  addEventListener('focusout', event => { if (tipTarget(event) === tipFor) hideTip(); });
  addEventListener('pointerdown', event => {
    swallow = false; clearTimeout(pressTimer);
    const t = tipTarget(event);
    if (tipFor && tipFor !== t) hideTip();
    if (event.pointerType === 'mouse' || !t) return;
    pressed = { x: event.clientX, y: event.clientY };
    pressTimer = setTimeout(() => { swallow = true; showTip(t); }, 450);
  });
  addEventListener('pointermove', event => {
    if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 10 * uiScale) { clearTimeout(pressTimer); pressed = null; }
  });
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, event => {
    clearTimeout(pressTimer); pressed = null;
    if (swallow && event.pointerType !== 'mouse') hideTip(1500);
  });
  addEventListener('click', event => { if (swallow) { swallow = false; event.preventDefault(); event.stopPropagation(); } }, true);
  addEventListener('contextmenu', event => { if (swallow || tipTarget(event)) event.preventDefault(); }, true);
  for (const type of ['scroll', 'resize']) addEventListener(type, () => { if (tipFor) hideTip(); }, true);

  root.gameUi = { ICONS, icon, fillIcons, dropdown, place, confirm, ask, select, scale: () => uiScale, updateScale };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fillIcons());
  else fillIcons();
})(globalThis);
