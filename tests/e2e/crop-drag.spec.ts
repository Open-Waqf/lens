import fs from 'node:fs';
import path from 'node:path';
import {expect, test} from './support/test';

const PHOTO = path.resolve('tests/fixtures/photos/french-invoice.jpg');

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('/#/scan?new=1');
});

async function importFiles(page: import('./support/test').Page, count: number) {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('button').filter({hasText: /Import/i}).click();
    const chooser = await chooserPromise;
    const buffer = fs.readFileSync(PHOTO);
    await chooser.setFiles(Array.from({length: count}, (_, i) => ({name: `page-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer})));
    await expect(page.locator('page-editor')).toBeVisible({timeout: 15_000});
    // The first preview is drawn after edge detection: the crop is final from here on.
    await expect(page.getByTestId('editor-loading')).toBeHidden({timeout: 60_000});
}

/** Drags the top-left corner down and to the right; the corner must follow the finger. */
async function dragTopLeftCorner(page: import('./support/test').Page) {
    await page.getByRole('button', {name: 'Crop'}).click();
    const handle = page.getByTestId('corner-handle-0');
    await expect(handle).toBeVisible();
    // The handle must sit on the drawn corner, or a finger on the dot grabs nothing.
    const corner = await page.evaluate(() => {
        const ed = document.querySelector('page-editor') as any;
        const c = document.querySelector('canvas[data-edges]') as HTMLCanvasElement;
        const r = c.getBoundingClientRect();
        const q = ed.quad[0];
        return {x: r.left + q.x * r.width / ed.baseW, y: r.top + q.y * r.height / ed.baseH, canvas: {x: r.left, y: r.top, w: r.width, h: r.height}};
    });
    const before = (await handle.boundingBox())!;
    expect(Math.abs(before.x + before.width / 2 - corner.x), `handle centre vs drawn corner x (handle ${JSON.stringify(before)}, corner ${JSON.stringify(corner)})`).toBeLessThanOrEqual(2);
    expect(Math.abs(before.y + before.height / 2 - corner.y), 'handle centre vs drawn corner y').toBeLessThanOrEqual(2);
    const x = before.x + before.width / 2, y = before.y + before.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 10, y + i * 10);
    await page.mouse.up();
    const after = (await handle.boundingBox())!;
    expect(after.x - before.x, 'the corner handle moved right with the drag').toBeGreaterThan(50);
    expect(after.y - before.y, 'the corner handle moved down with the drag').toBeGreaterThan(50);
}

test('C.1 One imported photo: a crop corner follows the finger', async ({page}) => {
    await importFiles(page, 1);
    await dragTopLeftCorner(page);
});

test('C.2 Two imported photos (review): a crop corner follows the finger', async ({page}) => {
    await importFiles(page, 2);
    await expect(page.locator('page-editor')).toContainText(/1\s*\/\s*2|1 of 2/);
    await dragTopLeftCorner(page);
});

/** The crop the editor found, once edge detection is done; null while it still runs. */
async function detectedQuad(page: import('./support/test').Page) {
    await expect.poll(() => page.evaluate(() => !!(document.querySelector('page-editor') as any).detection), {timeout: 30_000}).toBe(true);
    return page.evaluate(async () => {
        const ed = document.querySelector('page-editor') as any;
        await ed.detection;
        return ed.quad as {x: number; y: number}[];
    });
}

test('C.3 Two imported photos get the same auto crop as one imported photo', async ({page}) => {
    await importFiles(page, 1);
    const one = await detectedQuad(page);
    expect(one[0].x, 'one photo: the page edge was found, not the photo edge').toBeGreaterThan(10);
    await page.reload(); // leaves the unsaved photo behind
    await importFiles(page, 2);
    const two = await detectedQuad(page);
    for (let i = 0; i < 4; i++) {
        expect(Math.abs(two[i].x - one[i].x), `corner ${i} x`).toBeLessThanOrEqual(4);
        expect(Math.abs(two[i].y - one[i].y), `corner ${i} y`).toBeLessThanOrEqual(4);
    }
});

test('C.4 Saved page tiles have the same size for one page and for two', async ({page}) => {
    await importFiles(page, 1);
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await expect(page.locator('page-editor')).toBeHidden({timeout: 30_000});
    const tile = page.getByTestId('scan-strip').getByRole('button', {name: 'Edit page'});
    await expect(tile).toHaveCount(1);
    const one = (await tile.first().boundingBox())!;
    await page.getByRole('button', {name: 'Done'}).click();
    await page.goto('/#/scan?new=1');
    await importFiles(page, 2);
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await expect(page.locator('page-editor')).toContainText(/2 of 2|2\s*\/\s*2/, {timeout: 30_000});
    await expect.poll(() => page.evaluate(() => (document.querySelector('canvas[data-preview]') as HTMLCanvasElement | null)?.width || 0), {timeout: 30_000}).toBeGreaterThan(0);
    await page.getByRole('button', {name: 'Save Scan'}).click();
    await expect(page.locator('page-editor')).toBeHidden({timeout: 30_000});
    await expect(tile).toHaveCount(2);
    const two = (await tile.first().boundingBox())!;
    expect(Math.abs(two.width - one.width), 'tile width').toBeLessThanOrEqual(1);
    expect(Math.abs(two.height - one.height), 'tile height').toBeLessThanOrEqual(1);
});
