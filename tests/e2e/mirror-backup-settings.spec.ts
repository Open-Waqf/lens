import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('http://localhost:4173/#/settings');
});

test('mirror backup section is visible with progressive disclosure UX', async ({page}) => {
    const title = 'Backup Mirror (Auto-copy after export)';
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText('After each Export Backup, Sahifah Lens can save an extra encrypted .slbk copy')).toBeVisible();

    const unsupported = page.getByText('Folder mirroring is not available on this platform build.');
    const missingFolder = page.getByText('No backup folder selected.');
    const chooseFolder = page.getByRole('button', {name: 'Choose Folder'});
    const hasUnsupported = await unsupported.isVisible().catch(() => false);
    if (!hasUnsupported) {
        await expect(missingFolder).toBeVisible();
        await expect(chooseFolder).toBeVisible();
    } else {
        await expect(unsupported).toBeVisible();
    }

    const toggle = page.getByRole('button', {name: title});
    await toggle.click();
    if (hasUnsupported) {
        await expect.poll(async () => page.evaluate(() => localStorage.getItem('sahifah.mirrorBackupEnabled'))).toBe('0');
    } else {
        await expect.poll(async () => page.evaluate(() => localStorage.getItem('sahifah.mirrorBackupEnabled'))).toBe('1');
    }
});
