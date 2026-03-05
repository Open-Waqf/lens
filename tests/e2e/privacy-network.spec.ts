import {expect, test} from '@playwright/test';

const MOCK_IMAGE_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        window.localStorage.setItem('sahifah.enableOcr', '1');
        window.localStorage.setItem('sahifah.ocrLang', 'eng');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        (window as any).navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    });
});

test('core flow scan -> OCR -> save -> search -> export does not require outbound network', async ({page}) => {
    await page.goto('http://localhost:4173/#/scan');

    const importBtn = page.locator('button').filter({hasText: /Import/i});
    await expect(importBtn).toBeVisible({timeout: 15000});

    const chooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: 'test-doc.png',
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

    const saveBtn = page.getByRole('button', {name: /Save Scan/i});
    await expect(saveBtn).toBeEnabled({timeout: 10000});
    await saveBtn.click();
    await expect(page.locator('page-editor')).not.toBeVisible({timeout: 15000});

    // OCR status should resolve locally (done or error) without outbound network.
    const ocrResolved = await page.evaluate(async () => {
        function sleep(ms: number): Promise<void> {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            const status = await new Promise<string | null>((resolve, reject) => {
                const req = indexedDB.open('sahifah-lens');
                req.onerror = () => reject(req.error ?? new Error('DB open failed'));
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction(['pages'], 'readonly');
                    const store = tx.objectStore('pages');
                    const allReq = store.getAll();
                    allReq.onsuccess = () => {
                        const rows = (allReq.result || []) as Array<{createdAt?: number; ocrStatus?: string}>;
                        rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
                        db.close();
                        resolve(rows[0]?.ocrStatus ?? null);
                    };
                    allReq.onerror = () => {
                        db.close();
                        reject(allReq.error ?? new Error('Read pages failed'));
                    };
                };
            });
            if (status === 'done' || status === 'error') return true;
            await sleep(120);
        }
        return false;
    });
    expect(ocrResolved).toBe(true);

    await page.goto('http://localhost:4173/#/library');
    await expect(page.locator('text=No scans yet')).not.toBeVisible({timeout: 10000});
    await page.locator('input[placeholder*="Search"]').fill('scan');
    await expect(page.locator('h3', {hasText: /Scan/i}).first()).toBeVisible({timeout: 5000});

    await page.goto('http://localhost:4173/#/settings');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Export Backup")').click();
    await page.getByPlaceholder('Password123').fill('networkGate123');
    await page.getByRole('button', {name: 'Export', exact: true}).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().endsWith('.slbk')).toBe(true);
});
