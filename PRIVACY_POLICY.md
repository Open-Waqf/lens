# Privacy Policy for Sahifah Lens (العدسة)

**Last Updated: November 2026**

## 1. Our Commitment

Sahifah Lens is built on the principle of **Data Sovereignty**. We believe you should own your data. Our privacy policy
is simple: **We do not collect, see, or store your data.**

## 2. Data Processing & Storage

* **Local Processing:** All document scanning, image filtering, and OCR are performed entirely on your device's CPU/GPU.
  No image or text data is ever sent to our servers.
* **On-Device Storage:** In the Android app, your documents are stored in the app's private storage, which other apps
  cannot read, and the list of documents in the app's database. On the web, they are stored in the browser's private
  storage for this site (OPFS and IndexedDB).
* **No Backup to Google:** Android cloud backup and phone-to-phone transfer are turned off for Lens, so your documents
  are not copied to Google Drive or to a new phone without you. Move them with an encrypted backup (`.slbk`).
* **Optional Mirror Folder:** If you enable "Auto Backup to Folder (Advanced)", the app writes extra encrypted `.slbk`
  backup files to the local folder you choose. The app does not upload these files itself.
* **Web/PWA Storage Risk:** In browser contexts, OPFS/IndexedDB remain browser-managed. Sahifah Lens requests persistent
  storage where supported, but browser/OS eviction under storage pressure can still occur. The app surfaces in-app
  backup reminders and storage warnings for this case.
* **App Lock (optional):** When you turn on App Lock, the Android app asks for your fingerprint or face (Android's own
  prompt) when it opens and when it comes back from the background. Lens never sees or stores your biometric data.

## 3. Personal Information

* **No Accounts:** You do not need an email or identity to use Sahifah Lens.
* **No Tracking:** We do not use analytics, trackers, or cookies. Your usage patterns are your own business.
* **No Telemetry SDKs:** Production builds do not include analytics/crash-reporting SDKs (for example Firebase
  Analytics, Mixpanel, Amplitude, Sentry).

## 4. Third-Party Services

Sahifah Lens uses local-only libraries:

* **Tesseract.js:** For local OCR using bundled language packs stored with the app.
* **Capacitor:** To use the phone's features (document scanner, biometric prompt, files, sharing, vibration).
* **Google ML Kit document scanner (Android, Quick Scan):** Google's scanner, part of Google Play services on your phone.
  It runs on the phone and returns the page image to Lens. Lens sends nothing to Google; Google Play services is Google's
  software and follows Google's own policies.

Sahifah Lens does not run a cloud OCR service and does not require account-linked remote APIs for document processing.
If you connect your mirror folder to external sync tools, their own metadata/network behavior is outside Sahifah Lens.

## 5. Security of Data

While storage is private, files are stored unencrypted locally by default for performance. We strongly recommend:

1. Enabling **App Lock (Biometrics)** in settings.
2. Using the **Encrypted Backup** feature (`.slbk`) for off-device storage.

## 6. Your Rights

Since we do not collect your data, you have total control. You can delete everything instantly using the **Nuclear Reset
** feature in settings.
