import {expect, test} from '@playwright/test';

type ContrastProbe = {
    selector: string;
    minRatio: number;
};

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        (window as any).navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    });
});

async function assertContrast(page: import('@playwright/test').Page, probes: ContrastProbe[]) {
    const failures = await page.evaluate((items) => {
        function parseRgbInPage(input: string): [number, number, number, number] | null {
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext('2d', {willReadFrequently: true});
            if (!ctx) return null;
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = 'rgba(0,0,0,0)';
            ctx.fillStyle = input;
            ctx.fillRect(0, 0, 1, 1);
            const data = ctx.getImageData(0, 0, 1, 1).data;
            return [data[0], data[1], data[2], data[3] / 255];
        }

        function srgbToLinearInPage(v: number): number {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        }

        function luminanceInPage(rgb: [number, number, number]): number {
            const [r, g, b] = rgb;
            return 0.2126 * srgbToLinearInPage(r) + 0.7152 * srgbToLinearInPage(g) + 0.0722 * srgbToLinearInPage(b);
        }

        function contrastInPage(fg: [number, number, number], bg: [number, number, number]): number {
            const l1 = luminanceInPage(fg);
            const l2 = luminanceInPage(bg);
            const lighter = Math.max(l1, l2);
            const darker = Math.min(l1, l2);
            return (lighter + 0.05) / (darker + 0.05);
        }

        function blendOver(
            top: [number, number, number, number],
            bottom: [number, number, number, number]
        ): [number, number, number, number] {
            const outA = top[3] + bottom[3] * (1 - top[3]);
            if (outA <= 0) return [0, 0, 0, 0];
            const r = (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / outA;
            const g = (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / outA;
            const b = (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / outA;
            return [r, g, b, outA];
        }

        function effectiveBg(el: Element): [number, number, number] {
            // App base is dark; use it as the bottom-most paint layer.
            let acc: [number, number, number, number] = [15, 23, 42, 1];
            let cur: Element | null = el;
            while (cur) {
                const parsed = parseRgbInPage(getComputedStyle(cur).backgroundColor);
                if (parsed && parsed[3] > 0) {
                    acc = blendOver(parsed, acc);
                    if (acc[3] >= 0.999) break;
                }
                cur = cur.parentElement;
            }
            return [acc[0], acc[1], acc[2]];
        }

        const out: Array<{ selector: string; ratio: number; minRatio: number; text: string; fg?: string; bg?: string }> = [];
        for (const item of items) {
            const el = document.querySelector(item.selector);
            if (!el) {
                out.push({selector: item.selector, ratio: 0, minRatio: item.minRatio, text: 'MISSING'});
                continue;
            }
            const fgParsed = parseRgbInPage(getComputedStyle(el).color);
            if (!fgParsed) {
                out.push({selector: item.selector, ratio: 0, minRatio: item.minRatio, text: 'NO_COLOR'});
                continue;
            }
            const bg = effectiveBg(el);
            const ratio = contrastInPage([fgParsed[0], fgParsed[1], fgParsed[2]], bg);
            if (ratio < item.minRatio) {
                out.push({
                    selector: item.selector,
                    ratio: Math.round(ratio * 100) / 100,
                    minRatio: item.minRatio,
                    text: (el.textContent || '').trim().slice(0, 80),
                    fg: `${Math.round(fgParsed[0])},${Math.round(fgParsed[1])},${Math.round(fgParsed[2])}`,
                    bg: `${Math.round(bg[0])},${Math.round(bg[1])},${Math.round(bg[2])}`,
                });
            }
        }
        return out;
    }, probes);

    expect(failures).toEqual([]);
}

test('contrast baseline: library, scan, settings key text meets WCAG AA', async ({page}) => {
    await page.goto('http://localhost:4173/#/library');
    await assertContrast(page, [
        {selector: 'h1', minRatio: 4.5},
        {selector: 'input[placeholder*="Search"]', minRatio: 4.5},
        {selector: 'nav span.text-\\[10px\\]', minRatio: 4.5},
    ]);

    await page.goto('http://localhost:4173/#/scan?new=1');
    await page.waitForSelector('.text-2xl.font-bold.tracking-tight');
    await assertContrast(page, [
        {selector: '.text-2xl.font-bold.tracking-tight', minRatio: 4.5},
        {selector: 'button.w-full.py-5.bg-emerald-600', minRatio: 4.5},
        {selector: 'button.w-full.py-4.text-slate-400', minRatio: 4.5},
    ]);

    await page.goto('http://localhost:4173/#/settings');
    await assertContrast(page, [
        {selector: 'h1.text-2xl', minRatio: 4.5},
        {selector: '#DangerZone h2', minRatio: 4.5},
        {selector: 'section .text-slate-200', minRatio: 4.5},
    ]);
});
