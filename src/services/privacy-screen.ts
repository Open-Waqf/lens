import {Capacitor, registerPlugin} from '@capacitor/core';

type PrivacyScreenPlugin = {setLockEnabled(options: {enabled: boolean}): Promise<void>};

const PrivacyScreen = registerPlugin<PrivacyScreenPlugin>('PrivacyScreen');

/**
 * Tell Android whether App Lock is on. With it on, screenshots and screen recording of Lens
 * are blocked; with it off, the user can screenshot their own scans. On Android 13+ Lens is
 * always hidden in the recent-apps screen either way (android/.../PrivacyScreenPlugin.java).
 */
export async function syncPrivacyScreen(appLockEnabled: boolean): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
        await PrivacyScreen.setLockEnabled({enabled: appLockEnabled});
    } catch (e) {
        console.warn('Privacy screen update failed', e);
    }
}
