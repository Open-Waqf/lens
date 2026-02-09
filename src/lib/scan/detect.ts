import {DetectedQuad, orderQuad, type Point, quadArea} from './quad';

export function detectQuadFromRgba(rgba: Uint8ClampedArray, w: number, h: number): DetectedQuad {
    const n = w * h;
    const gray = new Uint8Array(n);

    // 1. Convert to Grayscale
    for (let i = 0, j = 0; i < n; i++, j += 4) {
        const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
        gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    }

    // 2. Sobel Magnitude (Gradient detection)
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

    // 3. Dynamic Thresholding with CENTER BIAS
    const mean = sum / count;
    const baseThr = mean + mean * 0.40; // Slightly higher base threshold

    const pts: Point[] = [];
    // Sample less densely for speed
    const step = Math.max(2, Math.floor(Math.min(w, h) / 160));
    let edgeHits = 0;

    const cx = w / 2;
    const cy = h / 2;
    // Max distance from center to corner
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 2; y < h - 2; y += step) {
        const row = y * w;
        for (let x = 2; x < w - 2; x += step) {
            const i = row + x;

            // SMART LOGIC:
            // Calculate distance from center (0.0 at center, 1.0 at corner)
            const dist = Math.hypot(x - cx, y - cy);
            const distRatio = dist / maxDist;

            // EXPONENTIAL PENALTY for corners
            // distRatio^3 makes it stay low in the middle but skyrocket at the edges.
            // At center: 1 + 0 = 1x threshold
            // At 50% out: 1 + 0.125 * 50 = 7x threshold (Harder)
            // At corner: 1 + 1 * 50 = 51x threshold (Impossible)
            const bias = 1 + (Math.pow(distRatio, 3) * 50);

            if (mags[i] > baseThr * bias) {
                edgeHits++;
                pts.push({x, y});
            }
        }
    }

    if (pts.length < 50) {
        return {quad: null, confidence: clamp01(edgeHits / 200), width: w, height: h};
    }

    // 4. Fit Quad
    const quad = orderQuad(pts);
    if (!quad) return {quad: null, confidence: 0.15, width: w, height: h};

    const area = quadArea(quad);
    const frameArea = w * h;
    const areaRatio = area / frameArea;

    // Reject suspicious shapes
    if (areaRatio < 0.1 || areaRatio > 0.99) {
        return {quad: null, confidence: 0.2, width: w, height: h};
    }

    // 5. Centrality Scoring
    // Calculate centroid of the detected quad
    let qcx = 0, qcy = 0;
    for (const p of quad) {
        qcx += p.x;
        qcy += p.y;
    }
    qcx /= 4;
    qcy /= 4;

    // Penalize if the document center is far from the screen center
    const quadDist = Math.hypot(qcx - cx, qcy - cy);
    const centralityScore = 1 - Math.min(1, quadDist / (maxDist * 0.8));

    const density = clamp01(pts.length / 800);
    const areaScore = 1 - Math.abs(areaRatio - 0.60);

    // Weighted confidence
    const conf = clamp01(
        0.20 +
        density * 0.30 +
        clamp01(areaScore) * 0.30 +
        centralityScore * 0.20
    );

    return {quad, confidence: conf, width: w, height: h};
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}