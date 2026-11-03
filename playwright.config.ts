import {defineConfig, devices} from '@playwright/test';

// TEST_BUILD=1 (npm run test:build, and CI) tests the production build in dist/ through
// `vite preview`, so build-only bugs are caught before deploy. Default: the dev server.
const testBuild = !!process.env.TEST_BUILD;

// Tests always start their own fresh server on their own port, never one already running
// (Signer lesson: a dev server left running for hours served stale code and hid a broken
// dependency). Port 5175 leaves 5173 free for `npm run dev` and `npm run android:live`.
const PORT = 5175;

// Chrome's own background traffic (component updates, safe browsing...) would trip the
// network guard in tests/e2e/support/test.ts, so it is switched off.
const quietChrome = [
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-sync',
    '--metrics-recording-only',
];

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // At most 4 browsers at once locally (memory). One on CI.
    workers: process.env.CI ? 1 : 4,
    // List in the terminal; the HTML report is written but never opens by itself
    // (it would block `npm run check`). Open it with `npx playwright show-report`.
    reporter: [['list'], ['html', {open: 'never'}]],

    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'on-first-retry',
        permissions: ['clipboard-read', 'clipboard-write'],
        launchOptions: {args: quietChrome},
    },

    webServer: {
        command: testBuild ? `npx vite preview --port ${PORT} --strictPort` : `npx vite --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 120 * 1000,
    },

    // Three ways to run the same tests (tags in test titles choose who runs what):
    //   phone     every test on a phone screen (Pixel 5, touch), except @desktop and @rtl-only
    //   phone-ar  the @rtl and @rtl-only tests on a phone screen in Arabic (right-to-left)
    //   desktop   every test on a desktop screen, except @phone and @rtl-only
    // @perf tests (timing gates) run on desktop only: phone emulation timings mean nothing.
    // `npm run check` runs phone + phone-ar. GitHub runs all three.
    projects: [
        {
            name: 'phone',
            use: {...devices['Pixel 5'], locale: 'en-US'},
            grepInvert: /@desktop|@rtl-only|@perf/,
        },
        {
            name: 'phone-ar',
            use: {...devices['Pixel 5'], locale: 'ar'},
            grep: /@rtl/,
        },
        {
            name: 'desktop',
            use: {...devices['Desktop Chrome'], locale: 'en-US'},
            grepInvert: /@phone|@rtl-only/,
        },
    ],
});
