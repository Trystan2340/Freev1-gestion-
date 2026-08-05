// Guide intégré du Planificateur 4.3 et du Centre intelligent 5.1.
(() => {
  const byId = id => document.getElementById(id);
  const sections = ['planner', 'smart'];
  let initialized = false;
  let lastFocused = null;

  function setSection(section, focusTab = false) {
    const selected = sections.includes(section) ? section : 'planner';
    document.querySelectorAll('[data-freev-help-tab]').forEach(tab => {
      const active = tab.dataset.freevHelpTab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    document.querySelectorAll('[data-freev-help-panel]').forEach(panel => {
      panel.hidden = panel.dataset.freevHelpPanel !== selected;
    });
  }

  function open(section = 'planner') {
    const overlay = byId('freevHelpOverlay');
    if (!overlay) return;
    lastFocused = document.activeElement;
    setSection(section);
    overlay.hidden = false;
    document.body.classList.add('v4-modal-open');
    requestAnimationFrame(() => {
      overlay.querySelector('[data-freev-help-tab][aria-selected="true"]')?.focus();
    });
  }

  function close() {
    const overlay = byId('freevHelpOverlay');
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('v4-modal-open');
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
    lastFocused = null;
  }

  function goTo(target) {
    close();
    window.switchView?.(target === 'smart' ? 'smart' : 'planner');
    if (target === 'smart') window.FreevV5?.setActiveTab?.('overview');
  }

  function trapFocus(event, dialog) {
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bind() {
    if (initialized) return;
    const overlay = byId('freevHelpOverlay');
    if (!overlay) return;
    initialized = true;

    overlay.addEventListener('click', event => {
      const tab = event.target.closest('[data-freev-help-tab]');
      const target = event.target.closest('[data-freev-help-target]');
      if (event.target === overlay || event.target.closest('[data-freev-help-close]')) close();
      if (tab) setSection(tab.dataset.freevHelpTab);
      if (target) goTo(target.dataset.freevHelpTarget);
    });

    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      const tab = event.target.closest('[data-freev-help-tab]');
      if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const current = sections.indexOf(tab.dataset.freevHelpTab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
        setSection(sections[next], true);
        return;
      }
      if (event.key === 'Tab') trapFocus(event, overlay.querySelector('[data-freev-help-dialog]'));
    });
  }

  window.FreevHelp = { open, close, setSection, goTo };
  document.addEventListener('DOMContentLoaded', bind, { once: true });
})();
