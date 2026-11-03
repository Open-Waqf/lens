// ocr-catch-up.spec.ts: a page left "pending" (app closed during OCR, an older backup, a
// rebuilt index) gets its text read at the next start. Before Nov 2026 it never did.
import fs from 'node:fs';
import {expect, test} from './support/test';

test('C.4 a page left pending is read at the next start @desktop', async ({page}) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('sahifah.storageBanner.dismissed', '1'));
    await page.goto('/#/library');
    const photo = fs.readFileSync('tests/fixtures/photos/french-invoice.jpg').toString('base64');
    await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const root = await navigator.storage.getDirectory!();
        const docs = await root.getDirectoryHandle('docs', {create: true});
        const d1 = await docs.getDirectoryHandle('d1', {create: true});
        for (const folder of ['pages', 'thumbs']) {
            const dir = await d1.getDirectoryHandle(folder, {create: true});
            const file = await dir.getFileHandle('p1.jpg', {create: true});
            const w = await file.createWritable();
            await w.write(bytes);
            await w.close();
        }
        const db = await new Promise<IDBDatabase>((resolve) => { const q = indexedDB.open('sahifah-lens'); q.onsuccess = () => resolve(q.result); });
        await new Promise<void>((resolve) => {
            const tx = db.transaction(['docs', 'pages'], 'readwrite');
            tx.objectStore('docs').put({id: 'd1', title: 'Left pending', folder: null, tags: [], pageIds: ['p1'], createdAt: 1, updatedAt: 1, autoTitle: true});
            // width and height 0: as the index rebuild leaves them
            tx.objectStore('pages').put({id: 'p1', docId: 'd1', imagePath: 'docs/d1/pages/p1.jpg', thumbPath: 'docs/d1/thumbs/p1.jpg', width: 0, height: 0, rotation: 0, createdAt: 1, ocrStatus: 'pending'});
            tx.oncomplete = () => resolve();
        });
        db.close();
    }, photo);
    await page.reload();
    await page.goto('/#/doc/d1');
    await page.getByTestId('btn-text').click();
    await expect(page.getByTestId('ocr-reading')).toBeHidden({timeout: 120_000});
    await expect(page.getByTestId('text-panel')).toContainText(/Facture/, {timeout: 10_000});
    await expect(page.locator('doc-page input').first()).toHaveValue(/^Facture/); // named from its text too
});
