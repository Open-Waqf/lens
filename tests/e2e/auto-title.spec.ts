// auto-title.spec.ts: a new document is named from the first words OCR reads (real OCR).
import {expect, test} from './support/test';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('sahifah.storageBanner.dismissed', '1'));
});

test('T.3 a scanned invoice gets its name from its text, not the date @desktop', async ({page}) => {
    test.setTimeout(120_000);
    await page.goto('/#/scan?new=1');
    await page.locator('#import-input').setInputFiles('tests/fixtures/photos/french-invoice.jpg');
    await page.evaluate(async () => {
        const input = document.querySelector('#import-input') as HTMLInputElement;
        await (document.querySelector('scan-page') as any).openNewBlobInEditor(input.files![0]);
    });
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await page.getByTestId('btn-done').click();
    await expect(page.locator('doc-page input').first()).toHaveValue(/^Facture/, {timeout: 60_000});
});

test('T.4 a name typed by the user is never replaced by the OCR name @desktop', async ({page}) => {
    test.setTimeout(120_000);
    await page.goto('/#/scan?new=1');
    await page.locator('#import-input').setInputFiles('tests/fixtures/photos/french-invoice.jpg');
    await page.evaluate(async () => {
        const input = document.querySelector('#import-input') as HTMLInputElement;
        await (document.querySelector('scan-page') as any).openNewBlobInEditor(input.files![0]);
    });
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await page.getByTestId('btn-done').click();
    const title = page.locator('doc-page input').first();
    await title.fill('My invoice');
    await title.blur();
    await page.getByTestId('btn-text').click();
    await expect(page.getByTestId('ocr-reading')).toBeHidden({timeout: 60_000}); // OCR done
    await expect(title).toHaveValue('My invoice');
});

test('U.2 while OCR runs, the text panel says it is reading, not "no text" @rtl', async ({page}) => {
    await page.goto('/#/library');
    await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => { const q = indexedDB.open('sahifah-lens'); q.onsuccess = () => resolve(q.result); });
        await new Promise<void>((resolve) => {
            const tx = db.transaction(['docs', 'pages'], 'readwrite');
            tx.objectStore('docs').put({id: 'ocr_doc', title: 'Pending', folder: null, tags: [], pageIds: ['ocr_p'], createdAt: 1, updatedAt: 1});
            tx.objectStore('pages').put({id: 'ocr_p', docId: 'ocr_doc', imagePath: 'x.jpg', thumbPath: 'x_t.jpg', width: 10, height: 10, rotation: 0, createdAt: 1, ocrStatus: 'pending'});
            tx.oncomplete = () => resolve();
        });
        db.close();
    });
    await page.goto('/#/doc/ocr_doc');
    await page.getByTestId('btn-text').click();
    await expect(page.getByTestId('ocr-reading')).toBeVisible();
    await expect(page.getByText(/No text|لا يوجد نص/)).toHaveCount(0);
});
