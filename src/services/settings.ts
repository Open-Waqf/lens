// Removed in Nov 2026 (they did nothing or never worked): Vault Mode, the mirror backup
// folder, the Quick/Manual scan mode and the OCR on/off switch (every page was read anyway).
// Their old localStorage keys are simply ignored.
export interface AppSettings {
    requireAuth: boolean;
    ocrLang: string;
    clearClipboardAfter60s: boolean;
}

// Internal constants for the local "app-lock enabled" marker.
// IMPORTANT: This is a UX lock convenience signal, not a cryptographic boundary.
// Never store encryption keys or vault secrets in localStorage.
// Changing these invalidates existing settings.
const SALT = 'sahifah-secure-salt-v1';
const ENABLED_PHRASE = 'sahifah-auth-is-enabled-strictly';

// Keys
const KEYS = {
    // We rename the key so it doesn't look like a boolean
    LOCK_INTEGRITY: 'sahifah.integrity_check',
    OCR_LANG: 'sahifah.ocrLang',
    CLIPBOARD_AUTO_CLEAR: 'sahifah.clipboardAutoClear',
};

class SettingsService {

    // We cache the hash so we don't recalculate it every ms
    private _enabledHash: string | null = null;

    constructor() {
        // Pre-calculate the "Enabled" hash on startup
        this._generateHash(ENABLED_PHRASE).then(h => this._enabledHash = h);
    }

    async get(): Promise<AppSettings> {
        // We must await the hash generation if it hasn't finished (edge case)
        if (!this._enabledHash) {
            this._enabledHash = await this._generateHash(ENABLED_PHRASE);
        }

        const ocrLang = localStorage.getItem(KEYS.OCR_LANG) || 'ara+eng';

        const storedHash = localStorage.getItem(KEYS.LOCK_INTEGRITY);
        const isLocked = storedHash === this._enabledHash;

        return {
            requireAuth: isLocked,
            ocrLang,
            clearClipboardAfter60s: localStorage.getItem(KEYS.CLIPBOARD_AUTO_CLEAR) === '1',
        };
    }

    setOcrLang(lang: string) {
        localStorage.setItem(KEYS.OCR_LANG, lang);
        this._notify();
    }


    setClipboardAutoClear(enable: boolean) {
        localStorage.setItem(KEYS.CLIPBOARD_AUTO_CLEAR, enable ? '1' : '0');
        this._notify();
    }



    async setAuth(enable: boolean) {
        if (enable) {
            // Store a local marker hash for app-lock state only.
            // This value does not protect encrypted vault data.
            const hash = await this._generateHash(ENABLED_PHRASE);
            localStorage.setItem(KEYS.LOCK_INTEGRITY, hash);
        } else {
            // Nuke the key completely
            localStorage.removeItem(KEYS.LOCK_INTEGRITY);
        }

        // Notify app
        this._notify();
    }


    private _notify() {
        // Since get() is now async, we might want to just dispatch the raw values if known,
        // or let components re-fetch.
        window.dispatchEvent(new CustomEvent('sahifah-settings-changed'));
    }

    // --- SHA-256 Hashing Helper ---
    private async _generateHash(text: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(text + SALT); // Salt prevents rainbow table lookups
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

export const settings = new SettingsService();
