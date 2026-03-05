import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        window.localStorage.removeItem('sahifah.ocrLang');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('http://localhost:4173/#/settings');
});

test('OCR language defaults to Arabic+English and shows Arabic disclaimer', async ({page}) => {
    const select = page.locator('select').first();
    await expect(select).toHaveValue('ara+eng');
    await expect(page.getByText('Arabic OCR may be less accurate than Latin text. Review extracted text for critical documents.')).toBeVisible();
});

test('switching OCR language to English hides Arabic disclaimer', async ({page}) => {
    const select = page.locator('select').first();
    await select.selectOption('eng');
    await expect(page.getByText('Arabic OCR may be less accurate than Latin text. Review extracted text for critical documents.')).not.toBeVisible();
});

