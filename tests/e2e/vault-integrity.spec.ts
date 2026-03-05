import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('http://localhost:4173/#/settings');
});

test('Vault Integrity: Fast Nuclear Reset shortcut works', async ({page}) => {
    const shortcut = page.locator('button[title="Nuclear Reset"]');
    await expect(shortcut).toBeVisible();

    await shortcut.click();

    // Verify Danger Zone reveals
    const dangerZone = page.locator('#DangerZone');
    await expect(dangerZone).toBeVisible();

    // Verify Input exists
    const input = page.locator('input[placeholder="DELETE"]');
    await expect(input).toBeVisible();
});

test('Vault Integrity: Storage Audit Toast appears on orphan detection', async ({page}) => {
    // 1. Inject orphan file
    await page.evaluate(async () => {
        if (!(navigator.storage as any).getDirectory) return;
        const root = await (navigator.storage as any).getDirectory();
        const docsDir = await root.getDirectoryHandle('docs', { create: true });
        const fileHandle = await docsDir.getFileHandle('orphan_final_e2e.jpg', { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(new Uint8Array([1, 2, 3]));
        await writable.close();
    });

    // 2. Reload to ensure app state is fresh
    await page.reload();

    // 3. Clear the risk flag AND trigger GC in one go to avoid re-triggering by the probe
    await page.evaluate(async () => {
        const win = window as any;
        // Force-clear the risk flags that might have been set by the auto-probe on reload
        localStorage.removeItem('sahifah.storageRisk.indexMissing');
        if (document.querySelector('app-root')) {
            (document.querySelector('app-root') as any).hasStorageRisk = false;
        }
        
        if (win.triggerStorageAudit) {
            await win.triggerStorageAudit();
        }
    });

    // 4. Verify toast
    const toast = page.getByText(/Storage Audit: Cleaned/i).first();
    await expect(toast).toBeVisible({ timeout: 15000 });
});

test('Vault Integrity: Settings Storage Audit detects and deletes orphans', async ({page}) => {
    const orphanPath = 'docs/orphan_settings_audit.jpg';

    await page.evaluate(() => {
        localStorage.setItem('sahifah.storageRisk.indexMissing', '1');
    });
    await page.reload();

    await page.evaluate(async (path) => {
        if (!(navigator.storage as any).getDirectory) return;
        const root = await (navigator.storage as any).getDirectory();
        const docsDir = await root.getDirectoryHandle('docs', {create: true});
        const fileHandle = await docsDir.getFileHandle(path.replace('docs/', ''), {create: true});
        const writable = await (fileHandle as any).createWritable();
        await writable.write(new Uint8Array([9, 8, 7, 6]));
        await writable.close();
    }, orphanPath);

    await page.getByTestId('run-storage-audit-btn').click();
    await page.getByRole('button', {name: 'Delete orphans'}).click();

    await expect(page.getByText(/Storage Audit complete: deleted \d+ orphan files\./)).toBeVisible({timeout: 10000});

    const existsAfter = await page.evaluate(async (path) => {
        if (!(navigator.storage as any).getDirectory) return false;
        const root = await (navigator.storage as any).getDirectory();
        const docsDir = await root.getDirectoryHandle('docs', {create: true});
        try {
            await docsDir.getFileHandle(path.replace('docs/', ''), {create: false});
            return true;
        } catch {
            return false;
        }
    }, orphanPath);
    expect(existsAfter).toBe(false);
});
