// old-data-kept.spec.ts: features trimmed in Nov 2026 (tags, notes) never lose what users saved.
import {expect, test} from './support/test';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('sahifah.welcomeSeen', '1'));
    await page.goto('/#/library');
    await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('sahifah-lens');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['docs'], 'readwrite');
            const now = Date.now();
            tx.objectStore('docs').put({
                id: 'doc_old', title: 'Lease 2024', folder: 'Home', tags: ['contract', 'rent'],
                notes: 'Signed with the landlord Amanah', pageIds: [], createdAt: now, updatedAt: now, searchIndex: '',
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    });
});

async function storedDoc(page: import('./support/test').Page) {
    return page.evaluate(() => new Promise<any>((resolve) => {
        const req = indexedDB.open('sahifah-lens');
        req.onsuccess = () => {
            const g = req.result.transaction(['docs']).objectStore('docs').get('doc_old');
            g.onsuccess = () => resolve(g.result);
        };
    }));
}

test('T.1 search still finds a document by its old notes and tags', async ({page}) => {
    await page.reload(); // the library read the database before the old document was added
    const search = page.getByPlaceholder(/Search docs/i);
    await search.fill('Amanah');
    await expect(page.locator('h3', {hasText: 'Lease 2024'})).toBeVisible();
    await search.fill('contract');
    await expect(page.locator('h3', {hasText: 'Lease 2024'})).toBeVisible();
});

test('T.2 editing a document keeps its old tags and notes', async ({page}) => {
    await page.goto('/#/doc/doc_old');
    const title = page.getByRole('textbox').first();
    await title.fill('Lease 2024 (signed)');
    await title.blur();
    await expect.poll(async () => (await storedDoc(page)).title).toBe('Lease 2024 (signed)');
    const doc = await storedDoc(page);
    expect(doc.tags).toEqual(['contract', 'rent']);
    expect(doc.notes).toBe('Signed with the landlord Amanah');
});
