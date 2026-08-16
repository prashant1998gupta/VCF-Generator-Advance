// Unit test for js/vcard.js — generation correctness + parse round-trip
global.window = {};
global.crypto = require('crypto');
require(require('path').join(__dirname, '..', 'js', 'vcard.js'));
const VCard = global.window.VCard;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}

const model = {
  name: { prefix: 'Dr.', first: 'Sanjeev', middle: 'K', last: 'Gupta', suffix: 'PhD', nickname: 'Sanju', fnOverride: '' },
  work: { company: 'Acme; Traders, Pvt. Ltd.', department: 'R&D', title: 'Managing Director', role: 'Management',
          websites: ['https://acme.example.com'], calendar: 'https://cal.example.com/s' },
  phones: [{ type: 'mobile', cc: '+91', number: '98765 43210' }, { type: 'work fax', cc: '', number: '011-23456789' },
           { type: 'Assistant', cc: '', number: '+91 11111 22222' }],
  emails: [{ type: 'work', address: 'sanjeev@acme.com' }, { type: 'Billing', address: 'billing@acme.com' }],
  addresses: [{ type: 'work', po: '', ext: 'Floor 3', street: '12, MG Road', city: 'New Delhi', state: 'Delhi', zip: '110001', country: 'India' }],
  photo: null, logo: null,
  social: [{ network: 'linkedin', url: 'https://linkedin.com/in/sanjeev' }],
  personal: { birthday: '1980-06-15', anniversary: '2005-02-20', gender: 'M' },
  other: { notes: 'Line one\nLine two, with comma; and semicolon', categories: 'Client, VIP', timezone: '+05:30', geoLat: '28.6139', geoLon: '77.2090' },
  custom: [{ key: 'GSTIN', value: '07AAACA1234A1Z5' }],
  uid: 'test-uid-123'
};

console.log('--- v3.0 generation ---');
const v3 = VCard.generate(model, '3.0');
check('BEGIN/END present', v3.startsWith('BEGIN:VCARD\r\n') && v3.includes('\r\nEND:VCARD'));
check('VERSION:3.0', v3.includes('VERSION:3.0'));
check('N structured', v3.includes('N:Gupta;Sanjeev;K;Dr.;PhD'));
check('FN composed', v3.includes('FN:Dr. Sanjeev K Gupta PhD'));
check('ORG escaped', v3.includes('ORG:Acme\\; Traders\\, Pvt. Ltd.;R&D'));
check('TEL cell', v3.includes('TEL;TYPE=CELL,VOICE:+91 98765 43210'));
check('TEL fax', v3.includes('TEL;TYPE=WORK,FAX:011-23456789'));
check('custom phone label item', /item\d+\.TEL:\+91 11111 22222/.test(v3) && /item\d+\.X-ABLabel:Assistant/.test(v3));
check('EMAIL work', v3.includes('EMAIL;TYPE=INTERNET,WORK:sanjeev@acme.com'));
check('ADR', v3.includes('ADR;TYPE=WORK:;Floor 3;12\\, MG Road;New Delhi;Delhi;110001;India'));
check('NOTE escaped newline+comma', v3.includes('NOTE:Line one\\nLine two\\, with comma\\; and semicolon'));
check('BDAY', v3.includes('BDAY:1980-06-15'));
check('X-ANNIVERSARY (not v4)', v3.includes('X-ANNIVERSARY:2005-02-20'));
check('GEO v3 semicolon', v3.includes('GEO:28.6139;77.209'));
check('CATEGORIES', v3.includes('CATEGORIES:Client,VIP'));
check('X-SOCIALPROFILE', v3.includes('X-SOCIALPROFILE;TYPE=linkedin:https://linkedin.com/in/sanjeev'));
check('X custom', v3.includes('X-GSTIN:07AAACA1234A1Z5'));
check('UID kept', v3.includes('UID:test-uid-123'));
check('CRLF line endings only', !/[^\r]\n/.test(v3.slice(1)));

// folding: every physical line ≤ 75 octets
const enc = new TextEncoder();
const tooLong = v3.split('\r\n').filter(l => enc.encode(l).length > 75);
check('all lines ≤75 octets', tooLong.length === 0, tooLong[0]);

console.log('--- v4.0 generation ---');
const v4 = VCard.generate(model, '4.0');
check('VERSION:4.0', v4.includes('VERSION:4.0'));
check('KIND individual', v4.includes('KIND:individual'));
check('TEL v4 lowercase quoted', v4.includes('TEL;TYPE="cell,voice":+91 98765 43210'));
check('BDAY basic format', v4.includes('BDAY:19800615'));
check('ANNIVERSARY v4', v4.includes('ANNIVERSARY:20050220'));
check('GENDER v4', v4.includes('GENDER:M'));
check('GEO v4 uri', v4.includes('GEO:geo:28.6139,77.209'));

console.log('--- v2.1 generation ---');
const v21 = VCard.generate(model, '2.1');
check('VERSION:2.1', v21.includes('VERSION:2.1'));
check('TEL v2.1 bare types', v21.includes('TEL;CELL;VOICE:+91 98765 43210'));
check('no NICKNAME in 2.1', !v21.includes('NICKNAME'));

console.log('--- photo embedding ---');
const withPhoto = { ...model, photo: { dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(300) } };
const v3p = VCard.generate(withPhoto, '3.0');
check('PHOTO v3 b encoding', v3p.includes('PHOTO;ENCODING=b;TYPE=JPEG:'));
const v4p = VCard.generate(withPhoto, '4.0');
check('PHOTO v4 data uri', v4p.includes('PHOTO:data:image/jpeg;base64,'));

console.log('--- parse round-trip (3.0) ---');
const parsed = VCard.parse(v3);
check('one card parsed', parsed.length === 1);
const p = parsed[0] || {};
check('name round-trip', p.name && p.name.first === 'Sanjeev' && p.name.last === 'Gupta' && p.name.prefix === 'Dr.');
check('company round-trip', p.work && p.work.company === 'Acme; Traders, Pvt. Ltd.');
check('title round-trip', p.work && p.work.title === 'Managing Director');
check('phones round-trip', p.phones && p.phones.length === 3 &&
  p.phones[0].type === 'mobile' && p.phones[0].number === '+91 98765 43210' &&
  p.phones[1].type === 'work fax' &&
  p.phones[2].type === 'Assistant', JSON.stringify(p.phones));
check('emails round-trip', p.emails && p.emails.length === 2 && p.emails[0].type === 'work' &&
  p.emails[1].type === 'Billing', JSON.stringify(p.emails));
check('address round-trip', p.addresses && p.addresses[0].street === '12, MG Road' && p.addresses[0].zip === '110001');
check('notes round-trip', p.other && p.other.notes === 'Line one\nLine two, with comma; and semicolon');
check('bday round-trip', p.personal && p.personal.birthday === '1980-06-15');
check('anniversary round-trip', p.personal && p.personal.anniversary === '2005-02-20');
check('social round-trip', p.social && p.social[0].network === 'linkedin');
check('categories round-trip', p.other && p.other.categories === 'Client, VIP');
check('custom round-trip', p.custom && p.custom.some(c => c.key === 'GSTIN' && c.value === '07AAACA1234A1Z5'), JSON.stringify(p.custom));
check('uid round-trip', p.uid === 'test-uid-123');

console.log('--- parse round-trip (4.0) ---');
const p4 = VCard.parse(v4)[0] || {};
check('v4 name', p4.name && p4.name.first === 'Sanjeev');
check('v4 bday normalized', p4.personal && p4.personal.birthday === '1980-06-15');
check('v4 phones', p4.phones && p4.phones[0].type === 'mobile');

console.log('--- parse photo round-trip ---');
const pp = VCard.parse(v3p)[0] || {};
check('photo parsed back', pp.photo && pp.photo.dataUrl.startsWith('data:image/jpeg;base64,AAAA'));

console.log('--- multi-card + folding parse ---');
const multi = v3 + v4;
check('two cards parsed', VCard.parse(multi).length === 2);

console.log('--- external vcf (Google-style export) ---');
const google = 'BEGIN:VCARD\nVERSION:3.0\nN:Doe;John;;;\nFN:John Doe\nEMAIL;TYPE=INTERNET:john@gmail.com\nTEL;TYPE=CELL:+1 555 0100\nORG:Example Inc.\nEND:VCARD\n';
const g = VCard.parse(google)[0] || {};
check('LF-only input parses', g.name && g.name.first === 'John');
check('bare INTERNET email', g.emails && g.emails[0].address === 'john@gmail.com');

console.log('--- v2.1 quoted-printable parse ---');
const qp = 'BEGIN:VCARD\r\nVERSION:2.1\r\nN:=E0=A4=97=E0=A4=AA=\r\n=E0=A5=8D=E0=A4=A4=E0=A4=BE;;;;\r\nNOTE;ENCODING=QUOTED-PRINTABLE:Caf=C3=A9 meeting\r\nEND:VCARD\r\n';
const q = VCard.parse(qp)[0] || {};
check('QP note decoded', q.other && q.other.notes === 'Café meeting', q.other && q.other.notes);

console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED ✅' : failures + ' FAILURES ❌'));
process.exit(failures ? 1 : 0);
