/* ============================================================
   app.js — bootstraps everything: tabs, theme, toasts, modals,
   settings, live preview pipeline, download/copy/share actions.
   Exposes global: App
   ============================================================ */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const THEME_KEY = 'vcfgen.theme';
  const VERSION_KEY = 'vcfgen.version';
  const DRAFT_KEY = 'vcfgen.draft';

  let currentTabName = 'create';
  let vcardVersion = '3.0';

  /* ---------------- toasts ---------------- */

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, 3200);
  }

  /* ---------------- tabs ---------------- */

  function showTab(name) {
    currentTabName = name;
    $$('.tab').forEach(t => {
      const active = t.dataset.tab === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active);
    });
    $$('.tab-panel').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
    window.scrollTo({ top: 0 });
  }

  /* ---------------- modals ---------------- */

  function openModal(id) { $('#' + id).hidden = false; }
  function closeModal(id) { $('#' + id).hidden = true; }

  function bindModals() {
    $$('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', e => { if (e.target === bd) bd.hidden = true; });
    });
    $$('.modal-close').forEach(b => {
      b.addEventListener('click', () => { b.closest('.modal-backdrop').hidden = true; });
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') $$('.modal-backdrop').forEach(bd => { bd.hidden = true; });
    });
  }

  /* ---------------- theme ---------------- */

  function applyTheme(mode) {
    const root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'system';
    applyTheme(saved);
    $('#set-theme').value = saved;
    $('#btn-theme').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const isDark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      const next = isDark ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
      $('#set-theme').value = next;
    });
    $('#set-theme').addEventListener('change', e => {
      localStorage.setItem(THEME_KEY, e.target.value);
      applyTheme(e.target.value);
    });
  }

  /* ---------------- vCard version ---------------- */

  function getVersion() { return vcardVersion; }
  function setVersion(v) {
    vcardVersion = v;
    $$('#version-seg button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
    refresh();
  }

  function initVersion() {
    vcardVersion = localStorage.getItem(VERSION_KEY) || '3.0';
    $('#set-version').value = vcardVersion;
    $$('#version-seg button').forEach(b => {
      b.addEventListener('click', () => {
        localStorage.setItem(VERSION_KEY, b.dataset.v);
        setVersion(b.dataset.v);
      });
    });
    $('#set-version').addEventListener('change', e => {
      localStorage.setItem(VERSION_KEY, e.target.value);
      setVersion(e.target.value);
    });
    $$('#version-seg button').forEach(b => b.classList.toggle('active', b.dataset.v === vcardVersion));
  }

  /* ---------------- live preview pipeline ---------------- */

  let refreshTimer = null;
  function onFormChange() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 120);
  }

  function refresh() {
    const model = FormUI.getModel();
    Preview.render(model);
    try {
      $('#vcf-source').textContent = VCard.generate(model, vcardVersion);
    } catch (e) {
      $('#vcf-source').textContent = 'Error: ' + e.message;
    }
    saveDraftSoon(model);
  }

  let draftTimer = null;
  function saveDraftSoon(model) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(model)); } catch (e) { /* storage full — skip */ }
    }, 700);
  }

  function restoreDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const model = JSON.parse(raw);
      const hasContent = (model.name && (model.name.first || model.name.last)) ||
        (model.work && model.work.company) ||
        (model.phones || []).some(p => p.number) || (model.emails || []).some(e => e.address);
      if (hasContent) FormUI.applyModel(model);
    } catch (e) { /* corrupt draft — ignore */ }
  }

  /* ---------------- actions ---------------- */

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function currentVcf() { return VCard.generate(FormUI.getModel(), vcardVersion); }

  function bindActions() {
    $('#btn-download').addEventListener('click', () => {
      const model = FormUI.getModel();
      downloadBlob(new Blob([VCard.generate(model, vcardVersion)], { type: 'text/vcard;charset=utf-8' }),
        VCard.suggestFileName(model));
      toast('Contact file downloaded ✔', 'ok');
    });

    $('#btn-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(currentVcf());
        toast('vCard copied to clipboard ✔', 'ok');
      } catch (e) {
        toast('Copy failed — your browser blocked clipboard access', 'err');
      }
    });

    $('#btn-share').addEventListener('click', async () => {
      const model = FormUI.getModel();
      const vcf = currentVcf();
      const file = new File([vcf], VCard.suggestFileName(model), { type: 'text/vcard' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: VCard.composeFN(model) });
        } else if (navigator.share) {
          await navigator.share({ title: VCard.composeFN(model), text: vcf });
        } else {
          toast('Sharing is not supported in this browser — use Download instead', 'warn');
        }
      } catch (e) {
        if (e && e.name !== 'AbortError') toast('Share failed: ' + e.message, 'err');
      }
    });

    $('#btn-clear').addEventListener('click', () => {
      if (confirm('Clear the whole form?')) {
        FormUI.reset();
        localStorage.removeItem(DRAFT_KEY);
        toast('Form cleared', 'ok');
      }
    });
  }

  /* ---------------- settings ---------------- */

  function initSettings() {
    $('#btn-settings').addEventListener('click', () => openModal('modal-settings'));

    const keyInput = $('#set-api-key');
    keyInput.value = AIScan.getKey();
    keyInput.addEventListener('change', () => {
      AIScan.setKey(keyInput.value);
      toast(keyInput.value.trim() ? 'API key saved in this browser' : 'API key removed', 'ok');
    });
    $('#key-show').addEventListener('click', () => {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    });

    const modelSel = $('#set-ai-model');
    modelSel.value = AIScan.getModel();
    modelSel.addEventListener('change', () => AIScan.setModel(modelSel.value));

    $('#btn-test-ai').addEventListener('click', async () => {
      const out = $('#ai-test-result');
      if (!AIScan.hasKey()) { out.textContent = 'Enter a key first'; return; }
      out.textContent = 'Testing…';
      try {
        await AIScan.testKey();
        out.textContent = '✅ Key works!';
      } catch (e) {
        out.textContent = '❌ ' + e.message;
      }
    });

    $('#btn-wipe').addEventListener('click', () => {
      if (!confirm('Erase EVERYTHING this app stored in your browser?\n(Contacts, draft, API key, settings)')) return;
      Object.keys(localStorage)
        .filter(k => k.startsWith('vcfgen.'))
        .forEach(k => localStorage.removeItem(k));
      location.reload();
    });
  }

  /* ---------------- service worker ---------------- */

  function initSW() {
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support optional */ });
    }
  }

  /* ---------------- boot ---------------- */

  function init() {
    bindModals();
    initTheme();

    $$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

    FormUI.init(onFormChange);
    initVersion();
    QR.init();
    Scanner.init();
    Contacts.init();
    Bulk.init();
    bindActions();
    initSettings();
    initSW();

    restoreDraft();
    refresh();
  }

  window.App = {
    toast, showTab, openModal, closeModal, downloadBlob, getVersion, setVersion,
    currentTab: () => currentTabName
  };

  init();
})();
