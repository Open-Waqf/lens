import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig({
    build: {
        outDir: 'dist',
        sourcemap: false,
        chunkSizeWarningLimit: 1000, // Increase warning limit to 1MB (optional but cleaner logs)
    },
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
                maximumFileSizeToCacheInBytes: 6000000,
                globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,wasm}']
            }
        })
    ]
});
