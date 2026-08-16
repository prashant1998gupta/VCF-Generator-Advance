/* ============================================================
   contacts.js — multi-contact manager backed by localStorage.
   Exposes global: Contacts
   ============================================================ */
(function () {
  'use strict';

  const STORE = 'vcfgen.contacts.v1';
  const $ = s => document.querySelector(s);

  let contacts = [];   // [{id, model}]
  let filter = '';

  function load() {
    try { contacts = JSON.parse(localStorage.getItem(STORE)) || []; }
    catch (e) { contacts = []; }
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(contacts));
    } catch (e) {
      App.toast('Storage is full — remove some contacts or large photos', 'err');
    }
    renderCount();
  }

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  function displayName(model) { return VCard.composeFN(model); }
  function subLine(model) {
    return [model.work && model.work.title, model.work && model.work.company].filter(Boolean).join(' · ')
      || (model.emails && model.emails[0] && model.emails[0].address)
      || (model.phones && model.phones[0] && model.phones[0].number) || '';
  }
  function initials(model) {
    const n = model.name || {};
    const s = (((n.first || '')[0] || '') + ((n.last || '')[0] || '')).toUpperCase();
    return s || (displayName(model)[0] || '?').toUpperCase();
  }

  /* ---------------- public API ---------------- */

  function all() { return contacts.map(c => c.model); }
  function count() { return contacts.length; }

  function add(model, opts) {
    if (!model.uid) model.uid = uid();
    // update if we already hold a contact with the same uid
    const existing = contacts.findIndex(c => c.model.uid === model.uid);
    if (existing !== -1) contacts[existing].model = model;
    else contacts.push({ id: uid(), model });
    save();
    render();
    if (!opts || !opts.silent) App.toast(existing !== -1 ? 'Contact updated ✔' : 'Saved to contact list ✔', 'ok');
  }

  function addMany(models) {
    models.forEach(m => { if (!m.uid) m.uid = uid(); contacts.push({ id: uid(), model: m }); });
    save();
    render();
  }

  function removeAll() {
    contacts = [];
    save();
    render();
  }

  /* ---------------- rendering ---------------- */

  function renderCount() {
    const n = contacts.length;
    const badge = $('#contacts-count');
    badge.textContent = n; badge.hidden = n === 0;
    $('#contacts-count-2').textContent = n;
  }

  function matches(model, q) {
    if (!q) return true;
    const hay = [
      displayName(model), (model.work || {}).company, (model.work || {}).title,
      ...(model.emails || []).map(e => e.address),
      ...(model.phones || []).map(p => p.number)
    ].join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function render() {
    const list = $('#contacts-list');
    const empty = $('#contacts-empty');
    list.innerHTML = '';
    const visible = contacts.filter(c => matches(c.model, filter));
    empty.hidden = contacts.length > 0;
    renderCount();

    visible.forEach(c => {
      const item = document.createElement('div');
      item.className = 'contact-item';

      const av = document.createElement('div');
      av.className = 'ct-avatar';
      if (c.model.photo && c.model.photo.dataUrl) {
        const img = document.createElement('img');
        img.src = c.model.photo.dataUrl; img.alt = '';
        av.appendChild(img);
      } else {
        av.textContent = initials(c.model);
      }
      item.appendChild(av);

      const info = document.createElement('div');
      info.className = 'ct-info';
      const nm = document.createElement('div');
      nm.className = 'ct-name'; nm.textContent = displayName(c.model);
      const sub = document.createElement('div');
      sub.className = 'ct-sub'; sub.textContent = subLine(c.model);
      info.appendChild(nm); info.appendChild(sub);
      item.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'ct-actions';
      const mkBtn = (label, title, fn, danger) => {
        const b = document.createElement('button');
        b.className = 'btn-mini' + (danger ? ' danger' : '');
        b.textContent = label; b.title = title;
        b.addEventListener('click', fn);
        actions.appendChild(b);
      };
      mkBtn('✎ Edit', 'Load into the Create tab', () => {
        FormUI.applyModel(c.model);
        App.showTab('create');
        App.toast('Loaded into the form — “Save to contact list” stores your edits', 'ok');
      });
      mkBtn('⬇ .vcf', 'Download this contact', () => {
        const vcf = VCard.generate(c.model, App.getVersion());
        App.downloadBlob(new Blob([vcf], { type: 'text/vcard' }), VCard.suggestFileName(c.model));
      });
      mkBtn('⧉', 'Duplicate', () => {
        const copy = JSON.parse(JSON.stringify(c.model));
        copy.uid = '';
        addMany([copy]);
        App.toast('Contact duplicated', 'ok');
      });
      mkBtn('✕', 'Delete', () => {
        contacts = contacts.filter(x => x.id !== c.id);
        save(); render();
      }, true);
      item.appendChild(actions);
      list.appendChild(item);
    });

    if (contacts.length && !visible.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'No contacts match your search.';
      list.appendChild(p);
    }
  }

  function init() {
    load();
    render();

    $('#btn-save-contact').addEventListener('click', () => {
      const model = FormUI.getModel();
      if (VCard.composeFN(model) === 'Contact' && !model.phones.length && !model.emails.length) {
        App.toast('Add at least a name, phone or email first', 'warn');
        return;
      }
      add(model);
    });

    $('#btn-new-contact').addEventListener('click', () => {
      FormUI.reset();
      App.showTab('create');
    });

    $('#contacts-search').addEventListener('input', e => {
      filter = e.target.value.trim();
      render();
    });

    $('#btn-clear-contacts').addEventListener('click', () => {
      if (!contacts.length) return;
      if (confirm('Delete all ' + contacts.length + ' saved contacts? This cannot be undone.')) {
        removeAll();
        App.toast('All contacts deleted', 'ok');
      }
    });
  }

  window.Contacts = { init, all, count, add, addMany, render };
})();
