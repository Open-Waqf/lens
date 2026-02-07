// Fast adaptive threshold using an integral image.
// Good defaults: radius 18, c 12 (receipts/docs)
export function adaptiveBwFromRgba(
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    radius = 18,
    c = 12
): Uint8ClampedArray {
    const n = w * h;
    const gray = new Uint8Array(n);

    for (let i = 0, j = 0; i < n; i++, j += 4) {
        const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
        gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    }

    const iw = w + 1;
    const ih = h + 1;
    const integral = new Uint32Array(iw * ih);

    for (let y = 1; y <= h; y++) {
        let rowSum = 0;
        for (let x = 1; x <= w; x++) {
            const g = gray[(y - 1) * w + (x - 1)];
            rowSum += g;
            integral[y * iw + x] = integral[(y - 1) * iw + x] + rowSum;
        }
    }

    const out = new Uint8ClampedArray(n * 4);

    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(h - 1, y + radius);

        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - radius);
            const x1 = Math.min(w - 1, x + radius);

            const A = (y0) * iw + (x0);
            const B = (y0) * iw + (x1 + 1);
            const C = (y1 + 1) * iw + (x0);
            const D = (y1 + 1) * iw + (x1 + 1);

            const sum = integral[D] - integral[B] - integral[C] + integral[A];
            const area = (x1 - x0 + 1) * (y1 - y0 + 1);
            const mean = sum / area;

            const g = gray[y * w + x];
            const v = g < (mean - c) ? 0 : 255;

            const i = (y * w + x) * 4;
            out[i] = v;
            out[i + 1] = v;
            out[i + 2] = v;
            out[i + 3] = 255;
        }
    }

    return out;
}
