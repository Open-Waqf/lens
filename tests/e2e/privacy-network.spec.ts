import {expect, test} from '@playwright/test';

const MOCK_IMAGE_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        window.localStorage.setItem('sahifah.enableOcr', '0');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        (window as any).navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    });
});

test('core flow does not require outbound network', async ({page}) => {
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

    await page.goto('http://localhost:4173/#/library');
    await expect(page.locator('text=No scans yet')).not.toBeVisible({timeout: 10000});

    await page.locator('input[placeholder*="Search"]').fill('scan');
    await page.goto('http://localhost:4173/#/settings');
    await expect(page.getByRole('button', {name: /Export Backup/i})).toBeVisible({timeout: 10000});
});
