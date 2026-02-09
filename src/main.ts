import './style.css';
import './app/app-root';

import {tryPersistStorage} from './services/persist';

// PWA auto update registration (virtual module provided by vite-plugin-pwa)
import {registerSW} from 'virtual:pwa-register';

registerSW({immediate: true});

void tryPersistStorage();
