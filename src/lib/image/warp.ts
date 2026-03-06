import type {Point, Quad} from '../scan/quad';

export function computeOutputSize(q: Quad): { w: number; h: number } {
    const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const top = dist(q[0], q[1]);
    const bottom = dist(q[3], q[2]);
    const left = dist(q[0], q[3]);
    const right = dist(q[1], q[2]);
    return {w: Math.max(1, Math.round((top + bottom) / 2)), h: Math.max(1, Math.round((left + right) / 2))};
}

export function warpRgba(
    srcRgba: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    srcQuad: Quad,
    outW: number,
    outH: number
): Uint8ClampedArray {
    const H = rectToQuadHomography(outW, outH, srcQuad);
    const out = new Uint8ClampedArray(outW * outH * 4);

    for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
            const p = applyHomography(H, x, y);
            const rgba = sampleBilinear(srcRgba, srcW, srcH, p.x, p.y);
            const i = (y * outW + x) * 4;
            out[i] = rgba[0];
            out[i + 1] = rgba[1];
            out[i + 2] = rgba[2];
            out[i + 3] = rgba[3];
        }
    }
    return out;
}

export function warpRgbaToCanvas(
    srcRgba: Uint8ClampedArray,
    srcW: number,
    srcH: number,
    srcQuad: Quad,
    outW: number,
    outH: number
): HTMLCanvasElement {
    const rgba = warpRgba(srcRgba, srcW, srcH, srcQuad, outW, outH);
    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext('2d')!;
    // Fix: Cast to 'any' to bypass strict ArrayBuffer/SharedArrayBuffer checks
    const img = new ImageData(rgba as any, outW, outH);
    ctx.putImageData(img, 0, 0);
    return c;
}

type Mat3 = [number, number, number, number, number, number, number, number, number];

function rectToQuadHomography(outW: number, outH: number, q: Quad): Mat3 {
    const dst = [{x: 0, y: 0}, {x: outW - 1, y: 0}, {x: outW - 1, y: outH - 1}, {x: 0, y: outH - 1}];
    return solveHomography(dst, q);
}

function solveHomography(src: Point[], dst: Point[]): Mat3 {
    const A: number[][] = [];
    const b: number[] = [];
    for (let i = 0; i < 4; i++) {
        const x = src[i].x, y = src[i].y;
        const u = dst[i].x, v = dst[i].y;
        A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
        b.push(u);
        A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
        b.push(v);
    }
    const h = solve8(A, b);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function solve8(A: number[][], b: number[]): number[] {
    const n = 8;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
        [M[col], M[pivot]] = [M[pivot], M[col]];
        const div = M[col][col] || 1e-12;
        for (let c = col; c <= n; c++) M[col][c] /= div;
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = M[r][col];
            for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
        }
    }
    return M.map(row => row[n]);
}

function applyHomography(H: Mat3, x: number, y: number): Point {
    const [a, b, c, d, e, f, g, h, i] = H;
    const den = g * x + h * y + i;
    return {x: (a * x + b * y + c) / den, y: (d * x + e * y + f) / den};
}

function sampleBilinear(src: Uint8ClampedArray, w: number, h: number, x: number, y: number): [number, number, number, number] {
    const cx = Math.max(0, Math.min(w - 1, x));
    const cy = Math.max(0, Math.min(h - 1, y));
    const x0 = Math.floor(cx), y0 = Math.floor(cy);
    const dx = cx - x0, dy = cy - y0;
    const idx = (yy: number, xx: number) => (yy * w + xx) * 4;

    const i00 = idx(y0, x0);
    const i10 = idx(y0, Math.min(x0 + 1, w - 1));
    const i01 = idx(Math.min(y0 + 1, h - 1), x0);
    const i11 = idx(Math.min(y0 + 1, h - 1), Math.min(x0 + 1, w - 1));

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const r = lerp(lerp(src[i00], src[i10], dx), lerp(src[i01], src[i11], dx), dy);
    const g = lerp(lerp(src[i00 + 1], src[i10 + 1], dx), lerp(src[i01 + 1], src[i11 + 1], dx), dy);
    const b = lerp(lerp(src[i00 + 2], src[i10 + 2], dx), lerp(src[i01 + 2], src[i11 + 2], dx), dy);

    return [r | 0, g | 0, b | 0, 255];
}

export const __warpInternals = {
    sampleBilinear,
};
