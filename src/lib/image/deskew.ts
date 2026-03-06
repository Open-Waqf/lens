export type DeskewEstimate = {
    angleDeg: number;
    confidence: number;
    samples: number;
};

const DESKEW_MAX_ABS_DEG = 3;
const DESKEW_MIN_APPLY_DEG = 0.6;
const DESKEW_MIN_CONFIDENCE = 0.08;
const DESKEW_MIN_SAMPLES = 400;
const DESKEW_MARGIN_RATIO = 0.08;

export function estimateDeskewAngleFromRgba(
    rgba: Uint8ClampedArray,
    width: number,
    height: number
): DeskewEstimate {
    if (width < 40 || height < 40) return {angleDeg: 0, confidence: 0, samples: 0};

    const scale = Math.min(1, 900 / Math.max(width, height));
    const stride = Math.max(1, Math.ceil(1 / Math.max(scale, 0.01)));
    const marginX = Math.floor(width * DESKEW_MARGIN_RATIO);
    const marginY = Math.floor(height * DESKEW_MARGIN_RATIO);
    const x0 = Math.max(0, marginX);
    const y0 = Math.max(0, marginY);
    const x1 = Math.max(x0 + 1, width - marginX);
    const y1 = Math.max(y0 + 1, height - marginY);

    let sum = 0;
    let sampleCount = 0;
    for (let y = y0; y < y1; y += stride) {
        for (let x = x0; x < x1; x += stride) {
            const i = (y * width + x) * 4;
            const lum = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
            sum += lum;
            sampleCount++;
        }
    }
    if (sampleCount === 0) return {angleDeg: 0, confidence: 0, samples: 0};

    const meanLum = sum / sampleCount;
    const darkThresh = Math.max(20, Math.min(220, meanLum * 0.82));

    const pointsX: number[] = [];
    const pointsY: number[] = [];

    for (let y = y0; y < y1; y += stride) {
        for (let x = x0; x < x1; x += stride) {
            const i = (y * width + x) * 4;
            const lum = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
            if (lum < darkThresh) {
                pointsX.push(Math.round(x * scale));
                pointsY.push(Math.round(y * scale));
            }
        }
    }

    if (pointsX.length < DESKEW_MIN_SAMPLES) return {angleDeg: 0, confidence: 0, samples: pointsX.length};

    const sw = Math.max(1, Math.round(width * scale));
    const sh = Math.max(1, Math.round(height * scale));
    const diag = Math.ceil(Math.hypot(sw, sh));
    const offset = diag;
    const bins = diag * 2 + 3;

    let bestAngle = 0;
    let bestScore = -Infinity;
    let secondScore = -Infinity;

    for (let a = -DESKEW_MAX_ABS_DEG; a <= DESKEW_MAX_ABS_DEG + 1e-9; a += 0.25) {
        const rad = (a * Math.PI) / 180;
        const sin = Math.sin(rad);
        const cos = Math.cos(rad);
        const hist = new Uint16Array(bins);

        for (let p = 0; p < pointsX.length; p++) {
            const row = Math.round((-pointsX[p] * sin) + (pointsY[p] * cos)) + offset;
            if (row >= 0 && row < bins) hist[row]++;
        }

        let hs = 0;
        let hs2 = 0;
        for (let i = 0; i < bins; i++) {
            const v = hist[i];
            hs += v;
            hs2 += v * v;
        }

        const mean = hs / bins;
        const variance = hs2 / bins - mean * mean;
        if (variance > bestScore) {
            secondScore = bestScore;
            bestScore = variance;
            bestAngle = a;
        } else if (variance > secondScore) {
            secondScore = variance;
        }
    }

    const confidence = bestScore > 0 ? Math.max(0, (bestScore - secondScore) / bestScore) : 0;
    return {angleDeg: bestAngle, confidence, samples: pointsX.length};
}

export function shouldApplyDeskew(est: DeskewEstimate): boolean {
    return (
        est.samples >= DESKEW_MIN_SAMPLES &&
        Math.abs(est.angleDeg) >= DESKEW_MIN_APPLY_DEG &&
        est.confidence >= DESKEW_MIN_CONFIDENCE
    );
}

export function rotateRgbaCanvas(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    angleDeg: number
): Uint8ClampedArray {
    if (Math.abs(angleDeg) < 0.01) return rgba;

    const srcCanvas = new OffscreenCanvas(width, height);
    const sctx = srcCanvas.getContext('2d')!;
    sctx.putImageData(new ImageData(rgba as any, width, height), 0, 0);

    const out = new OffscreenCanvas(width, height);
    const octx = out.getContext('2d')!;
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, width, height);
    octx.translate(width / 2, height / 2);
    octx.rotate((angleDeg * Math.PI) / 180);
    octx.drawImage(srcCanvas, -width / 2, -height / 2);

    return octx.getImageData(0, 0, width, height).data;
}

export function applyConservativeDeskew(
    rgba: Uint8ClampedArray,
    width: number,
    height: number
): Uint8ClampedArray {
    const pre = estimateDeskewAngleFromRgba(rgba, width, height);
    if (!shouldApplyDeskew(pre)) return rgba;

    const rotated = rotateRgbaCanvas(rgba, width, height, pre.angleDeg);
    const post = estimateDeskewAngleFromRgba(rotated, width, height);
    if (Math.abs(post.angleDeg) + 0.15 < Math.abs(pre.angleDeg)) return rotated;

    const rotatedAlt = rotateRgbaCanvas(rgba, width, height, -pre.angleDeg);
    const postAlt = estimateDeskewAngleFromRgba(rotatedAlt, width, height);
    if (Math.abs(postAlt.angleDeg) + 0.15 < Math.abs(pre.angleDeg)) return rotatedAlt;

    return rgba;
}
