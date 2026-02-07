import {expect, test} from '@playwright/test';

test('Scan 1 page (mock) → open doc → export PDF', async ({page}) => {
    await page.goto('/?mockCam=1#/scan');

    await page.getByRole('button', {name: 'Capture'}).click();
    await page.getByRole('button', {name: 'Add page to session'}).click();
    await page.getByRole('button', {name: 'Finish → Open document'}).click();

    await expect(page.getByText(/Pages \(\d+\)/)).toBeVisible();

    // Export PDF (will fallback to download in headless)
    await page.getByRole('button', {name: 'Export PDF'}).click();
});
