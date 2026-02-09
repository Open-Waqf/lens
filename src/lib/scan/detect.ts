import {DetectedQuad, orderQuad, type Point, type Quad, quadArea} from './quad';

function log(msg: string) {
    console.log(`%c[Detect] ${msg}`, 'color: cyan; background: #222;');
}

export function detectQuadFromRgba(rgba: Uint8ClampedArray, w: number, h: number): DetectedQuad {
    const start = performance.now();
    const n = w * h;

    // ---------------------------------------------------------
    // 1. PRE-PROCESS: Grayscale + Blur
    // ---------------------------------------------------------
    const gray = new Uint8Array(n);
    const blur = new Uint8Array(n);

    for (let i = 0, j = 0; i < n; i++, j += 4) {
        gray[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) | 0;
    }

    // 3x3 Box Blur
    for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
            const i = row + x;
            blur[i] = (
                gray[i - w - 1] + gray[i - w] + gray[i - w + 1] +
                gray[i - 1] + gray[i] + gray[i + 1] +
                gray[i + w - 1] + gray[i + w] + gray[i + w + 1]
            ) / 9;
        }
    }

    // ---------------------------------------------------------
    // 2. SOBEL GRADIENTS
    // ---------------------------------------------------------
    const mags = new Uint16Array(n);
    let sumMag = 0;
    let sumSqMag = 0;
    let count = 0;
    const edgePoints: number[] = [];

    for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
            const i = row + x;
            const dx = -blur[i - w - 1] - 2 * blur[i - 1] - blur[i + w - 1] + blur[i - w + 1] + 2 * blur[i + 1] + blur[i + w + 1];
            const dy = -blur[i - w - 1] - 2 * blur[i - w] - blur[i - w + 1] + blur[i + w - 1] + 2 * blur[i + w] + blur[i + w + 1];
            const m = Math.abs(dx) + Math.abs(dy);
            mags[i] = m;
            sumMag += m;
            sumSqMag += m * m;
            count++;
        }
    }

    if (count === 0) return {quad: null, confidence: 0, width: w, height: h};

    const mean = sumMag / count;
    const stdDev = Math.sqrt((sumSqMag / count) - (mean * mean));
    const edgeThresh = mean + stdDev * 1.5;

    // Collect Strong Edges
    for (let y = 2; y < h - 2; y++) {
        const row = y * w;
        for (let x = 2; x < w - 2; x++) {
            const i = row + x;
            if (mags[i] > edgeThresh) {
                edgePoints.push(i);
            }
        }
    }

    // ---------------------------------------------------------
    // 3. FAST HOUGH TRANSFORM (Line Voting)
    // ---------------------------------------------------------
    const rhoRes = 2;
    const numTheta = 180;
    const thetaRes = Math.PI / 180;

    const maxRho = Math.ceil(Math.hypot(w, h));
    const numRho = Math.ceil((2 * maxRho) / rhoRes);
    const centerRho = Math.floor(numRho / 2);

    const accumulator = new Uint16Array(numRho * numTheta);

    const cosTable = new Float32Array(numTheta);
    const sinTable = new Float32Array(numTheta);
    for (let t = 0; t < numTheta; t++) {
        const angle = t * thetaRes;
        cosTable[t] = Math.cos(angle);
        sinTable[t] = Math.sin(angle);
    }

    for (const idx of edgePoints) {
        const x = idx % w;
        const y = (idx / w) | 0;

        for (let t = 0; t < numTheta; t++) {
            const rhoVal = x * cosTable[t] + y * sinTable[t];
            const rIdx = Math.floor(rhoVal / rhoRes) + centerRho;
            if (rIdx >= 0 && rIdx < numRho) {
                accumulator[t * numRho + rIdx]++;
            }
        }
    }

    // ---------------------------------------------------------
    // 4. FIND PEAKS (Dominant Lines)
    // ---------------------------------------------------------
    const lines: { rho: number, theta: number, score: number }[] = [];
    const minVotes = Math.max(30, edgePoints.length / 60);

    for (let i = 0; i < accumulator.length; i++) {
        const score = accumulator[i];
        if (score > minVotes) {

            // 2D Peak Check (3x3 Window in Hough Space)
            const tIdx = Math.floor(i / numRho);
            const rIdx = i % numRho;
            let isPeak = true;

            // Iterate -1 to +1 neighbors
            for (let dt = -1; dt <= 1; dt++) {
                for (let dr = -1; dr <= 1; dr++) {
                    if (dt === 0 && dr === 0) continue;

                    const ni = (tIdx + dt) * numRho + (rIdx + dr);
                    // Boundary check
                    if (ni >= 0 && ni < accumulator.length) {
                        if (accumulator[ni] > score) {
                            isPeak = false;
                            break;
                        }
                    }
                }
                if (!isPeak) break;
            }

            if (isPeak) {
                const rho = (rIdx - centerRho) * rhoRes;
                const theta = tIdx * thetaRes;
                lines.push({rho, theta, score});
            }
        }
    }

    // Sort by strength
    lines.sort((a, b) => b.score - a.score);

    // ---------------------------------------------------------
    // 5. SMART LINE SELECTION
    // ---------------------------------------------------------
    const uniqueLines: typeof lines = [];

    // We want to keep at least 6 lines to have a pool for intersection
    for (const l of lines) {
        if (uniqueLines.length >= 10) break;

        // Relaxed suppression:
        // Lines must be distinct in EITHER angle OR distance
        const isDuplicate = uniqueLines.some(u => {
            const dRho = Math.abs(u.rho - l.rho);
            const dTheta = Math.abs(u.theta - l.theta);

            // If angle is similar (< 12 deg) AND distance is close (< 30px) -> Duplicate
            // If angle is different, it's a new line (e.g. corner).
            return dRho < 30 && (dTheta < 0.2 || Math.abs(dTheta - Math.PI) < 0.2);
        });

        if (!isDuplicate) uniqueLines.push(l);
    }

    // ---------------------------------------------------------
    // 6. INTERSECTIONS -> QUAD CANDIDATES
    // ---------------------------------------------------------
    if (uniqueLines.length < 4) {
        // log(`FAILED: Found ${uniqueLines.length} lines. Need 4.`);
        return {quad: null, confidence: 0, width: w, height: h};
    }

    // Limit to top 6 lines to keep combinations manageable (15 pairs -> intersections)
    const limit = Math.min(uniqueLines.length, 6);
    const intersectionPoints: Point[] = [];

    for (let i = 0; i < limit; i++) {
        for (let j = i + 1; j < limit; j++) {
            const l1 = uniqueLines[i];
            const l2 = uniqueLines[j];

            // Only intersect non-parallel lines (> 20 degrees diff)
            const angleDiff = Math.abs(l1.theta - l2.theta);
            if (angleDiff > 0.35 && angleDiff < Math.PI - 0.35) {
                const det = Math.cos(l1.theta) * Math.sin(l2.theta) - Math.sin(l1.theta) * Math.cos(l2.theta);

                const x = (Math.sin(l2.theta) * l1.rho - Math.sin(l1.theta) * l2.rho) / det;
                const y = (Math.cos(l1.theta) * l2.rho - Math.cos(l2.theta) * l1.rho) / det;

                // Allow intersections slightly outside image (for cropped docs)
                if (x > -w * 0.1 && x < w * 1.1 && y > -h * 0.1 && y < h * 1.1) {
                    intersectionPoints.push({x, y});
                }
            }
        }
    }

    // ---------------------------------------------------------
    // 7. FORM QUAD & SCORE
    // ---------------------------------------------------------
    let bestQuad: { q: Quad, s: number } | null = null;

    if (intersectionPoints.length >= 4) {
        // Try the Convex Hull of all points
        // If that fails, we could try subsets, but usually the hull is correct
        // because true corners are the most "extreme" points.
        const q = orderQuad(intersectionPoints);
        if (q) {
            const {score, details} = scoreQuad(q, w, h, mags, mean, stdDev);
            if (score > 0) {
                bestQuad = {q, s: score};
            }
        }
    }

    if (!bestQuad || bestQuad.s === 0) {
        // log(`FAILED: Hough Lines found, but no valid quad formed.`);
        return {quad: null, confidence: 0, width: w, height: h};
    }

    log(`WINNER: Hough Score=${bestQuad.s.toFixed(2)}`);
    return {quad: bestQuad.q, confidence: bestQuad.s, width: w, height: h};
}

// ---------------------------------------------------------
// SCORING FUNCTION (Unchanged)
// ---------------------------------------------------------
function scoreQuad(q: Quad, w: number, h: number, mags: Uint16Array, mean: number, stdDev: number) {
    const area = quadArea(q);
    const ratio = area / (w * h);
    if (ratio < 0.05 || ratio > 0.99) return {score: 0, details: {ratio, reason: 'ratio'}};

    const z0 = checkSideZ(q[0], q[1], w, h, mags, mean, stdDev);
    const z1 = checkSideZ(q[1], q[2], w, h, mags, mean, stdDev);
    const z2 = checkSideZ(q[2], q[3], w, h, mags, mean, stdDev);
    const z3 = checkSideZ(q[3], q[0], w, h, mags, mean, stdDev);

    const zScores = [z0, z1, z2, z3].sort((a, b) => a - b);
    const [z_weak, z_mid1, z_mid2, z_strong] = zScores;

    const THRESH_WEAK = 0.3;
    const THRESH_STRONG = 0.8;

    const visibleSides = zScores.filter(z => z >= THRESH_WEAK).length;
    if (visibleSides < 3) return {score: 0, details: {zScores, reason: 'not_visible'}};
    if (z_weak < THRESH_WEAK && z_mid1 < THRESH_STRONG) return {
        score: 0,
        details: {zScores, reason: 'noise_hallucination'}
    };

    const norm = (z: number) => Math.min(1, Math.max(0, z / 2.0));
    let finalScore = 0;

    if (z_weak >= THRESH_STRONG) finalScore = (norm(z0) + norm(z1) + norm(z2) + norm(z3)) / 4;
    else finalScore = (norm(z_mid1) + norm(z_mid2) + norm(z_strong)) / 3;

    return {score: finalScore, details: {zScores, ratio}};
}

function checkSideZ(p1: Point, p2: Point, w: number, h: number, mags: Uint16Array, mean: number, stdDev: number): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.min(64, Math.max(8, Math.floor(len / 4)));

    let totalZ = 0;
    let validSamples = 0;
    const safeStd = Math.min(100, Math.max(10, stdDev));
    const minMag = mean;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.round(p1.x + dx * t);
        const y = Math.round(p1.y + dy * t);

        if (x >= 0 && x < w && y >= 0 && y < h) {
            const mag = mags[y * w + x];
            if (mag > minMag) {
                const z = (mag - mean) / safeStd;
                totalZ += z;
                validSamples++;
            }
        }
    }

    if (validSamples === 0) return 0;
    const continuity = validSamples / (steps + 1);
    const avgZ = totalZ / validSamples;

    return avgZ * continuity;
}