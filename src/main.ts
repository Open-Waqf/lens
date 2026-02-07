import './style.css';
import './app/app-root';

import {requestStoragePersistence} from './services/persist';

// PWA auto update registration (virtual module provided by vite-plugin-pwa)
import {registerSW} from 'virtual:pwa-register';

registerSW({immediate: true});

void requestStoragePersistence();
