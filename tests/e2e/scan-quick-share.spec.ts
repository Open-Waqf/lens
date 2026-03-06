import {expect, test} from '@playwright/test';

const MOCK_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        try {
            Object.defineProperty(navigator, 'share', {value: undefined, configurable: true});
            Object.defineProperty(navigator, 'canShare', {value: undefined, configurable: true});
        } catch {
        }
    });
    await page.goto('http://localhost:4173/#/scan?new=1');
});

test('quick share from scan editor does not create a saved document', async ({page}) => {
    const importBtn = page.locator('button').filter({hasText: /Import/i});
    const chooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: 'quick-share.png',
        mimeType: 'image/png',
        buffer: Buffer.from(MOCK_IMAGE_BASE64, 'base64')
    });

    await expect(page.locator('page-editor')).toBeVisible({timeout: 15000});
    await expect(page.locator('nav')).toHaveCount(0);
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

    await page.locator('page-editor').getByRole('button', {name: /Share Now/i}).click();
    await page.waitForTimeout(600);
    await expect(page.locator('confirm-modal')).toHaveCount(0);

    await expect(page.locator('page-editor')).toBeVisible();
    await page.goto('http://localhost:4173/#/library');
    await expect(page.getByText('No scans yet')).toBeVisible({timeout: 10000});
    await expect(page.locator('nav')).toHaveCount(1);
});
