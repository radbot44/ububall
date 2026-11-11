'use strict';
// Game-styled UI shared by every screen: Tabler icons, dropdowns anchored to the control that
// opens them (never pushing content), confirm and name dialogs, and a custom select. ububall
// runs inside Discord Activities and as a phone app, so nothing here falls back to browser UI.
(function(root) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#icon-' + name);
    svg.append(use);
    return svg;
  }
  // Markup asks for an icon with <i data-icon="name"></i> or pre-rendered <svg class="icon"><use href="#icon-name"></use></svg>.
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
    popover.style.inset = 'auto';
    popover.style.left = popover.style.top = '0px';
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
  function dropdown(button, popover, { align = 'start', prepare, haspopup = 'true' } = {}) {
    popover.classList.add('game-popover');
    if (!popover.hasAttribute('popover')) popover.popover = 'auto';
    button.popoverTargetElement = popover; button.popoverTargetAction = 'toggle';
    button.setAttribute('aria-haspopup', haspopup);
    button.addEventListener('click', event => {
      if (popover.matches(':popover-open') && popover.anchor && popover.anchor !== button) {
        event.preventDefault();
        popover.anchor.setAttribute('aria-expanded', 'false');
        popover.anchor = button;
        popover.align = align;
        prepare?.();
        button.setAttribute('aria-expanded', 'true');
        place(popover, button, align);
        return;
      }
      popover.anchor = button;
      popover.align = align;
      if (!popover.matches(':popover-open')) prepare?.();
    });
    if (!popover.dataset.placed) {
      popover.dataset.placed = '1';
      popover.addEventListener('toggle', event => {
        const open = event.newState === 'open';
        if (popover.anchor) popover.anchor.setAttribute('aria-expanded', String(open));
        if (open && popover.anchor) place(popover, popover.anchor, popover.align);
      });
      addEventListener('resize', () => { if (popover.matches(':popover-open') && popover.anchor) place(popover, popover.anchor, popover.align); });
      addEventListener('scroll', event => {
        if (!popover.matches(':popover-open') || !popover.anchor) return;
        if (event.target === popover || popover.contains?.(event.target)) return;
        const a = popover.anchor.getBoundingClientRect();
        if (a.bottom < 0 || a.top > innerHeight || a.right < 0 || a.left > innerWidth) popover.hidePopover();
        else place(popover, popover.anchor, popover.align);
      }, true);
    }
    button.setAttribute('aria-expanded', 'false');
  }

  // Confirm and name dialogs, styled as game panels. Each creates an isolated top-layer dialog
  // removed on close so concurrent alerts or confirmations never collide.
  function panel({ title, message, input, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
    const dlg = document.body.appendChild(el('dialog', { className: 'game-dialog' }));
    const field = input ? el('input', { className: 'game-dialog-input', value: input.value || '', maxLength: input.maxLength || 40, required: true }) : null;
    if (field) {
      field.setAttribute('aria-label', input.label || title);
      field.readOnly = Boolean(input.readOnly);
    }
    const showCancel = cancelLabel !== null && cancelLabel !== false && cancelLabel !== '';
    const confirmBtn = el('button', { type: 'submit', className: danger ? 'game-dialog-danger' : 'primary', textContent: confirmLabel });
    const cancelBtn = showCancel ? el('button', { type: 'button', className: 'quiet', textContent: cancelLabel }) : null;
    const actions = el('div', { className: 'game-dialog-actions' }, ...(cancelBtn ? [cancelBtn] : []), confirmBtn);
    const form = el('form', { method: 'dialog' }, el('h2', { textContent: title }), ...(message ? [el('p', { textContent: message })] : []),
      ...(field ? [field] : []), actions);
    dlg.replaceChildren(form);
    dlg.setAttribute('aria-label', title);
    return new Promise(resolve => {
      let answer = null;
      if (cancelBtn) cancelBtn.onclick = () => dlg.close();
      form.onsubmit = event => {
        event.preventDefault();
        if (field && !field.value.trim()) { field.focus(); return; }
        answer = field ? field.value : true; dlg.close();
      };
      dlg.addEventListener('close', () => {
        dlg.remove();
        resolve(answer ?? (field ? null : false));
      }, { once: true });
      dlg.showModal();
      (field || confirmBtn).focus();
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
        button.focus();
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
      if (native.disabled && list.matches(':popover-open')) list.hidePopover();
      else if (list.matches(':popover-open')) { fill(); place(list, button, list.align); }
    }
    dropdown(button, list, { prepare: fill, haspopup: 'listbox' });
    list.addEventListener('toggle', event => { if (event.newState === 'open') (list.querySelector('[aria-selected="true"]') || list.querySelector('button'))?.focus(); });
    // Arrow/Home/End keys move through the options; Escape closes and restores trigger focus.
    list.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        list.hidePopover();
        button.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...list.querySelectorAll('button:not(:disabled)')];
      if (!items.length) return;
      if (event.key === 'Home') { items[0].focus(); return; }
      if (event.key === 'End') { items[items.length - 1].focus(); return; }
      const at = items.indexOf(document.activeElement);
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
  let tip = null, tipFor = null, pressTimer = 0, hideTimer = 0, swallowTimer = 0, pressed = null, swallow = false;
  function showTip(target) {
    if (!target?.dataset.tip) return;
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
    swallow = false; clearTimeout(pressTimer); clearTimeout(swallowTimer);
    const t = tipTarget(event);
    if (tipFor && tipFor !== t) hideTip();
    if (event.pointerType === 'mouse' || !t || !t.dataset.tip) return;
    pressed = { x: event.clientX, y: event.clientY };
    pressTimer = setTimeout(() => { swallow = true; showTip(t); }, 450);
  });
  addEventListener('pointermove', event => {
    if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 10 * uiScale) { clearTimeout(pressTimer); pressed = null; }
  });
  addEventListener('pointerup', event => {
    clearTimeout(pressTimer); pressed = null;
    if (swallow && event.pointerType !== 'mouse') {
      hideTip(1500);
      clearTimeout(swallowTimer);
      swallowTimer = setTimeout(() => { swallow = false; }, 0);
    }
  });
  addEventListener('pointercancel', () => {
    clearTimeout(pressTimer); clearTimeout(swallowTimer);
    pressed = null; swallow = false;
    if (tipFor) hideTip();
  });
  addEventListener('click', event => {
    if (swallow) {
      clearTimeout(swallowTimer);
      swallow = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  addEventListener('contextmenu', event => { if (swallow || tipTarget(event)) event.preventDefault(); }, true);
  for (const type of ['scroll', 'resize']) addEventListener(type, () => { if (tipFor) hideTip(); }, true);

  root.gameUi = { ICONS: {}, icon, fillIcons, dropdown, place, confirm, ask, select, scale: () => uiScale, updateScale };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fillIcons());
  else fillIcons();
})(globalThis);
