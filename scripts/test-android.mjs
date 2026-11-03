#!/usr/bin/env node
/**
 * test-android.mjs: run the phone tests on your USB phone.
 *
 *   npm run test:android                 install a fresh Lens Dev build, then run all tests
 *   npm run test:android -- --no-install run the tests on the Lens Dev already installed
 *   npm run test:android -- -g "P.2"     run only matching tests (any Playwright option works)
 *
 * The tests drive Lens Dev (org.openwaqf.lens.dev) inside its real Android WebView with
 * Playwright, over USB. They never touch the Play Store app. Each test starts Lens Dev with
 * no data (`pm clear`), so anything in Lens Dev is erased: keep real documents in the
 * Play Store app. Unlock the phone first: the script checks, and keeps the screen on
 * (while charging over USB) until the tests end.
 *
 * Why not Maestro (Signer uses it): Lens blocks screenshots (FLAG_SECURE), so Maestro's
 * failure screenshots are black, and Maestro cannot feed a real photo into the import
 * path or read the database to prove OCR worked. Playwright in the real WebView can.
 */
import {spawnSync} from 'node:child_process';
import {ROOT, androidEnv, requireDevice} from './android-env.mjs';

const args = process.argv.slice(2);
const noInstall = args.includes('--no-install');
const pwArgs = args.filter((a) => a !== '--no-install');
const env = {...androidEnv(), PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE || 'ubuntu24.04-x64'};

if (!requireDevice(env)) {
    console.error('\n✖ The phone tests need a real phone over USB (an emulator has no Google scanner).');
    process.exit(1);
}
if (!noInstall) {
    console.log('▶ Installing a fresh Lens Dev build on the phone…');
    const r = spawnSync('node', ['scripts/run-android.mjs'], {stdio: 'inherit', cwd: ROOT, env});
    if (r.status !== 0) {
        console.error('\n✖ Could not install Lens Dev (see above), so the tests were not run.');
        process.exit(1);
    }
}
// A locked or sleeping phone makes every test time out after minutes with an unclear
// error. Check first: wake the screen, keep it on while charging over USB, and stop with
// a clear message if the lock screen is showing.
function phoneLocked() {
    const win = spawnSync('adb', ['shell', 'dumpsys', 'window'], {encoding: 'utf8', env}).stdout || '';
    return /isKeyguardShowing=true|mDreamingLockscreen=true/.test(win);
}
spawnSync('adb', ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], {env});
spawnSync('adb', ['shell', 'svc', 'power', 'stayon', 'usb'], {env});
if (phoneLocked()) {
    console.error('\n✖ The phone is locked. Unlock it (leave it on the home screen or in any app), then run again.');
    console.error('  The screen now stays on while the phone charges over USB, so it will not lock during the tests.');
    process.exit(1);
}
console.log('▶ Running the phone tests on Lens Dev (keep the phone unlocked)…');
const r = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.device.config.ts', ...pwArgs], {stdio: 'inherit', cwd: ROOT, env});
spawnSync('adb', ['shell', 'svc', 'power', 'stayon', 'false'], {env}); // back to normal
if (r.status !== 0) {
    if (phoneLocked()) console.error('\n✖ The phone locked during the tests. Unlock it and run again.');
    console.error('\n✖ Some phone tests failed (see above). `npx playwright show-report playwright-report-device` has details.');
    process.exit(1);
}
console.log('\n✓ All phone tests passed on the phone.');
