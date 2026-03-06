import {describe, expect, it} from 'vitest';
import {estimateDeskewAngleFromRgba, shouldApplyDeskew} from '../../src/lib/image/deskew';

function makeWhiteRgba(w: number, h: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < out.length; i += 4) {
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
        out[i + 3] = 255;
    }
    return out;
}

function setPixel(img: Uint8ClampedArray, w: number, h: number, x: number, y: number, v: number) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    img[i] = v;
    img[i + 1] = v;
    img[i + 2] = v;
    img[i + 3] = 255;
}

function drawSlantedTextLikeLines(img: Uint8ClampedArray, w: number, h: number, deg: number) {
    const m = Math.tan((deg * Math.PI) / 180);
    for (let baseY = 40; baseY < h - 40; baseY += 22) {
        for (let x = 30; x < w - 30; x++) {
            const y = Math.round(baseY + m * (x - w / 2));
            setPixel(img, w, h, x, y, 0);
            setPixel(img, w, h, x, y + 1, 0);
        }
    }
}

describe('deskew estimation', () => {
    it('detects near-zero angle for flat synthetic text lines', () => {
        const w = 700;
        const h = 500;
        const rgba = makeWhiteRgba(w, h);
        drawSlantedTextLikeLines(rgba, w, h, 0);

        const est = estimateDeskewAngleFromRgba(rgba, w, h);
        expect(Math.abs(est.angleDeg)).toBeLessThanOrEqual(0.5);
        expect(shouldApplyDeskew(est)).toBe(false);
    });

    it('detects a small synthetic skew and marks it as actionable', () => {
        const w = 700;
        const h = 500;
        const rgba = makeWhiteRgba(w, h);
        drawSlantedTextLikeLines(rgba, w, h, 2.0);

        const est = estimateDeskewAngleFromRgba(rgba, w, h);
        expect(Math.abs(est.angleDeg)).toBeGreaterThan(0.6);
        expect(Math.abs(est.angleDeg)).toBeLessThanOrEqual(3);
        expect(est.samples).toBeGreaterThan(400);
        expect(shouldApplyDeskew(est)).toBe(true);
    });
});
