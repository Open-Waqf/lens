export interface AppSettings {
    requireAuth: boolean;
    defaultVault: boolean;
    enableOcr: boolean;
}

// Internal "Secrets" - Changing these invalidates existing settings
const SALT = 'sahifah-secure-salt-v1';
const ENABLED_PHRASE = 'sahifah-auth-is-enabled-strictly';

// Keys
const KEYS = {
    // We rename the key so it doesn't look like a boolean
    LOCK_INTEGRITY: 'sahifah.integrity_check',
    DEFAULT_VAULT: 'sahifah.defaultVault',
    ENABLE_OCR: 'sahifah.enableOcr',
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

        // Default OCR to TRUE if not set
        const ocrRaw = localStorage.getItem(KEYS.ENABLE_OCR);
        const ocrEnabled = ocrRaw === null ? true : (ocrRaw === '1');

        const storedHash = localStorage.getItem(KEYS.LOCK_INTEGRITY);
        const isLocked = storedHash === this._enabledHash;

        return {
            requireAuth: isLocked,
            defaultVault: localStorage.getItem(KEYS.DEFAULT_VAULT) === '1',
            enableOcr: ocrEnabled,
        };
    }

    setOcr(enable: boolean) {
        localStorage.setItem(KEYS.ENABLE_OCR, enable ? '1' : '0');
        this._notify();
    }

    async setAuth(enable: boolean) {
        if (enable) {
            // Store the specific hash
            const hash = await this._generateHash(ENABLED_PHRASE);
            localStorage.setItem(KEYS.LOCK_INTEGRITY, hash);
        } else {
            // Nuke the key completely
            localStorage.removeItem(KEYS.LOCK_INTEGRITY);
        }

        // Notify app
        this._notify();
    }

    setVault(enable: boolean) {
        localStorage.setItem(KEYS.DEFAULT_VAULT, enable ? '1' : '0');
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