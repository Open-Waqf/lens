import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {VitePWA} from 'vite-plugin-pwa';
import progress from 'vite-plugin-progress';
import {visualizer} from 'rollup-plugin-visualizer';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
    build: {
        outDir: 'dist',
        sourcemap: false,
        chunkSizeWarningLimit: 1000,
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true,
                drop_debugger: true,
            },
            format: {
                comments: false,
            },
        },
    },
    base: './',
    plugins: [
        tailwindcss(),
        VitePWA({
            strategies: 'generateSW',
            registerType: 'autoUpdate',
            filename: 'sw.js',
            manifestFilename: 'manifest.json',
            manifest: {
                name: 'Sahifah Lens',
                short_name: 'Lens',
                description: 'Local-first document scanner. No account, no ads.',
                theme_color: '#0F172A',
                background_color: '#0F172A',
                display: 'standalone',
                orientation: 'portrait',
                icons: [
                    {
                        src: 'icons/icon-192.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'icons/icon-512.png',
                        sizes: '512x512',
                        type: 'image/png'
                    },
                    {
                        src: 'icons/icon-512-maskable.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable'
                    }
                ]
            },
            workbox: {
                navigateFallback: 'index.html',
                maximumFileSizeToCacheInBytes: 6000000,
                globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,wasm}'],
                globIgnores: ['**/tesseract/**'],
                runtimeCaching: [{
                    urlPattern: ({url}) => url.pathname.includes('/tesseract/'),
                    handler: 'CacheFirst',
                    options: {
                        cacheName: 'ocr-cache-v1',
                        expiration: {
                            maxEntries: 10,
                            maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                        },
                        cacheableResponse: {
                            statuses: [0, 200]
                        }
                    }
                }]
            }
        }),
        progress(),
        viteCompression(),
        visualizer({
            open: false,
            filename: 'dist/stats.html',
            gzipSize: true,
            brotliSize: true
        }),
    ]
});