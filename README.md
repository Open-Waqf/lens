# Sahifah Lens (العدسة)

> Scan a paper, read its text, keep it on your phone, share it. Nothing is uploaded.

<div align="center">
<a href="https://lens.open-waqf.org">
<img src="public/icons/icon-512.png" alt="Sahifah Lens Logo" width="100" height="100" style="border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
</a>
</div>

Sahifah Lens is a document scanner for Android and the web. It scans paper with the phone's
scanner, reads the text on the device (OCR), keeps the pages in the app's private storage,
and shares them as a PDF or as images. No account, no ads, no cloud. It is built on the
principle of **Amanah** (trust): your documents never leave your hands. Read the
[privacy policy](PRIVACY_POLICY.md).

---

## What it does

### Scan

* **Quick Scan (Android):** "+" opens Google's document scanner (ML Kit, part of Google Play
  services). It finds the page edges and straightens the page. Lens saves the pages exactly as
  the scanner made them, with no extra processing, and shows them with one button: Share as
  PDF. Scan another page, or Done. On a phone without Google Play services, "+" opens the
  phone's camera app instead and the photo goes to the editor.
* **Import:** photos and PDFs from the phone or the computer. The editor finds the page edges;
  you can move the corners with a finger, rotate, and choose Original, Clean or Black & white.
* **Camera (web):** in the browser, a live camera view with edge detection.

### Read

* **OCR on the device:** Tesseract reads English and Arabic (both packs ship with the app).
  The text keeps its lines, and Arabic lines with numbers stay right to left.
* **Names from the text:** a new document is named after the first words on its first page.
  Rename it any time; a name you typed is never replaced.
* **Search** finds words inside the pages. **Copy text** with one tap.

### Keep

* **Folders**, and delete with **Undo** (five seconds).
* **Encrypted backup (`.slbk`):** one file, encrypted with your password (PBKDF2-SHA-256,
  600,000 rounds, then AES-256-GCM). It is written and restored as a stream, so a large
  library restores on an old phone. Restore can merge into or replace the library.
* **App Lock (Android):** fingerprint or face through Android's own prompt. With App Lock on,
  the app is hidden in Recents and screenshots are blocked.
* **No copies you did not make:** Android cloud backup and phone-to-phone transfer are off.
* **Erase everything** from Settings, in two taps.

### Share

* **Share as PDF** (normal or a smaller file), **share images**, and on Android **Sign with
  Signer** when Open Waqf Signer is installed.

### Private by design

* Documents stay in the app's private storage on Android, or in the browser's private
  storage (OPFS and IndexedDB) on the web.
* Nothing is uploaded. Every browser test and every phone test fails if the app reaches the
  network. No analytics, no crash reporting, no accounts.

---

## How it is built

* **UI:** TypeScript, Lit (Web Components), Tailwind CSS.
* **Storage:** Dexie.js (IndexedDB) for the list of documents; page images in the app's
  private files on Android, OPFS on the web.
* **OCR:** tesseract.js in a worker, language packs bundled (`public/tesseract/`).
* **PDF:** pdf-lib with an invisible text layer; the bundled Arabic font makes Arabic text
  searchable.
* **Backup:** Web Crypto, streamed with fflate. Format: [VAULT_SPEC.md](VAULT_SPEC.md).
  `node scripts/slbk-verify.mjs <file.slbk>` inspects a backup without decrypting it.
* **Native (Capacitor 8, Android):** ML Kit document scanner, biometric prompt, files, the
  system share sheet, a privacy-screen plugin and a Signer handoff plugin.
* **Languages:** English and Arabic (right to left), all in `src/lib/i18n.ts`. The check
  fails on a missing translation: [docs/TRANSLATIONS.md](docs/TRANSLATIONS.md).

---

## Platforms

* **Android:** Android 11 (API 30) or newer. Tested on a moto g75 5G (Android 16). Quick Scan
  needs Google Play services. Without it, "+" opens the phone's own camera app instead, one
  photo at a time, and the editor finds the edges. The Android app has no camera of its own
  and needs no camera permission.
* **Web/PWA:** current Chrome, Firefox and Safari (OPFS required).
* **iOS:** not built.

---

## Developer setup

Node 22 or newer (`.nvmrc`), JDK 21 and the Android SDK for the phone build.

```bash
npm ci
npm run dev            # http://localhost:5173
npm run check          # before every commit: typecheck, translations, unit and browser tests
```

| Command | What it does |
|---|---|
| `npm run check -- --desktop --build` | the full check GitHub runs: all screens, against the production build |
| `npm run android:run` | build and install the **Lens Dev** test app on your USB phone (own id, next to the Play Store app) |
| `npm run android:live` | Lens Dev loads from this computer and reloads on every save |
| `npm run test:android` | phone tests on the USB phone (see [docs/TESTING.md](docs/TESTING.md)) |
| `npm run release -- --dry-run` | show what a release would do; without `--dry-run` it releases (website + Android bundle) |
| `npm run android:release` | only the signed Android bundle for Play Console (unlock the key vault first) |

How the tests work: [docs/TESTING.md](docs/TESTING.md). Upgrading packages:
[docs/DEPENDENCIES.md](docs/DEPENDENCIES.md). Timing gates: [docs/perf.md](docs/perf.md).

GitHub runs the checks on every push and pull request into `develop`, and deploys
lens.open-waqf.org only from a version tag (made by `npm run release`).

---

## Good to know

* **Web storage is the browser's.** It can clear the site's storage when space is low. Export
  a backup. The Android app keeps its files in private app storage.
* **Your password is yours.** There is no "forgot password": there is no server.
* **App Lock is a gate, not encryption.** Pages are stored unencrypted in the app's private
  storage, which other apps cannot read. The backup file is the encrypted form.

<div align="center">
<p><em>Built with ❤️ for the Ummah and Humanity.</em></p>
<p><small>Released under <a href="https://www.elastic.co/licensing/elastic-license">Elastic License 2.0 (ELv2)</a>: free for personal, professional, and institutional use. Hosting as a competing managed service is not permitted.</small></p>
</div>
