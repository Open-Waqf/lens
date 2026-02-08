# ✒️ Sahifah Lens (العدسة)

> **Private. Local. Sovereign.**
> A high-performance, local-first document scanner and vault. No accounts, no ads, no cloud.

<div align="center">
<a href="[https://lens.open-waqf.org](https://www.google.com/search?q=https://lens.open-waqf.org)">
<img src="icons/icon-512.png" alt="Sahifah Lens Logo" width="100" height="100" style="border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
</a>
</div>

Sahifah Lens allows users to digitize documents, perform OCR, and organize their personal library directly on their
device. Built on the principle of **Amanah** (Trust), it ensures that your sensitive documents never leave your physical
control.

Unlike cloud-based scanners, **zero data is ever uploaded to a server**. All image processing and text recognition
happen locally using your device's hardware.

---

## 🌟 Key Features

### 🛡️ Security & Sovereignty

* **Zero-Cloud Architecture:** Your documents are stored in the **Origin Private File System (OPFS)** and IndexedDB,
  isolated from other websites and the cloud.
* **Encrypted Backups:** Export your entire library as an encrypted vault using Password-Based Encryption (PBE).
* **Nuclear Reset:** A "Reset Storage" kill-switch immediately erases all local documents, pages, and settings from the
  device.
* **Persistence Checks:** Automatically monitors if the OS is attempting to clear browser storage and warns you to back
  up.

### 📸 Intelligent Scanning

* **Edge Detection:** Real-time document boundary detection using custom computer vision workers.
* **Magic Filters:** On-device image enhancement including adaptive black-and-white thresholding for crisp,
  printer-ready documents.
* **Perspective Correction:** Automatically warps and crops images to fix camera angles.
* **Multi-Page Sessions:** Scan entire books or multi-page contracts in a single session.

### 🔍 Deep Search & OCR

* **On-Device OCR:** Uses **Tesseract.js** to extract text from images without an internet connection.
* **Searchable Library:** Instantly find documents by their content, not just their filenames.
* **PDF Generation:** Compile your scans into professional, searchable PDFs locally.

### 🌍 Universal Access

* **Hybrid Power:** Optimized for both the web (PWA) and native Android/iOS via **Capacitor**.
* **Offline First:** Fully functional in airplane mode; your library is always in your pocket.

---

## 🛡️ Privacy & "No Tracking" Promise

We believe in **Data Sovereignty**.

* **No Uploads:** Your documents never touch our infrastructure.
* **No Accounts:** No login, no email, and no identity tracking.
* **Local Processing:** OCR and PDF generation run in WebWorkers to keep the UI smooth and data local.

---

## 🏗️ Architecture

* **Core:** TypeScript, Vite, Lit (Web Components).
* **Storage:** OPFS (Origin Private File System) for high-performance file I/O.
* **OCR Engine:** Tesseract.js.
* **Native Layer:** Capacitor (Camera, Filesystem, and Share APIs).
* **Vision Logic:** Custom Canvas-based image processing pipeline.
* **Testing:** Playwright for End-to-End verification.

---

## 🚀 Getting Started

### Prerequisites

* Node.js 20+
* Android Studio (for native builds)

### 1. Installation

```bash
npm install
# Sync Capacitor for native platforms
npx cap sync

```

### 2. Development

Runs the PWA with Hot Module Replacement (HMR).

```bash
npm run dev

```

### 3. Run Audit (Tests)

Verifies scanning logic and storage integrity.

```bash
npm run test:e2e

```

### 4. Build for Production

```bash
npm run build
# To open the Android project
npm run cap:open:android

```

---

## ⚠️ Disclaimers

### Storage Persistence

On iOS and some low-storage devices, the browser may clear data if the app isn't used frequently. Always use the *
*Export Backup** feature in Settings to keep a permanent copy of your library.

### Device Performance

OCR and image warping are CPU-intensive. While Sahifah Lens is optimized via WebWorkers, scanning high-resolution
documents may be slower on budget hardware.

---

<div align="center">
<p><em>Built with ❤️ for the Ummah and Humanity.</em></p>
<p><small>Focused on Privacy, Security, and Ease of Use.</small></p>
</div>