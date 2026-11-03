// lens.spec.ts: the main flows on a real phone. Run with `npm run test:android`.
// Only what a real phone can show: Playwright on the computer covers the rest (npm run check).
import path from 'node:path';
import {adb, APP_ID, appMemoryMb, closeShareSheet, expect, importPhoto, pressPhoneBack, screenTexts, test, topActivity, waitForOcr} from './phone';

const PHOTOS = path.resolve('tests/fixtures/photos');

test('P.1 Quick Scan opens the Google document scanner, and Back returns to Lens', async ({app: {page}}) => {
    await page.evaluate(() => { location.hash = '#/scan?new=1'; });
    await page.getByRole('button', {name: 'Start Scanner'}).click();
    await expect.poll(topActivity, {timeout: 15_000}).toContain('mlkit.docscan');
    pressPhoneBack();
    await expect.poll(topActivity).toContain(APP_ID);
    await expect(page.getByRole('button', {name: 'Start Scanner'})).toBeVisible();
});

test('P.2 A French page: save, then OCR reads it on the phone', async ({app: {page}}) => {
    await importPhoto(page, path.join(PHOTOS, 'french-invoice.jpg'));
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await expect(page.locator('page-editor')).toBeHidden({timeout: 30_000});
    const ocr = await waitForOcr(page);
    expect(ocr?.status).toBe('done');
    expect(ocr?.text).toContain('Facture');
    expect(ocr?.text).toContain('Paris');
    // Every word keeps its own position (PDF text layer, "Show OCR" boxes): not one block.
    expect(ocr!.words).toBeGreaterThan(40);
    expect(ocr!.distinctBoxes).toBe(ocr!.words);
    expect(appMemoryMb()).toBeLessThan(400);
});

test('P.3 An Arabic page: OCR reads Arabic on the phone', async ({app: {page}}) => {
    await importPhoto(page, path.join(PHOTOS, 'arabic-clean.jpg'));
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await expect(page.locator('page-editor')).toBeHidden({timeout: 30_000});
    const ocr = await waitForOcr(page);
    expect(ocr?.status).toBe('done');
    expect(ocr?.text).toContain('بسم الله الرحمن الرحيم');
    expect(ocr!.words).toBeGreaterThan(40);
    expect(ocr!.distinctBoxes).toBe(ocr!.words);
});

test('P.4 Export PDF opens the Android share sheet with the PDF', async ({app: {page}}) => {
    await importPhoto(page, path.join(PHOTOS, 'french-invoice.jpg'));
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await page.getByTestId('btn-done').click();
    await page.getByTestId('btn-share-pdf').click();
    await expect.poll(topActivity, {timeout: 20_000}).toContain('intentresolver');
    const texts = screenTexts();
    expect(texts.some((t) => t.endsWith('.pdf'))).toBe(true);
    // The family path: if Signer Dev is installed, it is offered for the PDF.
    if (adb('shell', 'pm', 'list', 'packages', 'org.openwaqf.signer.dev').includes('signer.dev')) {
        expect(texts).toContain('Signer Dev');
    }
    await closeShareSheet();
});

test('P.5 A very large photo (48 MP) opens and saves without the app dying', async ({app: {page}}) => {
    await importPhoto(page, path.join(PHOTOS, 'huge-6000x8000.jpg'));
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await expect(page.locator('page-editor')).toBeHidden({timeout: 90_000});
    expect(adb('shell', 'pidof', APP_ID).trim()).not.toBe('');
});

test('P.6 Backup made on the phone restores on the phone with the same password', async ({app: {page}}) => {
    await importPhoto(page, path.join(PHOTOS, 'french-invoice.jpg'));
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await expect(page.locator('page-editor')).toBeHidden({timeout: 30_000});
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.getByRole('button', {name: /Export Backup/}).click();
    await page.getByPlaceholder('Password123').fill('test-1234');
    await page.getByRole('button', {name: 'Export', exact: true}).click();
    await expect.poll(topActivity, {timeout: 30_000}).toContain('intentresolver');
    // Read the exported file from the app's private storage before the share sheet closes.
    const name = adb('shell', 'run-as', APP_ID, 'ls', 'files/exports').trim().split(/\s+/)[0];
    expect(name).toMatch(/\.slbk$/);
    const base64 = adb('shell', 'run-as', APP_ID, 'base64', '-w', '0', `files/exports/${name}`).trim();
    await closeShareSheet();
    // Closing the share sheet deletes the temporary copies (checked on the phone, Nov 2026).
    await expect.poll(() => adb('shell', 'run-as', APP_ID, 'ls', 'cache/share', 'files/exports').trim().split(/\s+/).filter((l) => /\.(pdf|slbk)$/.test(l))).toEqual([]);

    // Restore it (through the app's restore code; the system picker cannot be scripted).
    await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        (window as any).__restoreFile = new File([bytes], 'backup.slbk', {type: 'application/octet-stream'});
    }, base64);
    const restore = page.evaluate(() => (document.querySelector('settings-page') as any).importBackup((window as any).__restoreFile));
    await page.getByPlaceholder(/password/i).last().fill('test-1234');
    await page.getByRole('button', {name: 'Restore', exact: true}).click();
    await page.getByRole('button', {name: 'Replace my library'}).click({timeout: 30_000});
    await restore;
    await expect(page.getByText('Restore complete', {exact: false})).toBeVisible();
    const pages = await page.evaluate(() => new Promise<number>((resolve) => {
        const req = indexedDB.open('sahifah-lens');
        req.onsuccess = () => { const c = req.result.transaction(['pages']).objectStore('pages').count(); c.onsuccess = () => resolve(c.result); };
    }));
    expect(pages).toBe(1);
});
