import {expect, test} from '@playwright/test';

const MOCK_IMAGE_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function isLocalHost(url: string): boolean {
    try {
        const u = new URL(url);
        return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

test.beforeEach(async ({context, page}) => {
    let externalAttemptCount = 0;

    await context.route('**/*', route => {
        const url = route.request().url();
        if (isLocalHost(url)) {
            void route.continue();
            return;
        }
        externalAttemptCount++;
        void route.abort('blockedbyclient');
    });

    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        window.localStorage.setItem('sahifah.enableOcr', '0');
        (window as any).__offlineExternalAttempts = 0;
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        (window as any).navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    });

    await page.exposeFunction('recordExternalAttempt', () => {
        externalAttemptCount++;
    });

    await page.addInitScript(() => {
        window.addEventListener('error', (ev) => {
            const msg = (ev as ErrorEvent).message || '';
            if (msg.toLowerCase().includes('network')) {
                (window as any).__offlineExternalAttempts++;
            }
        });
    });

    await page.goto('http://localhost:4173/#/scan');

    // stash counter getter for assertions inside tests
    (test.info() as any).externalAttemptCountRef = () => externalAttemptCount;
});

test('core flow works offline and does not attempt external network', async ({page}) => {
    const importBtn = page.locator('button').filter({hasText: /Import/i});
    await expect(importBtn).toBeVisible({timeout: 15000});

    const chooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: 'offline-core.png',
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
    const saveBtn = page.getByRole('button', {name: /Save Scan/i});
    await expect(saveBtn).toBeEnabled({timeout: 10000});
    await saveBtn.click();

    await page.goto('http://localhost:4173/#/library');
    await expect(page.getByText('No scans yet')).not.toBeVisible({timeout: 10000});
    await page.locator('input[placeholder*="Search"]').fill('scan');

    await page.goto('http://localhost:4173/#/settings');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Export Backup")').click();
    await page.getByPlaceholder('Password123').fill('offline123');
    await page.getByRole('button', {name: 'Export', exact: true}).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().endsWith('.slbk')).toBe(true);

    const externalCount = (test.info() as any).externalAttemptCountRef() as number;
    expect(externalCount).toBe(0);

    const runtimeNetworkErrors = await page.evaluate(() => (window as any).__offlineExternalAttempts || 0);
    expect(runtimeNetworkErrors).toBe(0);
});

