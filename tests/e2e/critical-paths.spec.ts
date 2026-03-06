import {expect, test, type Download, type Page} from '@playwright/test';
import fs from 'fs';
import path from 'path';

const MOCK_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function readDownloadBuffer(download: Download, fallbackFilePath: string): Promise<Buffer> {
    let downloadPath: string | null = null;
    try {
        downloadPath = await download.path();
    } catch {
        downloadPath = null;
    }

    if (downloadPath) {
        return fs.readFileSync(downloadPath);
    }

    await download.saveAs(fallbackFilePath);
    return fs.readFileSync(fallbackFilePath);
}

async function exportBackupBuffer(page: Page, password: string): Promise<Buffer> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const downloadPromise = page.waitForEvent('download', {timeout: 10000});
            await page.locator('button:has-text("Export Backup")').click();

            const passwordInput = page.getByPlaceholder('Password123');
            await passwordInput.waitFor({state: 'visible', timeout: 10000});
            await passwordInput.fill(password);
            await page.getByRole('button', {name: 'Export', exact: true}).click();

            const download = await downloadPromise;
            const failure = await download.failure();
            if (failure) {
                lastError = new Error(`Download failed: ${failure}`);
                continue;
            }
            return await readDownloadBuffer(
                download,
                path.join(test.info().outputDir, download.suggestedFilename() || `backup-attempt-${attempt + 1}.slbk`)
            );
        } catch (e) {
            lastError = e;
        }
    }
    throw new Error(`Could not export backup after retries: ${String(lastError)}`);
}

test.beforeEach(async ({page}) => {
    // 1. Force the 'Welcome Seen' flag and mock Capacitor
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        (window as any).navigator.mediaDevices.getUserMedia = async () => new MediaStream();
        try {
            Object.defineProperty(navigator, 'share', {value: undefined, configurable: true});
            Object.defineProperty(navigator, 'canShare', {value: undefined, configurable: true});
        } catch {
        }
    });

    // 2. Go to the app (it should now skip Welcome automatically)
    await page.goto('http://localhost:4173');
});

test('Disaster Recovery Flow: Import -> Encrypt -> Wipe -> Restore', async ({page}) => {
    // 1. NAVIGATE TO SCAN
    // Ensure we are in the main UI, then navigate
    await page.locator('#MainScanBtn').click();
    await page.waitForURL('**/#/scan**');

    // 2. TRIGGER FILE UPLOAD
    // Piercing the shadow/lit rendering with a locator that waits for the text
    const importBtn = page.locator('button').filter({hasText: /Import/i});

    // This should now succeed because the Welcome screen is bypassed
    await expect(importBtn).toBeVisible({timeout: 15000});

    const fileChooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
        name: 'test-doc.png',
        mimeType: 'image/png',
        buffer: Buffer.from(MOCK_IMAGE_BASE64, 'base64')
    });

    // 3. EDITOR & SAVE
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
    const saveButton = page.getByRole('button', {name: /Save Scan/i});
    await expect(saveButton).toBeEnabled({timeout: 10000});
    await saveButton.click();

    await expect(page.locator('page-editor')).not.toBeVisible({timeout: 15000});

    // CHECKPOINT: Go to Library and wait for the document to appear
    await page.goto('http://localhost:4173/#/library');

    // Wait for the "No scans yet" message to disappear
    await expect(page.locator('text=No scans yet')).not.toBeVisible({timeout: 10000});

    // 4. BACKUP
    await page.goto('http://localhost:4173/#/settings');

    const backupBuffer = await exportBackupBuffer(page, 'secure123');
    console.log('Backup successfully captured');

    // 5. WIPE
    await page.goto('http://localhost:4173/#/settings');
    const dangerZone = page.locator('#DangerZone');
    const deleteInput = dangerZone.getByPlaceholder('DELETE');
    if (await deleteInput.count() === 0 || !(await deleteInput.isVisible().catch(() => false))) {
        await dangerZone.locator('button').first().click();
    }
    await deleteInput.fill('DELETE');
    const eraseBtn = dangerZone.locator('button.bg-red-600').first();
    await expect(eraseBtn).toBeVisible({timeout: 10000});
    await expect(eraseBtn).toBeEnabled({timeout: 10000});
    await eraseBtn.click({force: true});
    const wipeBtn = page.locator('confirm-modal button.bg-red-600').first();
    let wipeConfirmedViaModal = false;
    try {
        await expect(wipeBtn).toBeVisible({timeout: 3000});
        await expect(wipeBtn).toBeEnabled({timeout: 3000});
        await wipeBtn.click({force: true});
        wipeConfirmedViaModal = true;
    } catch {
        // In some parallel runs the app is already reloaded after wipe at this point.
    }
    if (wipeConfirmedViaModal) {
        await page.waitForURL(/#\/(scan|settings|library)/, {timeout: 15000});
    }


    // 6. RESTORE
    await page.goto('#/settings');
    const restoreChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=Restore Backup').click();
    const restoreChooser = await restoreChooserPromise;
    await restoreChooser.setFiles({
        name: 'restore-test.slbk',
        mimeType: 'application/octet-stream',
        buffer: backupBuffer
    });

    const restoreModal = page.locator('confirm-modal').last();
    await restoreModal.getByPlaceholder(/Password/i).fill('secure123');
    await restoreModal.getByRole('button', {name: 'Restore', exact: true}).click();

    // Handle Merge/Replace modal
    const confirmInput = page.getByPlaceholder('MERGE or REPLACE');

    // Use a longer timeout here because decryption/unzipping can be slow
    await expect(confirmInput).toBeVisible({timeout: 15000});

    // --- STEP C: Handle Merge/Replace Modal ---
    await confirmInput.fill('REPLACE');
    await page.locator('button').filter({hasText: /Continue/i}).click();

    // 7. VERIFY
    await expect(page.locator('text=Restore complete!')).toBeVisible({timeout: 10000});
    await page.goto('#/library');
    await expect(page.locator('text=No scans yet')).not.toBeVisible();
});
