/**
 * Sauvola Adaptive Thresholding
 * The gold standard for document binarization.
 * * Unlike simple adaptive thresholding (Mean - C), Sauvola uses local variance
 * to determine if a region is "active" (text) or "flat" (background).
 * This prevents noise in empty areas and detects faint text better.
 * * Formula: T = m * (1 + k * (s / R - 1))
 * m = local mean
 * s = local standard deviation
 * k = 0.34 (sensitivity)
 * R = 128 (dynamic range)
 */
export function adaptiveBwFromRgba(
    rgba: Uint8ClampedArray,
    w: number,
    h: number
): Uint8ClampedArray {
    const n = w * h;

    // We need 2 integral images: Sum and Sum of Squares (for StdDev)
    // We use Float64 to prevent overflow on large images (e.g. 12MP)
    // For mobile, Float64Array is reasonably fast.
    const iw = w + 1;
    const ih = h + 1;
    const integralSum = new Float64Array(iw * ih);
    const integralSqSum = new Float64Array(iw * ih);
    const gray = new Uint8Array(n);

    // 1. Pass 1: Grayscale & Fill Integrals
    // Optimized to do everything in one loop to keep memory hot
    let idx = 0;
    for (let y = 1; y <= h; y++) {
        let rowSum = 0;
        let rowSqSum = 0;
        const rowOffset = y * iw;
        const prevRowOffset = (y - 1) * iw;

        for (let x = 1; x <= w; x++) {
            const r = rgba[idx];
            const g = rgba[idx + 1];
            const b = rgba[idx + 2];

            // Fast luminance approximation
            const val = (r * 77 + g * 150 + b * 29) >> 8;
            gray[(y - 1) * w + (x - 1)] = val;

            rowSum += val;
            rowSqSum += val * val;

            integralSum[rowOffset + x] = integralSum[prevRowOffset + x] + rowSum;
            integralSqSum[rowOffset + x] = integralSqSum[prevRowOffset + x] + rowSqSum;

            idx += 4;
        }
    }

    const out = new Uint8ClampedArray(n * 4);

    // Sauvola Parameters
    // Window size: 2 * r + 1.
    // Larger r = handles bigger font/shadows but slower. 16 is a good sweet spot.
    const r = 16;
    const k = 0.34; // Sensitivity (0.2 - 0.5). Higher = thinner text, less noise.
    const R = 128; // Standard dynamic range constant

    // 2. Pass 2: Calculate Threshold per Pixel
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r);
        const y1 = Math.min(h - 1, y + r);

        const rowIdx = y * w;
        const rowOutIdx = rowIdx * 4;

        const I_D_Base = (y1 + 1) * iw;
        const I_B_Base = y0 * iw;

        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - r);
            const x1 = Math.min(w - 1, x + r);

            // Integral Image Lookups
            const A_x = x0;
            const B_x = x1 + 1;

            const count = (x1 - x0 + 1) * (y1 - y0 + 1);

            const sum = integralSum[I_D_Base + B_x]
                - integralSum[I_B_Base + B_x]
                - integralSum[I_D_Base + A_x]
                + integralSum[I_B_Base + A_x];

            const sqSum = integralSqSum[I_D_Base + B_x]
                - integralSqSum[I_B_Base + B_x]
                - integralSqSum[I_D_Base + A_x]
                + integralSqSum[I_B_Base + A_x];

            const m = sum / count;
            // Variance = E[x^2] - (E[x])^2
            const v = (sqSum / count) - (m * m);
            // Standard Deviation
            const s = Math.sqrt(Math.max(0, v));

            // Sauvola Formula
            const t = m * (1 + k * ((s / R) - 1));

            const val = gray[rowIdx + x];
            const bin = val < t ? 0 : 255;

            const outIdx = rowOutIdx + (x * 4);
            out[outIdx] = bin;
            out[outIdx + 1] = bin;
            out[outIdx + 2] = bin;
            out[outIdx + 3] = 255;
        }
    }

    return out;
}