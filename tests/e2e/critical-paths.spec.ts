import {expect, test} from '@playwright/test';

const MOCK_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.beforeEach(async ({page}) => {
    // 1. Force the 'Welcome Seen' flag and mock Capacitor
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        (window as any).navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    });

    // 2. Go to the app (it should now skip Welcome automatically)
    await page.goto('http://localhost:4173');
});

test('Disaster Recovery Flow: Import -> Encrypt -> Wipe -> Restore', async ({page}) => {
    // 1. NAVIGATE TO SCAN
    // Ensure we are in the main UI, then navigate
    await page.getByRole('link', {name: 'Scan'}).click();
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
    // Using a broad text search for the Save button inside the editor
    await page.locator('button').filter({hasText: /Save/i}).click();

    await expect(page.locator('page-editor')).not.toBeVisible({ timeout: 15000 });

    // CHECKPOINT: Go to Library and wait for the document to appear
    await page.goto('http://localhost:4173/#/library');

    // Wait for the "No scans yet" message to disappear
    await expect(page.locator('text=No scans yet')).not.toBeVisible({ timeout: 10000 });

    // 4. BACKUP
    await page.goto('http://localhost:4173/#/settings');

    // Start listening for the download event
    const downloadPromise = page.waitForEvent('download');

    // Click the Export Backup button in the settings list
    await page.locator('button:has-text("Export Backup")').click();

    // Instead of waiting for the modal container, wait for the INPUT inside it.
    // This confirms the modal logic has fired and rendered.
    const passwordInput = page.getByPlaceholder('Password123');
    await passwordInput.waitFor({state: 'visible', timeout: 10000});
    await passwordInput.fill('secure123');

    // Click the "Export" button that belongs to the modal.
    // We use a locator that ensures we are clicking the one with the primary action.
    await page.getByRole('button', { name: 'Export', exact: true }).click();

    // Now the download should trigger
    const download = await downloadPromise;
    const backupPath = await download.path();
    console.log('Backup successfully captured at:', backupPath);

    // 5. WIPE
    await page.locator('text=Show Destructive Options').click();
    await page.getByPlaceholder('DELETE').fill('DELETE');
    await page.locator('button').filter({hasText: /Erase Everything/i}).click();
    await page.locator('button').filter({hasText: /Wipe Everything/i}).click();

    await page.goto('http://localhost:4173/#/library');
    await expect(page.locator('text=No scans yet')).toBeVisible();

    // 6. RESTORE
    await page.goto('#/settings');
    const restoreChooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=Restore Backup').click();
    const restoreChooser = await restoreChooserPromise;
    await restoreChooser.setFiles(backupPath!);

    await page.getByPlaceholder('Password').fill('secure123');
    await page.getByRole('button', { name: 'Restore', exact: true }).click();

    // Handle Merge/Replace modal
    const confirmInput = page.getByPlaceholder('MERGE or REPLACE');

    // Use a longer timeout here because decryption/unzipping can be slow
    await expect(confirmInput).toBeVisible({ timeout: 15000 });

    // --- STEP C: Handle Merge/Replace Modal ---
    await confirmInput.fill('REPLACE');
    await page.locator('button').filter({ hasText: /Continue/i }).click();

    // 7. VERIFY
    await expect(page.locator('text=Restore complete!')).toBeVisible({timeout: 10000});
    await page.goto('#/library');
    await expect(page.locator('text=No scans yet')).not.toBeVisible();
});