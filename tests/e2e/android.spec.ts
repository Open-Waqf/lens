// android.spec.ts: the app's Android logic, run in Playwright with a fake Android bridge
// (tests/e2e/support/native-fake.ts). Phone screen only (@phone).
import path from 'node:path';
import {expect, test} from './support/test';
import {enableAppLock, fakeAndroid, nativeCalls, nativeFiles, pressBack} from './support/native-fake';

const PAGE1 = path.resolve('tests/test-images/page1.jpg');

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('sahifah.welcomeSeen', '1'));
});

/** "+": Google's scanner opens by itself, and its page is saved straight away. */
async function scanOnePage(page: import('./support/test').Page) {
    await page.goto('/#/scan?new=1&scan=1');
    await expect(page.getByTestId('btn-share-pdf')).toBeVisible();
}

test.describe('A. Android app (fake Android bridge) @phone', () => {
    test('A.1 "+" opens Google\'s scanner at once, and its pages are saved without a second review', async ({page}) => {
        // Nov 2026: no Scan screen with one button before the scanner (E1), and no editor
        // after it (E2): the scanner already let the user crop and review.
        await fakeAndroid(page, {scan: [PAGE1, PAGE1]});
        await page.goto('/#/library');
        await page.locator('#MainScanBtn').click();
        await expect(page.getByTestId('btn-share-pdf')).toBeVisible();
        expect(await page.evaluate(() => (window as any).Capacitor.getPlatform())).toBe('android');
        expect((await nativeCalls(page, 'DocumentScanner')).map((c) => c.method)).toEqual(['scanDocument']);
        await expect(page.locator('page-editor')).toHaveCount(0);
        await expect(page.locator('[data-testid=scan-strip] img')).toHaveCount(2);
    });

    test('A.19 Opening the scan screen any other way does not start the camera', async ({page}) => {
        // Only "+" and "Add pages" (links with scan=1) open the scanner by themselves.
        await fakeAndroid(page, {scan: [PAGE1]});
        await page.goto('/#/scan?new=1');
        await expect(page.getByRole('button', {name: 'Start Scanner'})).toBeVisible();
        await page.waitForTimeout(300);
        expect(await nativeCalls(page, 'DocumentScanner')).toHaveLength(0);
    });

    test('A.2 Cancelling the scanner right after "+" goes back to the library, with no error', async ({page}) => {
        await fakeAndroid(page, {scan: []});
        await page.goto('/#/library');
        await page.locator('#MainScanBtn').click();
        await expect(page).toHaveURL(/#\/library$/);
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
        await page.getByTestId('btn-done').click();
        await page.getByTestId('btn-share-pdf').click();
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

    test('A.5 Back on the scan result screen goes to the library', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1]});
        await scanOnePage(page);
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
        await page.getByTestId('btn-done').click();
        const title = page.getByRole('textbox').first();
        await title.fill('عقد الإيجار: نوفمبر');
        await title.blur();
        await page.getByTestId('btn-share-pdf').click();
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
        await page.getByRole('switch', {name: 'App Lock'}).click();
        await expect.poll(async () => (await nativeCalls(page, 'PrivacyScreen')).map((c) => c.options.enabled)).toEqual([false, true]);
        await page.getByRole('switch', {name: 'App Lock'}).click();
        await expect.poll(async () => (await nativeCalls(page, 'PrivacyScreen')).map((c) => c.options.enabled)).toEqual([false, true, false]);
    });

    test('A.12 With App Lock on, screenshots are blocked from the start', async ({page}) => {
        await enableAppLock(page);
        await fakeAndroid(page);
        await page.goto('/#/library');
        await expect.poll(async () => (await nativeCalls(page, 'PrivacyScreen')).map((c) => c.options.enabled)).toEqual([true]);
    });

    test('A.13 A Quick Scan page is saved as the scanner made it: no upscaling, no sharpening', async ({page}) => {
        // Google's scanner already crops, straightens and cleans the page. Before Nov 2026
        // the editor still upscaled it to 1800 px and sharpened it ("archive" preset).
        await fakeAndroid(page, {scan: [PAGE1]}); // page1.jpg is 804 x 1038
        await scanOnePage(page);
        const saved = await page.evaluate(() => new Promise<any>((resolve) => {
            const req = indexedDB.open('sahifah-lens');
            req.onsuccess = () => { const all = req.result.transaction(['pages']).objectStore('pages').getAll(); all.onsuccess = () => resolve(all.result[0]); };
        }));
        expect([saved.width, saved.height]).toEqual([804, 1038]);
    });

    test('A.14 Sign with Signer hands the PDF straight to Signer when it is installed', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1], signer: true});
        await scanOnePage(page);
        await page.getByTestId('btn-done').click();
        await page.getByTestId('btn-more').click();
        await page.getByTestId('btn-sign').click();
        await expect.poll(async () => (await nativeCalls(page, 'SignerHandoff')).filter((c) => c.method === 'open').length).toBe(1);
        const open = (await nativeCalls(page, 'SignerHandoff')).find((c) => c.method === 'open')!;
        expect(open.options.path).toMatch(/^share\/\d+\/.+\.pdf$/);
        expect(await nativeCalls(page, 'Share')).toHaveLength(0); // no share sheet in between
    });

    test('A.15 Without Signer installed, there is no Sign with Signer item', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1], signer: false});
        await scanOnePage(page);
        await page.getByTestId('btn-done').click();
        await page.getByTestId('btn-more').click();
        await expect(page.getByTestId('btn-sign')).toHaveCount(0);
    });

    test('A.16 Deleting a document hides it at once, Undo brings it back, files stay', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1]});
        await scanOnePage(page);
        await page.getByTestId('btn-done').click();
        await page.getByTestId('btn-more').click();
        await page.getByRole('button', {name: 'Delete document'}).click();
        // No question first: gone from the library, with Undo in a toast.
        await expect(page).toHaveURL(/#\/library$/);
        await expect(page.getByText('No scans yet')).toBeVisible();
        await page.getByRole('button', {name: 'Undo'}).click();
        await expect(page.locator('library-page h3')).toHaveCount(1);
        await page.waitForTimeout(5500); // past the Undo time: nothing may be removed now
        expect((await nativeFiles(page)).filter((f) => f.startsWith('DATA/docs/'))).toHaveLength(2);
    });

    test('A.17 Without Undo, the document and its files are removed when the time runs out', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1]});
        await scanOnePage(page);
        await page.getByTestId('btn-done').click();
        await page.getByTestId('btn-more').click();
        await page.getByRole('button', {name: 'Delete document'}).click();
        await expect(page.getByText('No scans yet')).toBeVisible();
        await expect.poll(async () => (await nativeFiles(page)).filter((f) => f.startsWith('DATA/docs/')), {timeout: 10_000}).toEqual([]);
        const docs = await page.evaluate(() => new Promise<number>((resolve) => {
            const r = indexedDB.open('sahifah-lens');
            r.onsuccess = () => { const c = r.result.transaction(['docs']).objectStore('docs').count(); c.onsuccess = () => resolve(c.result); };
        }));
        expect(docs).toBe(0);
    });

    test('A.18 A delete cut short by closing the app is finished at the next start', async ({page}) => {
        await fakeAndroid(page, {scan: [PAGE1]});
        await scanOnePage(page);
        // Mark the document deleted (as the Undo delete does), then "close" the app at once.
        await page.evaluate(() => new Promise<void>((resolve) => {
            const r = indexedDB.open('sahifah-lens');
            r.onsuccess = () => {
                const tx = r.result.transaction(['docs'], 'readwrite');
                const store = tx.objectStore('docs');
                store.getAll().onsuccess = (e: any) => { for (const d of e.target.result) store.put({...d, deletedAt: Date.now()}); };
                tx.oncomplete = () => resolve();
            };
        }));
        // Start again on the library (on the scan screen Lens would open the scanner again).
        // The in-memory fake files are gone after a reload, so check the database.
        await page.goto('/#/library');
        await page.reload();
        await expect.poll(() => page.evaluate(() => new Promise<number>((resolve) => {
            const r = indexedDB.open('sahifah-lens');
            r.onsuccess = () => { const c = r.result.transaction(['docs']).objectStore('docs').count(); c.onsuccess = () => resolve(c.result); };
        }))).toBe(0);
    });
});
