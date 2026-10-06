// Lightweight custom dropdown, styled like ClickUp's: a trigger button plus a popover list
// whose items can have an icon and a small badge. Works as a value picker (`createMenuSelect`)
// or an action menu (`createActionMenu`). Keyboard: Enter/Space/↓ open, ↑/↓ move, Enter picks,
// Esc closes. Only one menu is open at a time.
import { icon } from '../lib/icons.js';

/** @typedef {{ value: string, label: string, icon?: string, badge?: string, hint?: string }} MenuItem */

let openMenu = null;

document.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.root.contains(e.target)) openMenu.close();
});

function itemContent(item, { showBadge = true } = {}) {
  const parts = [];
  if (item.icon) parts.push(`<span class="mi-icon">${icon(item.icon)}</span>`);
  parts.push(`<span class="mi-label"></span>`);
  if (showBadge && item.badge) parts.push(`<span class="mi-badge"></span>`);
  const span = document.createElement('span');
  span.className = 'mi';
  span.innerHTML = parts.join('');
  span.querySelector('.mi-label').textContent = item.label;
  if (showBadge && item.badge) span.querySelector('.mi-badge').textContent = item.badge;
  if (item.hint) span.title = item.hint;
  return span;
}

/**
 * @param {HTMLElement} root  empty container; becomes the dropdown
 * @param {{ items: MenuItem[], value?: string, label: string,
 *           trigger?: (item: MenuItem | undefined) => Node, onPick: (item: MenuItem) => void,
 *           align?: 'left' | 'right' }} opts
 */
function createMenu(root, opts) {
  let items = opts.items;
  let value = opts.value;
  let active = -1;

  root.classList.add('ms');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = opts.buttonClass || 'ms-button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', opts.label);
  const list = document.createElement('ul');
  list.className = `ms-menu ${opts.align === 'right' ? 'right' : ''}`;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  root.append(button, list);

  function renderButton() {
    const current = items.find((i) => i.value === value);
    button.replaceChildren(
      opts.trigger ? opts.trigger(current) : itemContent({ ...(current || { label: '—' }), icon: undefined }),
    );
    const chev = document.createElement('span');
    chev.className = 'ms-chevron';
    chev.innerHTML = icon('chevronDown', 14);
    button.append(chev);
  }

  function renderList() {
    list.replaceChildren(
      ...items.map((item, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(item.value === value));
        li.className = i === active ? 'active' : '';
        li.append(itemContent(item));
        li.addEventListener('pointerenter', () => setActive(i));
        li.addEventListener('click', () => pick(item));
        return li;
      }),
    );
  }

  function setActive(i) {
    active = i;
    [...list.children].forEach((li, j) => li.classList.toggle('active', j === i));
    list.children[i]?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (button.disabled) return;
    if (openMenu && openMenu !== api) openMenu.close();
    openMenu = api;
    renderList();
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    setActive(Math.max(0, items.findIndex((i) => i.value === value)));
  }

  function close() {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (openMenu === api) openMenu = null;
  }

  function pick(item) {
    close();
    button.focus();
    opts.onPick(item);
  }

  button.addEventListener('click', () => (list.hidden ? open() : close()));
  button.addEventListener('keydown', (e) => {
    if (list.hidden) {
      if (['ArrowDown', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(items.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, active - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (items[active]) pick(items[active]);
    } else if (e.key === 'Tab') {
      close();
    }
  });

  const api = {
    root,
    close,
    get value() {
      return value;
    },
    setValue(v) {
      value = v;
      renderButton();
    },
    setItems(next) {
      items = next;
      renderButton();
      if (!list.hidden) renderList();
    },
    setDisabled(disabled) {
      button.disabled = disabled;
      if (disabled) close();
    },
  };
  renderButton();
  return api;
}

/** Dropdown that holds a value. `onChange` fires when the user picks a different item. */
export function createMenuSelect(root, { items, value, label, onChange }) {
  const menu = createMenu(root, {
    items,
    value,
    label,
    onPick(item) {
      if (item.value === menu.value) return;
      menu.setValue(item.value);
      onChange?.(item.value, item);
    },
  });
  return menu;
}

/** Button that opens a list of actions (no selected value). */
export function createActionMenu(root, { items, label, trigger, onPick, align, buttonClass }) {
  return createMenu(root, { items, label, trigger, onPick, align, buttonClass });
}
