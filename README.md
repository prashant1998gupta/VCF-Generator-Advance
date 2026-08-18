# VCF Generator Advance

The most advanced free vCard (.vcf) generator — with high-accuracy business card scanning, QR contact codes and bulk CSV tools. **100% in your browser: nothing is ever uploaded.**

## Features

- **Full vCard support** — every useful field (names, work, unlimited phones/emails, home & work addresses, photo & logo, 11 social networks, birthday, notes, categories, geo, custom X- fields) in **vCard 2.1 / 3.0 / 4.0** with spec-correct escaping and line folding.
- **Visiting-card scanner** — upload, drag-drop, paste or camera-capture card photos; **multiple images per scan**: front + back, all panels of a folded card, or a whole **batch of different cards** (each becomes its own contact). Split one photo of two cards / an open folded card into halves. Auto-straighten, crop, rotate, enhance and binarize, then run **local dual-pass OCR in 26 languages** (Tesseract.js).
- **Smart parser** — layout- and dictionary-driven extraction of name (with honorifics & degrees split out), designation, department, company, mobile / work / home / fax numbers (label-aware, Indian & international formats, extensions), emails, websites, social links, structured addresses (PIN/ZIP, city, state, country — Indian, US and European formats), GSTIN / PAN / CIN / registration numbers as custom fields, taglines and qualifications as notes; repairs common OCR mistakes (`©`→`@`, `.corn`→`.com`, `98l10`→`98110`, `lyer`→`Iyer`, split words). Verified on a 28-card noisy-OCR test bench.
- **AI Vision mode** — reads the card image directly (no OCR guessing) for near-perfect results on stylized, low-contrast or handwritten cards, in any language. Keys live **on the server**, so visitors never have to get one; four providers (Groq, Gemini, OpenAI, Anthropic) with automatic fallback. See [AI scanning setup](#ai-scanning-setup). Without a backend the app still runs everywhere — local OCR handles every card, and users can supply their own key.
- **QR contact codes** — size, colour and error-correction options; PNG + SVG download.
- **Contact list & bulk tools** — save contacts in-browser, import CSV with automatic column mapping, import multi-card .vcf, export as one combined .vcf, a ZIP of individual files, or CSV.
- **Live preview**, draft autosave, light/dark theme, fully responsive, installable PWA with offline support.

## Run

It is a static site — no build step.

```bash
python3 -m http.server 8720
```

then open http://localhost:8720. Or double-click `index.html` (camera and offline mode need http/https). Deploy the folder as-is to GitHub Pages, Netlify or any static host.

To also run the AI backend locally, use the bundled dev server instead (it serves the site *and* `api/`):

```bash
node dev-server.js
```

It reads a local `.env` (see `.env.example`). `MOCK_AI=1` stubs the provider calls so you can
exercise the whole AI path without a key and without spending quota.

## AI scanning setup

Local OCR needs nothing. AI Vision mode needs one or more provider keys, held **server-side** —
the browser never sees a key, and your users never have to create one.

**Deploy to Vercel** (free tier, works with the existing GitHub repo):

1. Import the repo at [vercel.com/new](https://vercel.com/new). No build settings needed — `vercel.json` is included.
2. **Settings → Environment Variables**, add at least one:

   | Variable | Where to get it | Notes |
   |---|---|---|
   | `GROQ_API_KEY` | console.groq.com | fastest, generous free tier |
   | `GEMINI_API_KEY` | aistudio.google.com | strong vision, free tier |
   | `OPENAI_API_KEY` | platform.openai.com | |
   | `ANTHROPIC_API_KEY` | console.anthropic.com | best on messy/stylized cards |

3. Redeploy. The Scan tab's **✦ AI Vision** button now shows **Ready** — nothing for visitors to configure.

Providers are tried in order and the first that answers wins, so a second key is free insurance
against one vendor being down or rate-limiting you. Optional tuning:

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER_ORDER` | `groq,gemini,openai,anthropic` | try providers in your own order |
| `RATE_LIMIT_PER_HOUR` | `20` | scans allowed per IP per hour (`0` = unlimited) |
| `GROQ_VISION_MODEL` etc. | see `.env.example` | pin a different model per provider |

Netlify, Cloudflare Pages or a small Node host work too — `api/extract-card.js` is a standard
`(req, res)` handler; `dev-server.js` shows how little wiring it needs.

### How the endpoint is protected

Putting a key behind an endpoint is only safe if the endpoint is not an open proxy. `api/extract-card.js`:

- **Requires a same-origin `Origin`/`Referer`.** A request with *no* origin header is rejected, not waved through — that inversion is the usual way these proxies get drained by `curl`.
- **Rate-limits per IP** (sliding window). Best-effort per warm instance, so also set a spend cap in your provider's console — that is the real backstop.
- **Verifies image bytes**, not the declared type: magic-byte sniffing, size caps (5 MB/image, 4 images), and header-only dimension checks.
- **Never echoes upstream errors.** Provider failures are logged server-side and returned as a generic code, because an error body can quote the request — and a quoted request can contain the credential.
- **No key ever reaches the browser.** `GET /api/extract-card` reports only *which* providers are configured, so the UI can show the right state without leaking anything.

Run `node tests/test_api_extract.js` to exercise all of the above against a stubbed provider.

## Tests

No dependencies — plain Node:

```bash
node tests/run_fixtures.js      # card-parser accuracy bench (28 noisy-OCR cards, 561 checks)
node tests/test_parser.js       # parser unit tests
node tests/test_vcard.js        # vCard generate/parse round-trip tests
node tests/test_ocr_merge.js    # dual-pass OCR line-merge tests
node tests/test_ocr_lines.js    # OCR line extraction / two-column gap detection
node tests/test_card_detect.js  # card-edge geometry / perspective rectification
node tests/test_api_extract.js  # AI endpoint: security gates, fallback, rate limit (no network)
```

`run_fixtures.js` feeds its fixture text through the real `OCR.extractLines()` rather than
straight into the parser, so the bench exercises the same line extraction the browser does.

Add a fixture by dropping a JSON file into `tests/fixtures/` (format documented at the top of `run_fixtures.js`).

## Stack

Plain HTML/CSS/JS. Libraries via CDN: [tesseract.js](https://github.com/naptha/tesseract.js) (OCR), [node-qrcode](https://github.com/soldair/node-qrcode) (QR), [JSZip](https://stuk.github.io/jszip/), [PapaParse](https://www.papaparse.com/).

## Privacy

Contacts, drafts, photos and scans stay in your browser's localStorage, and local OCR runs entirely
on-device. The only routine network calls are to CDNs for libraries/fonts/OCR language data.

**AI Vision mode is the one exception, and only when you choose it:** the card image is sent to this
site's backend, forwarded to one AI provider for that single request, and never stored. If the
deployment has no backend, the image goes from your browser straight to Anthropic using the key you
supplied — and nowhere else.
