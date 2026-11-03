// library-reload.spec.ts: the library updates in place when something changes (OCR done,
// a delete undone). Before Nov 2026 every reload flashed the placeholder skeleton, and a
// tap in that moment landed on nothing.
import {expect, test} from './support/test';

test('L.1 a library reload does not flash the skeleton over an existing list', async ({page}) => {
    await page.goto('/#/library');
    await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => { const q = indexedDB.open('sahifah-lens'); q.onsuccess = () => resolve(q.result); });
        await new Promise<void>((resolve) => {
            const tx = db.transaction(['docs'], 'readwrite');
            tx.objectStore('docs').put({id: 'r1', title: 'Reload me', folder: null, tags: [], pageIds: [], createdAt: 1, updatedAt: 1});
            tx.oncomplete = () => resolve();
        });
        db.close();
    });
    await page.reload();
    await expect(page.getByRole('heading', {name: 'Reload me'})).toBeVisible();
    const loadingAfterChange = await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('sahifah-library-changed'));
        return (document.querySelector('library-page') as any).loading;
    });
    expect(loadingAfterChange, 'the list stays while it reloads').toBe(false);
    await expect(page.getByRole('heading', {name: 'Reload me'})).toBeVisible();
});
