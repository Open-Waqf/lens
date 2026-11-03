// editor-save.spec.ts: the editor's work on the image worker. Nov 2026 deep dive:
// Save used to warp the full photo twice (page, then thumbnail), and every preview during
// a corner drag warped the full photo too.
import fs from 'node:fs';
import {expect, test} from './support/test';

type Sent = {id: string; bitmapW: number | null; outW: number | null; hasBlob: boolean};

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        // Record what the page sends to its workers (the bitmap is read before it is transferred).
        (window as any).__sent = [];
        const orig = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (msg: any, ...rest: any[]) {
            if (msg && typeof msg.id === 'string') {
                (window as any).__sent.push({id: msg.id, bitmapW: msg.bitmap?.width ?? null, outW: msg.outW ?? null, hasBlob: !!msg.blob});
            }
            return (orig as any).call(this, msg, ...rest);
        };
    });
    await page.goto('/#/scan?new=1');
});

async function importPhoto(page: import('./support/test').Page, file: string) {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('button').filter({hasText: /Import/i}).click();
    await (await chooser).setFiles({name: 'photo.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(file)});
    await expect(page.locator('page-editor')).toBeVisible({timeout: 15_000});
    await expect(page.getByTestId('editor-loading')).toBeHidden({timeout: 60_000});
}

const sent = (page: import('./support/test').Page) => page.evaluate(() => (window as any).__sent as Sent[]);

test('P.1 Save sends the photo to the worker once, and gets the page and its thumbnail back', async ({page}) => {
    await importPhoto(page, 'tests/fixtures/photos/french-invoice.jpg');
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await expect(page.locator('page-editor')).toBeHidden({timeout: 30_000});
    const saves = (await sent(page)).filter((m) => m.id.startsWith('save'));
    expect(saves, 'one worker request for Save').toHaveLength(1);
    expect(saves[0].hasBlob).toBe(true);
    // The saved page has its thumbnail: the result screen shows it.
    await expect(page.getByTestId('scan-strip').locator('img')).toHaveCount(1);
});

test('P.2 previews are warped from a copy no larger than 2048 px, not from the 48 MP photo', async ({page}) => {
    test.setTimeout(120_000);
    await importPhoto(page, 'tests/fixtures/photos/huge-6000x8000.jpg');
    const previews = (await sent(page)).filter((m) => m.id.startsWith('prev-'));
    expect(previews.length).toBeGreaterThan(0);
    for (const p of previews) expect(p.bitmapW, 'preview source width').toBeLessThanOrEqual(2048);
});
