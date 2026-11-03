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

test('R.4 the Arabic library shows Arabic counts, dates and prompts, no English left @rtl-only', async ({page}) => {
    await page.goto('/#/library');
    await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => { const q = indexedDB.open('sahifah-lens'); q.onsuccess = () => resolve(q.result); });
        await new Promise<void>((resolve) => {
            const tx = db.transaction(['docs'], 'readwrite');
            const when = new Date('2026-11-03T10:00:00').getTime();
            // 6 documents and no backup yet: the "protect your data" prompt shows.
            for (let i = 0; i < 6; i++) {
                tx.objectStore('docs').put({id: `ar_${i}`, title: `وثيقة ${i}`, folder: null, tags: [],
                    pageIds: i === 0 ? ['p'] : ['p1', 'p2', 'p3'], createdAt: when, updatedAt: when - i});
            }
            tx.oncomplete = () => resolve();
        });
        db.close();
    });
    await page.reload();
    await expect(page.getByText('صفحة واحدة')).toBeVisible();
    await expect(page.getByText('عدد الصفحات: 3').first()).toBeVisible();
    await expect(page.getByText('احمِ بياناتك')).toBeVisible();
    const visible = await page.locator('main').innerText();
    // Only brand and format names may stay in Latin letters.
    const latin = visible.replace(/\b(Lens|Sahifah|PDF|OCR|slbk)\b/g, '').match(/[A-Za-z]{2,}/g) || [];
    expect(latin).toEqual([]);
});
