// contrast-all.spec.ts: every visible text on the main screens is readable (WCAG AA).
// Small text needs a contrast of at least 4.5:1, large text (24 px, or 18.7 px bold) 3:1.
// The colour behind a text is found by blending the backgrounds of its parents, so
// translucent cards (bg-slate-900/50) count too.
import {expect, test, type Page} from './support/test';

async function lowContrastTexts(page: Page) {
    return page.evaluate(() => {
        // Any CSS colour (Tailwind 4 uses oklch) to RGBA, through a 1-pixel canvas.
        const ctx = document.createElement('canvas').getContext('2d', {willReadFrequently: true})!;
        let parsed = 0;
        const parse = (c: string) => {
            if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return {r: 0, g: 0, b: 0, a: 0};
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = '#000';
            ctx.fillStyle = c;
            ctx.fillRect(0, 0, 1, 1);
            const d = ctx.getImageData(0, 0, 1, 1).data;
            parsed++;
            return {r: d[0], g: d[1], b: d[2], a: d[3] / 255};
        };
        const lum = ({r, g, b}: {r: number; g: number; b: number}) => {
            const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const blend = (top: any, under: any) => ({
            r: top.r * top.a + under.r * (1 - top.a),
            g: top.g * top.a + under.g * (1 - top.a),
            b: top.b * top.a + under.b * (1 - top.a), a: 1,
        });
        const backgroundOf = (el: Element) => {
            const layers: any[] = [];
            for (let n: Element | null = el; n; n = n.parentElement) {
                const c = parse(getComputedStyle(n).backgroundColor);
                if (c && c.a > 0) layers.push(c);
                if (c && c.a >= 1) break;
            }
            let bg = {r: 2, g: 6, b: 23, a: 1}; // body: slate-950
            for (const l of layers.reverse()) bg = blend(l, bg);
            return bg;
        };
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            const text = (t.textContent || '').trim();
            const el = t.parentElement;
            if (!text || !el) continue;
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || style.visibility === 'hidden' || Number(style.opacity) < 0.1) continue;
            if (el.closest('[aria-hidden="true"], .sr-only, button:disabled')) continue;
            const fg = parse(style.color);
            if (!fg) continue;
            const bg = backgroundOf(el);
            const color = blend(fg, bg);
            const [l1, l2] = [lum(color), lum(bg)].sort((a, b) => b - a);
            const ratio = (l1 + 0.05) / (l2 + 0.05);
            const size = parseFloat(style.fontSize);
            const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
            if (ratio < (large ? 3 : 4.5)) out.push(`${ratio.toFixed(2)} "${text.slice(0, 40)}" (${el.className.toString().match(/text-[a-z]+-\d+(\/\d+)?/g)?.join(' ') || style.color})`);
        }
        if (parsed === 0) out.push('no colours were read: the check itself is broken');
        return [...new Set(out)];
    });
}

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        localStorage.setItem('sahifah.welcomeSeen', '1');
        localStorage.setItem('sahifah.storageBanner.dismissed', '1');
    });
});

for (const [name, hash] of [['library', '#/library'], ['scan', '#/scan?new=1'], ['settings', '#/settings']]) {
    test(`C.1 all text on the ${name} screen meets WCAG AA contrast @rtl`, async ({page}) => {
        await page.goto('/' + hash);
        await page.waitForTimeout(300);
        expect(await lowContrastTexts(page)).toEqual([]);
    });
}

test('C.2 all text on a document page meets WCAG AA contrast @rtl', async ({page}) => {
    await page.goto('/#/library');
    await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => { const q = indexedDB.open('sahifah-lens'); q.onsuccess = () => resolve(q.result); });
        await new Promise<void>((resolve) => {
            const tx = db.transaction(['docs', 'pages'], 'readwrite');
            tx.objectStore('docs').put({id: 'c_doc', title: 'Contrast', folder: 'Home', tags: [], pageIds: ['c_p'], createdAt: 1, updatedAt: 1});
            tx.objectStore('pages').put({id: 'c_p', docId: 'c_doc', imagePath: 'x.jpg', thumbPath: 'x_t.jpg', width: 10, height: 10, rotation: 0, createdAt: 1,
                words: [{text: 'hello', box: [0.1, 0.1, 0.1, 0.1], confidence: 90}]});
            tx.oncomplete = () => resolve();
        });
        db.close();
    });
    await page.goto('/#/doc/c_doc');
    // A plain tap at the button's centre (Playwright's click safety check misreads this
    // button when the storage banner is dismissed; a real tap works, checked Nov 2026).
    const toggle = page.locator('doc-page button.text-emerald-400').first();
    const box = (await toggle.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('doc-page .whitespace-pre-wrap').first()).toBeVisible();
    await page.waitForTimeout(300);
    expect(await lowContrastTexts(page)).toEqual([]);
});

test('C.3 all text in the page editor meets WCAG AA contrast @rtl', async ({page}) => {
    await page.goto('/#/scan?new=1');
    await page.locator('#import-input').setInputFiles('tests/test-images/page1.jpg');
    await page.evaluate(async () => {
        const input = document.querySelector('#import-input') as HTMLInputElement;
        await (document.querySelector('scan-page') as any).openNewBlobInEditor(input.files![0]);
    });
    await expect(page.locator('page-editor')).toBeVisible();
    await page.waitForTimeout(800);
    expect(await lowContrastTexts(page)).toEqual([]);
});
