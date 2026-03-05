import {expect, test} from '@playwright/test';

const MOCK_IMAGE_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
    await page.goto('http://localhost:4173/#/scan');
});

test('tag delete cascades across document metadata (AC-6.3)', async ({page}) => {
    const importBtn = page.locator('button').filter({hasText: /Import/i});
    await expect(importBtn).toBeVisible({timeout: 15000});

    const chooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: 'tag-cascade.png',
        mimeType: 'image/png',
        buffer: Buffer.from(MOCK_IMAGE_BASE64, 'base64')
    });

    await expect(page.locator('page-editor')).toBeVisible({timeout: 15000});
    await page.evaluate(() => {
        const el = document.querySelector('page-editor') as any;
        if (!el) return;
        el.quad = [
            {x: 10, y: 10},
            {x: 490, y: 10},
            {x: 490, y: 490},
            {x: 10, y: 490}
        ];
        el.requestUpdate();
    });
    await page.getByRole('button', {name: /Save Scan/i}).click();
    await expect(page.locator('page-editor')).toBeHidden({timeout: 15000});

    await page.goto('http://localhost:4173/#/library');
    await page.locator('h3').first().click();
    await page.waitForURL('**/#/doc/**');

    const tagsInput = page.locator('input[list="tag-list"]');
    await tagsInput.evaluate((el) => {
        const input = el as HTMLInputElement;
        input.value = 'amanah,qa';
        input.dispatchEvent(new Event('change', {bubbles: true, composed: true}));
    });
    const docId = page.url().split('/doc/')[1];
    await expect.poll(async () => await readDocTags(page, docId)).toContain('amanah');
    await page.reload();
    await page.waitForURL('**/#/doc/**');
    await expect(page.locator('input[list="tag-list"]')).toHaveValue(/amanah/);

    await page.locator('a[href="#/library"]').click();
    await page.waitForURL('**/#/library');
    const deleteTagBtn = page.getByRole('button', {name: /^Delete tag: amanah$/});
    await expect(deleteTagBtn).toBeVisible({timeout: 10000});
    await deleteTagBtn.click();
    await page.getByRole('button', {name: 'Delete Tag', exact: true}).click();
    await expect(page.getByText('Tag "amanah" removed from 1 document(s).')).toBeVisible({timeout: 10000});
    await expect(deleteTagBtn).toHaveCount(0);

    await page.locator('h3').first().click();
    await page.waitForURL('**/#/doc/**');
    await expect(page.locator('input[list="tag-list"]')).toHaveValue('qa');
});
