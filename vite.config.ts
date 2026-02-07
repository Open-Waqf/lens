import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig({
    // Good default for static hosting + Capacitor webview
    base: './',
    plugins: [
        tailwindcss(),
        VitePWA({
            strategies: 'generateSW',
            registerType: 'autoUpdate',
            manifest: {
                name: 'Sahifah Lens',
                short_name: 'Sahifah',
                description: 'Local-first document scanner + vault. No account, no ads.',
                theme_color: '#0b1220',
                background_color: '#0b1220',
                display: 'standalone',
                icons: [
                    {src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png'},
                    {src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png'}
                ]
            },
            workbox: {
                navigateFallback: 'index.html',
                globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}']
            }
        })
    ]
});
