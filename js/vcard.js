/* ============================================================
   vcard.js — vCard engine: generate 2.1 / 3.0 / 4.0 + parse .vcf
   Spec-correct escaping, 75-octet line folding, photo embedding.
   Exposes global: VCard
   ============================================================ */
(function () {
  'use strict';

  const enc = new TextEncoder();

  /* ---------------- escaping ---------------- */

  // Escape a text value (NOTE, FN, TITLE …). v2.1 keeps commas literal.
  function esc(v, version) {
    if (v == null) return '';
    v = String(v).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;');
    if (version !== '2.1') v = v.replace(/,/g, '\\,');
    return v;
  }

  function unescape_(v) {
    if (v == null) return '';
    return String(v)
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  /* ---------------- folding ---------------- */

  // Fold a content line at 75 octets (UTF-8 aware, never splits a code point).
  function fold(line) {
    if (enc.encode(line).length <= 75) return line;
    const parts = [];
    let cur = '', curBytes = 0, limit = 75;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (curBytes + b > limit) {
        parts.push(cur);
        cur = ch; curBytes = b; limit = 74; // continuation lines lose 1 octet to the leading space
      } else {
        cur += ch; curBytes += b;
      }
    }
    if (cur) parts.push(cur);
    return parts.map((p, i) => (i === 0 ? p : ' ' + p)).join('\r\n');
  }

  /* ---------------- helpers ---------------- */

  function typeParam(types, version) {
    if (!types || !types.length) return '';
    if (version === '2.1') return ';' + types.map(t => t.toUpperCase()).join(';');
    if (version === '3.0') return ';TYPE=' + types.map(t => t.toUpperCase()).join(',');
    // 4.0 — lowercase; quote when multiple (comma inside a param value must be quoted)
    const v = types.map(t => t.toLowerCase()).join(',');
    return ';TYPE=' + (types.length > 1 ? '"' + v + '"' : v);
  }

  const TEL_TYPES = {
    mobile: ['cell', 'voice'],
    home:   ['home', 'voice'],
    work:   ['work', 'voice'],
    main:   ['voice'],
    fax:    ['fax'],
    'work fax': ['work', 'fax'],
    'home fax': ['home', 'fax'],
    pager:  ['pager'],
    other:  ['voice']
  };

  function fullPhone(p) {
    const num = (p.number || '').trim();
    if (!num) return '';
    const cc = (p.cc || '').trim();
    if (cc && !num.startsWith('+')) return cc + ' ' + num;
    return num;
  }

  function composeFN(model) {
    const n = model.name || {};
    if ((n.fnOverride || '').trim()) return n.fnOverride.trim();
    const parts = [n.prefix, n.first, n.middle, n.last, n.suffix].map(s => (s || '').trim()).filter(Boolean);
    if (parts.length) return parts.join(' ');
    if ((model.work || {}).company) return model.work.company.trim();
    return 'Contact';
  }

  function dataUrlParts(dataUrl) {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || '');
    if (!m) return null;
    return { mime: m[1], b64: m[2].replace(/\s+/g, '') };
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /* ---------------- generation ---------------- */

  /**
   * @param {object} model  the app contact model (see form.js emptyModel)
   * @param {'2.1'|'3.0'|'4.0'} version
   * @param {object} [opts] { includePhoto:true, includeLogo:true }
   */
  function generate(model, version, opts) {
    version = version || '3.0';
    opts = Object.assign({ includePhoto: true, includeLogo: true }, opts);
    const v4 = version === '4.0', v21 = version === '2.1';
    const L = [];           // raw (unfolded) content lines
    let itemN = 0;          // Apple-style item group counter for custom labels

    const push = (line) => { if (line) L.push(line); };
    const e = (s) => esc(s, version);

    push('BEGIN:VCARD');
    push('VERSION:' + version);
    if (!v21) push('PRODID:-//VCF Generator Advance//EN');
    if (v4) push('KIND:individual');

    // --- name ---
    const n = model.name || {};
    push('N:' + [n.last, n.first, n.middle, n.prefix, n.suffix].map(x => e(x || '')).join(';'));
    push('FN:' + e(composeFN(model)));
    if ((n.nickname || '').trim() && !v21) push('NICKNAME:' + e(n.nickname.trim()));

    // --- work ---
    const w = model.work || {};
    if ((w.company || '').trim() || (w.department || '').trim()) {
      push('ORG:' + e((w.company || '').trim()) + ((w.department || '').trim() ? ';' + e(w.department.trim()) : ''));
    }
    if ((w.title || '').trim()) push('TITLE:' + e(w.title.trim()));
    if ((w.role || '').trim()) push('ROLE:' + e(w.role.trim()));
    (w.websites || []).forEach(u => { if ((u || '').trim()) push('URL:' + e(u.trim())); });
    if ((w.calendar || '').trim() && !v21) push('CALURI:' + e(w.calendar.trim()));

    // --- phones ---
    (model.phones || []).forEach(p => {
      const num = fullPhone(p);
      if (!num) return;
      const t = (p.type || 'mobile').toLowerCase();
      if (TEL_TYPES[t]) {
        push('TEL' + typeParam(TEL_TYPES[t], version) + ':' + e(num));
      } else {
        // custom label → Apple item group (widely supported incl. iOS/Android)
        itemN++;
        push('item' + itemN + '.TEL:' + e(num));
        push('item' + itemN + '.X-ABLabel:' + e(p.type));
      }
    });

    // --- emails ---
    (model.emails || []).forEach(em => {
      const a = (em.address || '').trim();
      if (!a) return;
      const t = (em.type || 'home').toLowerCase();
      if (t === 'home' || t === 'work' || t === 'other') {
        const types = v4 ? (t === 'other' ? [] : [t])
                         : (t === 'other' ? ['internet'] : ['internet', t]);
        push('EMAIL' + typeParam(types, version) + ':' + e(a));
      } else {
        itemN++;
        push('item' + itemN + '.EMAIL' + (v4 ? '' : typeParam(['internet'], version)) + ':' + e(a));
        push('item' + itemN + '.X-ABLabel:' + e(em.type));
      }
    });

    // --- addresses ---
    (model.addresses || []).forEach(ad => {
      const comps = [ad.po, ad.ext, ad.street, ad.city, ad.state, ad.zip, ad.country];
      if (!comps.some(c => (c || '').trim())) return;
      const val = comps.map(c => e((c || '').trim())).join(';');
      const t = (ad.type || 'home').toLowerCase();
      if (t === 'home' || t === 'work' || t === 'other') {
        push('ADR' + typeParam(t === 'other' ? [] : [t], version) + ':' + val);
      } else {
        itemN++;
        push('item' + itemN + '.ADR:' + val);
        push('item' + itemN + '.X-ABLabel:' + e(ad.type));
      }
    });

    // --- images ---
    if (opts.includePhoto && model.photo && model.photo.dataUrl) {
      const ph = photoProp('PHOTO', model.photo.dataUrl, version);
      if (ph) push(ph);
    }
    if (opts.includeLogo && model.logo && model.logo.dataUrl) {
      const lg = photoProp('LOGO', model.logo.dataUrl, version);
      if (lg) push(lg);
    }

    // --- social ---
    (model.social || []).forEach(s => {
      const url = (s.url || '').trim();
      if (!url) return;
      const net = (s.network || 'custom').toLowerCase();
      if (net === 'custom') {
        itemN++;
        push('item' + itemN + '.URL:' + e(url));
        push('item' + itemN + '.X-ABLabel:' + e(s.label || 'Profile'));
      } else {
        push('X-SOCIALPROFILE;' + (v21 ? net.toUpperCase() : 'TYPE=' + net) + ':' + e(url));
      }
    });

    // --- personal ---
    const p = model.personal || {};
    if ((p.birthday || '').trim()) push('BDAY:' + (v4 ? p.birthday.replace(/-/g, '') : p.birthday));
    if ((p.anniversary || '').trim()) {
      if (v4) push('ANNIVERSARY:' + p.anniversary.replace(/-/g, ''));
      else push('X-ANNIVERSARY:' + p.anniversary);
    }
    if ((p.gender || '').trim()) {
      if (v4) push('GENDER:' + p.gender);
      else push('X-GENDER:' + ({ M: 'Male', F: 'Female', O: 'Other', N: 'None', U: 'Unknown' }[p.gender] || p.gender));
    }

    // --- other ---
    const o = model.other || {};
    if ((o.notes || '').trim()) push('NOTE:' + e(o.notes.trim()));
    if ((o.categories || '').trim() && !v21) {
      push('CATEGORIES:' + o.categories.split(',').map(c => e(c.trim())).filter(Boolean).join(','));
    }
    if ((o.timezone || '').trim()) push('TZ:' + e(o.timezone.trim()));
    const lat = parseFloat(o.geoLat), lon = parseFloat(o.geoLon);
    if (isFinite(lat) && isFinite(lon)) {
      if (v4) push('GEO:geo:' + lat + ',' + lon);
      else if (v21) push('GEO:' + lat + ',' + lon);
      else push('GEO:' + lat + ';' + lon);
    }

    // --- custom X- fields ---
    (model.custom || []).forEach(c => {
      const k = (c.key || '').trim(), v = (c.value || '').trim();
      if (!k || !v) return;
      const name = 'X-' + k.toUpperCase().replace(/^X-/, '').replace(/[^A-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (name.length > 2) push(name + ':' + e(v));
    });

    push('UID:' + (model.uid || (model.uid = uuid())));
    push('REV:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''));
    push('END:VCARD');

    return L.map(fold).join('\r\n') + '\r\n';
  }

  function photoProp(prop, dataUrl, version) {
    const parts = dataUrlParts(dataUrl);
    if (!parts) {
      if (/^https?:/i.test(dataUrl)) {
        return version === '4.0' ? prop + ':' + dataUrl
             : prop + ';VALUE=URI:' + dataUrl;
      }
      return null;
    }
    const sub = (parts.mime.split('/')[1] || 'jpeg').toUpperCase();
    if (version === '4.0') return prop + ':data:' + parts.mime + ';base64,' + parts.b64;
    if (version === '2.1') return prop + ';ENCODING=BASE64;TYPE=' + sub + ':' + parts.b64;
    return prop + ';ENCODING=b;TYPE=' + sub + ':' + parts.b64;
  }

  /* ---------------- parsing ---------------- */

  function decodeQP(s) {
    // quoted-printable: soft breaks already merged; decode =XX byte sequences as UTF-8
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
        bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2;
      } else {
        const eb = enc.encode(s[i]);
        for (const b of eb) bytes.push(b);
      }
    }
    try { return new TextDecoder('utf-8').decode(new Uint8Array(bytes)); }
    catch (e) { return s; }
  }

  function parseParams(paramStr) {
    // ";TYPE=WORK,VOICE;CHARSET=UTF-8" or v2.1 bare ";CELL;FAX"
    const params = {};
    if (!paramStr) return params;
    const parts = [];
    let cur = '', inQ = false;
    for (const ch of paramStr) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ';' && !inQ) { if (cur) parts.push(cur); cur = ''; }
      else cur += ch;
    }
    if (cur) parts.push(cur);
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq === -1) {
        (params.TYPE = params.TYPE || []).push(...part.toUpperCase().split(','));
      } else {
        const key = part.slice(0, eq).toUpperCase();
        const val = part.slice(eq + 1);
        if (key === 'TYPE') (params.TYPE = params.TYPE || []).push(...val.toUpperCase().split(','));
        else params[key] = val;
      }
    }
    return params;
  }

  function parseLine(raw) {
    const m = /^(?:([A-Za-z0-9-]+)\.)?([A-Za-z0-9-]+)((?:;[^:]*)?):([\s\S]*)$/.exec(raw);
    if (!m) return null;
    return { group: m[1] || null, name: m[2].toUpperCase(), params: parseParams(m[3]), value: m[4] };
  }

  /** Parse .vcf text → array of app contact models. */
  function parse(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    // Merge v2.1 quoted-printable soft line breaks ("=" at end of line)
    text = text.replace(/=\r?\n/g, '');
    // Unfold continuation lines (RFC folding: CRLF + space/tab)
    text = text.replace(/\r?\n[ \t]/g, '');
    const lines = text.split(/\r?\n/);

    const cards = [];
    let cur = null;           // property list of the current card
    for (const rawLine of lines) {
      const line = rawLine.trim() === '' ? '' : rawLine;
      if (!line) continue;
      const up = line.toUpperCase();
      if (up === 'BEGIN:VCARD') { cur = []; continue; }
      if (up === 'END:VCARD') { if (cur) cards.push(cur); cur = null; continue; }
      if (!cur) continue;
      const p = parseLine(line);
      if (p) cur.push(p);
    }
    return cards.map(propsToModel);
  }

  function propsToModel(props) {
    const model = {
      name: { prefix: '', first: '', middle: '', last: '', suffix: '', nickname: '', fnOverride: '' },
      work: { company: '', department: '', title: '', role: '', websites: [], calendar: '' },
      phones: [], emails: [], addresses: [],
      photo: null, logo: null,
      social: [],
      personal: { birthday: '', anniversary: '', gender: '' },
      other: { notes: '', categories: '', timezone: '', geoLat: '', geoLon: '' },
      custom: [], uid: ''
    };

    // First pass: collect Apple item-group labels
    const labels = {};
    for (const p of props) {
      if (p.group && p.name === 'X-ABLABEL') labels[p.group] = unescape_(p.value);
    }

    let sawFN = '', sawNParts = null;

    for (const p of props) {
      let val = p.value;
      if ((p.params.ENCODING || '').toUpperCase() === 'QUOTED-PRINTABLE') val = decodeQP(val);
      const types = p.params.TYPE || [];
      const label = p.group ? labels[p.group] : null;

      switch (p.name) {
        case 'N': {
          sawNParts = val.split(/(?<!\\);/).map(unescape_);
          const [last, first, middle, prefix, suffix] = sawNParts;
          Object.assign(model.name, { last: last || '', first: first || '', middle: middle || '', prefix: prefix || '', suffix: suffix || '' });
          break;
        }
        case 'FN': sawFN = unescape_(val); break;
        case 'NICKNAME': model.name.nickname = unescape_(val); break;
        case 'ORG': {
          const parts = val.split(/(?<!\\);/).map(unescape_);
          model.work.company = parts[0] || '';
          model.work.department = parts.slice(1).filter(Boolean).join(', ');
          break;
        }
        case 'TITLE': model.work.title = unescape_(val); break;
        case 'ROLE': model.work.role = unescape_(val); break;
        case 'URL': {
          const u = unescape_(val);
          if (label) model.social.push({ network: 'custom', label: label, url: u });
          else model.work.websites.push(u);
          break;
        }
        case 'CALURI': model.work.calendar = unescape_(val); break;
        case 'TEL': {
          const t = new Set(types);
          let type = 'other';
          if (label) type = label;
          else if (t.has('CELL')) type = 'mobile';
          else if (t.has('FAX')) type = t.has('HOME') ? 'home fax' : (t.has('WORK') ? 'work fax' : 'fax');
          else if (t.has('PAGER')) type = 'pager';
          else if (t.has('WORK')) type = 'work';
          else if (t.has('HOME')) type = 'home';
          else type = 'mobile';
          let num = unescape_(val).replace(/^tel:/i, '');
          model.phones.push({ type: type, cc: '', number: num });
          break;
        }
        case 'EMAIL': {
          const t = new Set(types);
          let type = label ? label : (t.has('WORK') ? 'work' : (t.has('HOME') ? 'home' : 'home'));
          model.emails.push({ type: type, address: unescape_(val) });
          break;
        }
        case 'ADR': {
          const c = val.split(/(?<!\\);/).map(unescape_);
          const t = new Set(types);
          model.addresses.push({
            type: label ? label : (t.has('WORK') ? 'work' : (t.has('HOME') ? 'home' : 'other')),
            po: c[0] || '', ext: c[1] || '', street: c[2] || '', city: c[3] || '',
            state: c[4] || '', zip: c[5] || '', country: c[6] || ''
          });
          break;
        }
        case 'PHOTO': case 'LOGO': {
          const img = parseImage(p, val);
          if (img) model[p.name.toLowerCase()] = img;
          break;
        }
        case 'BDAY': model.personal.birthday = normDate(val); break;
        case 'ANNIVERSARY': case 'X-ANNIVERSARY': model.personal.anniversary = normDate(val); break;
        case 'GENDER': model.personal.gender = (val.split(';')[0] || '').trim().toUpperCase().slice(0, 1); break;
        case 'X-GENDER': {
          const g = val.trim().toUpperCase();
          model.personal.gender = { MALE: 'M', FEMALE: 'F', OTHER: 'O', NONE: 'N', UNKNOWN: 'U' }[g] || g.slice(0, 1);
          break;
        }
        case 'NOTE': model.other.notes = unescape_(val); break;
        case 'CATEGORIES': model.other.categories = val.split(/(?<!\\),/).map(s => unescape_(s).trim()).filter(Boolean).join(', '); break;
        case 'TZ': model.other.timezone = unescape_(val); break;
        case 'GEO': {
          let g = val.replace(/^geo:/i, '');
          const parts = g.split(/[;,]/);
          if (parts.length >= 2) { model.other.geoLat = parts[0].trim(); model.other.geoLon = parts[1].trim(); }
          break;
        }
        case 'X-SOCIALPROFILE': {
          const net = (types[0] || 'custom').toLowerCase();
          model.social.push({ network: net, url: unescape_(p.params.X_USER || val) });
          break;
        }
        case 'UID': model.uid = val.trim(); break;
        case 'VERSION': case 'PRODID': case 'REV': case 'KIND': case 'X-ABLABEL': break;
        default:
          if (p.name.startsWith('X-')) {
            model.custom.push({ key: p.name.slice(2), value: unescape_(val) });
          }
      }
    }

    // FN kept only when it differs from the auto-composed name
    if (sawFN) {
      const auto = composeFN(model);
      if (sawFN.trim() !== auto.trim()) model.name.fnOverride = sawFN;
    }
    return model;
  }

  function parseImage(p, val) {
    const encoding = (p.params.ENCODING || '').toUpperCase();
    if (/^data:/i.test(val)) return { dataUrl: val.trim() };
    if (encoding === 'B' || encoding === 'BASE64') {
      let mime = 'image/jpeg';
      const t = (p.params.TYPE || [])[0];
      if (t) mime = 'image/' + t.toLowerCase().replace('image/', '');
      return { dataUrl: 'data:' + mime + ';base64,' + val.replace(/\s+/g, '') };
    }
    if (/^https?:/i.test(val)) return { dataUrl: val.trim() }; // remote URL — kept as-is
    return null;
  }

  function normDate(v) {
    v = v.trim();
    let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    return '';
  }

  /* ---------------- misc public helpers ---------------- */

  function suggestFileName(model) {
    const n = model.name || {};
    const base = [n.first, n.last].map(s => (s || '').trim()).filter(Boolean).join('_')
      || (model.work && model.work.company || '').trim().replace(/\s+/g, '_')
      || 'contact';
    return base.replace(/[^\w\u00C0-\uFFFF-]+/g, '_').replace(/_+/g, '_') + '.vcf';
  }

  window.VCard = { generate, parse, composeFN, suggestFileName, fold, esc };
})();
