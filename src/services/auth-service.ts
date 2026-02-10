import {NativeBiometric} from '@capgo/capacitor-native-biometric';
import {Capacitor} from '@capacitor/core';
import {settings} from './settings';

const WEBAUTHN_ID_KEY = 'sahifah_webauthn_id';

export class AuthService {
    private static _isUnlocked = false;

    static async isAuthenticated(): Promise<boolean> {
        // Update: await the settings
        const currentSettings = await settings.get();

        if (!currentSettings.requireAuth) return true;
        return this._isUnlocked;
    }

    /**
     * Tries to authenticate the user using the best available method.
     * - Mobile: FaceID / Fingerprint (Plugin)
     * - Web: Windows Hello / TouchID (WebAuthn)
     */
    static async promptAuth(): Promise<boolean> {
        // 1. Mobile Native Auth
        if (Capacitor.isNativePlatform()) {
            try {
                // FIX 1: verifyIdentity returns void on success, throws on failure.
                // We do not capture a result variable.
                await NativeBiometric.verifyIdentity({
                    reason: "Access your private Sahifah vault",
                    title: "Unlock Sahifah",
                    subtitle: "Authenticate to continue",
                    description: "Biometric authentication required"
                });

                // If code reaches here, auth succeeded
                this._isUnlocked = true;
                return true;
            } catch {
                return false;
            }
        }

        // 2. Web / PWA Auth (Windows Hello / TouchID)
        return await this._webAuthnVerify();
    }

    /**
     * Sets up authentication for the first time.
     * Must be called when the user toggles the switch ON.
     */
    static async setupAuth(): Promise<boolean> {
        if (Capacitor.isNativePlatform()) {
            // Mobile: Just verify it works
            const result = await NativeBiometric.isAvailable();
            return !!result.isAvailable;
        } else {
            // Web: We must "Register" a new credential
            return await this._webAuthnRegister();
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
                        id: this._base64ToBuffer(storedId), // Uses fixed helper
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
        // FIX 2: Return the .buffer property to match ArrayBuffer return type
        return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
    }
}