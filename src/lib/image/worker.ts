/// <reference lib="webworker" />

import type {FilterMode} from '../../domain/types';

type Rotation = 0 | 90 | 180 | 270;

export type WorkerRequest = {
    id: string;
    blob: Blob;
    crop?: { x: number; y: number; w: number; h: number };
    rotation: Rotation;
    filter: FilterMode;
    masterJpegQuality: number;
    thumbMax: number;
};

export type WorkerResponse = {
    id: string;
    ok: true;
    master: { bytes: Uint8Array; width: number; height: number };
    thumb: { bytes: Uint8Array; width: number; height: number };
} | {
    id: string;
    ok: false;
    error: string;
};

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

function toGray(data: Uint8ClampedArray): void {
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const y = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
        data[i] = data[i + 1] = data[i + 2] = y;
    }
}

// Fast global threshold (Otsu). v0.1 “good enough”, upgrade to adaptive in v1.
function otsuThreshold(gray: Uint8ClampedArray): number {
    const hist = new Array<number>(256).fill(0);
    for (let i = 0; i < gray.length; i += 4) hist[gray[i]]++;

    const total = gray.length / 4;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let varMax = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        wF = total - wB;
        if (wF === 0) break;

        sumB += t * hist[t];

        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const varBetween = wB * wF * (mB - mF) * (mB - mF);

        if (varBetween > varMax) {
            varMax = varBetween;
            threshold = t;
        }
    }

    return threshold;
}

function applyBW(data: Uint8ClampedArray): void {
    toGray(data);
    const t = otsuThreshold(data);
    for (let i = 0; i < data.length; i += 4) {
        const v = data[i] > t ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = v;
    }
}

function applyFilter(mode: FilterMode, img: ImageData): void {
    if (mode === 'original') return;
    if (mode === 'grayscale') toGray(img.data);
    if (mode === 'bw') applyBW(img.data);
}

function rotatedSize(w: number, h: number, rot: Rotation): { w: number; h: number } {
    return rot === 90 || rot === 270 ? {w: h, h: w} : {w, h};
}

function drawWithRotation(
    ctx: OffscreenCanvasRenderingContext2D,
    bmp: ImageBitmap,
    rot: Rotation
): void {
    const w = bmp.width, h = bmp.height;

    ctx.save();
    if (rot === 0) {
        ctx.drawImage(bmp, 0, 0);
    } else if (rot === 90) {
        ctx.translate(h, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(bmp, 0, 0);
    } else if (rot === 180) {
        ctx.translate(w, h);
        ctx.rotate(Math.PI);
        ctx.drawImage(bmp, 0, 0);
    } else if (rot === 270) {
        ctx.translate(0, w);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(bmp, 0, 0);
    }
    ctx.restore();
}

async function canvasToJpegBytes(canvas: OffscreenCanvas, quality: number): Promise<Uint8Array> {
    const blob = await canvas.convertToBlob({type: 'image/jpeg', quality});
    return new Uint8Array(await blob.arrayBuffer());
}

function makeThumbCanvas(src: OffscreenCanvas, maxDim: number): OffscreenCanvas {
    const w = src.width, h = src.height;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const t = new OffscreenCanvas(tw, th);
    const tctx = t.getContext('2d')!;
    tctx.drawImage(src, 0, 0, tw, th);
    return t;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
    const req = ev.data;
    try {
        const bmp = await createImageBitmap(req.blob);

        const crop = req.crop ?? {x: 0, y: 0, w: bmp.width, h: bmp.height};
        const cx = clamp(crop.x, 0, bmp.width - 1);
        const cy = clamp(crop.y, 0, bmp.height - 1);
        const cw = clamp(crop.w, 1, bmp.width - cx);
        const ch = clamp(crop.h, 1, bmp.height - cy);

        // Crop
        const cropped = new OffscreenCanvas(cw, ch);
        const cctx = cropped.getContext('2d')!;
        cctx.drawImage(bmp, cx, cy, cw, ch, 0, 0, cw, ch);

        // Rotate
        const rs = rotatedSize(cw, ch, req.rotation);
        const rotated = new OffscreenCanvas(rs.w, rs.h);
        const rctx = rotated.getContext('2d')!;
        drawWithRotation(rctx, await createImageBitmap(cropped), req.rotation);

        // Filter
        const img = rctx.getImageData(0, 0, rotated.width, rotated.height);
        applyFilter(req.filter, img);
        rctx.putImageData(img, 0, 0);

        const masterBytes = await canvasToJpegBytes(rotated, req.masterJpegQuality);
        const thumbCanvas = makeThumbCanvas(rotated, req.thumbMax);
        const thumbBytes = await canvasToJpegBytes(thumbCanvas, 0.7);

        const res: WorkerResponse = {
            id: req.id,
            ok: true,
            master: {bytes: masterBytes, width: rotated.width, height: rotated.height},
            thumb: {bytes: thumbBytes, width: thumbCanvas.width, height: thumbCanvas.height}
        };
        // eslint-disable-next-line no-restricted-globals
        (self as DedicatedWorkerGlobalScope).postMessage(res);
    } catch (e) {
        const res: WorkerResponse = {id: req.id, ok: false, error: (e as Error).message};
        // eslint-disable-next-line no-restricted-globals
        (self as DedicatedWorkerGlobalScope).postMessage(res);
    }
};
