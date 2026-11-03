// backup-compat.spec.ts: every backup in tests/fixtures/backups/ still restores.
// These files were exported by real releases and are never changed (see their README).
import path from 'node:path';
import {expect, test} from './support/test';

const FIXTURES = [
    {file: 'lens-0.5.0-2026-11.slbk', password: 'fixture-2026-11', title: 'Backup fixture 2026-11 عقد', pages: 2},
];

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('sahifah.welcomeSeen', '1'));
});

for (const fx of FIXTURES) {
    test(`K.1 a backup from ${fx.file} restores with its documents and page images`, async ({page}) => {
        await page.goto('/#/settings');
        const chooser = page.waitForEvent('filechooser');
        await page.locator('text=Restore Backup').click();
        await (await chooser).setFiles(path.resolve('tests/fixtures/backups', fx.file));
        await page.getByPlaceholder('Password').fill(fx.password);
        await page.getByRole('button', {name: 'Restore', exact: true}).click();
        await page.getByRole('button', {name: 'Replace my library'}).click({timeout: 30_000});
        await expect(page.getByText('Restore complete', {exact: false})).toBeVisible({timeout: 30_000});

        await page.goto('/#/library');
        await page.getByText(fx.title).click();
        // Every page image is really there and decodes (not just its database record).
        const thumbs = page.locator('[data-page-card-id] img');
        await expect(thumbs).toHaveCount(fx.pages);
        for (let i = 0; i < fx.pages; i++) {
            await expect.poll(() => thumbs.nth(i).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
        }
        await page.locator('[data-page-card-id] [role=button]').first().click();
        await expect.poll(() => page.locator('.fixed img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(100);
    });
}
