// Test card-parser.js field extraction against simulated OCR results
global.window = {};
require(require('path').join(__dirname, '..', 'js', 'vcard.js'));
global.FormUI = { emptyModel: () => ({
  name: { prefix: '', first: '', middle: '', last: '', suffix: '', nickname: '', fnOverride: '' },
  work: { company: '', department: '', title: '', role: '', websites: [], calendar: '' },
  phones: [], emails: [], addresses: [], photo: null, logo: null, social: [],
  personal: { birthday: '', anniversary: '', gender: '' },
  other: { notes: '', categories: '', timezone: '', geoLat: '', geoLon: '' },
  custom: [], uid: ''
})};
require(require('path').join(__dirname, '..', 'js', 'card-parser.js'));
const CardParser = global.window.CardParser;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
}
const mkLines = (specs) => specs.map(([text, h], i) => ({
  text, confidence: 90, height: h || 20, bbox: { x0: 0, y0: i * 30, x1: 500, y1: i * 30 + (h || 20) }
}));
const get = (r, cat) => r.fields.filter(f => f.category === cat).map(f => f.value);

// ---- Card 1: typical Indian business card ----
console.log('--- Card 1: Indian business card ---');
const card1 = CardParser.parse({
  text: '',
  lines: mkLines([
    ['ACME TRADERS PVT. LTD.', 34],
    ['Rajesh Kumar Sharma', 28],
    ['Managing Director', 18],
    ['M: +91 98765 43210', 18],
    ['Tel: 011-2345 6789  Fax: 011-2345 6780', 18],
    ['E-mail: rajesh@acmetraders.com', 18],
    ['www.acmetraders.com', 18],
    ['12, MG Road, Connaught Place,', 16],
    ['New Delhi - 110001, India', 16]
  ])
});
check('name', get(card1, 'name')[0] === 'Rajesh Kumar Sharma', card1.fields);
check('title', get(card1, 'title')[0] === 'Managing Director');
check('company', get(card1, 'company')[0] === 'ACME TRADERS PVT. LTD.');
check('mobile', get(card1, 'mobile')[0] === '+91 98765 43210', get(card1, 'mobile'));
check('work phone', get(card1, 'work-phone').some(v => v.includes('2345 6789')), card1.fields.filter(f=>f.category.includes('phone')));
check('fax', get(card1, 'fax').some(v => v.includes('6780')), get(card1, 'fax'));
check('email', get(card1, 'email')[0] === 'rajesh@acmetraders.com');
check('website', get(card1, 'website').some(v => v.includes('acmetraders.com')));
const addr1 = card1.fields.find(f => f.category === 'address');
check('address found', !!addr1, card1.fields);
check('address has PIN', addr1 && addr1.data && addr1.data.zip === '110001', addr1 && addr1.data);

// ---- Card 2: US-style card with social ----
console.log('--- Card 2: US card with social ---');
const card2 = CardParser.parse({
  text: '',
  lines: mkLines([
    ['Jane Elizabeth Doe', 30],
    ['Senior Software Engineer', 18],
    ['TechNova Inc.', 24],
    ['jane.doe@technova.io', 16],
    ['(415) 555-0123', 16],
    ['linkedin.com/in/janedoe', 16],
    ['500 Market Street, Suite 400', 14],
    ['San Francisco, CA 94105', 14]
  ])
});
check('name', get(card2, 'name')[0] === 'Jane Elizabeth Doe', get(card2, 'name'));
check('title', get(card2, 'title')[0] === 'Senior Software Engineer');
check('company', get(card2, 'company')[0] === 'TechNova Inc.', get(card2, 'company'));
check('email', get(card2, 'email')[0] === 'jane.doe@technova.io');
check('phone found', card2.fields.some(f => /phone|mobile/.test(f.category) && f.value.includes('555-0123')), card2.fields);
check('linkedin as social', card2.fields.some(f => f.category === 'social' && f.data && f.data.network === 'linkedin'), card2.fields.filter(f=>f.category==='social'||f.category==='website'));

// ---- Card 3: sparse card, company from email domain ----
console.log('--- Card 3: sparse card ---');
const card3 = CardParser.parse({
  text: '',
  lines: mkLines([
    ['Dr. Amit Verma', 26],
    ['amit@brightsolar.in', 16],
    ['+91 90000 11111', 16]
  ])
});
check('name with prefix', get(card3, 'name')[0] === 'Dr. Amit Verma', get(card3, 'name'));
check('company guessed from domain', get(card3, 'company')[0] === 'Brightsolar', get(card3, 'company'));
check('website fallback', get(card3, 'website')[0] === 'https://www.brightsolar.in');

// ---- fieldsToModel ----
console.log('--- fieldsToModel ---');
const model = CardParser.fieldsToModel(card1.fields, global.FormUI.emptyModel());
check('first/last split', model.name.first === 'Rajesh' && model.name.last === 'Sharma' && model.name.middle === 'Kumar', model.name);
check('title applied', model.work.title === 'Managing Director');
check('company applied', model.work.company === 'ACME TRADERS PVT. LTD.');
check('phones applied', model.phones.length === 3, model.phones);
check('fax type', model.phones.some(p => p.type === 'work fax'));
check('email applied', model.emails[0].address === 'rajesh@acmetraders.com');
check('address structured', model.addresses.length === 1 && model.addresses[0].zip === '110001', model.addresses);

// prefix handling in fieldsToModel
const m3 = CardParser.fieldsToModel(card3.fields, global.FormUI.emptyModel());
check('prefix extracted', m3.name.prefix === 'Dr.' && m3.name.first === 'Amit' && m3.name.last === 'Verma', m3.name);

// merge (no duplicate phones)
const merged = CardParser.fieldsToModel(card1.fields, model);
check('merge dedupes phones', merged.phones.length === 3, merged.phones.length);

console.log('\n' + (failures === 0 ? 'ALL PARSER TESTS PASSED ✅' : failures + ' FAILURES ❌'));
process.exit(failures ? 1 : 0);
