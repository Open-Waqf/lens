// ocr-text-lines.spec.ts: OCR words become readable text again (lines, phrases).
import {expect, test} from './support/test';

const W = (text: string, x: number, y: number) => ({text, box: [x, y, 0.08, 0.02], confidence: 90});

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('sahifah.welcomeSeen', '1'));
    await page.goto('/#/library');
    await page.evaluate(async (words) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('sahifah-lens');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['docs', 'pages'], 'readwrite');
            const now = Date.now();
            tx.objectStore('docs').put({id: 'doc_lines', title: 'Invoice', folder: null, tags: [], pageIds: ['p_lines'], createdAt: now, updatedAt: now, searchIndex: ''});
            tx.objectStore('pages').put({id: 'p_lines', docId: 'doc_lines', imagePath: 'missing.jpg', thumbPath: 'missing_t.jpg', width: 100, height: 100, rotation: 0, createdAt: now, ocrStatus: 'done', words});
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }, [W('Facture', 0.1, 0.1), W('2026', 0.2, 0.1), W('12', 0.1, 0.2), W('rue', 0.2, 0.2), W('de', 0.3, 0.2), W('la', 0.4, 0.2), W('Paix', 0.5, 0.2)]);
});

test('O.1 extracted text keeps one line per printed line', async ({page}) => {
    await page.goto('/#/doc/doc_lines');
    await page.getByTestId('btn-text').click();
    await expect(page.getByText('Facture 2026', {exact: false})).toBeVisible();
    const shown = await page.locator('.whitespace-pre-wrap').first().innerText();
    expect(shown.trim()).toBe('Facture 2026\n12 rue de la Paix');
});

test('O.2 find in document matches a phrase that spans several words', async ({page}) => {
    await page.goto('/#/doc/doc_lines');
    await page.getByTestId('btn-text').click();
    await page.getByPlaceholder('Search text...').fill('rue de la');
    await expect(page.locator('[data-page-card-id]')).toHaveCount(1);
    await page.getByPlaceholder('Search text...').fill('nothing here');
    await expect(page.locator('[data-page-card-id]')).toHaveCount(0);
});
