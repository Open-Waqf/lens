import {expect, test} from '@playwright/test';

test.describe('Scanning Flow', () => {

    test.beforeEach(async ({page}) => {
        // Bypass Welcome Screen by setting local storage
        await page.addInitScript(() => {
            localStorage.setItem('sahifah.welcomeSeen', '1');
        });
    });

    test('Scan 1 page → save → export PDF', async ({page}) => {
        // 1. Go to scan page (mock camera optional if implemented, otherwise uses black screen)
        await page.goto('/#/scan?new=1');

        // 2. Capture
        // Note: In a real e2e with camera access, we'd need to mock the media stream.
        // Assuming "Capture" button is visible and active.
        await page.getByRole('button', {name: 'Capture'}).click();

        // 3. Editor Step (New in Phase 2/4)
        // We expect the Page Editor to open. Click "Keep" or "Save" icon.
        // Adjust this selector based on your specific icon/button in page-editor.ts
        // If the button has no text, use a selector or aria-label.
        // Assuming there is a primary action button in the editor.
        // Wait for editor to appear
        await expect(page.locator('page-editor')).toBeVisible();
        // Click the main action button in the editor (usually bottom right)
        await page.locator('page-editor button').last().click();

        // 4. Back at Scan Page
        await expect(page.locator('page-editor')).not.toBeVisible();

        // 5. Finish / Save
        // The button label changes dynamically: "Save (1)"
        await page.getByRole('button', {name: /Save \(\d+\)/}).click();

        // 6. Doc Page
        await expect(page.getByText(/Pages \(\d+\)/)).toBeVisible();

        // 7. Export PDF
        await page.getByRole('button', {name: 'Export PDF'}).click();
    });

    test('Welcome screen appears on first run', async ({page}) => {
        // Clear storage to force welcome screen
        await page.addInitScript(() => localStorage.clear());
        await page.goto('/');

        await expect(page.getByText('Welcome to Lens')).toBeVisible();
        await page.getByRole('button', {name: 'Start Scanning'}).click();

        // Should navigate to scan
        await expect(page).toHaveURL(/.*#\/scan/);
    });
});