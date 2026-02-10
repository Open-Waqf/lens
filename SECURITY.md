# Security Policy

## 🛡️ Security Philosophy

Sahifah Lens prioritizes local-first security. By eliminating the cloud, we eliminate the primary vector for mass data
breaches.

## ⚠️ Known Security Posture

Before reporting a vulnerability, please note our current implementation status:

* **Local Storage:** Documents are stored in the browser's Origin Private File System (OPFS). These files are currently
  **unencrypted at rest**. Physical access to an unlocked device may allow data retrieval.
* **App Lock:** The biometric/passcode lock feature is currently a UI preference and does not provide cryptographic
  protection for the underlying files.
* **Backups:** Backups (.slbk) are cryptographically secured using **AES-GCM** with **PBKDF2** key derivation.

## 🚀 Supported Versions

We provide security updates for the latest stable release:

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Yes     |
| < 0.1.0 | ❌ No      |

## 📢 Reporting a Vulnerability

If you discover a security vulnerability, please do not open a public issue. Instead, follow these steps:

1. Email your findings to [security@open-waqf.org](mailto:security@open-waqf.org).
2. Include a detailed description of the vulnerability and steps to reproduce.
3. We will acknowledge your report within 48 hours and coordinate a fix.

## 🛠️ Security Roadmap

Planned security enhancements include:

* **Encryption at Rest:** Implementation of "Vault Mode" to encrypt local files in OPFS.
* **Hardened App Lock:** Integration with native Biometric APIs to guard application entry.