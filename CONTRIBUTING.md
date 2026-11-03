# 🛠️ Contributing to Sahifah Lens

Thank you for your interest in contributing! Sahifah Lens is built on the principle of **Sovereignty**—not just for
users, but for the code itself. We prioritize performance, security, and local-first architecture.

## 📐 General Principles

1. **Amanah (Trust):** Never add code that sends data to an external server. No analytics, no tracking, no "phone home"
   features.
2. **Local-First:** All processing must happen on the device.
3. **UI Responsiveness:** Heavy tasks (OCR, Image Processing, Edge Detection) **must** reside in a WebWorker. The main
   thread is for UI only.

---

## 💻 Coding Standards

### 1. Computer Vision & Workers

Our CV logic (found in `src/lib/scan/` and `src/lib/image/`) is performance-critical.

* **Zero-Copy when possible:** Use `Transferable` objects (like `ArrayBuffer`) when sending data to/from workers to
  avoid cloning overhead.
* **OffscreenCanvas:** Use `OffscreenCanvas` inside workers for image manipulation to avoid main-thread painting stalls.
* **Memory Management:** Explicitly close `ImageBitmap` objects and nullify large `Uint8Array` references as soon as
  they are no longer needed.

### 2. State Management & Persistence

We use a "Save-First" strategy for batch imports to prevent OOM (Out of Memory) crashes on mobile.

* **Atomic Transactions:** Use Dexie transactions for metadata updates.
* **OPFS for Blobs:** Large binary data (images/PDFs) belongs in **OPFS**, while metadata belongs in **IndexedDB**.
  Never store base64 strings in the database.
* **Byte-First:** Prefer `Uint8Array` for data manipulation. Convert to `Blob` or `File` only at the final boundary (
  e.g., sharing or writing to disk).

### 3. Cryptography (PBE)

Backups use a specific chunked-streaming protocol to allow multi-gigabyte exports on low-RAM devices.

* **Protocol:** Any changes to `src/lib/crypto/pbe.ts` must maintain compatibility with the `SLBK` header and the
  `[Length][IV][Ciphertext]` chunk frame format.
* **Web Crypto API:** Only use the native `crypto.subtle` API. Avoid third-party JS crypto libraries for core
  encryption.
* **Test Vector Procedure:** For any crypto/header change, run:
  ```bash
  npm run test:unit -- tests/unit/crypto.test.ts tests/unit/restore-error.test.ts
  ```
  Then export a backup and verify plaintext header values:
  ```bash
  node scripts/slbk-verify.mjs ./lens-backup-YYYY-MM-DD.slbk
  ```
  Confirm at minimum: magic `SLBK`, version, PBKDF2 iterations (`>=600000`), salt length (`16`), IV length (`12`).

### 4. Localization

* **No hardcoded UI text:** User-facing strings must use translation keys from `src/lib/i18n.ts` via `t(...)`.
* **App shell included:** Navigation labels, fatal/recovery prompts, and toast messages in `app-root` follow the same rule.
* **Clipboard privacy:** Copy actions must route through `src/services/clipboard.ts` so opt-in auto-clear behavior remains consistent.

---

## 🚀 Development Workflow

1. **Branching:** Create a feature branch (`feat/your-feature` or `fix/your-fix`) from `develop`.
2. **Checks:** Run `npm run check` before every commit and pull request. GitHub runs the same
   checks (on all screens, against the production build) on every pull request into `develop`.
3. **Privacy:** Every browser test fails if the app tries to reach the network. Never add an
   exception for analytics, fonts, CDNs or any remote service.
4. **Phone:** Android-specific changes (sharing, files, scanner, app lock) are checked on a
   real phone with `npm run test:android` before they are called done.
5. **Translations:** Every text in `src/lib/i18n.ts` must exist in every language.
   `npm run check-i18n` lists anything missing.
6. **Dependencies:** Read [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) before upgrading anything.

Details: [docs/TESTING.md](docs/TESTING.md).

## 📦 Pull Request Process

* Describe the **why** behind your change.
* If you are adding a new filter or CV logic, include "Before/After" performance metrics (e.g., `tMs` from the
  `DetectGovernor`).
* Ensure the Service Worker version is incremented if you change assets that need caching.
