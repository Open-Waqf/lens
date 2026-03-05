# Privacy Policy for Sahifah Lens (العدسة)

**Last Updated: March 2026**

## 1. Our Commitment

Sahifah Lens is built on the principle of **Data Sovereignty**. We believe you should own your data. Our privacy policy
is simple: **We do not collect, see, or store your data.**

## 2. Data Processing & Storage

* **Local Processing:** All document scanning, image filtering, and OCR are performed entirely on your device's CPU/GPU.
  No image or text data is ever sent to our servers.
* **On-Device Storage:** Your documents are stored in the **Origin Private File System (OPFS)** and **IndexedDB**. This
  data is physically isolated from other websites.
* **Web/PWA Storage Risk:** In browser contexts, OPFS/IndexedDB remain browser-managed. Sahifah Lens requests persistent
  storage where supported, but browser/OS eviction under storage pressure can still occur. The app surfaces in-app
  backup reminders and storage warnings for this case.
* **Multitasking Privacy:** On native platforms, the app requires biometric re-authentication immediately when returning
  from the background to prevent document exposure in the OS task switcher.

## 3. Personal Information

* **No Accounts:** You do not need an email or identity to use Sahifah Lens.
* **No Tracking:** We do not use analytics, trackers, or cookies. Your usage patterns are your own business.
* **No Telemetry SDKs:** Production builds do not include analytics/crash-reporting SDKs (for example Firebase
  Analytics, Mixpanel, Amplitude, Sentry).

## 4. Third-Party Services

Sahifah Lens uses local-only libraries:

* **Tesseract.js:** For local OCR using bundled language packs stored with the app.
* **Capacitor:** To interface with native hardware (Camera, Biometrics, Haptics).

Sahifah Lens does not run a cloud OCR service and does not require account-linked remote APIs for document processing.

## 5. Security of Data

While storage is private, files are stored unencrypted locally by default for performance. We strongly recommend:

1. Enabling **App Lock (Biometrics)** in settings.
2. Using the **Encrypted Backup** feature (`.slbk`) for off-device storage.

## 6. Your Rights

Since we do not collect your data, you have total control. You can delete everything instantly using the **Nuclear Reset
** feature in settings.
