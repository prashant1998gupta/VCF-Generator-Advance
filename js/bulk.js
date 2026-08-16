/* ============================================================
   bulk.js — CSV import (with column mapping) / export, VCF
   import, combined VCF + ZIP export, CSV template.
   Exposes global: Bulk
   ============================================================ */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);

  /* ---------------- field definitions ---------------- */

  const set = (path) => (m, v) => {
    const keys = path.split('.');
    let o = m;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = v;
  };
  const phone = (type) => (m, v) => m.phones.push({ type, cc: '', number: v });
  const email = (type) => (m, v) => m.emails.push({ type, address: v });
  const addr = (type, key) => (m, v) => {
    let a = m.addresses.find(x => x.type === type);
    if (!a) { a = { type, po: '', ext: '', street: '', city: '', state: '', zip: '', country: '' }; m.addresses.push(a); }
    a[key] = v;
  };
  const social = (network) => (m, v) => {
    let u = v.trim();
    if (u && !/^https?:\/\//i.test(u) && u.includes('.')) u = 'https://' + u;
    else if (u && !u.includes('.')) return; // bare handle without domain — skip
    m.social.push({ network, url: u });
  };

  // key → [label, aliases[], apply(model, value)]
  const FIELDS = {
    prefix:       ['Prefix', ['title(honorific)', 'salutation', 'honorific'], set('name.prefix')],
    first_name:   ['First name', ['firstname', 'first', 'fname', 'givenname', 'given'], set('name.first')],
    middle_name:  ['Middle name', ['middlename', 'middle'], set('name.middle')],
    last_name:    ['Last name', ['lastname', 'last', 'lname', 'surname', 'familyname', 'family'], set('name.last')],
    suffix:       ['Suffix', [], set('name.suffix')],
    nickname:     ['Nickname', ['nick'], set('name.nickname')],
    full_name:    ['Full name', ['fullname', 'name', 'displayname', 'contactname'], (m, v) => {
      const parts = v.trim().split(/\s+/);
      if (!m.name.first && parts.length) { m.name.first = parts[0]; m.name.last = parts.slice(1).join(' '); }
    }],
    company:      ['Company', ['organization', 'organisation', 'org', 'companyname', 'business', 'firm'], set('work.company')],
    department:   ['Department', ['dept'], set('work.department')],
    job_title:    ['Job title', ['jobtitle', 'title', 'designation', 'position', 'role', 'post'], set('work.title')],
    website:      ['Website', ['url', 'web', 'site', 'homepage', 'websiteurl'], (m, v) => {
      let u = v.trim();
      if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
      m.work.websites.push(u);
    }],
    mobile_phone: ['Mobile phone', ['mobile', 'cell', 'cellphone', 'mobileno', 'mobilenumber', 'phone', 'phonenumber', 'contactno', 'contact', 'whatsappnumber'], phone('mobile')],
    work_phone:   ['Work phone', ['workphone', 'office', 'officephone', 'landline', 'tel', 'telephone', 'businessphone'], phone('work')],
    home_phone:   ['Home phone', ['homephone'], phone('home')],
    fax:          ['Fax', ['faxnumber'], phone('work fax')],
    email_work:   ['Email (work)', ['workemail', 'officeemail', 'businessemail'], email('work')],
    email_home:   ['Email (personal)', ['email', 'emailaddress', 'mail', 'personalemail', 'homeemail', 'emailid'], email('home')],
    work_street:  ['Work address — street', ['workstreet', 'workaddress', 'officeaddress', 'address', 'street', 'addressline1', 'streetaddress'], addr('work', 'street')],
    work_city:    ['Work address — city', ['workcity', 'city', 'town'], addr('work', 'city')],
    work_state:   ['Work address — state', ['workstate', 'state', 'province', 'region'], addr('work', 'state')],
    work_zip:     ['Work address — PIN/ZIP', ['workzip', 'zip', 'zipcode', 'pincode', 'pin', 'postalcode', 'postcode'], addr('work', 'zip')],
    work_country: ['Work address — country', ['workcountry', 'country'], addr('work', 'country')],
    home_street:  ['Home address — street', ['homestreet', 'homeaddress'], addr('home', 'street')],
    home_city:    ['Home address — city', ['homecity'], addr('home', 'city')],
    home_state:   ['Home address — state', ['homestate'], addr('home', 'state')],
    home_zip:     ['Home address — PIN/ZIP', ['homezip', 'homepincode'], addr('home', 'zip')],
    home_country: ['Home address — country', ['homecountry'], addr('home', 'country')],
    birthday:     ['Birthday (YYYY-MM-DD)', ['bday', 'dob', 'dateofbirth', 'birthdate'], (m, v) => {
      const d = normDate(v); if (d) m.personal.birthday = d;
    }],
    anniversary:  ['Anniversary (YYYY-MM-DD)', [], (m, v) => {
      const d = normDate(v); if (d) m.personal.anniversary = d;
    }],
    notes:        ['Notes', ['note', 'comments', 'comment', 'remarks', 'description', 'about'], (m, v) => {
      m.other.notes = m.other.notes ? m.other.notes + '\n' + v : v;
    }],
    categories:   ['Categories / tags', ['category', 'tags', 'tag', 'group', 'groups', 'label'], set('other.categories')],
    linkedin:     ['LinkedIn', ['linkedinurl'], social('linkedin')],
    instagram:    ['Instagram', ['insta'], social('instagram')],
    facebook:     ['Facebook', ['fb'], social('facebook')],
    twitter:      ['X / Twitter', ['x'], social('twitter')],
    whatsapp:     ['WhatsApp link', ['whatsapplink', 'wame'], social('whatsapp')]
  };

  const TEMPLATE_COLS = ['prefix', 'first_name', 'middle_name', 'last_name', 'company', 'job_title',
    'mobile_phone', 'work_phone', 'email_work', 'email_home', 'website',
    'work_street', 'work_city', 'work_state', 'work_zip', 'work_country',
    'birthday', 'notes', 'categories', 'linkedin', 'instagram'];

  function normDate(v) {
    v = String(v || '').trim();
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v);
    if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(v);          // DD-MM-YYYY (common in India)
    if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
    return '';
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  function normHeader(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function guessField(header) {
    const n = normHeader(header);
    if (!n) return '';
    for (const key of Object.keys(FIELDS)) {
      if (normHeader(key) === n) return key;
    }
    for (const [key, def] of Object.entries(FIELDS)) {
      if (def[1].some(a => normHeader(a) === n)) return key;
    }
    // loose contains match
    for (const [key, def] of Object.entries(FIELDS)) {
      if ([normHeader(key), ...def[1].map(normHeader)].some(a => a.length > 3 && (n.includes(a) || a.includes(n)))) return key;
    }
    return '';
  }

  /* ---------------- CSV import ---------------- */

  let pendingRows = null;

  function importCsvFile(file) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const rows = res.data || [];
        const headers = (res.meta && res.meta.fields) || [];
        if (!rows.length || !headers.length) {
          App.toast('CSV appears to be empty', 'err');
          return;
        }
        pendingRows = rows;
        buildMappingUI(headers, rows);
        App.openModal('modal-csv');
      },
      error: (err) => App.toast('Could not parse CSV: ' + err.message, 'err')
    });
  }

  function buildMappingUI(headers, rows) {
    $('#csv-info').textContent = rows.length + ' row' + (rows.length > 1 ? 's' : '') +
      ' found. Match each CSV column to a contact field (auto-detected where possible).';
    const table = $('#csv-map-table');
    table.innerHTML = '<tr><th>CSV column</th><th>Sample</th><th>Import as</th></tr>';
    headers.forEach(h => {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = h;
      const td2 = document.createElement('td');
      const sample = rows.map(r => r[h]).find(v => v && String(v).trim()) || '';
      const s = document.createElement('span');
      s.className = 'sample'; s.textContent = sample; s.title = sample;
      td2.appendChild(s);
      const td3 = document.createElement('td');
      const sel = document.createElement('select');
      sel.dataset.header = h;
      const skip = document.createElement('option');
      skip.value = ''; skip.textContent = '— skip —';
      sel.appendChild(skip);
      Object.entries(FIELDS).forEach(([key, def]) => {
        const o = document.createElement('option');
        o.value = key; o.textContent = def[0];
        sel.appendChild(o);
      });
      sel.value = guessField(h);
      td3.appendChild(sel);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      table.appendChild(tr);
    });
  }

  function doImport() {
    if (!pendingRows) return;
    const mapping = [...document.querySelectorAll('#csv-map-table select')]
      .map(s => ({ header: s.dataset.header, field: s.value }))
      .filter(m => m.field);
    if (!mapping.length) { App.toast('Map at least one column', 'warn'); return; }

    const models = [];
    for (const row of pendingRows) {
      const m = FormUI.emptyModel();
      let any = false;
      for (const { header, field } of mapping) {
        const v = String(row[header] == null ? '' : row[header]).trim();
        if (!v) continue;
        FIELDS[field][2](m, v);
        any = true;
      }
      if (any) models.push(m);
    }
    if (!models.length) { App.toast('No usable rows found', 'warn'); return; }
    Contacts.addMany(models);
    pendingRows = null;
    App.closeModal('modal-csv');
    App.showTab('contacts');
    App.toast('Imported ' + models.length + ' contact' + (models.length > 1 ? 's' : '') + ' ✔', 'ok');
  }

  /* ---------------- exports ---------------- */

  function requireContacts() {
    if (!Contacts.count()) { App.toast('No saved contacts to export yet', 'warn'); return false; }
    return true;
  }

  function exportAllVcf() {
    if (!requireContacts()) return;
    const v = App.getVersion();
    const text = Contacts.all().map(m => VCard.generate(m, v)).join('');
    App.downloadBlob(new Blob([text], { type: 'text/vcard' }), 'contacts_' + Contacts.count() + '.vcf');
    App.toast('Exported ' + Contacts.count() + ' contacts into one .vcf', 'ok');
  }

  async function exportZip() {
    if (!requireContacts()) return;
    const v = App.getVersion();
    const zip = new JSZip();
    const used = new Set();
    Contacts.all().forEach(m => {
      let name = VCard.suggestFileName(m);
      let base = name.replace(/\.vcf$/, ''), i = 2;
      while (used.has(name)) { name = base + '_' + (i++) + '.vcf'; }
      used.add(name);
      zip.file(name, VCard.generate(m, v));
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    App.downloadBlob(blob, 'contacts.zip');
    App.toast('ZIP with ' + Contacts.count() + ' .vcf files ready', 'ok');
  }

  function exportCsv() {
    if (!requireContacts()) return;
    const rows = Contacts.all().map(m => {
      const firstOf = (arr, pred) => (arr || []).find(pred) || {};
      const addrOf = t => (m.addresses || []).find(a => a.type === t) || {};
      const socialOf = n => ((m.social || []).find(s => s.network === n) || {}).url || '';
      const wa = addrOf('work');
      return {
        prefix: m.name.prefix, first_name: m.name.first, middle_name: m.name.middle,
        last_name: m.name.last, suffix: m.name.suffix, nickname: m.name.nickname,
        company: m.work.company, department: m.work.department, job_title: m.work.title,
        mobile_phone: joinPhone(firstOf(m.phones, p => p.type === 'mobile')),
        work_phone: joinPhone(firstOf(m.phones, p => p.type === 'work')),
        home_phone: joinPhone(firstOf(m.phones, p => p.type === 'home')),
        fax: joinPhone(firstOf(m.phones, p => /fax/.test(p.type))),
        email_work: (firstOf(m.emails, e => e.type === 'work')).address || '',
        email_home: (firstOf(m.emails, e => e.type !== 'work')).address || '',
        website: (m.work.websites || [])[0] || '',
        work_street: wa.street || '', work_city: wa.city || '', work_state: wa.state || '',
        work_zip: wa.zip || '', work_country: wa.country || '',
        birthday: m.personal.birthday, anniversary: m.personal.anniversary,
        notes: m.other.notes, categories: m.other.categories,
        linkedin: socialOf('linkedin'), instagram: socialOf('instagram'),
        facebook: socialOf('facebook'), twitter: socialOf('twitter'), whatsapp: socialOf('whatsapp')
      };
    });
    const csv = Papa.unparse(rows);
    App.downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'contacts.csv');
    App.toast('CSV exported', 'ok');
  }

  function joinPhone(p) {
    if (!p || !p.number) return '';
    return (p.cc && !p.number.startsWith('+')) ? p.cc + ' ' + p.number : p.number;
  }

  function downloadTemplate() {
    const example = {
      prefix: 'Mr.', first_name: 'Sanjeev', middle_name: '', last_name: 'Gupta',
      company: 'Acme Pvt. Ltd.', job_title: 'Managing Director',
      mobile_phone: '+91 98765 43210', work_phone: '011 2345 6789',
      email_work: 'sanjeev@acme.com', email_home: '', website: 'https://acme.com',
      work_street: '12 MG Road', work_city: 'New Delhi', work_state: 'Delhi',
      work_zip: '110001', work_country: 'India',
      birthday: '1980-06-15', notes: 'Met at trade fair', categories: 'Client, VIP',
      linkedin: 'https://linkedin.com/in/sanjeevgupta', instagram: ''
    };
    const row = {};
    TEMPLATE_COLS.forEach(c => { row[c] = example[c] || ''; });
    const csv = Papa.unparse([row]);
    App.downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'contacts_template.csv');
  }

  /* ---------------- VCF import ---------------- */

  function importVcfFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const models = VCard.parse(reader.result);
        if (!models.length) { App.toast('No contacts found in that file', 'warn'); return; }
        if (models.length === 1) {
          FormUI.applyModel(models[0]);
          App.showTab('create');
          App.toast('Contact loaded into the form — review & save', 'ok');
        } else {
          Contacts.addMany(models);
          App.showTab('contacts');
          App.toast('Imported ' + models.length + ' contacts ✔', 'ok');
        }
      } catch (e) {
        console.error(e);
        App.toast('Could not read that .vcf file', 'err');
      }
    };
    reader.readAsText(file);
  }

  /* ---------------- init ---------------- */

  function init() {
    $('#btn-import-vcf').addEventListener('click', () => $('#import-vcf-file').click());
    $('#import-vcf-file').addEventListener('change', e => {
      if (e.target.files[0]) importVcfFile(e.target.files[0]);
      e.target.value = '';
    });
    $('#btn-import-csv').addEventListener('click', () => $('#import-csv-file').click());
    $('#import-csv-file').addEventListener('change', e => {
      if (e.target.files[0]) importCsvFile(e.target.files[0]);
      e.target.value = '';
    });
    $('#csv-do-import').addEventListener('click', doImport);
    $('#btn-export-all-vcf').addEventListener('click', exportAllVcf);
    $('#btn-export-zip').addEventListener('click', exportZip);
    $('#btn-export-csv').addEventListener('click', exportCsv);
    $('#btn-csv-template').addEventListener('click', downloadTemplate);
  }

  window.Bulk = { init };
})();
