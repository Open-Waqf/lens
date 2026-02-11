# ✒️ Sahifah Lens (العدسة)

> **Private. Local. Sovereign.**
> A high-performance, local-first document scanner and vault. No accounts, no ads, no cloud.

<div align="center">
<a href="https://lens.openwaqf.org">
<img src="public/icons/icon-512.png" alt="Sahifah Lens Logo" width="100" height="100" style="border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
</a>
</div>

Sahifah Lens allows users to digitize documents, perform OCR, and organize their personal library directly on their
device. Built on the principle of **Amanah** (Trust), it ensures that your sensitive documents never leave your physical
control.

---

## 🌟 Key Features

### 🛡️ Privacy & Sovereignty

* **Zero-Cloud Architecture:** Documents are stored in the **Origin Private File System (OPFS)**, isolated from other
  websites.
* **Biometric App Lock:** Immediate re-locking upon app multitasking/resume to prevent unauthorized physical access.
* **Stream-Encrypted Backups:** Export your library as a `.slbk` vault using AES-GCM with a unified chunk-streaming
  protocol (Magic: `SLBK`).
* **Nuclear Reset:** A "Reset Storage" kill-switch erases all local documents and database entries instantly.
* **Offline First:** Fully functional in airplane mode; OCR and image processing are 100% local.

### 📸 Intelligent Scanning & Editing

* **Edge Detection:** Real-time boundary detection via Computer Vision workers.
* **Visual Filter Picker:** Real-time thumbnail previews for Magic Color, B&W, and Whiteboard filters.
* **The "Stitcher":** Merge multiple separate scans into a single organized document.
* **Perspective Correction:** Automatically warps and crops images to fix camera angles.

### 🔍 Deep Search & OCR

* **On-Device OCR:** Uses **Tesseract.js** in WebWorkers to extract text without internet.
* **Contextual Snippets:** Search results highlight the exact sentence found in OCR text or user notes.
* **Rich Metadata:** Organize with Folders, Tags, and private searchable Notes.
* **PDF Generation:** Compile professional, searchable PDFs with invisible text layers locally.

---

## 🏗️ Technical Architecture

* **UI:** TypeScript + Lit (Web Components) + Tailwind CSS.
* **Persistence:** Dexie.js (IndexedDB) for metadata; OPFS for high-performance binary storage.
* **Crypto:** Web Crypto API using PBKDF2 for key derivation and AES-GCM for stream encryption.
* **Native:** Capacitor 6+ for high-quality camera access, Biometrics, and native system sharing.
* **Sensory:** Hybrid Haptic engine for tactile feedback on both Web and Native.

---

## 🛠️ Developer Setup

### 1. Prerequisites

* **Node.js:** v18 or later.
* **Package Manager:** `npm`.

### 2. Installation

```bash
git clone [https://github.com/open-waqf/lens.git](https://github.com/open-waqf/lens.git)
cd lens
npm install

```

### 3. Development

```bash
npm run dev

```

### 4. Native Setup (Android/iOS)

```bash
npm run build
npx cap sync
npx cap open android # or ios

```

---

## ⚠️ Disclaimers

* **Storage Persistence:** On mobile, the OS may clear browser data if storage is low. **Always export an Encrypted
  Backup** to secure your data permanently.
* **Sovereignty:** You are responsible for your own keys/passwords. There is no "Forgot Password" link because there is
  no server.

<div align="center">
<p><em>Built with ❤️ for the Ummah and Humanity.</em></p>
<p><small>Released under Polyform Noncommercial License 1.0.0</small></p>
</div>