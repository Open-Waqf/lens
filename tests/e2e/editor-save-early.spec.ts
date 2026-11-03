// editor-save-early.spec.ts: Save works even when tapped while the editor is still working.
import {expect, test} from './support/test';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('sahifah.welcomeSeen', '1'));
});

test('E.1 Save tapped at once, while the editor still loads and detects edges, saves the page', async ({page}) => {
    // Regression (Nov 2026): Save was disabled while the editor detected edges or drew its
    // preview, and a tap in that moment did nothing, with no feedback.
    await page.goto('/#/scan?new=1');
    await page.locator('#import-input').setInputFiles('tests/test-images/page1.jpg');
    await page.evaluate(async () => {
        const input = document.querySelector('#import-input') as HTMLInputElement;
        await (document.querySelector('scan-page') as any).openNewBlobInEditor(input.files![0]);
        // Tap Save as soon as it exists, like an impatient user, without waiting for anything.
        await new Promise<void>((resolve) => {
            const tap = () => {
                const save = document.querySelector('page-editor button[aria-label="Save Scan"]') as HTMLButtonElement | null;
                if (save) { save.click(); resolve(); } else requestAnimationFrame(tap);
            };
            tap();
        });
    });
    await expect(page.locator('page-editor')).toBeHidden({timeout: 15_000});
    await expect(page.getByText('1 page(s)')).toBeVisible();
});
