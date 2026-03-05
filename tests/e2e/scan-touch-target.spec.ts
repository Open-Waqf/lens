import {expect, test} from '@playwright/test';

const MOCK_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('http://localhost:4173/#/scan?new=1');
});

test('scan editor corner handles meet 44x44 touch target minimum', async ({page}) => {
    const importBtn = page.locator('button').filter({hasText: /Import/i});
    const chooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: 'touch-target.png',
        mimeType: 'image/png',
        buffer: Buffer.from(MOCK_IMAGE_BASE64, 'base64'),
    });

    await expect(page.locator('page-editor')).toBeVisible({timeout: 10000});

    for (const idx of [0, 1, 2, 3]) {
        const handle = page.getByTestId(`corner-handle-${idx}`);
        await expect(handle).toBeVisible({timeout: 10000});
        const box = await handle.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
    }
});

