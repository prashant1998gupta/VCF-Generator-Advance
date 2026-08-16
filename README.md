# VCF Generator Advance

The most advanced free vCard (.vcf) generator — with high-accuracy business card scanning, QR contact codes and bulk CSV tools. **100% in your browser: nothing is ever uploaded.**

## Features

- **Full vCard support** — every useful field (names, work, unlimited phones/emails, home & work addresses, photo & logo, 11 social networks, birthday, notes, categories, geo, custom X- fields) in **vCard 2.1 / 3.0 / 4.0** with spec-correct escaping and line folding.
- **Visiting-card scanner** — upload, drag-drop, paste or camera-capture a card photo. Crop, rotate, enhance and binarize, then run **local OCR in 26 languages** (Tesseract.js). A smart parser turns the text into name / title / company / phones / emails / website / address using layout and linguistic heuristics.
- **AI mode (optional)** — paste your own Anthropic API key in Settings for near-perfect reading of stylized cards via Claude vision. The image is sent directly from your browser to Anthropic and nowhere else.
- **QR contact codes** — size, colour and error-correction options; PNG + SVG download.
- **Contact list & bulk tools** — save contacts in-browser, import CSV with automatic column mapping, import multi-card .vcf, export as one combined .vcf, a ZIP of individual files, or CSV.
- **Live preview**, draft autosave, light/dark theme, fully responsive, installable PWA with offline support.

## Run

It is a static site — no build step.

```bash
python3 -m http.server 8720
```

then open http://localhost:8720. Or double-click `index.html` (camera and offline mode need http/https). Deploy the folder as-is to GitHub Pages, Netlify or any static host.

## Stack

Plain HTML/CSS/JS. Libraries via CDN: [tesseract.js](https://github.com/naptha/tesseract.js) (OCR), [node-qrcode](https://github.com/soldair/node-qrcode) (QR), [JSZip](https://stuk.github.io/jszip/), [PapaParse](https://www.papaparse.com/).

## Privacy

Contacts, drafts, photos and scans stay in your browser's localStorage. The only network calls are to CDNs for libraries/fonts/OCR language data, and — only if you enable AI mode — to `api.anthropic.com` with your own key.
