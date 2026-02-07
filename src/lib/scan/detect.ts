import {DetectedQuad, orderQuad, type Point, quadArea} from './quad';

export function detectQuadFromRgba(rgba: Uint8ClampedArray, w: number, h: number): DetectedQuad {
    // Convert to grayscale + simple Sobel magnitude, then pick strong edge points.
    const n = w * h;
    const gray = new Uint8Array(n);

    for (let i = 0, j = 0; i < n; i++, j += 4) {
        const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
        gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    }

    // Sobel magnitude (skip borders)
    const mags: Uint16Array = new Uint16Array(n);
    let sum = 0;
    let count = 0;

    for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
            const i = row + x;

            const gx =
                -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
                gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];

            const gy =
                -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
                gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];

            const mag = Math.min(65535, Math.abs(gx) + Math.abs(gy));
            mags[i] = mag;

            sum += mag;
            count++;
        }
    }

    if (count === 0) return {quad: null, confidence: 0, width: w, height: h};

    // Threshold: mean + k*mean/2 (simple, works surprisingly well)
    const mean = sum / count;
    const thr = mean + mean * 0.35;

    const pts: Point[] = [];
    // sample to keep fast
    const step = Math.max(2, Math.floor(Math.min(w, h) / 160)); // ~160 points per axis max
    let edgeHits = 0;

    for (let y = 2; y < h - 2; y += step) {
        const row = y * w;
        for (let x = 2; x < w - 2; x += step) {
            const i = row + x;
            if (mags[i] > thr) {
                edgeHits++;
                pts.push({x, y});
            }
        }
    }

    if (pts.length < 50) {
        return {quad: null, confidence: clamp01(edgeHits / 200), width: w, height: h};
    }

    const quad = orderQuad(pts);
    if (!quad) return {quad: null, confidence: 0.15, width: w, height: h};

    const area = quadArea(quad);
    const frameArea = w * h;

    // reject tiny / huge weird shapes
    const areaRatio = area / frameArea;
    if (areaRatio < 0.12 || areaRatio > 0.98) {
        return {quad: null, confidence: 0.2, width: w, height: h};
    }

    // confidence based on edge density + area ratio
    const density = clamp01(pts.length / 800);
    const areaScore = 1 - Math.abs(areaRatio - 0.55); // best when doc covers ~55% of frame
    const conf = clamp01(0.25 + density * 0.45 + clamp01(areaScore) * 0.35);

    return {quad, confidence: conf, width: w, height: h};
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}
