import {DetectedQuad, orderQuad, type Point, type Quad, quadArea} from './quad';

// Toggle this to true if you need to debug in the browser console
const DEBUG = false;

function log(msg: string) {
    if (DEBUG) console.log(`%c[Detect] ${msg}`, 'color: cyan; background: #222;');
}

export function detectQuadFromRgba(rgba: Uint8ClampedArray, w: number, h: number): DetectedQuad {
    // FIX 1: Removed unused 'start' variable
    const n = w * h;

    // ---------------------------------------------------------
    // 1. PRE-PROCESS
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
    // 2. SOBEL
    // ---------------------------------------------------------
    const mags = new Uint16Array(n);
    let sumMag = 0, sumSqMag = 0, count = 0;
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
    const variance = Math.max(0, (sumSqMag / count) - (mean * mean));
    const stdDev = Math.sqrt(variance);
    // Slightly lower threshold to visualize more lines
    const edgeThresh = mean + stdDev * 1.0;

    for (let y = 2; y < h - 2; y++) {
        const row = y * w;
        for (let x = 2; x < w - 2; x++) {
            const i = row + x;
            if (mags[i] > edgeThresh) edgePoints.push(i);
        }
    }

    // ---------------------------------------------------------
    // 3. HOUGH TRANSFORM
    // ---------------------------------------------------------
    const rhoRes = 2, numTheta = 180, thetaRes = Math.PI / 180;
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
            if (rIdx >= 0 && rIdx < numRho) accumulator[t * numRho + rIdx]++;
        }
    }

    // ---------------------------------------------------------
    // 4. FIND LINES
    // ---------------------------------------------------------
    interface Line {
        rho: number;
        theta: number;
        score: number;
    }

    const horizLines: Line[] = [];
    const vertLines: Line[] = [];

    // Low vote threshold to see everything
    const minVotes = Math.max(15, edgePoints.length / 100);

    for (let i = 0; i < accumulator.length; i++) {
        const score = accumulator[i];
        if (score > minVotes) {
            const tIdx = Math.floor(i / numRho);
            const rIdx = i % numRho;
            let isPeak = true;
            for (let dt = -1; dt <= 1; dt++) {
                for (let dr = -1; dr <= 1; dr++) {
                    if (dt === 0 && dr === 0) continue;
                    const ni = (tIdx + dt) * numRho + (rIdx + dr);
                    if (ni >= 0 && ni < accumulator.length && accumulator[ni] > score) {
                        isPeak = false;
                        break;
                    }
                }
                if (!isPeak) break;
            }
            if (isPeak) {
                const rho = (rIdx - centerRho) * rhoRes;
                const theta = tIdx * thetaRes;
                const deg = theta * (180 / Math.PI);
                const line = {rho, theta, score};

                if (deg > 45 && deg < 135) horizLines.push(line);
                else vertLines.push(line);
            }
        }
    }

    horizLines.sort((a, b) => b.score - a.score);
    vertLines.sort((a, b) => b.score - a.score);

    const filterLines = (list: Line[], limit: number) => {
        const unique: Line[] = [];
        for (const l of list) {
            if (unique.length >= limit) break;
            const isDuplicate = unique.some(u =>
                Math.abs(u.rho - l.rho) < 30 &&
                Math.abs(u.theta - l.theta) < 0.2
            );
            if (!isDuplicate) unique.push(l);
        }
        return unique;
    };

    const uniqueHoriz = filterLines(horizLines, 8);
    const uniqueVert = filterLines(vertLines, 8);

    // ---------------------------------------------------------
    // 5. COMBINATORIAL SEARCH
    // ---------------------------------------------------------
    let bestQuad: { q: Quad, s: number, r: number, metric: number } | null = null;

    const intersect = (l1: Line, l2: Line): Point | null => {
        const det = Math.cos(l1.theta) * Math.sin(l2.theta) - Math.sin(l1.theta) * Math.cos(l2.theta);
        if (Math.abs(det) < 0.1) return null;
        const x = (Math.sin(l2.theta) * l1.rho - Math.sin(l1.theta) * l2.rho) / det;
        const y = (Math.cos(l1.theta) * l2.rho - Math.cos(l2.theta) * l1.rho) / det;
        return {x, y};
    };

    if (uniqueHoriz.length >= 2 && uniqueVert.length >= 2) {
        const hLimit = Math.min(uniqueHoriz.length, 6);
        const vLimit = Math.min(uniqueVert.length, 6);

        for (let h1 = 0; h1 < hLimit; h1++) {
            for (let h2 = h1 + 1; h2 < hLimit; h2++) {
                for (let v1 = 0; v1 < vLimit; v1++) {
                    for (let v2 = v1 + 1; v2 < vLimit; v2++) {

                        const tl = intersect(uniqueHoriz[h1], uniqueVert[v1]);
                        const tr = intersect(uniqueHoriz[h1], uniqueVert[v2]);
                        const bl = intersect(uniqueHoriz[h2], uniqueVert[v1]);
                        const br = intersect(uniqueHoriz[h2], uniqueVert[v2]);
                        if (!tl || !tr || !bl || !br) continue;

                        const q = orderQuad([tl, tr, br, bl]);
                        if (q) {
                            const {score, details} = scoreQuad(q, w, h, mags, mean, stdDev);
                            if (score > 0) {
                                // FIX 2: Added fallback for potentially undefined details.ratio
                                const ratio = details.ratio || 0;
                                const metric = score + (ratio * 1.0);
                                if (!bestQuad || metric > bestQuad.metric) {
                                    // FIX 3: Added fallback here as well
                                    bestQuad = {q, s: score, r: ratio, metric};
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (!bestQuad) {
        return {quad: null, confidence: 0, width: w, height: h};
    }

    log(`WINNER: Score=${bestQuad.s.toFixed(2)} Area=${bestQuad.r.toFixed(2)}`);
    return {quad: bestQuad.q, confidence: bestQuad.s, width: w, height: h};
}

// ---------------------------------------------------------
// SCORING
// ---------------------------------------------------------
function scoreQuad(q: Quad, w: number, h: number, mags: Uint16Array, mean: number, stdDev: number) {
    const area = quadArea(q);
    const ratio = area / (w * h);
    if (ratio < 0.05 || ratio > 0.99) return {score: 0, details: {ratio, reason: 'ratio'}};

    const z0 = checkSideZ(q[0], q[1], w, h, mags, mean, stdDev);
    const z1 = checkSideZ(q[1], q[2], w, h, mags, mean, stdDev);
    const z2 = checkSideZ(q[2], q[3], w, h, mags, mean, stdDev);
    const z3 = checkSideZ(q[3], q[0], w, h, mags, mean, stdDev);

    // GAP CHECK (30%)
    const maxAllowedGap = 0.30;
    if (z0.maxGap > maxAllowedGap || z1.maxGap > maxAllowedGap ||
        z2.maxGap > maxAllowedGap || z3.maxGap > maxAllowedGap) {
        return {
            score: 0,
            details: {reason: 'gap_detected', maxGap: Math.max(z0.maxGap, z1.maxGap, z2.maxGap, z3.maxGap)}
        };
    }

    const zScores = [z0.score, z1.score, z2.score, z3.score].sort((a, b) => a - b);
    const [z_weak, z_mid1, z_mid2, z_strong] = zScores;

    if (zScores.filter(z => z >= 0.3).length < 3) return {score: 0, details: {zScores, reason: 'not_visible'}};

    const norm = (z: number) => Math.min(1, Math.max(0, z / 2.0));
    let finalScore = 0;
    if (z_weak >= 0.8) finalScore = (norm(z0.score) + norm(z1.score) + norm(z2.score) + norm(z3.score)) / 4;
    else finalScore = (norm(z_mid1) + norm(z_mid2) + norm(z_strong)) / 3;

    return {score: finalScore, details: {zScores, ratio, maxGap: 0}};
}

function checkSideZ(p1: Point, p2: Point, w: number, h: number, mags: Uint16Array, mean: number, stdDev: number): {
    score: number,
    maxGap: number
} {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.min(64, Math.max(8, Math.floor(len / 4)));
    let totalZ = 0, validSamples = 0, currentGap = 0, maxGapSequence = 0;
    const safeStd = Math.min(100, Math.max(10, stdDev));
    const minMag = mean;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.round(p1.x + dx * t);
        const y = Math.round(p1.y + dy * t);
        let hit = false;
        if (x >= 0 && x < w && y >= 0 && y < h) {
            const mag = mags[y * w + x];
            if (mag > minMag) {
                totalZ += (mag - mean) / safeStd;
                validSamples++;
                hit = true;
            }
        }
        if (hit) currentGap = 0;
        else {
            currentGap++;
            if (currentGap > maxGapSequence) maxGapSequence = currentGap;
        }
    }

    if (validSamples === 0) return {score: 0, maxGap: 1.0};
    return {score: (totalZ / validSamples) * (validSamples / (steps + 1)), maxGap: maxGapSequence / (steps + 1)};
}
