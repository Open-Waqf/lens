/**
 * Optimized "Magic Color" Filter
 * * Instead of calculating integral images for R, G, and B separately (slow),
 * we calculate ONE integral image for Luminance.
 * * We assume shadows are just a drop in luminance. We calculate the local
 * luminance average and apply a gain to boost dark areas to the target white.
 */

export function magicColorFromRgba(
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    radius = 20
): Uint8ClampedArray {
    const n = w * h;
    const len = n * 4;
    const out = new Uint8ClampedArray(len);

    const iw = w + 1;
    const ih = h + 1;

    // Use Int32 for performance, assuming image isn't gigapixel
    const integral = new Int32Array(iw * ih);

    // 1. Pass 1: Build Luminance Integral Image
    // Doing this once is 3x faster than per-channel
    let idx = 0;
    for (let y = 1; y <= h; y++) {
        let rowSum = 0;
        const rowOffset = y * iw;
        const prevRowOffset = (y - 1) * iw;

        for (let x = 1; x <= w; x++) {
            const r = rgba[idx];
            const g = rgba[idx + 1];
            const b = rgba[idx + 2];

            // Perceived luminance
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) | 0;

            rowSum += lum;
            integral[rowOffset + x] = integral[prevRowOffset + x] + rowSum;
            idx += 4;
        }
    }

    // 2. Pass 2: Apply Gain
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(h - 1, y + radius);
        const hSide = y1 - y0 + 1;

        const I_D_Base = (y1 + 1) * iw;
        const I_B_Base = y0 * iw;
        const rowIdx = y * w * 4;

        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - radius);
            const x1 = Math.min(w - 1, x + radius);

            const D = I_D_Base + (x1 + 1);
            const B = I_B_Base + (x1 + 1);
            const C = I_D_Base + x0;
            const A = I_B_Base + x0;

            const count = (x1 - x0 + 1) * hSide;
            const sum = integral[D] - integral[B] - integral[C] + integral[A];

            // Local background luminance
            const bgLum = sum / count;

            // Target luminance is usually around 200-240 for "white paper"
            // We calculate a Gain Factor to boost this pixel
            // If local bg is dark (shadow), gain is high. If light, gain is near 1.
            // We cap gain to avoid exploding noise in pure black areas.
            let gain = 240 / (bgLum + 10);
            if (gain > 2.5) gain = 2.5;
            if (gain < 1.0) gain = 1.0;

            const i = rowIdx + (x * 4);

            let r = rgba[i] * gain;
            let g = rgba[i + 1] * gain;
            let b = rgba[i + 2] * gain;

            // Simple S-Curve for contrast
            // Makes text darker and paper whiter
            r = r > 255 ? 255 : r;
            g = g > 255 ? 255 : g;
            b = b > 255 ? 255 : b;

            out[i] = r;
            out[i + 1] = g;
            out[i + 2] = b;
            out[i + 3] = 255;
        }
    }

    return out;
}
