// play-screenshots.spec.ts: the Google Play pictures, from the real app, in every language.
//
//   npm run play:screenshots                 -> ~/Downloads/lens-review/play-store/screenshots/
//   PLAY_SHOTS=/some/folder npm run play:screenshots
//
// Five pictures per language (en, ar), 1080 x 2160, the Play Store's favourite size:
//   1-scan      the result right after "+": the scanned page, Share as PDF
//   2-text      a document with the text the app read, ready to copy
//   3-library   the library with a few documents in folders
//   4-crop      the editor in crop mode, the corners on the page
//   5-settings  App Lock, the OCR language, backup
//
// Nothing is faked: the app runs as on Android (the test bridge stands in for the phone),
// the pages are real photos from the test fixtures, and the names and the text are what
// OCR read from them. Arabic is taken right to left.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect, test} from '@playwright/test';
import {fakeAndroid} from '../e2e/support/native-fake';

const OUT = process.env.PLAY_SHOTS || path.join(os.homedir(), 'Downloads/lens-review/play-store/screenshots');
const PHOTOS = path.resolve('tests/fixtures/photos');
const photo = (name: string) => path.join(PHOTOS, name);
const b64 = (file: string) => fs.readFileSync(file).toString('base64');

// The library: three documents, two folders. Their names come from their own text.
const DOCS = [
    {id: 'inv', folder: {en: 'Invoices', ar: 'فواتير'}, pages: ['french-invoice.jpg'], typedName: {en: 'Internet bill, October', ar: 'فاتورة الإنترنت، أكتوبر'}},
    {id: 'lease', folder: {en: 'Home', ar: 'المنزل'}, pages: ['arabic-clean.jpg', 'arabic-dark-tilted.jpg']},
    {id: 'letter', folder: null, pages: ['english-dark-lowlight.jpg']},
];

test('Play Store screenshots', async ({page}, info) => {
    const lang = info.project.name as 'en' | 'ar';
    fs.mkdirSync(OUT, {recursive: true});
    const shot = async (n: number, name: string) => {
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        const file = path.join(OUT, `${lang}-${n}-${name}.png`);
        await page.screenshot({path: file});
        const b = fs.readFileSync(file);
        expect([b.readUInt32BE(16), b.readUInt32BE(20)], `${file} must be 1080 x 2160`).toEqual([1080, 2160]);
    };

    // The page files live in the app's private storage: the test bridge holds them.
    const existingFiles: Record<string, string> = {};
    const now = Date.now();
    const docs: object[] = [], pages: object[] = [];
    DOCS.forEach((d, di) => {
        const pageIds: string[] = [];
        d.pages.forEach((p, pi) => {
            const id = `${d.id}-p${pi + 1}`;
            const data = b64(photo(p));
            existingFiles[`DATA/docs/${d.id}/pages/${id}.jpg`] = data;
            existingFiles[`DATA/docs/${d.id}/thumbs/${id}.jpg`] = data;
            pages.push({id, docId: d.id, imagePath: `docs/${d.id}/pages/${id}.jpg`, thumbPath: `docs/${d.id}/thumbs/${id}.jpg`,
                width: 0, height: 0, rotation: 0, createdAt: now - di * 86_400_000 + pi, ocrStatus: 'pending'});
            pageIds.push(id);
        });
        docs.push({id: d.id, title: `Scan ${di + 1}`, folder: d.folder ? d.folder[lang] : null, tags: [], pageIds,
            createdAt: now - di * 86_400_000, updatedAt: now - di * 86_400_000, autoTitle: true});
    });

    await page.addInitScript((l) => {
        localStorage.setItem('sahifah.welcomeSeen', '1');
        localStorage.setItem('sahifah.locale', l);
    }, lang);
    await fakeAndroid(page, {scan: [photo('french-invoice.jpg')], signer: true, existingFiles});
    await page.goto('/#/library');
    await expect(page.locator('library-page')).toBeVisible();
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
    // A fresh start: the app reads the pages it finds unread (names and text come from that).
    await page.reload();
    await expect(page.locator('library-page')).toBeVisible();
    const allRead = () => page.evaluate(() => new Promise<boolean>((resolve) => {
        const q = indexedDB.open('sahifah-lens');
        q.onsuccess = () => { const r = q.result.transaction(['pages']).objectStore('pages').getAll(); r.onsuccess = () => { q.result.close(); resolve(r.result.every((p: any) => p.ocrStatus === 'done')); }; };
    }));
    await expect.poll(allRead, {timeout: 180_000, intervals: [1000]}).toBe(true);
    // One document renamed by hand, through the app's title field (a name you type stays).
    for (const d of DOCS) {
        if (!('typedName' in d) || !d.typedName) continue;
        await page.goto(`/#/doc/${d.id}`);
        const title = page.locator('doc-page input').first();
        await expect(title).toBeVisible();
        await title.fill(d.typedName[lang]);
        await title.blur();
        await expect.poll(() => page.evaluate((id) => new Promise((resolve) => {
            const q = indexedDB.open('sahifah-lens');
            q.onsuccess = () => { const r = q.result.transaction(['docs']).objectStore('docs').get(id); r.onsuccess = () => { q.result.close(); resolve(r.result.title); }; };
        }), d.id)).toBe(d.typedName[lang]);
    }
    await page.goto('/#/library');
    await expect(page.locator('library-page')).toBeVisible();

    // 1. "+" and a scan: the page is saved, Share as PDF is one tap away.
    await page.locator('#MainScanBtn').click();
    await expect(page.getByTestId('btn-share-pdf')).toBeVisible({timeout: 30_000});
    await expect(page.getByTestId('scan-strip').locator('img')).toHaveCount(1);
    await shot(1, 'scan');

    // 2. The document, with the text the app read.
    await page.getByTestId('btn-done').click();
    await expect(page.locator('doc-page')).toBeVisible();
    await page.getByTestId('btn-text').click();
    await expect(page.getByTestId('ocr-reading')).toBeHidden({timeout: 120_000});
    await page.getByTestId('text-panel').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 72));
    await expect(page.getByTestId('text-panel')).toContainText(/\w{3,}|[؀-ۿ]{2,}/);
    await shot(2, 'text');

    // 3. The library: four documents, their names from their text, two in folders.
    await page.goto('/#/library');
    await expect(page.locator('library-page h3')).toHaveCount(4, {timeout: 20_000});
    await expect(page.locator('library-page img')).toHaveCount(4, {timeout: 20_000});
    await page.evaluate(() => window.scrollTo(0, 0)); // the document page left its scroll behind
    await shot(3, 'library');

    // 4. The editor in crop mode, on the lease.
    await page.goto('/#/doc/lease');
    await expect(page.locator('doc-page')).toBeVisible();
    await page.locator('[data-page-card-id] [role=button]').first().click();
    await page.locator(`doc-page button[aria-label="${lang === 'ar' ? 'تعديل الصفحة' : 'Edit page'}"]`).first().click();
    await expect(page.locator('page-editor')).toBeVisible();
    await expect(page.getByTestId('editor-loading')).toBeHidden({timeout: 60_000});
    await page.getByRole('button', {name: lang === 'ar' ? /^قص$|^اقتصاص$/ : /^Crop$/}).click();
    await expect(page.getByTestId('corner-handle-0')).toBeVisible();
    await shot(4, 'crop');

    // 5. Settings, after a real backup (made in this run through the app).
    await page.goto('/#/settings');
    await expect(page.locator('settings-page')).toBeVisible();
    await page.getByRole('button', {name: lang === 'ar' ? /تصدير نسخة احتياطية/ : /Export Backup/}).click();
    await page.getByPlaceholder('Password123').fill('store-2026');
    await page.getByRole('button', {name: lang === 'ar' ? 'تصدير' : 'Export', exact: true}).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('sahifah.lastBackup')), {timeout: 60_000}).not.toBeNull();
    await page.reload();
    await expect(page.locator('settings-page')).toBeVisible();
    await shot(5, 'settings');
});
