import {expect, test} from '@playwright/test';

async function readDoc(page: import('@playwright/test').Page, docId: string): Promise<{ correctedOcrText?: string; searchIndex?: string }> {
    return await page.evaluate(async (id) => {
        const req = indexedDB.open('sahifah-lens');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            req.onerror = () => reject(req.error ?? new Error('DB open failed'));
            req.onsuccess = () => resolve(req.result);
        });
        const doc = await new Promise<any>((resolve, reject) => {
            const tx = db.transaction(['docs'], 'readonly');
            const r = tx.objectStore('docs').get(id);
            r.onsuccess = () => resolve(r.result || {});
            r.onerror = () => reject(r.error ?? new Error('Doc read failed'));
        });
        db.close();
        return {correctedOcrText: doc.correctedOcrText, searchIndex: doc.searchIndex};
    }, docId);
}

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('http://localhost:4173/#/library');
});

test('manual OCR correction saves corrected text and updates search index', async ({page}) => {
    const now = Date.now();
    const docId = 'doc_manual_ocr';

    await page.evaluate(async ({now, docId}) => {
        const req = indexedDB.open('sahifah-lens');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            req.onerror = () => reject(req.error ?? new Error('DB open failed'));
            req.onsuccess = () => resolve(req.result);
        });
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['docs', 'pages'], 'readwrite');
            tx.objectStore('docs').put({
                id: docId,
                title: 'Manual OCR Doc',
                folder: null,
                tags: [],
                notes: '',
                searchIndex: 'auto text',
                pageIds: ['page_manual_1'],
                createdAt: now - 10,
                updatedAt: now - 10
            });
            tx.objectStore('pages').put({
                id: 'page_manual_1',
                docId,
                imagePath: 'missing.jpg',
                thumbPath: 'missing_thumb.jpg',
                width: 100,
                height: 100,
                rotation: 0,
                createdAt: now - 10,
                words: [{text: 'auto', box: [0.1, 0.1, 0.1, 0.1], confidence: 90}]
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Seed tx failed'));
        });
        db.close();
    }, {now, docId});

    await page.goto(`http://localhost:4173/#/doc/${docId}`);
    await page.getByRole('button', {name: 'Show Extracted Text'}).click();
    await page.getByRole('button', {name: 'Edit OCR Text'}).click();
    const editor = page.getByPlaceholder('Type corrected OCR text...');
    await editor.fill('verified arabic correction');
    await page.getByRole('button', {name: 'Save OCR Text'}).click();

    await expect(page.getByText('Corrected OCR text saved.')).toBeVisible({timeout: 5000});
    await expect.poll(async () => await readDoc(page, docId)).toMatchObject({
        correctedOcrText: 'verified arabic correction',
        searchIndex: 'verified arabic correction'
    });
});
