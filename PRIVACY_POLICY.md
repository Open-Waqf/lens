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
* **Backups:** "Export Backup" makes one encrypted file (`.slbk`) and hands it to Android's share sheet, or to a
  download in the browser. Where it goes is your choice. The app does not upload it.
* **Web/PWA Storage:** In the browser, OPFS and IndexedDB belong to the browser. Sahifah Lens asks for persistent
  storage where the browser supports it, but the browser or the OS can still clear the site's storage when space is
  low. The web app shows a storage warning and backup reminders for this case.
* **App Lock (optional):** When you turn on App Lock, the Android app asks for your fingerprint or face (Android's own
  prompt) when it opens and when it comes back from the background. Lens never sees or stores your biometric data.
  With App Lock on, the app's screen is hidden in Recents and screenshots are blocked.
* **Clipboard:** "Copy text" puts the page text on the clipboard. An optional setting clears it after 60 seconds.

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
* **Sharing:** "Share as PDF", "Share images" and "Export Backup" hand the file to Android's share sheet (or a download
  in the browser). The app you pick there receives the file; what it does with it is outside Sahifah Lens. "Sign with
  Signer" hands the PDF to the Open Waqf Signer app on the same phone.

Sahifah Lens does not run a cloud OCR service and needs no account or remote API for anything it does.

## 5. Security of Data

While storage is private, files are stored unencrypted locally by default for performance. We strongly recommend:

1. Enabling **App Lock (Biometrics)** in settings.
2. Using the **Encrypted Backup** feature (`.slbk`) for off-device storage.

## 6. Your Rights

Since we do not collect your data, you have total control. You can delete everything at once with **Erase
everything** in Settings. Deleting a document in the library gives you five seconds to undo; after that it is gone.
