/* ============================================================
   form.js — dynamic contact form: repeatable rows, photo/logo,
   collect ⇄ apply model. Exposes global: FormUI
   ============================================================ */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const CC_LIST = [
    ['', '—'], ['+91', '🇮🇳 +91'], ['+1', '🇺🇸 +1'], ['+44', '🇬🇧 +44'], ['+971', '🇦🇪 +971'],
    ['+61', '🇦🇺 +61'], ['+65', '🇸🇬 +65'], ['+49', '🇩🇪 +49'], ['+33', '🇫🇷 +33'],
    ['+86', '🇨🇳 +86'], ['+81', '🇯🇵 +81'], ['+82', '🇰🇷 +82'], ['+7', '🇷🇺 +7'],
    ['+55', '🇧🇷 +55'], ['+27', '🇿🇦 +27'], ['+234', '🇳🇬 +234'], ['+880', '🇧🇩 +880'],
    ['+92', '🇵🇰 +92'], ['+94', '🇱🇰 +94'], ['+977', '🇳🇵 +977'], ['+966', '🇸🇦 +966'],
    ['+974', '🇶🇦 +974'], ['+968', '🇴🇲 +968'], ['+60', '🇲🇾 +60'], ['+66', '🇹🇭 +66'],
    ['+84', '🇻🇳 +84'], ['+62', '🇮🇩 +62'], ['+63', '🇵🇭 +63'], ['+90', '🇹🇷 +90'],
    ['+39', '🇮🇹 +39'], ['+34', '🇪🇸 +34'], ['+31', '🇳🇱 +31'], ['+41', '🇨🇭 +41'],
    ['+46', '🇸🇪 +46'], ['+48', '🇵🇱 +48'], ['+20', '🇪🇬 +20'], ['+254', '🇰🇪 +254'],
    ['+52', '🇲🇽 +52'], ['+64', '🇳🇿 +64'], ['+353', '🇮🇪 +353'], ['+972', '🇮🇱 +972']
  ];

  const PHONE_TYPES = ['mobile', 'work', 'home', 'main', 'fax', 'work fax', 'home fax', 'pager', 'other'];
  const EMAIL_TYPES = ['home', 'work', 'other'];
  const ADDR_TYPES = ['home', 'work', 'other'];
  const SOCIAL_NETWORKS = [
    ['linkedin', 'LinkedIn', 'https://linkedin.com/in/username'],
    ['instagram', 'Instagram', 'https://instagram.com/username'],
    ['facebook', 'Facebook', 'https://facebook.com/username'],
    ['twitter', 'X / Twitter', 'https://x.com/username'],
    ['youtube', 'YouTube', 'https://youtube.com/@channel'],
    ['tiktok', 'TikTok', 'https://tiktok.com/@username'],
    ['github', 'GitHub', 'https://github.com/username'],
    ['whatsapp', 'WhatsApp', 'https://wa.me/919999999999'],
    ['telegram', 'Telegram', 'https://t.me/username'],
    ['snapchat', 'Snapchat', 'https://snapchat.com/add/username'],
    ['pinterest', 'Pinterest', 'https://pinterest.com/username'],
    ['custom', 'Other / custom', 'https://…']
  ];

  let photoData = null; // {dataUrl}
  let logoData = null;
  let changeCb = null;
  const notify = () => { if (changeCb) changeCb(); };

  /* ---------------- row builders ---------------- */

  function typeSelect(types, value, allowCustom) {
    const sel = document.createElement('select');
    sel.className = 'row-type';
    types.forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t[0].toUpperCase() + t.slice(1);
      sel.appendChild(o);
    });
    if (allowCustom) {
      const o = document.createElement('option');
      o.value = '__custom'; o.textContent = 'Custom…';
      sel.appendChild(o);
    }
    if (value && !types.includes(value)) {
      const o = document.createElement('option');
      o.value = value; o.textContent = value;
      sel.insertBefore(o, sel.lastChild);
    }
    if (value) sel.value = value;
    sel.addEventListener('change', () => {
      if (sel.value === '__custom') {
        const label = (prompt('Custom label:') || '').trim();
        if (label) {
          const o = document.createElement('option');
          o.value = label; o.textContent = label;
          sel.insertBefore(o, sel.lastChild);
          sel.value = label;
        } else {
          sel.value = types[0];
        }
      }
      notify();
    });
    return sel;
  }

  function delBtn(row) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'rep-del'; b.title = 'Remove'; b.textContent = '✕';
    b.addEventListener('click', () => { row.remove(); notify(); });
    return b;
  }

  function phoneRow(data) {
    data = data || { type: 'mobile', cc: '', number: '' };
    const row = document.createElement('div');
    row.className = 'rep-row phone-row';
    row.appendChild(typeSelect(PHONE_TYPES, data.type, true));
    const cc = document.createElement('select');
    cc.className = 'cc-select';
    CC_LIST.forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      cc.appendChild(o);
    });
    cc.value = CC_LIST.some(([v]) => v === data.cc) ? data.cc : '';
    if (data.cc && cc.value !== data.cc) { // uncommon cc from import
      const o = document.createElement('option'); o.value = data.cc; o.textContent = data.cc;
      cc.appendChild(o); cc.value = data.cc;
    }
    row.appendChild(cc);
    const num = document.createElement('input');
    num.type = 'tel'; num.placeholder = '98765 43210'; num.value = data.number || '';
    num.className = 'row-value';
    row.appendChild(num);
    row.appendChild(delBtn(row));
    return row;
  }

  function emailRow(data) {
    data = data || { type: 'home', address: '' };
    const row = document.createElement('div');
    row.className = 'rep-row';
    row.appendChild(typeSelect(EMAIL_TYPES, data.type, true));
    const inp = document.createElement('input');
    inp.type = 'email'; inp.placeholder = 'name@example.com'; inp.value = data.address || '';
    inp.className = 'row-value';
    row.appendChild(inp);
    row.appendChild(delBtn(row));
    return row;
  }

  function websiteRow(url) {
    const row = document.createElement('div');
    row.className = 'rep-row';
    const lab = document.createElement('span');
    lab.className = 'field-label'; lab.style.margin = '0'; lab.textContent = 'Website';
    row.appendChild(lab);
    const inp = document.createElement('input');
    inp.type = 'url'; inp.placeholder = 'https://example.com'; inp.value = url || '';
    inp.className = 'row-value';
    row.appendChild(inp);
    row.appendChild(delBtn(row));
    return row;
  }

  function socialRow(data) {
    data = data || { network: 'linkedin', url: '' };
    const row = document.createElement('div');
    row.className = 'rep-row';
    const sel = document.createElement('select');
    sel.className = 'row-type';
    SOCIAL_NETWORKS.forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      sel.appendChild(o);
    });
    sel.value = SOCIAL_NETWORKS.some(([v]) => v === data.network) ? data.network : 'custom';
    const inp = document.createElement('input');
    inp.type = 'url'; inp.className = 'row-value';
    const setPh = () => {
      const net = SOCIAL_NETWORKS.find(([v]) => v === sel.value);
      inp.placeholder = net ? net[2] : 'https://…';
    };
    setPh();
    sel.addEventListener('change', () => { setPh(); notify(); });
    inp.value = data.url || '';
    row.appendChild(sel);
    row.appendChild(inp);
    row.appendChild(delBtn(row));
    return row;
  }

  function customRow(data) {
    data = data || { key: '', value: '' };
    const row = document.createElement('div');
    row.className = 'rep-row custom-row';
    const k = document.createElement('input');
    k.type = 'text'; k.placeholder = 'Field name (e.g. GSTIN)'; k.value = data.key || '';
    k.className = 'row-key';
    const v = document.createElement('input');
    v.type = 'text'; v.placeholder = 'Value'; v.value = data.value || '';
    v.className = 'row-value';
    row.appendChild(k); row.appendChild(v); row.appendChild(delBtn(row));
    return row;
  }

  function addrBlock(data) {
    data = data || { type: 'home', po: '', ext: '', street: '', city: '', state: '', zip: '', country: '' };
    const blk = document.createElement('div');
    blk.className = 'addr-block';
    const head = document.createElement('div');
    head.className = 'addr-head';
    head.appendChild(typeSelect(ADDR_TYPES, data.type, true));
    head.appendChild(delBtn(blk));
    blk.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'addr-grid';
    const mk = (cls, ph, val, span2) => {
      const i = document.createElement('input');
      i.type = 'text'; i.placeholder = ph; i.value = val || ''; i.className = cls;
      if (span2) i.classList.add('span-2');
      grid.appendChild(i);
      return i;
    };
    mk('a-street', 'Street address', data.street, true);
    mk('a-ext', 'Apartment, floor, landmark (optional)', data.ext, true);
    mk('a-city', 'City', data.city);
    mk('a-state', 'State / Province', data.state);
    mk('a-zip', 'PIN / ZIP code', data.zip);
    mk('a-country', 'Country', data.country);
    mk('a-po', 'PO box (optional)', data.po, true);
    blk.appendChild(grid);
    return blk;
  }

  /* ---------------- images ---------------- */

  function loadImageFile(file, cb, maxSide) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { window.App && App.toast('Image is larger than 5 MB', 'err'); return; }
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) { window.App && App.toast('Use a JPG, PNG or WebP image', 'err'); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const M = maxSide || 512;
      let w = img.naturalWidth, h = img.naturalHeight;
      const sc = Math.min(1, M / Math.max(w, h));
      w = Math.round(w * sc); h = Math.round(h * sc);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const isPng = /png$/i.test(file.type);
      const dataUrl = isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
      cb({ dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); window.App && App.toast('Could not read that image', 'err'); };
    img.src = url;
  }

  function bindImageUpload(dropId, inputId, previewId, removeId, setter) {
    const drop = $(dropId), input = $(inputId), preview = $(previewId), removeBtn = $(removeId);
    const show = (data) => {
      setter(data);
      if (data) {
        preview.src = data.dataUrl; preview.hidden = false;
        removeBtn.hidden = false;
        drop.querySelector('.img-drop-hint').style.visibility = 'hidden';
      } else {
        preview.src = ''; preview.hidden = true;
        removeBtn.hidden = true;
        drop.querySelector('.img-drop-hint').style.visibility = '';
      }
      notify();
    };
    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => loadImageFile(input.files[0], show));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('dragover');
      loadImageFile(e.dataTransfer.files[0], show);
    });
    removeBtn.addEventListener('click', () => { input.value = ''; show(null); });
    return show;
  }

  let setPhotoUI, setLogoUI;

  /* ---------------- collect / apply ---------------- */

  function emptyModel() {
    return {
      name: { prefix: '', first: '', middle: '', last: '', suffix: '', nickname: '', fnOverride: '' },
      work: { company: '', department: '', title: '', role: '', websites: [], calendar: '' },
      phones: [], emails: [], addresses: [],
      photo: null, logo: null, social: [],
      personal: { birthday: '', anniversary: '', gender: '' },
      other: { notes: '', categories: '', timezone: '', geoLat: '', geoLon: '' },
      custom: [], uid: ''
    };
  }

  function getModel() {
    const m = emptyModel();
    m.uid = getModel._uid || '';
    m.name = {
      prefix: $('#f-prefix').value.trim(), first: $('#f-first').value.trim(),
      middle: $('#f-middle').value.trim(), last: $('#f-last').value.trim(),
      suffix: $('#f-suffix').value.trim(), nickname: $('#f-nickname').value.trim(),
      fnOverride: $('#f-fn').value.trim()
    };
    m.work = {
      company: $('#f-company').value.trim(), department: $('#f-department').value.trim(),
      title: $('#f-title').value.trim(), role: $('#f-role').value.trim(),
      websites: $$('#websites-list .row-value').map(i => i.value.trim()).filter(Boolean),
      calendar: $('#f-calendar').value.trim()
    };
    m.phones = $$('#phones-list .rep-row').map(r => ({
      type: r.querySelector('.row-type').value,
      cc: r.querySelector('.cc-select').value,
      number: r.querySelector('.row-value').value.trim()
    })).filter(p => p.number);
    m.emails = $$('#emails-list .rep-row').map(r => ({
      type: r.querySelector('.row-type').value,
      address: r.querySelector('.row-value').value.trim()
    })).filter(e => e.address);
    m.addresses = $$('#addr-list .addr-block').map(b => ({
      type: b.querySelector('.row-type').value,
      po: b.querySelector('.a-po').value.trim(), ext: b.querySelector('.a-ext').value.trim(),
      street: b.querySelector('.a-street').value.trim(), city: b.querySelector('.a-city').value.trim(),
      state: b.querySelector('.a-state').value.trim(), zip: b.querySelector('.a-zip').value.trim(),
      country: b.querySelector('.a-country').value.trim()
    })).filter(a => a.street || a.city || a.zip || a.country || a.state);
    m.photo = photoData; m.logo = logoData;
    m.social = $$('#social-list .rep-row').map(r => ({
      network: r.querySelector('select').value,
      url: r.querySelector('.row-value').value.trim()
    })).filter(s => s.url);
    m.personal = {
      birthday: $('#f-bday').value, anniversary: $('#f-anniversary').value,
      gender: $('#f-gender').value
    };
    m.other = {
      notes: $('#f-notes').value.trim(), categories: $('#f-categories').value.trim(),
      timezone: $('#f-tz').value.trim(),
      geoLat: $('#f-geo-lat').value.trim(), geoLon: $('#f-geo-lon').value.trim()
    };
    m.custom = $$('#custom-list .custom-row').map(r => ({
      key: r.querySelector('.row-key').value.trim(),
      value: r.querySelector('.row-value').value.trim()
    })).filter(c => c.key && c.value);
    return m;
  }

  function applyModel(m) {
    m = Object.assign(emptyModel(), m);
    getModel._uid = m.uid || '';
    const n = m.name || {}, w = m.work || {}, p = m.personal || {}, o = m.other || {};
    $('#f-prefix').value = n.prefix || ''; $('#f-first').value = n.first || '';
    $('#f-middle').value = n.middle || ''; $('#f-last').value = n.last || '';
    $('#f-suffix').value = n.suffix || ''; $('#f-nickname').value = n.nickname || '';
    $('#f-fn').value = n.fnOverride || '';
    $('#f-company').value = w.company || ''; $('#f-department').value = w.department || '';
    $('#f-title').value = w.title || ''; $('#f-role').value = w.role || '';
    $('#f-calendar').value = w.calendar || '';
    $('#f-bday').value = p.birthday || ''; $('#f-anniversary').value = p.anniversary || '';
    $('#f-gender').value = p.gender || '';
    $('#f-notes').value = o.notes || ''; $('#f-categories').value = o.categories || '';
    $('#f-tz').value = o.timezone || '';
    $('#f-geo-lat').value = o.geoLat || ''; $('#f-geo-lon').value = o.geoLon || '';

    const fill = (listSel, items, maker, fallback) => {
      const list = $(listSel);
      list.innerHTML = '';
      const arr = (items && items.length) ? items : (fallback ? [undefined] : []);
      arr.forEach(it => list.appendChild(maker(it)));
    };
    fill('#phones-list', m.phones, phoneRow, true);
    fill('#emails-list', m.emails, emailRow, true);
    fill('#websites-list', (w.websites || []).map(u => u), websiteRow, false);
    fill('#addr-list', m.addresses, addrBlock, false);
    fill('#social-list', m.social, socialRow, false);
    fill('#custom-list', m.custom, customRow, false);

    setPhotoUI(m.photo && m.photo.dataUrl ? m.photo : null);
    setLogoUI(m.logo && m.logo.dataUrl ? m.logo : null);
    notify();
  }

  function reset() { applyModel(emptyModel()); }

  /* ---------------- init ---------------- */

  function init(onChange) {
    changeCb = onChange;

    $('#add-phone').addEventListener('click', () => { $('#phones-list').appendChild(phoneRow()); notify(); });
    $('#add-email').addEventListener('click', () => { $('#emails-list').appendChild(emailRow()); notify(); });
    $('#add-website').addEventListener('click', () => { $('#websites-list').appendChild(websiteRow()); notify(); });
    $('#add-addr').addEventListener('click', () => { $('#addr-list').appendChild(addrBlock()); notify(); });
    $('#add-social').addEventListener('click', () => { $('#social-list').appendChild(socialRow()); notify(); });
    $('#add-custom').addEventListener('click', () => { $('#custom-list').appendChild(customRow()); notify(); });

    setPhotoUI = bindImageUpload('#photo-drop', '#f-photo', '#photo-preview', '#photo-remove', d => { photoData = d; });
    setLogoUI = bindImageUpload('#logo-drop', '#f-logo', '#logo-preview', '#logo-remove', d => { logoData = d; });

    // default rows
    $('#phones-list').appendChild(phoneRow());
    $('#emails-list').appendChild(emailRow());

    // live updates
    $('.form-col').addEventListener('input', notify);
    $('.form-col').addEventListener('change', notify);
  }

  window.FormUI = { init, getModel, applyModel, reset, emptyModel, loadImageFile };
})();
