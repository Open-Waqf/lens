// phone.ts: connect Playwright to the Lens Dev app on a USB phone.
//
// Debug builds of a Capacitor app expose their WebView to Chrome DevTools. adb forwards
// that socket to this computer, and Playwright attaches to the app's real page. So these
// tests run the real app code in the real Android WebView, with the real Capacitor plugins.
// Native screens (the scanner, the share sheet) are read with `uiautomator` through adb.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {chromium, test as base, expect, type Browser, type Page} from '@playwright/test';

export {expect};
export const APP_ID = 'org.openwaqf.lens.dev';
const ACTIVITY = `${APP_ID}/org.openwaqf.lens.MainActivity`;
const CDP_PORT = 9333;

export function adb(...args: string[]): string {
    return execFileSync('adb', args, {encoding: 'utf8'});
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The activity in front, e.g. "com.android.intentresolver/.ChooserActivityLauncher". */
export function topActivity(): string {
    const out = adb('shell', 'dumpsys', 'activity', 'activities');
    return out.match(/topResumedActivity=ActivityRecord\{\S+ \S+ (\S+)/)?.[1] || '';
}

/** Texts on the phone screen right now (for native screens outside the WebView). */
export function screenTexts(): string[] {
    adb('shell', 'uiautomator', 'dump', '/sdcard/lens-ui.xml');
    const xml = adb('shell', 'cat', '/sdcard/lens-ui.xml');
    return [...xml.matchAll(/text="([^"]+)"/g)].map((m) => m[1]);
}

/** Tap a text on a native screen (share sheet...). */
export function tapScreenText(text: string) {
    adb('shell', 'uiautomator', 'dump', '/sdcard/lens-ui.xml');
    const xml = adb('shell', 'cat', '/sdcard/lens-ui.xml');
    const node = [...xml.matchAll(/<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].find((m) => m[1] === text);
    if (!node) throw new Error(`"${text}" is not on the phone screen`);
    const [x1, y1, x2, y2] = node.slice(2).map(Number);
    adb('shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)));
}

export const pressPhoneBack = () => adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');

/**
 * Close the Android share sheet and wait until Lens is in front again. A Back press while
 * the sheet is still loading its targets is ignored by Android, so press until it closes.
 */
export async function closeShareSheet() {
    for (let i = 0; i < 5; i++) {
        if (topActivity().includes(APP_ID)) return;
        pressPhoneBack();
        await sleep(1000);
    }
    throw new Error(`The share sheet did not close (in front: ${topActivity()})`);
}

/** App memory (PSS) in MB, as Android reports it. */
export function appMemoryMb(): number {
    const m = adb('shell', 'dumpsys', 'meminfo', APP_ID).match(/TOTAL PSS:\s+(\d+)/);
    return m ? Math.round(Number(m[1]) / 1024) : -1;
}

async function attach(): Promise<{browser: Browser; page: Page}> {
    for (let i = 0; i < 40; i++) {
        const pid = adb('shell', 'pidof', APP_ID).trim();
        if (pid) {
            try {
                execFileSync('adb', ['forward', `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
                const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
                const page = browser.contexts()[0]?.pages().find((p) => p.url().startsWith('https://localhost'));
                if (page) return {browser, page};
                await browser.close();
            } catch {
                // WebView not ready yet.
            }
        }
        await sleep(500);
    }
    throw new Error('Could not attach to Lens Dev. Is it installed, and is the phone unlocked?');
}

/**
 * Start Lens Dev with no data (like a fresh install), skip the welcome screen, attach.
 * Every test gets a clean app. `requests` lists every URL the page loaded.
 */
export const test = base.extend<{app: {page: Page; requests: string[]}}>({
    app: async ({}, use) => {
        adb('shell', 'pm', 'clear', APP_ID);
        adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
        adb('shell', 'am', 'start', '-W', '-n', ACTIVITY);
        const {browser, page} = await attach();
        const requests: string[] = [];
        page.on('request', (r) => requests.push(r.url()));
        await page.evaluate(() => {
            localStorage.setItem('sahifah.welcomeSeen', '1');
            localStorage.setItem('sahifah.locale', 'en');
            location.hash = '#/library';
            location.reload();
        });
        await page.waitForLoadState();
        await expect(page.getByRole('heading', {name: 'Library'})).toBeVisible({timeout: 20_000});
        await use({page, requests});
        // Every phone test also proves the privacy promise: nothing left the app.
        const outside = requests.filter((u) => !/^(https:\/\/localhost\/|blob:|data:|android-webview-video-poster:)/.test(u));
        expect(outside, 'The app reached outside the phone').toEqual([]);
        await browser.close().catch(() => {});
    },
});

/** Import a photo through the app's own import code (the system picker cannot be scripted). */
export async function importPhoto(page: Page, file: string) {
    await page.evaluate(() => { location.hash = '#/scan?new=1'; });
    await expect(page.locator('#import-input')).toBeAttached();
    await page.locator('#import-input').setInputFiles({
        name: file.split('/').pop()!, mimeType: 'image/jpeg', buffer: fs.readFileSync(file),
    });
    await page.evaluate(() => {
        const input = document.querySelector('#import-input') as HTMLInputElement;
        return (document.querySelector('scan-page') as any).openNewBlobInEditor(input.files![0]);
    });
    await expect(page.locator('page-editor')).toBeVisible();
    await editorSettled(page);
}

/**
 * Wait until the editor has drawn its preview and stayed idle for a moment. Save is
 * disabled while the editor works (edge detection, preview), and a tap in that moment
 * does nothing, the same as for a real user.
 */
export async function editorSettled(page: Page) {
    await expect.poll(() => page.evaluate(() => (document.querySelector('canvas[data-preview]') as HTMLCanvasElement | null)?.width || 0), {timeout: 30_000}).toBeGreaterThan(0);
    const save = page.getByRole('button', {name: 'Save Scan'});
    let steady = 0;
    for (let i = 0; i < 60 && steady < 4; i++) {
        steady = (await save.isEnabled()) ? steady + 1 : 0;
        await sleep(250);
    }
}

/** OCR text of the newest page, once OCR is done (null if it did not finish in time). */
export async function waitForOcr(page: Page, timeoutMs = 60_000): Promise<{status: string; text: string; words: number; distinctBoxes: number} | null> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        const last = await page.evaluate(() => new Promise<any>((resolve) => {
            const req = indexedDB.open('sahifah-lens');
            req.onsuccess = () => {
                const all = req.result.transaction(['pages']).objectStore('pages').getAll();
                all.onsuccess = () => {
                    const pages = (all.result as any[]).sort((a, b) => a.createdAt - b.createdAt);
                    const p = pages[pages.length - 1];
                    const words = (p?.words || []) as Array<{text: string; box: number[]}>;
                    resolve(p && {
                        status: p.ocrStatus,
                        text: words.map((w) => w.text).join(' '),
                        words: words.length,
                        distinctBoxes: new Set(words.map((w) => w.box.map((n) => n.toFixed(3)).join(','))).size,
                    });
                };
            };
        }));
        if (last && last.status !== 'pending') return last;
        await sleep(1000);
    }
    return null;
}
