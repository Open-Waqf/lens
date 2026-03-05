import {expect, test} from '@playwright/test';

const MOCK_IMAGE_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
    await tagsInput.fill('amanah,qa');
    await tagsInput.dispatchEvent('change');
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
