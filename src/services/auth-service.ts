import {NativeBiometric} from '@capgo/capacitor-native-biometric';
import {Capacitor} from '@capacitor/core';
import {settings} from './settings';

const WEBAUTHN_ID_KEY = 'sahifah.webauthn_id';

export class AuthService {
    private static _isUnlocked = false;

    private static _promptInFlight: Promise<boolean> | null = null;
    private static _resumeBypassTokens: Array<{ expiresAt: number; reason: string }> = [];

    private static readonly DEFAULT_BYPASS_TTL_MS = 30_000;

    static ignoreNextResumeForExternalAction(reason = 'external-action', ttlMs = this.DEFAULT_BYPASS_TTL_MS) {
        const safeTtl = Number.isFinite(ttlMs) ? Math.max(1000, Math.floor(ttlMs)) : this.DEFAULT_BYPASS_TTL_MS;
        this._resumeBypassTokens.push({
            expiresAt: Date.now() + safeTtl,
            reason,
        });
    }

    static setIgnoreNextResume(val: boolean) {
        if (val) {
            this.ignoreNextResumeForExternalAction('legacy');
            return;
        }
        this._resumeBypassTokens = [];
    }

    static get isPrompting() {
        return this._promptInFlight !== null;
    }

    static async isAuthenticated(): Promise<boolean> {
        if (this._isUnlocked) return true;
        const currentSettings = await settings.get();
        if (!currentSettings.requireAuth) return true;
        return this._isUnlocked;
    }

    static lock(): void {
        if (this.isPrompting) return;

        // Skip exactly one lock transition for known user-initiated external flows
        // (share sheet, file picker, export intents). Token auto-expires to avoid leakage.
        if (this._consumeResumeBypassToken()) {
            return;
        }

        this._isUnlocked = false;
    }

    static async promptAuth(): Promise<boolean> {
        if (this._isUnlocked) return true;

        // If a prompt is already running, return the existing promise
        if (this._promptInFlight) return this._promptInFlight;

        this._promptInFlight = (async () => {
            if (Capacitor.isNativePlatform()) {
                try {
                    await NativeBiometric.verifyIdentity({
                        reason: "Access your private Sahifah vault",
                        title: "Unlock Sahifah",
                        subtitle: "Authenticate to continue",
                        description: " "
                    });
                    this._isUnlocked = true;
                    return true;
                } catch {
                    this._isUnlocked = false;
                    return false;
                }
            }
            const ok = await this._webAuthnVerify();
            this._isUnlocked = ok;
            return ok;
        })();

        try {
            return await this._promptInFlight;
        } finally {
            this._promptInFlight = null; // Clear the guard when done
        }
    }

    static async setupAuth(): Promise<boolean> {
        if (Capacitor.isNativePlatform()) {
            try {
                const result = await NativeBiometric.isAvailable();
                if (!result.isAvailable) return false;

                // Reuse the shared, guarded prompt logic
                // This ensures _isUnlocked is set and _promptInFlight is handled
                return await this.promptAuth();
            } catch (e) {
                return false;
            }
        } else {
            const success = await this._webAuthnRegister();
            if (success) this._isUnlocked = true;
            return success;
        }
    }

    // --- WebAuthn Implementation (Local/Offline) ---

    private static async _webAuthnRegister(): Promise<boolean> {
        try {
            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);

            const credential = await navigator.credentials.create({
                publicKey: {
                    challenge,
                    rp: {name: "Sahifah Lens"},
                    user: {
                        id: Uint8Array.from("local-user", c => c.charCodeAt(0)),
                        name: "user@local",
                        displayName: "Vault Owner"
                    },
                    pubKeyCredParams: [{alg: -7, type: "public-key"}],
                    authenticatorSelection: {
                        authenticatorAttachment: "platform",
                        userVerification: "required"
                    },
                    timeout: 60000
                }
            }) as PublicKeyCredential;

            if (credential) {
                localStorage.setItem(WEBAUTHN_ID_KEY, this._bufferToBase64(credential.rawId));
                return true;
            }
        } catch (e) {
            console.warn("WebAuthn Setup Failed", e);
        }
        return false;
    }

    private static async _webAuthnVerify(): Promise<boolean> {
        const storedId = localStorage.getItem(WEBAUTHN_ID_KEY);
        if (!storedId) return false;

        try {
            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);

            const credential = await navigator.credentials.get({
                publicKey: {
                    challenge,
                    allowCredentials: [{
                        id: this._base64ToBuffer(storedId),
                        type: "public-key"
                    }],
                    userVerification: "required"
                }
            });

            if (credential) {
                this._isUnlocked = true;
                return true;
            }
        } catch (e) {
            console.warn("WebAuthn Verify Failed", e);
        }
        return false;
    }

    // --- Helpers ---

    private static _bufferToBase64(buffer: ArrayBuffer): string {
        return btoa(String.fromCharCode(...new Uint8Array(buffer)));
    }

    private static _base64ToBuffer(base64: string): ArrayBuffer {
        return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
    }

    private static _consumeResumeBypassToken(): boolean {
        const now = Date.now();
        this._resumeBypassTokens = this._resumeBypassTokens.filter(t => t.expiresAt > now);
        if (this._resumeBypassTokens.length === 0) return false;
        this._resumeBypassTokens.shift();
        return true;
    }
}
