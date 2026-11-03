// rtl.spec.ts: the app in Arabic (right-to-left) on a phone. Runs in the phone-ar project.
import {expect, test, type Page} from './support/test';

// No screen may scroll sideways in Arabic (a common right-to-left layout bug).
async function expectNoSidewaysScroll(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('sahifah.welcomeSeen', '1'));
});

test('R.1 the phone language picks Arabic, right-to-left, on first start @rtl-only', async ({page}) => {
    await page.goto('/#/library');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', {name: 'المكتبة'})).toBeVisible();
});

test('R.2 library, scan and settings fit the screen in Arabic @rtl-only', async ({page}) => {
    for (const [hash, heading] of [['#/library', 'المكتبة'], ['#/scan?new=1', 'المسح'], ['#/settings', 'الإعدادات']]) {
        await page.goto('/' + hash);
        await expect(page.getByText(heading, {exact: true}).first()).toBeVisible();
        await expectNoSidewaysScroll(page);
    }
});

test('R.3 the bottom bar reads right to left: Library on the right, Settings on the left @rtl-only', async ({page}) => {
    await page.goto('/#/library');
    const library = await page.getByRole('navigation').getByRole('link', {name: 'المكتبة'}).boundingBox();
    const settings = await page.getByRole('navigation').getByRole('link', {name: 'الإعدادات'}).boundingBox();
    expect(library!.x).toBeGreaterThan(settings!.x);
});
