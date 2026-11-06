// deep-dive-fixes.spec.ts: the Opus fixes from the Nov 2026 core deep dive.
import fs from 'node:fs';
import {expect, test} from './support/test';

const PHOTO = 'tests/fixtures/photos/french-invoice.jpg';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        localStorage.setItem('sahifah.welcomeSeen', '1');
        localStorage.setItem('sahifah.storageBanner.dismissed', '1');
    });
});

async function seed(page: import('./support/test').Page, docs: object[], pages: object[]) {
    await page.goto('/#/library');
    await page.evaluate(async ([docs, pages]) => {
        const db = await new Promise<IDBDatabase>((resolve) => { const q = indexedDB.open('sahifah-lens'); q.onsuccess = () => resolve(q.result); });
        await new Promise<void>((resolve) => {
            const tx = db.transaction(['docs', 'pages'], 'readwrite');
            for (const d of docs) tx.objectStore('docs').put(d);
            for (const p of pages) tx.objectStore('pages').put(p);
            tx.oncomplete = () => resolve();
        });
        db.close();
    }, [docs, pages]);
}

async function importPhotos(page: import('./support/test').Page, count: number) {
    await page.goto('/#/scan?new=1');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('button').filter({hasText: /Import/i}).click();
    const buffer = fs.readFileSync(PHOTO);
    await (await chooser).setFiles(Array.from({length: count}, (_, i) => ({name: `p${i + 1}.jpg`, mimeType: 'image/jpeg', buffer})));
    await expect(page.locator('page-editor')).toBeVisible({timeout: 15_000});
}

test('D.1 a failed promise in the background shows a short message, not the crash screen', async ({page}) => {
    await page.goto('/#/library');
    await expect(page.getByRole('heading', {name: 'Library'})).toBeVisible();
    await page.evaluate(() => { void Promise.reject(new Error('a plugin call failed')); });
    await expect(page.getByText('Something did not work. Your documents are safe.')).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(page.getByRole('heading', {name: 'Library'})).toBeVisible();
});

test('D.2 a page whose text could not be read says so, with Try again, not "No text"', async ({page}) => {
    await seed(page,
        [{id: 'e1', title: 'Unreadable', folder: null, tags: [], pageIds: ['ep1'], createdAt: 1, updatedAt: 1}],
        [{id: 'ep1', docId: 'e1', imagePath: 'x.jpg', thumbPath: 'x_t.jpg', width: 10, height: 10, rotation: 0, createdAt: 1, ocrStatus: 'error'}]);
    await page.goto('/#/doc/e1');
    await page.getByTestId('btn-text').click();
    await expect(page.getByTestId('ocr-failed')).toBeVisible();
    await expect(page.getByTestId('ocr-failed').getByRole('button', {name: 'Try again'})).toBeVisible();
    await expect(page.getByText('No text detected')).toHaveCount(0);
});

test('D.3 Settings has no OCR on/off switch (every page is read anyway)', async ({page}) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('switch', {name: 'App Lock'})).toBeVisible();
    await expect(page.getByRole('switch', {name: /Text Recognition/})).toHaveCount(0);
    await expect(page.getByText('OCR language', {exact: false})).toBeVisible();
});

test('D.4 the web import accepts photos only', async ({page}) => {
    await page.goto('/#/scan?new=1');
    await expect(page.locator('#import-input')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
});

test('D.5 Share as PDF right after removing a page leaves that page out, while its Undo is open @desktop', async ({page}) => {
    test.setTimeout(120_000);
    await importPhotos(page, 2);
    for (let i = 0; i < 2; i++) {
        await expect(page.getByTestId('editor-loading')).toBeHidden({timeout: 30_000});
        await page.getByRole('button', {name: 'Save Scan'}).click();
        if (i === 0) await expect(page.locator('page-editor')).toContainText(/2 of 2|2\s*\/\s*2/, {timeout: 30_000});
    }
    await expect(page.locator('page-editor')).toBeHidden({timeout: 30_000}); // the second save is done
    await expect(page.getByTestId('scan-strip').getByRole('button', {name: 'Edit page'})).toHaveCount(2, {timeout: 15_000});
    await page.getByRole('button', {name: 'Remove page'}).first().click();
    await expect(page.getByTestId('scan-strip').getByRole('button', {name: 'Edit page'})).toHaveCount(1);
    const download = page.waitForEvent('download');
    await page.getByTestId('btn-share-pdf').click();
    const file = await (await download).path();
    const {PDFDocument} = await import('pdf-lib');
    const pdf = await PDFDocument.load(fs.readFileSync(file!));
    expect(pdf.getPageCount()).toBe(1);
});

test('D.6 when the image worker dies during Save, the editor says so and Save works again', async ({page}) => {
    await page.addInitScript(() => {
        const orig = Worker.prototype.postMessage;
        let crashed = false;
        Worker.prototype.postMessage = function (msg: any, ...rest: any[]) {
            if (!crashed && msg && typeof msg.id === 'string' && msg.id.startsWith('save')) {
                crashed = true;
                setTimeout(() => this.dispatchEvent(new ErrorEvent('error', {message: 'out of memory'})), 50);
                return;
            }
            return (orig as any).call(this, msg, ...rest);
        };
    });
    await importPhotos(page, 1);
    await expect(page.getByTestId('editor-loading')).toBeHidden({timeout: 30_000});
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await expect(page.getByText(/could not be processed/)).toBeVisible({timeout: 10_000});
    await expect(page.getByRole('button', {name: 'Save Scan'})).toBeEnabled();
    await page.getByRole('button', {name: 'Save Scan'}).click(); // a fresh worker this time
    await expect(page.locator('page-editor')).toBeHidden({timeout: 30_000});
});

test('D.7 the document page lists folders without loading every document', async ({page}) => {
    await seed(page,
        [{id: 'f1', title: 'In a folder', folder: 'Taxes', tags: [], pageIds: [], createdAt: 1, updatedAt: 1},
         {id: 'f2', title: 'Other', folder: 'Work', tags: [], pageIds: [], createdAt: 1, updatedAt: 1}],
        []);
    await page.evaluate(() => {
        (window as any).__docScans = 0;
        const count = (orig: any) => function (this: IDBObjectStore, ...args: any[]) {
            if (this.name === 'docs') (window as any).__docScans++;
            return orig.apply(this, args);
        };
        IDBObjectStore.prototype.getAll = count(IDBObjectStore.prototype.getAll);
        IDBObjectStore.prototype.openCursor = count(IDBObjectStore.prototype.openCursor);
    });
    await page.evaluate(() => { location.hash = '#/doc/f1'; });
    await expect(page.locator('doc-page input').first()).toHaveValue('In a folder');
    expect(await page.evaluate(() => (window as any).__docScans), 'full scans of the documents table').toBe(0);
    expect(await page.evaluate(() => (document.querySelector('doc-page') as any).folderSuggestions)).toEqual(['Taxes', 'Work']);
});

test('D.8 a name being typed is not reset when the page reloads (OCR finished meanwhile)', async ({page}) => {
    await seed(page, [{id: 't1', title: 'Scan Nov 3', folder: null, tags: [], pageIds: [], createdAt: 1, updatedAt: 1, autoTitle: true}], []);
    await page.goto('/#/doc/t1');
    const title = page.locator('doc-page input').first();
    await expect(title).toHaveValue('Scan Nov 3');
    await title.fill('My lease');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('sahifah-library-changed'))); // the reload OCR causes
    await page.waitForTimeout(300);
    await expect(title).toHaveValue('My lease');
    await title.blur();
    await expect.poll(() => page.evaluate(() => new Promise((resolve) => {
        const q = indexedDB.open('sahifah-lens');
        q.onsuccess = () => { const r = q.result.transaction(['docs']).objectStore('docs').get('t1'); r.onsuccess = () => { q.result.close(); resolve([r.result.title, r.result.autoTitle]); }; };
    }))).toEqual(['My lease', false]);
});

test('D.9 renaming does not write back old search text that OCR replaced meanwhile', async ({page}) => {
    await seed(page, [{id: 's1', title: 'Old', folder: null, tags: [], pageIds: [], createdAt: 1, updatedAt: 1, searchIndex: 'before ocr'}], []);
    await page.goto('/#/doc/s1');
    const title = page.locator('doc-page input').first();
    await expect(title).toHaveValue('Old');
    await page.evaluate(() => new Promise<void>((resolve) => { // OCR saves new text in the background
        const q = indexedDB.open('sahifah-lens');
        q.onsuccess = () => { const tx = q.result.transaction(['docs'], 'readwrite'); const s = tx.objectStore('docs'); const g = s.get('s1'); g.onsuccess = () => s.put({...g.result, searchIndex: 'after ocr'}); tx.oncomplete = () => { q.result.close(); resolve(); }; };
    }));
    await title.fill('New');
    await title.blur();
    await expect.poll(() => page.evaluate(() => new Promise((resolve) => {
        const q = indexedDB.open('sahifah-lens');
        q.onsuccess = () => { const r = q.result.transaction(['docs']).objectStore('docs').get('s1'); r.onsuccess = () => { q.result.close(); resolve([r.result.title, r.result.searchIndex]); }; };
    }))).toEqual(['New', 'after ocr']);
});

test('D.10 a French name in the Arabic app follows its own direction @rtl-only', async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('sahifah.locale', 'ar'));
    await seed(page, [{id: 'fr1', title: 'Facture n° 2026-1103. Société Exemple SARL, 12 rue de la Liberté', folder: null, tags: [], pageIds: [], createdAt: 1, updatedAt: 1}], []);
    await page.reload();
    const h3 = page.locator('library-page h3').first();
    await expect(h3).toContainText('Facture');
    expect(await h3.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
    await page.goto('/#/doc/fr1');
    const title = page.locator('doc-page input').first();
    await expect(title).toHaveValue(/^Facture/);
    expect(await title.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
});
