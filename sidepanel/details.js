// "More details" for new tasks: assignees, due date, tags and custom fields.
// Collapsed by default; data is only fetched once the section is opened.
import * as api from '../lib/clickup-api.js';
import { localDateToMs } from '../lib/geometry.js';

// Custom field types we can edit here; anything else is left for ClickUp itself.
const SUPPORTED = new Set([
  'short_text', 'text', 'email', 'url', 'phone', 'number', 'currency',
  'date', 'checkbox', 'drop_down', 'labels', 'emoji',
]);

const $ = (id) => document.getElementById(id);

/**
 * A select that adds items as removable chips.
 * @param {HTMLElement} chipsEl
 * @param {HTMLSelectElement} selectEl
 */
function createChipPicker(chipsEl, selectEl, placeholder, onChange) {
  let items = []; // { value, label, color? }
  const selected = new Set();

  function render() {
    chipsEl.replaceChildren(
      ...items
        .filter((i) => selected.has(i.value))
        .map((i) => {
          const chip = document.createElement('span');
          chip.className = 'chip';
          if (i.color) chip.style.setProperty('--chip', i.color);
          chip.append(i.label);
          const x = document.createElement('button');
          x.type = 'button';
          x.textContent = '✕';
          x.title = `Remove ${i.label}`;
          x.addEventListener('click', () => {
            selected.delete(i.value);
            render();
            onChange();
          });
          chip.append(x);
          return chip;
        }),
    );
    selectEl.replaceChildren(new Option(items.length ? placeholder : 'None available', ''));
    for (const i of items) if (!selected.has(i.value)) selectEl.add(new Option(i.label, i.value));
    selectEl.disabled = !items.length;
  }

  selectEl.addEventListener('change', () => {
    if (!selectEl.value) return;
    selected.add(selectEl.value);
    render();
    onChange();
  });

  render();
  return {
    setItems(next) {
      items = next;
      // Keep only selections that still exist (e.g. after switching lists).
      for (const v of [...selected]) if (!items.some((i) => i.value === v)) selected.delete(v);
      render();
    },
    values: () => [...selected],
    clear() {
      selected.clear();
      render();
    },
  };
}

/**
 * @param {{ getListId: () => string, getSpaceId: () => string }} ctx
 */
export function createDetails({ getListId, getSpaceId }) {
  const root = $('more-details');
  const countBadge = $('more-count');
  const status = $('more-status');
  const dueDate = $('due-date');
  const dueTime = $('due-time');
  const fieldsEl = $('custom-fields');

  const assignees = createChipPicker($('assignee-chips'), $('sel-assignee'), 'Add assignee…', updateCount);
  const tags = createChipPicker($('tag-chips'), $('sel-tag'), 'Add tag…', updateCount);

  let loadedListId = null;
  let loadedSpaceId = null;
  /** Rendered custom fields: { field, read(): unknown | undefined, clear() } */
  let fieldControls = [];

  function setStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  // ---- Custom fields ----

  function fieldControl(field) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    const id = `cf-${field.id}`;
    label.htmlFor = id;
    label.textContent = field.name;
    if (field.required) {
      const req = document.createElement('span');
      req.className = 'req';
      req.textContent = ' *';
      label.append(req);
    }
    wrap.append(label);

    const options = field.type_config?.options || [];
    let read;
    let clear;

    switch (field.type) {
      case 'checkbox': {
        const box = document.createElement('label');
        box.className = 'checkbox';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        box.append(input, ' Checked');
        wrap.append(box);
        read = () => (input.checked ? true : undefined);
        clear = () => (input.checked = false);
        break;
      }
      case 'drop_down': {
        const select = document.createElement('select');
        select.id = id;
        select.add(new Option('—', ''));
        for (const o of options) select.add(new Option(o.name, o.id));
        wrap.append(select);
        read = () => select.value || undefined;
        clear = () => (select.value = '');
        break;
      }
      case 'labels': {
        const chips = document.createElement('div');
        chips.className = 'chips';
        const select = document.createElement('select');
        select.id = id;
        wrap.append(chips, select);
        const picker = createChipPicker(chips, select, 'Add label…', updateCount);
        picker.setItems(options.map((o) => ({ value: o.id, label: o.label || o.name, color: o.color })));
        read = () => (picker.values().length ? picker.values() : undefined);
        clear = () => picker.clear();
        break;
      }
      case 'emoji': {
        const select = document.createElement('select');
        select.id = id;
        select.add(new Option('—', ''));
        const max = field.type_config?.count || 5;
        for (let n = 0; n <= max; n++) select.add(new Option(`${n} / ${max}`, String(n)));
        wrap.append(select);
        read = () => (select.value === '' ? undefined : Number(select.value));
        clear = () => (select.value = '');
        break;
      }
      case 'date': {
        const input = document.createElement('input');
        input.type = 'date';
        input.id = id;
        wrap.append(input);
        read = () => (input.value ? localDateToMs(input.value) : undefined);
        clear = () => (input.value = '');
        break;
      }
      default: {
        const multiline = field.type === 'text';
        const input = document.createElement(multiline ? 'textarea' : 'input');
        input.id = id;
        if (multiline) input.rows = 2;
        else {
          input.type = { email: 'email', url: 'url', phone: 'tel', number: 'number', currency: 'number' }[field.type] || 'text';
          if (field.type === 'currency') input.step = '0.01';
          if (field.type === 'url') input.placeholder = 'https://';
          if (field.type === 'phone') input.placeholder = '+1 555 123 4567';
        }
        wrap.append(input);
        const numeric = field.type === 'number' || field.type === 'currency';
        read = () => {
          const v = input.value.trim();
          if (!v) return undefined;
          return numeric ? Number(v) : v;
        };
        clear = () => (input.value = '');
      }
    }

    wrap.addEventListener('input', updateCount);
    wrap.addEventListener('change', updateCount);
    return { el: wrap, control: { field, read, clear } };
  }

  function renderFields(fields) {
    const supported = fields.filter((f) => SUPPORTED.has(f.type));
    const skipped = fields.filter((f) => !SUPPORTED.has(f.type));
    fieldControls = [];
    const nodes = [];
    if (supported.length) {
      const h = document.createElement('h3');
      h.textContent = 'Custom fields';
      nodes.push(h);
    }
    for (const f of supported) {
      const { el, control } = fieldControl(f);
      fieldControls.push(control);
      nodes.push(el);
    }
    if (skipped.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = `Set in ClickUp after creating: ${skipped.map((f) => f.name).join(', ')}.`;
      nodes.push(p);
    }
    fieldsEl.replaceChildren(...nodes);
  }

  // ---- Loading ----

  async function load() {
    const listId = getListId();
    const spaceId = getSpaceId();

    // Drop data belonging to a previous list/space right away — even while collapsed —
    // so we never submit another list's custom fields.
    if (listId !== loadedListId && loadedListId !== null) {
      assignees.setItems([]);
      renderFields([]);
      loadedListId = null;
    }
    if (spaceId !== loadedSpaceId && loadedSpaceId !== null) {
      tags.setItems([]);
      loadedSpaceId = null;
    }
    updateCount();
    if (!root.open) return; // fetched lazily on first open

    const jobs = [];
    if (!listId) {
      assignees.setItems([]);
      renderFields([]);
    } else if (listId !== loadedListId) {
      loadedListId = listId;
      jobs.push(
        Promise.all([api.getListMembers(listId), api.getListFields(listId)]).then(([members, fields]) => {
          if (getListId() !== listId) return;
          assignees.setItems(
            members.map((m) => ({ value: String(m.id), label: m.username || m.email || `User ${m.id}` })),
          );
          renderFields(fields);
        }),
      );
    }

    if (!spaceId) {
      tags.setItems([]);
    } else if (spaceId !== loadedSpaceId) {
      loadedSpaceId = spaceId;
      jobs.push(
        api.getSpaceTags(spaceId).then((list) => {
          if (getSpaceId() !== spaceId) return;
          tags.setItems(list.map((t) => ({ value: t.name, label: t.name, color: t.tag_bg })));
        }),
      );
    }

    if (!jobs.length) return;
    setStatus('Loading…');
    try {
      await Promise.all(jobs);
      setStatus('');
    } catch (err) {
      // Allow a retry next time the section is opened or the list changes.
      loadedListId = loadedSpaceId = null;
      setStatus(`Couldn’t load details: ${err.message}`);
    }
    updateCount();
  }

  root.addEventListener('toggle', load);

  // ---- Values ----

  function collect() {
    const custom_fields = [];
    const missing = [];
    for (const c of fieldControls) {
      const value = c.read();
      if (value === undefined) {
        if (c.field.required) missing.push(c.field.name);
        continue;
      }
      const entry = { id: c.field.id, value };
      custom_fields.push(entry);
    }
    return {
      assignees: assignees.values().map(Number),
      tags: tags.values(),
      due_date: dueDate.value ? localDateToMs(dueDate.value, dueTime.value) : undefined,
      due_date_time: !!(dueDate.value && dueTime.value),
      custom_fields,
      missing,
    };
  }

  function updateCount() {
    const v = collect();
    const n = (v.assignees.length ? 1 : 0) + (v.tags.length ? 1 : 0) + (v.due_date ? 1 : 0) + v.custom_fields.length;
    countBadge.textContent = `${n} set`;
    countBadge.hidden = !n;
  }

  dueDate.addEventListener('change', updateCount);
  dueTime.addEventListener('change', updateCount);

  function reset() {
    assignees.clear();
    tags.clear();
    dueDate.value = '';
    dueTime.value = '';
    fieldControls.forEach((c) => c.clear());
    updateCount();
  }

  return {
    /** Call when the selected list or space changes. */
    reload: load,
    collect,
    reset,
    open() {
      root.open = true;
    },
  };
}
