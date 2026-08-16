/* ============================================================
   preview.js — live phone-style contact card preview
   Exposes global: Preview
   ============================================================ */
(function () {
  'use strict';

  const NET_LABELS = {
    linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', twitter: 'X / Twitter',
    youtube: 'YouTube', tiktok: 'TikTok', github: 'GitHub', whatsapp: 'WhatsApp',
    telegram: 'Telegram', snapchat: 'Snapchat', pinterest: 'Pinterest', custom: 'Profile'
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function initials(model) {
    const n = model.name || {};
    const a = (n.first || '').trim()[0] || '';
    const b = (n.last || '').trim()[0] || '';
    const s = (a + b).toUpperCase();
    if (s) return s;
    const fn = VCard.composeFN(model);
    return (fn[0] || '?').toUpperCase();
  }

  function row(parent, label, value, plain) {
    if (!value) return;
    const r = el('div', 'pv-row');
    r.appendChild(el('div', 'pv-label', label));
    const v = el('div', 'pv-value' + (plain ? ' plain' : ''));
    v.textContent = value;
    r.appendChild(v);
    parent.appendChild(r);
  }

  function isEmpty(model) {
    const n = model.name || {}, w = model.work || {};
    return !(n.first || n.last || n.fnOverride || w.company ||
      (model.phones || []).length || (model.emails || []).length);
  }

  function fmtAddress(a) {
    return [a.street, a.ext, [a.city, a.state].filter(Boolean).join(', '),
      [a.zip, a.country].filter(Boolean).join(' '), a.po ? 'PO ' + a.po : '']
      .filter(Boolean).join('\n');
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return d; }
  }

  function render(model) {
    const root = document.getElementById('preview-card');
    root.innerHTML = '';

    if (isEmpty(model)) {
      const empty = el('div', 'pv-empty');
      empty.innerHTML = '👋 Start typing — your contact card<br>preview appears here live.';
      root.appendChild(empty);
      return;
    }

    // hero
    const hero = el('div', 'pv-hero');
    const av = el('div', 'pv-avatar');
    if (model.photo && model.photo.dataUrl) {
      const img = document.createElement('img');
      img.src = model.photo.dataUrl; img.alt = '';
      av.appendChild(img);
    } else {
      av.textContent = initials(model);
    }
    hero.appendChild(av);
    hero.appendChild(el('div', 'pv-name', VCard.composeFN(model)));
    const sub = [model.work && model.work.title, model.work && model.work.company].filter(Boolean).join(' · ');
    if (sub) hero.appendChild(el('div', 'pv-sub', sub));

    // quick actions
    const acts = el('div', 'pv-actions');
    const actDefs = [
      ['💬', 'message', (model.phones || []).length],
      ['📞', 'call', (model.phones || []).length],
      ['✉️', 'mail', (model.emails || []).length],
      ['🌐', 'web', ((model.work || {}).websites || []).length || (model.social || []).length]
    ];
    actDefs.forEach(([ic, label, on]) => {
      const a = el('div', 'pv-act');
      a.style.opacity = on ? 1 : .35;
      const i = el('div', 'pv-act-ic', ic);
      a.appendChild(i);
      a.appendChild(el('span', null, label));
      acts.appendChild(a);
    });
    hero.appendChild(acts);
    root.appendChild(hero);

    // rows
    const rows = el('div', 'pv-rows');
    (model.phones || []).forEach(p => {
      const num = (p.cc && !p.number.startsWith('+') ? p.cc + ' ' : '') + p.number;
      row(rows, p.type, num);
    });
    (model.emails || []).forEach(e => row(rows, e.type + ' email', e.address));
    ((model.work || {}).websites || []).forEach(u => row(rows, 'website', u));
    (model.addresses || []).forEach(a => row(rows, a.type + ' address', fmtAddress(a), true));
    (model.social || []).forEach(s => row(rows, NET_LABELS[s.network] || s.label || 'profile', s.url));
    row(rows, 'birthday', fmtDate((model.personal || {}).birthday), true);
    row(rows, 'anniversary', fmtDate((model.personal || {}).anniversary), true);
    if ((model.other || {}).notes) row(rows, 'notes', model.other.notes, true);
    if ((model.other || {}).categories) row(rows, 'tags', model.other.categories, true);
    root.appendChild(rows);
  }

  window.Preview = { render };
})();
