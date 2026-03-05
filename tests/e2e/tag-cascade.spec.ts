import {expect, test} from '@playwright/test';

async function readDocTags(page: import('@playwright/test').Page, docId: string): Promise<string[]> {
    return await page.evaluate(async (id) => {
        const req = indexedDB.open('sahifah-lens');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            req.onerror = () => reject(req.error ?? new Error('DB open failed'));
            req.onsuccess = () => resolve(req.result);
        });
        const tags = await new Promise<string[]>((resolve, reject) => {
            const tx = db.transaction(['docs'], 'readonly');
            const r = tx.objectStore('docs').get(id);
            r.onsuccess = () => resolve((r.result?.tags ?? []) as string[]);
            r.onerror = () => reject(r.error ?? new Error('Doc read failed'));
        });
        db.close();
        return tags;
    }, docId);
}

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        (window as any).navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    });
    await page.goto('http://localhost:4173/#/library');
});

test('tag delete cascades across document metadata (AC-6.3)', async ({page}) => {
    const now = Date.now();
    const docA = 'doc_tag_a';
    const docB = 'doc_tag_b';

    await page.evaluate(async ({now, docA, docB}) => {
        const req = indexedDB.open('sahifah-lens');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            req.onerror = () => reject(req.error ?? new Error('DB open failed'));
            req.onsuccess = () => resolve(req.result);
        });
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['docs'], 'readwrite');
            const store = tx.objectStore('docs');
            store.put({
                id: docA,
                title: 'Tag Cascade A',
                folder: null,
                tags: ['amanah', 'qa'],
                notes: '',
                searchIndex: '',
                pageIds: [],
                createdAt: now - 10,
                updatedAt: now - 10
            });
            store.put({
                id: docB,
                title: 'Tag Cascade B',
                folder: null,
                tags: ['amanah', 'ops'],
                notes: '',
                searchIndex: '',
                pageIds: [],
                createdAt: now - 5,
                updatedAt: now - 5
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('Seed tx failed'));
        });
        db.close();
    }, {now, docA, docB});

    await page.reload();
    const deleteTagBtn = page.getByRole('button', {name: /^Delete tag: amanah$/});
    await expect(deleteTagBtn).toBeVisible({timeout: 10000});
    await deleteTagBtn.click();
    await page.getByRole('button', {name: 'Delete Tag', exact: true}).click();
    await expect(page.getByText('Tag "amanah" removed from 2 document(s).')).toBeVisible({timeout: 10000});
    await expect(deleteTagBtn).toHaveCount(0);

    await expect.poll(async () => await readDocTags(page, docA)).toEqual(['qa']);
    await expect.poll(async () => await readDocTags(page, docB)).toEqual(['ops']);
});
