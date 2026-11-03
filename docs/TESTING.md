# Testing Lens

One rule: run `npm run check` before every commit. It takes about 15 seconds.

## The layers

| Layer | Command | Where it runs | What it proves |
|---|---|---|---|
| Typecheck | part of `npm run check` | computer | TypeScript compiles, every text key exists |
| Translations | `npm run check-i18n` | computer | every language has every text, every text is used (ratchet below) |
| Copied files | part of `npm run check` | computer | the OCR worker in `public/tesseract/` matches the tesseract.js package |
| Unit tests | `npm run test:unit` | computer (Vitest, jsdom) | crypto, backup format, OCR parsing, storage, settings |
| Browser tests | `npm test` | computer (Playwright) | the app on a phone screen, in Arabic, and on desktop |
| Android logic | part of the browser tests | computer (fake Android bridge) | Quick Scan, sharing, backup files, app lock, Back button |
| Phone tests | `npm run test:android` | your USB phone | the real WebView, Google scanner, share sheet, OCR speed and memory |

## Browser tests (Playwright)

- Three projects: `phone` (Pixel 5, every test), `phone-ar` (Arabic, right-to-left, tests
  tagged `@rtl` or `@rtl-only`), `desktop` (every test, plus the timing gates tagged `@perf`).
  `npm run check` runs phone and phone-ar. `npm run check -- --desktop` adds desktop.
  GitHub runs all three against the production build (`npm run test:build`).
- Tests start their own fresh server on port 5175, never one already running. Port 5173
  stays free for `npm run dev` and `npm run android:live`.
- **Network guard.** Every test imports `test` from `tests/e2e/support/test.ts`. It fails the
  test if the page requests anything outside the local server, or if the app's Content
  Security Policy had to block an attempt. This is the privacy promise, checked on every run.
- **Fake Android bridge** (`tests/e2e/support/native-fake.ts`): the app believes it runs on
  Android. Plugin calls are answered and recorded, files go to an in-memory phone storage,
  and the scanner and file picker return test photos. See `tests/e2e/android.spec.ts`.
- Timing gates (`tests/e2e/perf-gates.spec.ts`, `npm run test:perf`) write their report to
  `test-results/perf/` (not tracked). Thresholds: [perf.md](perf.md).

## Phone tests

`npm run test:android` installs a fresh Lens Dev build on your USB phone and runs
`tests/device/` with Playwright inside the app's real WebView (Chrome DevTools over adb).
Native screens (scanner, share sheet) are read through `uiautomator`.

- Lens Dev (`org.openwaqf.lens.dev`) only. Every test starts it with no data: never keep
  real documents in Lens Dev. The Play Store app is never touched.
- Keep the phone unlocked. About one minute.
- `-- --no-install` reuses the installed build. `-- -g "P.2"` runs one test.
- Photos come from `tests/fixtures/photos/` (made by `scripts/make-photo-fixtures.mjs`).
  Add real phone photos there when you have them: they are harder than drawn pages.
- Not automated: the fingerprint prompt itself and the system file picker. Test those by
  hand before a release.

Why not Maestro, like Signer: Lens blocks screenshots (FLAG_SECURE), so Maestro's failure
screenshots are black, and Maestro cannot feed a photo into the import path or read the
database to prove OCR worked.

## Translations ratchet

`scripts/i18n-known-gaps.json` lists the Arabic texts that were missing in Nov 2026. They are
reported but do not fail the check. A new gap fails it. When you translate one, the check
tells you to remove it from the list, so the list only shrinks.

## Other checks

- `npm run test:no-telemetry [apk-or-aab]`: scans an Android build for analytics and
  crash-reporting SDKs. The release runs it on the APK and on the signed bundle.
- `npm run vault:verify <file.slbk>`: prints a backup's plain header without the password.
