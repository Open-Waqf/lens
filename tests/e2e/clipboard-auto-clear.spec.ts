import {expect, test} from '@playwright/test';

async function seedDocWithOcr(page: import('@playwright/test').Page): Promise<void> {
    await page.evaluate(async () => {
        const req = indexedDB.open('sahifah-lens');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            req.onerror = () => reject(req.error ?? new Error('DB open failed'));
            req.onsuccess = () => resolve(req.result);
        });

        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['docs', 'pages'], 'readwrite');
            tx.objectStore('docs').put({
                id: 'doc-clip-1',
                title: 'Clipboard Doc',
                folder: null,
                tags: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                pageIds: ['page-clip-1'],
            });
            tx.objectStore('pages').put({
                id: 'page-clip-1',
                docId: 'doc-clip-1',
                imagePath: 'docs/doc-clip-1/pages/page-clip-1.jpg',
                thumbPath: 'docs/doc-clip-1/thumbs/page-clip-1.jpg',
                width: 1000,
                height: 1000,
                rotation: 0,
                createdAt: Date.now(),
                words: [{text: 'Sample OCR text'}],
                ocrStatus: 'done',
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Seed transaction failed'));
        });
        db.close();
    });
}

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).__sahifahClipboardClearDelayMs = 100;
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
});

test('clipboard auto-clear removes copied OCR text when enabled', async ({page}) => {
    await page.goto('http://localhost:4173/#/settings');
    await page.getByRole('button', {name: 'Clipboard Auto-Clear'}).click();

    await seedDocWithOcr(page);
    await page.goto('http://localhost:4173/#/doc/doc-clip-1');
    await page.getByRole('button', {name: 'Show Extracted Text'}).click();
    await page.getByRole('button', {name: 'Copy OCR Text'}).click();

    await expect.poll(async () => page.evaluate(async () => navigator.clipboard.readText())).toContain('Sample OCR text');
    await page.waitForTimeout(200);
    await expect.poll(async () => page.evaluate(async () => navigator.clipboard.readText())).toBe('');
});

test('clipboard auto-clear keeps copied OCR text when disabled', async ({page}) => {
    await page.goto('http://localhost:4173/#/settings');
    await seedDocWithOcr(page);
    await page.goto('http://localhost:4173/#/doc/doc-clip-1');
    await page.getByRole('button', {name: 'Show Extracted Text'}).click();
    await page.getByRole('button', {name: 'Copy OCR Text'}).click();

    await expect.poll(async () => page.evaluate(async () => navigator.clipboard.readText())).toContain('Sample OCR text');
    await page.waitForTimeout(250);
    await expect.poll(async () => page.evaluate(async () => navigator.clipboard.readText())).toContain('Sample OCR text');
});
