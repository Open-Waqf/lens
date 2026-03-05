import {expect, test} from '@playwright/test';
import fs from 'fs';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('http://localhost:4173/#/settings');
});

test('SLBK export downloads a .slbk file', async ({page}) => {
    const downloadPromise = page.waitForEvent('download');

    await page.locator('button:has-text("Export Backup")').click();
    await page.getByPlaceholder('Password123').fill('secure123');
    await page.getByRole('button', {name: 'Export', exact: true}).click();

    const download = await downloadPromise;
    const filename = download.suggestedFilename();
    expect(filename.endsWith('.slbk')).toBe(true);
});

test('SLBK restore requires password', async ({page}) => {
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Export Backup")').click();
    await page.getByPlaceholder('Password123').fill('correct123');
    await page.getByRole('button', {name: 'Export', exact: true}).click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    if (!backupPath) throw new Error('Missing backup file path');

    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=Restore Backup').click();
    const chooser = await chooserPromise;
    const backupBuffer = fs.readFileSync(backupPath);
    await chooser.setFiles({
        name: 'restore-wrong-pass.slbk',
        mimeType: 'application/octet-stream',
        buffer: backupBuffer
    });

    await expect(page.getByPlaceholder('Password')).toBeVisible({timeout: 10000});
    await page.getByPlaceholder('Password').fill('wrong-password');
    await page.getByRole('button', {name: 'Restore', exact: true}).click();

    await expect(page.getByText('Incorrect password.')).toBeVisible({timeout: 10000});

    await page.goto('http://localhost:4173/#/library');
    await expect(page.getByText('No scans yet')).toBeVisible({timeout: 10000});
});

test('SLBK restore rejects corrupted backup with specific error and no partial write', async ({page}) => {
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Export Backup")').click();
    await page.getByPlaceholder('Password123').fill('correct123');
    await page.getByRole('button', {name: 'Export', exact: true}).click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    if (!backupPath) throw new Error('Missing backup file path');

    const backupBuffer = fs.readFileSync(backupPath);
    const cutoff = Math.max(16, backupBuffer.length - 64);
    const corrupted = backupBuffer.subarray(0, cutoff);

    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=Restore Backup').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: 'restore-corrupted.slbk',
        mimeType: 'application/octet-stream',
        buffer: corrupted
    });

    await expect(page.getByPlaceholder('Password')).toBeVisible({timeout: 10000});
    await page.getByPlaceholder('Password').fill('correct123');
    await page.getByRole('button', {name: 'Restore', exact: true}).click();

    await expect(page.getByText('Vault file is corrupted or incomplete.')).toBeVisible({timeout: 10000});

    await page.goto('http://localhost:4173/#/library');
    await expect(page.getByText('No scans yet')).toBeVisible({timeout: 10000});
});
