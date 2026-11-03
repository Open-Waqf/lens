import {defineConfig} from '@playwright/test';

// Phone tests: Playwright drives the Lens Dev app on a USB phone, inside its real Android
// WebView (Chrome DevTools protocol over adb). No web server and no emulated browser.
// Run them with `npm run test:android` (it installs a fresh Lens Dev first).
export default defineConfig({
    testDir: './tests/device',
    fullyParallel: false,
    workers: 1, // one phone
    retries: 0,
    timeout: 120_000,
    reporter: [['list'], ['html', {open: 'never', outputFolder: 'playwright-report-device'}]],
});
