import {expect, test} from '@playwright/test';

const MOCK_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
    });
    await page.goto('http://localhost:4173/#/scan?new=1');
});

test('Page Editor: Invalid Selection (Crossed Handles) Warning', async ({page}) => {
    // 1. Import Image
    const importBtn = page.locator('button').filter({hasText: /Import/i});
    const fileChooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
        name: 'test-doc.png',
        mimeType: 'image/png',
        buffer: Buffer.from(MOCK_IMAGE_BASE64, 'base64')
    });

    const editor = page.locator('page-editor');
    await expect(editor).toBeVisible({timeout: 10000});

    // 2. Force invalid selection state
    await page.evaluate(() => {
        const el = document.querySelector('page-editor') as any;
        if (!el) return;
        el.quad = null;
        el.requestUpdate();
    });

    // 3. Verify "Invalid Selection" warning appears
    // The warning is conditionally rendered in the template
    const warning = page.getByTestId('invalid-warning');
    await expect(warning).toBeVisible({timeout: 5000});

    // 4. Verify "Save Scan" button is disabled
    const saveBtn = page.getByRole('button', {name: /Save Scan/i});
    await expect(saveBtn).toBeDisabled();

    // 5. Recover to valid shape
    await page.evaluate(() => {
        const el = document.querySelector('page-editor') as any;
        el.quad = [
            {x: 10, y: 10},
            {x: 490, y: 10},
            {x: 490, y: 490},
            {x: 10, y: 490}
        ];
        el.requestUpdate();
    });

    await expect(warning).not.toBeVisible();
    await expect(saveBtn).toBeEnabled();
});

test('Page Editor: A11y Hitbox check', async ({page}) => {
    const importBtn = page.locator('button').filter({hasText: /Import/i});
    const fileChooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
        name: 'test-doc.png',
        mimeType: 'image/png',
        buffer: Buffer.from(MOCK_IMAGE_BASE64, 'base64')
    });

    const editor = page.locator('page-editor');
    await expect(editor).toBeVisible();

    const canvas = editor.locator('canvas[data-edges]');
    await canvas.waitFor({state: 'visible'});
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas box not found");

    // Click 25px away from corner (0,0). Hit radius is 32px CSS.
    // This confirms the larger touch target is active.
    await page.mouse.move(box.x + 25, box.y + 25);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100, {steps: 5});
    await page.mouse.up();

    const undoBtn = page.locator('button[title="Undo"]');
    await expect(undoBtn).toBeEnabled();
});
