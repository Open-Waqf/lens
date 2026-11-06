import {defineConfig} from '@playwright/test';

// The Google Play pictures: `npm run play:screenshots` (see tests/store/play-screenshots.spec.ts).
// The production build in dist/ is served by vite preview on its own port, and each
// language is a project at a phone size of 360 x 720 CSS pixels drawn at 3x: 1080 x 2160.
const PORT = 5177;
const phone = {viewport: {width: 360, height: 720}, deviceScaleFactor: 3, isMobile: true, hasTouch: true};

export default defineConfig({
    testDir: './tests/store',
    workers: 1,
    retries: 0,
    reporter: [['list']],
    timeout: 240_000,
    use: {baseURL: `http://localhost:${PORT}`, ...phone},
    webServer: {
        command: `npx vite preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 60_000,
    },
    projects: [
        {name: 'en', use: {locale: 'en-US'}},
        {name: 'ar', use: {locale: 'ar'}},
    ],
});
