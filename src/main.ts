import './style.css';
import './app/app-root';

import {tryPersistStorage} from './services/persist';
import {Capacitor} from '@capacitor/core';

// PWA auto update registration (virtual module provided by vite-plugin-pwa)
import {registerSW} from 'virtual:pwa-register';

if (!Capacitor.isNativePlatform()) {
    const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
            window.dispatchEvent(new CustomEvent('sahifah:pwa-update-available', {
                detail: {
                    applyUpdate: () => void updateSW(true),
                },
            }));
        },
    });
}

void tryPersistStorage();
