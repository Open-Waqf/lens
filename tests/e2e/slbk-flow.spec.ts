import {expect, test} from './support/test';
import fs from 'fs';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('/#/settings');
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

    await expect(page.getByText('Incorrect password.')).toBeVisible({timeout: 20000});

    await page.goto('/#/library');
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

    // A document already in the library: "Replace" with a corrupt backup must not lose it.
    await page.goto('/#/library');
    await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => { const q = indexedDB.open('sahifah-lens'); q.onsuccess = () => resolve(q.result); });
        await new Promise<void>((resolve) => {
            const tx = db.transaction(['docs'], 'readwrite');
            tx.objectStore('docs').put({id: 'keep_me', title: 'Keep me', folder: null, tags: [], pageIds: [], createdAt: 1, updatedAt: 1});
            tx.oncomplete = () => resolve();
        });
        db.close();
    });
    await page.goto('/#/settings');

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
    // The damage is at the end of the file, so it is found only after the mode question.
    await page.getByRole('button', {name: 'Replace my library'}).click({timeout: 15000});

    await expect(page.getByText('Vault file is corrupted or incomplete.')).toBeVisible({timeout: 10000});

    await page.goto('/#/library');
    await expect(page.getByText('Keep me')).toBeVisible({timeout: 10000});
});

test('SLBK restore rejects unsupported future version backup', async ({page}) => {
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Export Backup")').click();
    await page.getByPlaceholder('Password123').fill('correct123');
    await page.getByRole('button', {name: 'Export', exact: true}).click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    if (!backupPath) throw new Error('Missing backup file path');

    const backupBuffer = fs.readFileSync(backupPath);
    const futureVersion = Buffer.from(backupBuffer);
    // Version bytes are big-endian at offsets 4..5.
    futureVersion[4] = 0x00;
    futureVersion[5] = 0x04;

    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('text=Restore Backup').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: 'restore-unsupported-version.slbk',
        mimeType: 'application/octet-stream',
        buffer: futureVersion
    });

    await expect(page.getByPlaceholder('Password')).toBeVisible({timeout: 10000});
    await page.getByPlaceholder('Password').fill('correct123');
    await page.getByRole('button', {name: 'Restore', exact: true}).click();

    await expect(page.getByText('Vault file version is not supported.')).toBeVisible({timeout: 10000});

    await page.goto('/#/library');
    await expect(page.getByText('No scans yet')).toBeVisible({timeout: 10000});
});

for (const [label, metadata] of [['empty metadata', '{}'], ['metadata that is not JSON', 'not json {']] as const) {
    test(`SLBK restore of a damaged backup (${label}) says so clearly and changes nothing`, async ({page}) => {
        // Regression (Nov 2026): a backup without docs/pages lists failed with a raw
        // "Cannot read properties of undefined (reading 'length')".
        const {zipSync, strToU8} = await import('fflate');
        const buffer = Buffer.from(zipSync({'metadata.json': strToU8(metadata)}));

        const chooserPromise = page.waitForEvent('filechooser');
        await page.locator('text=Restore Backup').click();
        await (await chooserPromise).setFiles({name: 'damaged.zip', mimeType: 'application/zip', buffer});
        // A plain .zip backup has no password: leave the field empty.
        await page.getByRole('button', {name: 'Restore', exact: true}).click({timeout: 10000});

        await expect(page.getByText('Invalid backup: missing metadata.', {exact: false})).toBeVisible({timeout: 10000});
        await expect(page.getByText(/Cannot read properties|JSON|Unexpected token/)).toHaveCount(0);
        await expect(page.getByRole('button', {name: 'Add to my library'})).toHaveCount(0);
    });
}
