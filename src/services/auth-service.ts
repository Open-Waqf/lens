import {NativeBiometric} from '@capgo/capacitor-native-biometric';
import {Capacitor} from '@capacitor/core';
import {settings} from './settings';

const WEBAUTHN_ID_KEY = 'sahifah.webauthn_id';

export class AuthService {
    private static _isUnlocked = false;

    static async isAuthenticated(): Promise<boolean> {
        // If the variable is already true, don't even bother reading settings
        if (this._isUnlocked) return true;

        const currentSettings = await settings.get();
        if (!currentSettings.requireAuth) return true;
        return this._isUnlocked;
    }

    static lock(): void {
        this._isUnlocked = false;
    }

    /**
     * Tries to authenticate the user using the best available method.
     */
    static async promptAuth(): Promise<boolean> {
        if (Capacitor.isNativePlatform()) {
            try {
                await NativeBiometric.verifyIdentity({
                    reason: "Access your private Sahifah vault",
                    title: "Unlock Sahifah",
                    subtitle: "Authenticate to continue",
                    description: " "
                });

                // SUCCESS: Mark as unlocked
                this._isUnlocked = true;
                return true;
            } catch (e) {
                this._isUnlocked = false;
                return false;
            }
        }
        return await this._webAuthnVerify();
    }

    static async setupAuth(): Promise<boolean> {
        if (Capacitor.isNativePlatform()) {
            try {
                const result = await NativeBiometric.isAvailable();
                if (!result.isAvailable) return false;

                await NativeBiometric.verifyIdentity({
                    reason: "Enable App Lock",
                    title: "Enable App Lock",
                    subtitle: "Verify your identity",
                    description: " "
                });

                // SUCCESS: Mark as unlocked so we don't loop
                this._isUnlocked = true;
                return true;
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
}