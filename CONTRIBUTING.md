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

---

## 🚀 Development Workflow

1. **Branching:** Create a feature branch (`feat/your-feature` or `fix/your-fix`).
2. **Type Checking:** Run `npm run typecheck` before any PR. We do not accept PRs with `any` types in core logic.
3. **Testing:**

* Test image processing on both Desktop (high RAM) and Mobile (low RAM).
* Verify that the "Offline" mode still works (DevTools -> Network -> Offline).


4. **Linting:** Follow the existing style. We prefer **Lit** for UI components and standard **TypeScript** classes for
   services.

## 📦 Pull Request Process

* Describe the **why** behind your change.
* If you are adding a new filter or CV logic, include "Before/After" performance metrics (e.g., `tMs` from the
  `DetectGovernor`).
* Ensure the Service Worker version is incremented if you change assets that need caching.