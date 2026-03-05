import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        const key = '__e2e.storageBanner.initDone';
        if (window.localStorage.getItem(key) !== '1') {
            window.localStorage.removeItem('sahifah.storageBanner.dismissed');
            window.localStorage.setItem(key, '1');
        }
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('http://localhost:4173/#/library');
});

test('storage banner can be dismissed and stays hidden after reload', async ({page}) => {
    await expect(page.getByText('Storage is not persistent')).toBeVisible({timeout: 10000});
    await page.getByTestId('dismiss-storage-banner').click();
    await expect(page.getByText('Storage is not persistent')).not.toBeVisible({timeout: 10000});

    await page.reload();
    await expect(page.getByText('Storage is not persistent')).not.toBeVisible({timeout: 10000});
});
