// android.spec.ts: the app's Android logic, run in Playwright with a fake Android bridge
// (tests/e2e/support/native-fake.ts). Phone screen only (@phone).
import path from 'node:path';
import {expect, test} from './support/test';
import {enableAppLock, fakeAndroid, nativeCalls, nativeFiles, pressBack} from './support/native-fake';

const PAGE1 = path.resolve('tests/test-images/page1.jpg');

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('sahifah.welcomeSeen', '1'));
});

async function scanOnePage(page: import('./support/test').Page) {
    await page.goto('/#/scan?new=1');
    await page.getByRole('button', {name: 'Start Scanner'}).click();
    await expect(page.locator('page-editor')).toBeVisible();
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await expect(page.locator('page-editor')).toBeHidden();
}

test.describe('A. Android app (fake Android bridge) @phone', () => {
    test('A.1 Quick Scan is the default on Android and opens the scanned page in the editor', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1]});
        await page.goto('/#/scan?new=1');
        expect(await page.evaluate(() => (window as any).Capacitor.getPlatform())).toBe('android');
        await page.getByRole('button', {name: 'Start Scanner'}).click();
        await expect(page.locator('page-editor')).toBeVisible();
        const scan = (await nativeCalls(page, 'DocumentScanner'))[0];
        expect(scan.method).toBe('scanDocument');
    });

    test('A.2 Cancelling the scanner goes back quietly, with no error', async ({page}) => {
        await fakeAndroid(page, {scan: []});
        await page.goto('/#/scan?new=1');
        await page.getByRole('button', {name: 'Start Scanner'}).click();
        await expect(page.getByRole('button', {name: 'Start Scanner'})).toBeVisible();
        await expect(page.getByText(/failed/i)).toHaveCount(0);
    });

    test('A.3 Saving a scan writes the page and its thumbnail into the app\'s own storage', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1]});
        await scanOnePage(page);
        const stored = await nativeFiles(page);
        expect(stored.filter((f) => /^DATA\/docs\/[^/]+\/pages\/[^/]+\.jpg$/.test(f))).toHaveLength(1);
        expect(stored.filter((f) => /^DATA\/docs\/[^/]+\/thumbs\/[^/]+\.jpg$/.test(f))).toHaveLength(1);
        // Never in shared storage (Documents, Pictures): pages are private to the app.
        expect(stored.every((f) => f.startsWith('DATA/'))).toBe(true);
    });

    test('A.4 Export PDF hands one PDF to the share sheet and deletes the temporary copy after', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1]});
        await scanOnePage(page);
        await page.getByRole('button', {name: 'Open'}).click();
        await page.getByRole('button', {name: 'Export PDF'}).click();
        await expect.poll(async () => (await nativeCalls(page, 'Share')).length).toBe(1);
        const share = (await nativeCalls(page, 'Share'))[0];
        expect(share.options.files).toHaveLength(1);
        // The file keeps the document's name: what the person receiving it sees.
        const title = await page.getByRole('textbox').first().inputValue();
        expect(decodeURIComponent(share.options.files[0].split('/').pop())).toBe(`${title.replace(/:/g, "-")}.pdf`); // ":" breaks Windows file names
        await expect.poll(async () => (await nativeFiles(page)).filter((f) => f.startsWith('CACHE/'))).toEqual([]);
        // No hidden copy of every exported PDF stays inside the app (it was never used).
        expect((await nativeFiles(page)).filter((f) => f.endsWith('.pdf'))).toEqual([]);
    });

    test('A.5 Back on the scan screen goes to the library', async ({page}) => {
        await fakeAndroid(page);
        await page.goto('/#/scan?new=1');
        await expect(page.getByRole('button', {name: 'Start Scanner'})).toBeVisible();
        expect(await pressBack(page)).toBeGreaterThan(0);
        await expect(page).toHaveURL(/#\/library$/);
    });

    test('A.6 App lock: the fingerprint prompt opens at start, and a match shows the library', async ({page}) => {
        await enableAppLock(page);
        await fakeAndroid(page, {biometric: {succeed: true}});
        await page.goto('/#/library');
        await expect(page.getByRole('heading', {name: 'Library'})).toBeVisible();
        expect((await nativeCalls(page, 'NativeBiometric')).map((c) => c.method)).toContain('verifyIdentity');
    });

    test('A.7 App lock: a failed fingerprint keeps the library hidden', async ({page}) => {
        await enableAppLock(page);
        await fakeAndroid(page, {biometric: {succeed: false}});
        await page.goto('/#/library');
        await expect(page.getByRole('button', {name: 'Unlock'})).toBeVisible();
        await expect(page.locator('library-page')).toHaveCount(0);
    });

    test('A.8 Backup: export writes an encrypted file, shares it, and removes the temporary files', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1]});
        await scanOnePage(page);
        await page.goto('/#/settings');
        await page.getByRole('button', {name: /Export Backup/}).click();
        await page.getByPlaceholder('Password123').fill('test-1234');
        await page.getByRole('button', {name: 'Export', exact: true}).click();
        await expect.poll(async () => (await nativeCalls(page, 'Share')).length, {timeout: 20000}).toBe(1);
        const share = (await nativeCalls(page, 'Share'))[0];
        expect(share.options.files[0]).toMatch(/\.slbk$/);
        await expect.poll(async () => (await nativeFiles(page)).filter((f) => /^(CACHE\/|DATA\/exports\/)/.test(f))).toEqual([]);
    });

    test('A.9 An Arabic title stays Arabic in the shared file name', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1]});
        await scanOnePage(page);
        await page.getByRole('button', {name: 'Open'}).click();
        const title = page.getByRole('textbox').first();
        await title.fill('عقد الإيجار: نوفمبر');
        await title.blur();
        await page.getByRole('button', {name: 'Export PDF'}).click();
        await expect.poll(async () => (await nativeCalls(page, 'Share')).length).toBe(1);
        const file = decodeURIComponent((await nativeCalls(page, 'Share'))[0].options.files[0].split('/').pop());
        expect(file).toBe('عقد الإيجار- نوفمبر.pdf');
    });

    test('A.10 Leftover temporary copies are deleted at start, documents are kept', async ({page}) => {
        const bytes = Buffer.from('x').toString('base64');
        await fakeAndroid(page, {existingFiles: {
            'CACHE/share_1793703235098_Scan.pdf': bytes,             // old style
            'CACHE/share/1793703384180/lens-backup.slbk': bytes,     // new style
            'DATA/exports/backup_1793703378762.slbk': bytes,         // backup export work file
            'DATA/imports/temp_restore_1793703378762.zip': bytes,    // restore work file
            'DATA/docs/doc1/pages/p1.jpg': bytes,                    // a real document page
        }});
        await page.goto('/#/library');
        await expect.poll(() => nativeFiles(page)).toEqual(['DATA/docs/doc1/pages/p1.jpg']);
    });

    test('A.11 Screenshots are blocked only while App Lock is on', async ({page}) => {
        await fakeAndroid(page);
        await page.goto('/#/settings');
        await expect.poll(async () => (await nativeCalls(page, 'PrivacyScreen')).map((c) => c.options.enabled)).toEqual([false]);
        await page.getByRole('button', {name: 'App Lock'}).click();
        await expect.poll(async () => (await nativeCalls(page, 'PrivacyScreen')).map((c) => c.options.enabled)).toEqual([false, true]);
        await page.getByRole('button', {name: 'App Lock'}).click();
        await expect.poll(async () => (await nativeCalls(page, 'PrivacyScreen')).map((c) => c.options.enabled)).toEqual([false, true, false]);
    });

    test('A.12 With App Lock on, screenshots are blocked from the start', async ({page}) => {
        await enableAppLock(page);
        await fakeAndroid(page);
        await page.goto('/#/library');
        await expect.poll(async () => (await nativeCalls(page, 'PrivacyScreen')).map((c) => c.options.enabled)).toEqual([true]);
    });
});
