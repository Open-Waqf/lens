// editor-loading.spec.ts: the editor never shows a black stage. The spinner stays until the
// first preview is on the canvas (before Nov 2026 it went away when the photo was decoded,
// about a second before the preview was drawn).
import fs from 'node:fs';
import path from 'node:path';
import {expect, test} from './support/test';

const PHOTO = path.resolve('tests/fixtures/photos/french-invoice.jpg');

test('E.1 the spinner stays until the first preview is drawn', async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('/#/scan?new=1');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('button').filter({hasText: /Import/i}).click();
    await (await chooser).setFiles({name: 'a.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(PHOTO)});
    await expect(page.locator('page-editor')).toBeVisible();
    // Watch the stage from inside the page: at no moment may it be without both the
    // spinner and a drawn preview.
    const gap = await page.evaluate(() => new Promise<string | null>((resolve) => {
        const start = performance.now();
        const tick = () => {
            const spinner = document.querySelector('[data-testid="editor-loading"]');
            const canvas = document.querySelector('canvas[data-preview]') as HTMLCanvasElement | null;
            let drawn = false;
            if (canvas && canvas.width > 0) {
                const px = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
                drawn = px[3] > 0;
            }
            if (drawn) { resolve(null); return; }
            if (!spinner) { resolve(`no spinner and no preview after ${Math.round(performance.now() - start)} ms`); return; }
            if (performance.now() - start > 30_000) { resolve('no preview in 30 s'); return; }
            setTimeout(tick, 15);
        };
        tick();
    }));
    expect(gap).toBeNull();
});

test('E.2 a photo with no page edges to find still gets its preview (no endless spinner)', async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('/#/scan?new=1');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('button').filter({hasText: /Import/i}).click();
    // A 1x1 photo: edge detection finds nothing.
    await (await chooser).setFiles({name: 'blank.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')});
    await expect(page.locator('page-editor')).toBeVisible();
    await expect(page.getByTestId('editor-loading')).toBeHidden({timeout: 15_000});
});
