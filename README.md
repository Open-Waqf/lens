# ✒️ Sahifah Lens (العدسة)

> **Private. Local. Sovereign.**
> A high-performance, local-first document scanner and vault. No accounts, no ads, no cloud.

<div align="center">
<a href="https://lens.open-waqf.org">
<img src="public/icons/icon-512.png" alt="Sahifah Lens Logo" width="100" height="100" style="border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
</a>
</div>

Sahifah Lens allows users to digitize documents, perform OCR, and organize their personal library directly on their
device. Built on the principle of **Amanah** (Trust), it ensures that your sensitive documents never leave your physical
control.

Unlike cloud-based scanners, **zero data is ever uploaded to a server**. All image processing and text recognition
happen locally using your device's hardware via WebWorkers.

---

## 🌟 Key Features

### 🛡️ Privacy & Sovereignty

* **Zero-Cloud Architecture:** Your documents are stored in the **Origin Private File System (OPFS)** and IndexedDB,
  isolated from other websites.
* **Encrypted Backups:** Export your entire library as a password-protected `.slbk` vault using AES-GCM encryption.
* **Nuclear Reset:** A "Reset Storage" kill-switch immediately erases all local documents, pages, and settings from the
  device.
* **Offline First:** Fully functional in airplane mode; your library stays in your pocket, not on a server.

### 📸 Intelligent Scanning

* **Edge Detection:** Real-time document boundary detection using custom computer vision workers.
* **Magic Filters:** On-device image enhancement including adaptive black-and-white thresholding for crisp,
  printer-ready documents.
* **Perspective Correction:** Automatically warps and crops images to fix camera angles.

### 🔍 Deep Search & OCR

* **On-Device OCR:** Uses **Tesseract.js** to extract text from images without an internet connection.
* **Searchable Library:** Instantly find documents by their content via a local search index.
* **PDF Generation:** Compile your scans into professional, searchable PDFs with invisible text layers locally.

---

## 🏗️ Technical Architecture

* **Core:** TypeScript, Vite, Lit (Web Components).
* **Storage:** OPFS for binary files and Dexie (IndexedDB) for metadata.
* **OCR Engine:** Tesseract.js running in local WebWorkers.
* **Native Layer:** Capacitor for Camera, Filesystem, and Share APIs on Android/iOS.

---

## ⚠️ Disclaimers

* **Local Storage:** Documents are stored unencrypted in the browser's private directory (OPFS). Use device-level
  encryption for maximum security.
* **Storage Persistence:** On some mobile devices, the OS may clear browser data if storage is low. **Always export an
  Encrypted Backup** to secure your data permanently.

<div align="center">
<p><em>Built with ❤️ for the Ummah and Humanity.</em></p>
<p><small>Released under Polyform Noncommercial License 1.0.0</small></p>
</div>