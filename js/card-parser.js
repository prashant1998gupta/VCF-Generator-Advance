/* ============================================================
   card-parser.js — turns raw OCR output into structured contact
   fields using layout + linguistic heuristics. This is what makes
   local scanning accurate.
   Exposes global: CardParser
   ============================================================ */
(function () {
  'use strict';

  /* ---------- category definitions (shared with review UI) ---------- */

  const CATEGORIES = [
    ['name', 'Name'],
    ['title', 'Job title'],
    ['company', 'Company'],
    ['mobile', 'Mobile phone'],
    ['work-phone', 'Work phone'],
    ['fax', 'Fax'],
    ['email', 'Email'],
    ['website', 'Website'],
    ['address', 'Address'],
    ['social', 'Social link'],
    ['notes', 'Note'],
    ['ignore', '— Ignore —']
  ];

  /* ---------- dictionaries & patterns ---------- */

  const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const RE_URL = /(https?:\/\/[^\s|]+|www\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(\/[^\s|]*)?)/gi;
  const RE_BARE_DOMAIN = /(^|[\s|:])((?:[A-Za-z0-9-]+\.)+(?:com|in|org|net|io|co|biz|info|dev|ai|me|us|uk|ae|sg|au|ca|de|fr|it|es|nl|jp|cn|tech|store|online|site|xyz|shop|life|world|agency|solutions|services|digital|studio|design|group|global|company|business))(\/[^\s|]*)?(?=$|[\s|,)])/gi;
  const RE_PHONE = /(?:\+?\d[\d\s\-—.()\/]{5,}\d)/g;
  const RE_PIN_IN = /\b\d{6}\b/;
  const RE_ZIP_US = /\b\d{5}(?:-\d{4})?\b/;

  const TITLE_WORDS = [
    'ceo', 'cto', 'cfo', 'coo', 'cmo', 'chairman', 'chairperson', 'founder', 'co-founder', 'cofounder',
    'director', 'managing director', 'md', 'president', 'vice president', 'vp', 'proprietor', 'partner',
    'manager', 'general manager', 'gm', 'head', 'lead', 'chief', 'officer', 'executive', 'supervisor',
    'engineer', 'developer', 'programmer', 'architect', 'designer', 'consultant', 'advisor', 'analyst',
    'specialist', 'coordinator', 'administrator', 'accountant', 'auditor', 'advocate', 'attorney', 'lawyer',
    'doctor', 'physician', 'surgeon', 'dentist', 'pharmacist', 'professor', 'lecturer', 'teacher', 'principal',
    'sales', 'marketing', 'business development', 'operations', 'hr', 'human resources', 'finance',
    'photographer', 'journalist', 'editor', 'writer', 'realtor', 'broker', 'agent', 'dealer', 'distributor',
    'contractor', 'builder', 'planner', 'strategist', 'scientist', 'researcher', 'technician', 'therapist',
    'trainer', 'coach', 'interior', 'stylist', 'chef', 'owner', 'incharge', 'in-charge', 'secretary', 'treasurer'
  ];

  // Legal suffixes that near-certainly mark a company name
  const COMPANY_STRONG = /\b(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|llp|llc|inc\.?|incorporated|corp\.?|corporation|gmbh|s\.?a\.?|plc|&\s*(sons|co\.?|bros\.?|brothers))\b/i;
  // Industry words that often appear in company names but also in job titles
  const COMPANY_WEAK = /\b(company|enterprises?|industries|traders?|trading|exports?|imports?|impex|group|holdings?|ventures?|solutions?|technologies|technology|tech|systems?|infotech|software|studios?|labs?|agency|agencies|associates?|consultants?|consultancy|services?|logistics|textiles?|jewell?ers?|caterers?|builders?|developers?|infra(?:structure)?|realty|properties|motors?|automobiles?|electricals?|electronics|engineering|works|foods?|farms?|pharma(?:ceuticals?)?|hospitals?|clinics?|academy|institute|foundation|store|mart|bazaa?r|emporium|collections?|creations?|fashions?|designs?|prints?|packaging|international|overseas)\b/i;

  const ADDR_WORDS = /\b(road|rd\.?|street|st\.?|avenue|ave\.?|lane|ln\.?|marg|nagar|chowk|bazaa?r|sector|phase|block|plot|floor|flr|shop|gali|wing|suite|ste\.?|unit|building|bldg|tower|complex|arcade|plaza|heights|apartments?|apt\.?|society|colony|layout|cross|main|market|mkt|near|opp\.?|opposite|behind|beside|above|industrial|area|estate|park|zone|dist\.?|district|tehsil|taluka|po\b|p\.o\.?|gpo|landmark|highway|hwy|bypass|circle|square|junction|jn\.?|station|gate|campus|city|village|vill\.?|pincode|pin\s*[-:]?|zip)\b/i;

  const COUNTRIES = /\b(india|usa|u\.s\.a\.?|united states|uk|u\.k\.?|united kingdom|uae|u\.a\.e\.?|canada|australia|singapore|germany|france|japan|china|nepal|bangladesh|sri lanka|pakistan|saudi arabia|qatar|oman|kuwait|bahrain|malaysia|thailand|indonesia|philippines|vietnam|south africa|nigeria|kenya|egypt|brazil|mexico|italy|spain|netherlands|switzerland|sweden|poland|russia|turkey|israel|ireland|new zealand)\b/i;

  const SOCIAL_HOSTS = {
    'linkedin.com': 'linkedin', 'instagram.com': 'instagram', 'facebook.com': 'facebook', 'fb.com': 'facebook',
    'twitter.com': 'twitter', 'x.com': 'twitter', 'youtube.com': 'youtube', 'youtu.be': 'youtube',
    'tiktok.com': 'tiktok', 'github.com': 'github', 'wa.me': 'whatsapp', 'whatsapp.com': 'whatsapp',
    't.me': 'telegram', 'telegram.me': 'telegram', 'snapchat.com': 'snapchat', 'pinterest.com': 'pinterest'
  };

  const FREE_MAIL = /^(gmail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|rediffmail|rediff|protonmail|proton|zoho|mail|gmx|yandex|inbox)\./i;

  const NAME_PREFIX = /^(mr|mrs|ms|miss|dr|prof|er|adv|ca|shri|smt|sri|md\.?|mohd\.?)[\s.]+/i;

  const LABEL_JUNK = /^\s*(tel|tell|phone|ph|mob|mobile|cell|whatsapp|wa|call|off|office|work|fax|email|e-?mail|mail|web|website|www|url|address|add|regd\.?\s*office|corp\.?\s*office|branch|works?)\s*[:.\-]?\s*/i;

  /* ---------- helpers ---------- */

  function digits(s) { return (s || '').replace(/\D/g, ''); }

  function classifyPhone(context, line, numRaw) {
    // 1. label right before this number ("Fax: 011-…", "M: 98…") — most reliable
    const c = (context || '').toLowerCase();
    if (/\bfax\b[\s.:,\-|]*$/.test(c)) return 'fax';
    if (/\b(m|mob|mobile|cell|whatsapp|wa|personal|hp)\b[\s.:,\-|]*$/.test(c)) return 'mobile';
    if (/\b(t|tel|off|office|work|board|landline|ph|phone|direct|dir)\b[\s.:,\-|]*$/.test(c)) return 'work-phone';

    // 2. whole line — only when it carries exactly one kind of label
    const l = line.toLowerCase();
    const hasFax = /\bfax\b/.test(l);
    const hasMob = /\b(mob|mobile|cell|whatsapp|wa)\b/.test(l);
    const hasTel = /\b(tel|off|office|work|board|landline)\b/.test(l);
    if ([hasFax, hasMob, hasTel].filter(Boolean).length === 1) {
      if (hasFax) return 'fax';
      if (hasMob) return 'mobile';
      return 'work-phone';
    }

    // 3. number-shape heuristics: Indian mobiles are 10 digits starting 6-9
    const d = digits(numRaw);
    const last10 = d.slice(-10);
    if (last10.length === 10 && /^[6-9]/.test(last10) && (d.length === 10 || d.startsWith('91') || numRaw.trim().startsWith('+'))) return 'mobile';
    if (d.length >= 11 && numRaw.trim().startsWith('+')) return 'mobile';
    return 'work-phone';
  }

  function cleanPhone(numRaw) {
    let s = numRaw.replace(/[—–]/g, '-').replace(/[^\d+()\-.\s\/]/g, '').trim();
    s = s.replace(/\s{2,}/g, ' ');
    return s;
  }

  function normUrl(u) {
    u = u.trim().replace(/[|,.;]+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/*/, '');
    return u;
  }

  function hostOf(u) {
    try { return new URL(normUrl(u)).hostname.replace(/^www\./i, '').toLowerCase(); }
    catch (e) { return ''; }
  }

  function isTitleCaseWord(w) { return /^[A-Z][a-z'’.-]+$/.test(w) || /^[A-Z]\.?$/.test(w); }

  function looksLikeName(text) {
    const t = text.replace(NAME_PREFIX, '').trim();
    const words = t.split(/\s+/);
    if (words.length < 1 || words.length > 4) return false;
    if (/\d|@|\/|:|www|\.com/i.test(t)) return false;
    const capsOk = words.every(w => isTitleCaseWord(w) || /^[A-Z]+$/.test(w));
    if (!capsOk) return false;
    const letters = t.replace(/[^A-Za-z]/g, '');
    return letters.length >= 3 && letters.length <= 40;
  }

  function looksLikeTitle(text) {
    const t = text.toLowerCase().replace(/[^a-z\s&-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 70) return false;
    return TITLE_WORDS.some(word => {
      if (word.includes(' ')) return t.includes(word);
      return new RegExp('\\b' + word + '\\b').test(t);
    });
  }

  function looksLikeCompany(text) {
    if (COMPANY_STRONG.test(text)) return true;
    // Industry words ("Solutions", "Software"…) also appear in job titles —
    // only count them for lines that don't read as a title
    if (COMPANY_WEAK.test(text) && !looksLikeTitle(text)) return true;
    const t = text.trim();
    // ALL-CAPS display line, several letters, not an address/title
    if (/^[A-Z0-9&.,'’\- ]+$/.test(t) && (t.replace(/[^A-Z]/g, '').length >= 4) &&
        !ADDR_WORDS.test(t) && !looksLikeTitle(t)) return true;
    return false;
  }

  function looksLikeAddress(text) {
    if (RE_PIN_IN.test(text) || RE_ZIP_US.test(text)) {
      if (ADDR_WORDS.test(text) || COUNTRIES.test(text) || /,/.test(text)) return true;
      // a bare 6-digit number alone isn't an address
      return text.replace(/\d{5,6}(-\d{4})?/, '').replace(/[^A-Za-z]/g, '').length >= 3;
    }
    if (ADDR_WORDS.test(text)) {
      const commas = (text.match(/,/g) || []).length;
      const digitCount = digits(text).length;
      return commas >= 1 || digitCount >= 1 || /\b(near|opp|behind|beside)\b/i.test(text);
    }
    if (COUNTRIES.test(text) && /,/.test(text)) return true;
    return false;
  }

  /* ---------- main parse ---------- */

  /**
   * @param {{text:string, lines:Array<{text,confidence,height,bbox}>}} ocr
   * @returns {{fields:Array<{category,value,confidence,data?}>, unassigned:string[]}}
   */
  function parse(ocr) {
    const fields = [];
    const unassigned = [];
    const addrLines = [];

    // working set of lines with layout info
    let lines = (ocr.lines && ocr.lines.length)
      ? ocr.lines.map((l, i) => ({ ...l, idx: i }))
      : (ocr.text || '').split(/\n+/).map((t, i) => ({ text: t.trim(), confidence: 80, height: 1, bbox: { y0: i * 10 }, idx: i }));

    lines = lines
      .map(l => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
      .filter(l => l.text.length >= 2)
      .filter(l => l.text.replace(/[^A-Za-z0-9-￿]/g, '').length >= 2)
      .filter(l => l.confidence >= 25 || /@|\d{5,}/.test(l.text));

    const medianH = median(lines.map(l => l.height)) || 1;
    const seenEmails = new Set(), seenPhones = new Set(), seenUrls = new Set();

    const leftovers = [];

    for (const line of lines) {
      let rest = line.text;
      let consumed = false;

      // --- emails (tolerate OCR spaces around @ and commas for dots) ---
      const emailSource = rest.includes('@') ? rest.replace(/\s*@\s*/g, '@').replace(/\s+(?=[A-Za-z0-9._%+-]*@)/g, '') : rest;
      const emails = emailSource.match(RE_EMAIL) || [];
      for (let em of emails) {
        em = em.replace(/[.,;]+$/, '').toLowerCase();
        if (seenEmails.has(em)) continue;
        seenEmails.add(em);
        fields.push({ category: 'email', value: em, confidence: 'high' });
        consumed = true;
      }
      if (emails.length) rest = emailSource.replace(RE_EMAIL, ' ');

      // --- explicit URLs ---
      const urls = rest.match(RE_URL) || [];
      for (const u of urls) {
        const url = normUrl(u);
        const host = hostOf(url);
        if (!host || seenUrls.has(host + url)) continue;
        seenUrls.add(host + url);
        const social = SOCIAL_HOSTS[host] || Object.keys(SOCIAL_HOSTS).find(h => host.endsWith(h));
        if (social) {
          fields.push({ category: 'social', value: url, confidence: 'high', data: { network: SOCIAL_HOSTS[host] || SOCIAL_HOSTS[social] } });
        } else {
          fields.push({ category: 'website', value: url, confidence: 'high' });
        }
        consumed = true;
      }
      if (urls.length) rest = rest.replace(RE_URL, ' ');

      // --- bare domains (example.com, linkedin.com/in/…) ---
      let bare;
      RE_BARE_DOMAIN.lastIndex = 0;
      while ((bare = RE_BARE_DOMAIN.exec(rest)) !== null) {
        const dom = bare[2].toLowerCase();
        const path = bare[3] || '';
        if (seenUrls.has(dom + path) || (seenEmails.size && [...seenEmails].some(e => e.endsWith('@' + dom)))) continue;
        seenUrls.add(dom + path);
        const socialKey = SOCIAL_HOSTS[dom] ? dom : Object.keys(SOCIAL_HOSTS).find(h => dom.endsWith('.' + h) || dom === h);
        if (socialKey) {
          fields.push({ category: 'social', value: 'https://' + dom + path, confidence: 'high', data: { network: SOCIAL_HOSTS[socialKey] } });
        } else {
          fields.push({ category: 'website', value: 'https://' + dom + path, confidence: 'medium' });
        }
        consumed = true;
        rest = rest.replace(bare[0], ' ');
        RE_BARE_DOMAIN.lastIndex = 0;
      }

      // --- phones (with per-match label context: "Tel: … Fax: …" lines) ---
      let pmatch, phoneCount = 0;
      RE_PHONE.lastIndex = 0;
      while ((pmatch = RE_PHONE.exec(rest)) !== null) {
        const pm = pmatch[0];
        const d = digits(pm);
        if (d.length < 7 || d.length > 15) continue;
        if (seenPhones.has(d)) continue;
        seenPhones.add(d);
        const context = rest.slice(Math.max(0, pmatch.index - 16), pmatch.index);
        const cat = classifyPhone(context, line.text, pm);
        fields.push({ category: cat, value: cleanPhone(pm), confidence: 'high' });
        consumed = true;
        phoneCount++;
      }
      if (phoneCount) rest = rest.replace(RE_PHONE, ' ');

      // --- what remains of this line ---
      rest = rest.replace(LABEL_JUNK, ' ').replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
      if (rest.replace(/[^A-Za-z-￿]/g, '').length < 3) continue;
      if (consumed && rest.length < 6) continue;

      if (looksLikeAddress(rest)) { addrLines.push({ ...line, text: rest }); continue; }
      leftovers.push({ ...line, text: rest });
    }

    // --- address assembly: merge consecutive address lines ---
    if (addrLines.length) {
      addrLines.sort((a, b) => a.idx - b.idx);
      const joined = addrLines.map(l => l.text.replace(/[,;\s]+$/, '')).join(', ');
      fields.push({ category: 'address', value: joined, confidence: 'medium', data: structureAddress(joined) });
    }

    // --- classify leftovers: title / company / name ---
    let nameField = null, titleField = null, companyField = null;
    const scored = leftovers.map(l => ({
      ...l,
      relH: l.height / medianH,
      topness: 1 - Math.min(1, l.idx / Math.max(1, lines.length - 1))
    }));

    // title first (most distinctive) — a strong legal suffix (Ltd, Inc…) overrides
    for (const l of scored) {
      if (!titleField && looksLikeTitle(l.text) && !COMPANY_STRONG.test(l.text)) {
        titleField = { category: 'title', value: cleanupTitle(l.text), confidence: 'high', _line: l };
        continue;
      }
    }

    // company
    for (const l of scored) {
      if (titleField && l === titleField._line) continue;
      if (!companyField && looksLikeCompany(l.text)) {
        companyField = { category: 'company', value: l.text.trim(), confidence: COMPANY_STRONG.test(l.text) ? 'high' : 'medium', _line: l };
      }
    }

    // name: score candidates
    let best = null, bestScore = -1;
    for (const l of scored) {
      if (titleField && l === titleField._line) continue;
      if (companyField && l === companyField._line) continue;
      if (!looksLikeName(l.text)) continue;
      let score = 1;
      score += l.relH > 1.25 ? 2 : (l.relH > 1.05 ? 1 : 0);
      score += l.topness * 2;
      if (NAME_PREFIX.test(l.text)) score += 2;
      if (titleField && Math.abs(l.idx - titleField._line.idx) === 1) score += 1.5; // name usually sits next to the title
      if (/^[A-Z\s.]+$/.test(l.text) && companyField == null) score -= 0.5;        // all-caps might be the company
      if (score > bestScore) { bestScore = score; best = l; }
    }
    if (best) {
      nameField = { category: 'name', value: best.text.trim(), confidence: bestScore >= 3 ? 'high' : 'medium', _line: best };
    }

    // company fallback: biggest remaining line, or corporate email domain
    if (!companyField) {
      const remaining = scored.filter(l => l !== (best || {}) && l !== (titleField && titleField._line));
      const big = remaining.filter(l => l.relH > 1.3).sort((a, b) => b.relH - a.relH)[0];
      if (big && !looksLikeTitle(big.text)) {
        companyField = { category: 'company', value: big.text.trim(), confidence: 'medium', _line: big };
      }
    }
    if (!companyField) {
      const corp = [...seenEmails].find(e => !FREE_MAIL.test(e.split('@')[1] || ''));
      if (corp) {
        const dom = corp.split('@')[1];
        const nameGuess = dom.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        companyField = { category: 'company', value: nameGuess, confidence: 'low' };
      }
    }

    // website fallback from corporate email domain
    if (!fields.some(f => f.category === 'website')) {
      const corp = [...seenEmails].find(e => !FREE_MAIL.test(e.split('@')[1] || ''));
      if (corp) fields.push({ category: 'website', value: 'https://www.' + corp.split('@')[1], confidence: 'low' });
    }

    [nameField, titleField, companyField].forEach(f => {
      if (f) { delete f._line; fields.unshift(f); }
    });
    // keep display order: name, title, company first, then contact points
    fields.sort((a, b) => orderOf(a) - orderOf(b));

    // unassigned = leftovers that never became fields
    const used = new Set(fields.map(f => f.value));
    for (const l of leftovers) {
      if (![nameField, titleField, companyField].some(f => f && f.value === l.text.trim()) && !used.has(l.text.trim())) {
        unassigned.push(l.text.trim());
      }
    }

    return { fields, unassigned };
  }

  function orderOf(f) {
    const order = ['name', 'title', 'company', 'mobile', 'work-phone', 'fax', 'email', 'website', 'social', 'address', 'notes'];
    const i = order.indexOf(f.category);
    return i === -1 ? 99 : i;
  }

  function cleanupTitle(t) {
    return t.replace(/[|•·]+/g, ' ').replace(/\s+/g, ' ').replace(/^[,\-–\s]+|[,\-–\s]+$/g, '').trim();
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /* ---------- address structuring ---------- */

  function structureAddress(joined) {
    const out = { street: joined, city: '', state: '', zip: '', country: '' };
    let rest = joined;

    const pin = rest.match(RE_PIN_IN) || rest.match(RE_ZIP_US);
    if (pin) { out.zip = pin[0]; rest = rest.replace(pin[0], ''); }

    const country = rest.match(COUNTRIES);
    if (country) { out.country = titleCase(country[0]); rest = rest.replace(country[0], ''); }

    // last comma-separated chunk with letters only → probably the city
    const chunks = rest.split(',').map(s => s.replace(/[-–\s]+$/g, '').trim()).filter(Boolean);
    if (chunks.length >= 2) {
      const lastChunk = chunks[chunks.length - 1];
      if (/^[A-Za-z .]+$/.test(lastChunk) && lastChunk.split(/\s+/).length <= 3) {
        out.city = lastChunk;
        chunks.pop();
      }
    }
    out.street = chunks.join(', ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/[,\s]+$/, '').trim();
    return out;
  }

  function titleCase(s) { return s.replace(/\w\S*/g, t => t[0].toUpperCase() + t.slice(1).toLowerCase()); }

  /* ---------- fields → contact model ---------- */

  /**
   * Merge reviewed scan fields into a contact model.
   * @param {Array<{category,value,data}>} fields
   * @param {object} base  model to merge into (use FormUI.emptyModel() for a fresh one)
   */
  function fieldsToModel(fields, base) {
    const m = base || FormUI.emptyModel();
    const notes = [];

    for (const f of fields) {
      const v = (f.value || '').trim();
      if (!v || f.category === 'ignore') continue;
      switch (f.category) {
        case 'name': {
          if (m.name.first || m.name.last) break;
          let t = v.replace(/\s+/g, ' ').trim();
          const pm = t.match(NAME_PREFIX);
          if (pm) { m.name.prefix = pm[0].trim().replace(/\.?$/, '.'); t = t.replace(NAME_PREFIX, ''); }
          const parts = t.split(' ');
          if (parts.length === 1) m.name.first = parts[0];
          else { m.name.first = parts[0]; m.name.last = parts[parts.length - 1]; m.name.middle = parts.slice(1, -1).join(' '); }
          break;
        }
        case 'title': if (!m.work.title) m.work.title = v; else notes.push(v); break;
        case 'company': if (!m.work.company) m.work.company = v; else notes.push('Company: ' + v); break;
        case 'mobile': pushPhone(m, 'mobile', v); break;
        case 'work-phone': pushPhone(m, 'work', v); break;
        case 'fax': pushPhone(m, 'work fax', v); break;
        case 'email': {
          if (!m.emails.some(e => e.address.toLowerCase() === v.toLowerCase())) {
            m.emails.push({ type: m.emails.length ? 'other' : 'work', address: v });
          }
          break;
        }
        case 'website': {
          const u = normUrl(v);
          if (!m.work.websites.includes(u)) m.work.websites.push(u);
          break;
        }
        case 'social': {
          const net = (f.data && f.data.network) || SOCIAL_HOSTS[hostOf(v)] || 'custom';
          if (!m.social.some(s => s.url === normUrl(v))) m.social.push({ network: net, url: normUrl(v) });
          break;
        }
        case 'address': {
          const a = f.data && f.data.street !== undefined ? f.data : structureAddress(v);
          m.addresses.push({ type: 'work', po: '', ext: '', street: a.street || v, city: a.city || '', state: a.state || '', zip: a.zip || '', country: a.country || '' });
          break;
        }
        case 'notes': notes.push(v); break;
      }
    }
    if (notes.length) m.other.notes = (m.other.notes ? m.other.notes + '\n' : '') + notes.join('\n');
    return m;
  }

  function pushPhone(m, type, value) {
    const d = value.replace(/\D/g, '');
    if (m.phones.some(p => p.number.replace(/\D/g, '') === d)) return;
    m.phones.push({ type, cc: '', number: value });
  }

  window.CardParser = { parse, fieldsToModel, CATEGORIES, structureAddress };
})();
