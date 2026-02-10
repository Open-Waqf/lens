# 🔐 Security Policy

## 🛡️ Our Security Philosophy

Sahifah Lens is built on the **Zero-Knowledge** and **Local-Only** paradigm. We believe that security is a prerequisite
for privacy. Because the app has no backend, the security of your documents depends on three things:

1. The integrity of the **Web Crypto API** implementation.
2. The strength of the user's **Backup Password**.
3. The physical security and **Disk Encryption** of the user's device.

---

## 🛑 What We Don't Track

To protect your privacy, this project does not have:

* A centralized database of users.
* Error reporting tools that send stack traces to a server (e.g., Sentry).
* Any telemetry or analytics.

**This means if you find a bug or a security flaw, you are the only one who knows. Please report it!**

---

## 🛡️ Supported Versions

We only provide security updates for the latest version of Sahifah Lens. If you are using an older version, please
update via the PWA prompt or the App Store/Play Store to ensure you have the latest cryptographic fixes.

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ YES     |
| < 0.1.0 | ❌ NO      |

---

## 🐛 Reporting a Vulnerability

If you discover a security vulnerability, please follow these steps:

1. **Do not open a public GitHub Issue.**
2. Email your report to **security@openwaqf.org**.
3. Include a detailed description of the vulnerability, including:

* The steps to reproduce (PoC).
* The potential impact (e.g., "An attacker with physical access could bypass the app lock").
* The device and browser/OS version used.

We will acknowledge your email within **48 hours** and provide a timeline for a fix. We follow a standard **90-day
disclosure policy**, meaning we ask that you do not share the vulnerability publicly until we have had 90 days to issue
a patch.

---

## 🚨 Security Scope

### In-Scope

* **Cryptographic Flaws:** Weaknesses in the `.slbk` export format or `encryptStream` logic.
* **Data Leakage:** Scenarios where data might be cached in a public directory or exposed to other apps.
* **Auth Bypass:** Ways to circumvent the "App Lock" biometrics on native platforms.

### Out-of-Scope

* **Compromised OS:** If the user's phone is rooted/jailbroken or has a keylogger, we cannot protect the data.
* **Weak Passwords:** Brute-forcing a 4-character password on a backup is not a vulnerability of the app, but a
  user-choice risk.
* **Browser-Level Flaws:** Vulnerabilities in the Chrome/Safari implementation of OPFS or IndexedDB.

---

## 📜 Security Hardening Tips for Users

* **Use Full Disk Encryption:** Ensure your Android (File-based Encryption) or iOS (Data Protection) is active.
* **Backup Often:** Use a strong, unique password for your `.slbk` exports.
* **The "Nuclear Reset":** If you believe your device has been compromised, use the "Erase Everything" button in
  Settings to wipe the local vault immediately.