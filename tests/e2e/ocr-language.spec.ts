import {expect, test, type Page} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        window.localStorage.setItem('sahifah.locale', 'en');
        if (!window.sessionStorage.getItem('e2e.ocrLangInitDone')) {
            window.localStorage.removeItem('sahifah.ocrLang');
            window.sessionStorage.setItem('e2e.ocrLangInitDone', '1');
        }
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('http://localhost:4173/#/settings');
});

function ocrLanguageSelect(page: Page) {
    return page.locator('div.space-y-2')
        .filter({has: page.getByText('OCR Language')})
        .locator('select')
        .first();
}

test('OCR language defaults to Arabic+English', async ({page}) => {
    const select = ocrLanguageSelect(page);
    await expect(select).toHaveValue('ara+eng');
});

test('switching OCR language to English persists selection', async ({page}) => {
    const select = ocrLanguageSelect(page);
    await select.selectOption('eng');
    await expect(select).toHaveValue('eng');

    await page.reload();
    await expect(ocrLanguageSelect(page)).toHaveValue('eng');
});
