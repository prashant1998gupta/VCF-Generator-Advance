# VCF Generator Advance

The most advanced free vCard (.vcf) generator — with high-accuracy business card scanning, QR contact codes and bulk CSV tools. **100% in your browser: nothing is ever uploaded.**

## Features

- **Full vCard support** — every useful field (names, work, unlimited phones/emails, home & work addresses, photo & logo, 11 social networks, birthday, notes, categories, geo, custom X- fields) in **vCard 2.1 / 3.0 / 4.0** with spec-correct escaping and line folding.
- **Visiting-card scanner** — upload, drag-drop, paste or camera-capture card photos; **multiple images per scan**: front + back, all panels of a folded card, or a whole **batch of different cards** (each becomes its own contact). Split one photo of two cards / an open folded card into halves. Auto-straighten, crop, rotate, enhance and binarize, then run **local dual-pass OCR in 26 languages** (Tesseract.js).
- **Smart parser** — layout- and dictionary-driven extraction of name (with honorifics & degrees split out), designation, department, company, mobile / work / home / fax numbers (label-aware, Indian & international formats, extensions), emails, websites, social links, structured addresses (PIN/ZIP, city, state, country — Indian, US and European formats), GSTIN / PAN / CIN / registration numbers as custom fields, taglines and qualifications as notes; repairs common OCR mistakes (`©`→`@`, `.corn`→`.com`, `98l10`→`98110`, `lyer`→`Iyer`, split words). Verified on a 28-card noisy-OCR test bench.
- **AI mode (optional)** — paste your own Anthropic API key in Settings for near-perfect reading of stylized cards via Claude vision (front and back sent together). Images go directly from your browser to Anthropic and nowhere else.
- **QR contact codes** — size, colour and error-correction options; PNG + SVG download.
- **Contact list & bulk tools** — save contacts in-browser, import CSV with automatic column mapping, import multi-card .vcf, export as one combined .vcf, a ZIP of individual files, or CSV.
- **Live preview**, draft autosave, light/dark theme, fully responsive, installable PWA with offline support.

## Run

It is a static site — no build step.

```bash
python3 -m http.server 8720
```

then open http://localhost:8720. Or double-click `index.html` (camera and offline mode need http/https). Deploy the folder as-is to GitHub Pages, Netlify or any static host.

## Tests

No dependencies — plain Node:

```bash
node tests/run_fixtures.js      # card-parser accuracy bench (28 noisy-OCR cards)
node tests/test_parser.js       # parser unit tests
node tests/test_vcard.js        # vCard generate/parse round-trip tests
```

Add a fixture by dropping a JSON file into `tests/fixtures/` (format documented at the top of `run_fixtures.js`).

## Stack

Plain HTML/CSS/JS. Libraries via CDN: [tesseract.js](https://github.com/naptha/tesseract.js) (OCR), [node-qrcode](https://github.com/soldair/node-qrcode) (QR), [JSZip](https://stuk.github.io/jszip/), [PapaParse](https://www.papaparse.com/).

## Privacy

Contacts, drafts, photos and scans stay in your browser's localStorage. The only network calls are to CDNs for libraries/fonts/OCR language data, and — only if you enable AI mode — to `api.anthropic.com` with your own key.
