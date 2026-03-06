# 🔐 Security Policy

## 🛡️ Our Security Philosophy

Sahifah Lens is built on the **Zero-Knowledge** paradigm. Security is a prerequisite for privacy. Because the app has no
backend, security depends on:

1. The integrity of the **Web Crypto API** (AES-GCM).
2. The strength of your **Backup Password**.
3. Your device's **Biometric/Lock Screen** security.

---

## 🛑 What We Don't Track

To protect your privacy, this project does not have:

* A centralized user database.
* Error reporting tools (Sentry/LogRocket).
* Any telemetry or "Phone Home" logic.

**If you find a security flaw, you are the only one who knows. Please report it!**

## 🐛 Reporting a Vulnerability

Do not open a public GitHub Issue. Email **security@openwaqf.org**.
Include:

* Steps to reproduce (PoC).
* Potential impact (e.g., "Auth bypass on Android").
* Device/OS details.

We acknowledge reports within **48 hours** and follow a **90-day disclosure policy**.

---

## 🚨 Security Scope

### In-Scope

* **Cryptographic Flaws:** Weaknesses in the `.slbk` export or chunk-streaming logic.
* **Auth Bypass:** Circumventing the Biometric App Lock on native platforms.
* **Data Leakage:** Evidence of OCR text or thumbnails leaking into public system directories.

### Out-of-Scope

* **Compromised OS:** Rooted/Jailbroken devices or keyloggers.
* **Weak Passwords:** Brute-forcing a weak user-chosen backup password.
* **Browser Flaws:** Vulnerabilities in the browser's implementation of OPFS/IndexedDB.

---

## 📜 Security Hardening Tips

* **Use Full Disk Encryption:** Ensure Android File-based Encryption or iOS Data Protection is active.
* **The "Nuclear Reset":** If you believe your device is compromised, wipe the local vault immediately via Settings.
* **Encrypted Backups:** Always use a strong password when exporting to cloud providers.
