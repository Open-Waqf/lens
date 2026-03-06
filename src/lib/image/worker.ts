import type {FilterMode} from '../../domain/types';
import type {Quad} from '../scan/quad';
import {adaptiveBwFromRgba} from './adaptive-bw';
import {applyConservativeDeskew} from './deskew';
import {magicColorFromRgba, whiteboardFromRgba} from './magic-filter';
import {warpRgba} from './warp';

export type Rotation = 0 | 90 | 180 | 270;

export type WorkerRequest = {
    id: string;
    blob?: Blob;
    bitmap?: ImageBitmap;

    quad?: Quad;
    crop?: { x: number; y: number; w: number; h: number };

    rotation: Rotation;
    filter: FilterMode;

    // --- Mode A: Explicit Output Size (Single Encode) ---
    outW?: number;
    outH?: number;
    encode?: boolean; // If true, returns bytes. Else returns bitmap.
    outputMime?: 'image/jpeg' | 'image/webp';
    quality?: number;
    sharpenAmount?: number;

    // --- Mode B: Dual Encode (Batch / Pipeline compatibility) ---
    // If these are present, we generate BOTH master and thumb
    masterJpegQuality?: number;
    thumbMax?: number;
    thumbJpegQuality?: number;
};

export type WorkerResponse =
    | {
    id: string;
    ok: true;
    bitmap?: ImageBitmap;
    bytes?: Uint8Array;
    width?: number;
    height?: number;
    master?: { bytes: Uint8Array; width: number; height: number };
    thumb?: { bytes: Uint8Array; width: number; height: number };
}
    | { id: string; ok: false; error: string };

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
    const req = ev.data;
    let src: ImageBitmap | null = null;
    try {
        if (req.bitmap) src = req.bitmap;
        else if (req.blob) src = await createImageBitmap(req.blob);
        else throw new Error('No source image');

        // 1. Determine Target Dimensions (Smart Resize)
        // If outW/H is not provided, we clamp to a reasonable max (e.g. 2500px)
        // to prevent 48MP images from crashing the browser/DB.
        let finalW = req.outW ?? src.width;
        let finalH = req.outH ?? src.height;

        // Auto-clamp if no specific size requested (Safe default)
        if (!req.outW && !req.outH) {
            const MAX_DIM = 2500;
            const maxSrc = Math.max(finalW, finalH);
            if (maxSrc > MAX_DIM) {
                const scale = MAX_DIM / maxSrc;
                finalW = Math.round(finalW * scale);
                finalH = Math.round(finalH * scale);
            }
        }

        let finalRgba: Uint8ClampedArray;

        // 2. Crop / Warp
        if (req.quad) {
            const tmp = new OffscreenCanvas(src.width, src.height);
            const tctx = tmp.getContext('2d', {willReadFrequently: true})!;
            tctx.drawImage(src, 0, 0);
            const srcData = tctx.getImageData(0, 0, src.width, src.height).data;
            finalRgba = warpRgba(srcData, src.width, src.height, req.quad, finalW, finalH);
            // Conservative post-warp deskew improves OCR alignment without touching detector logic.
            finalRgba = applyConservativeDeskew(finalRgba, finalW, finalH);
        } else {
            const crop = req.crop ?? {x: 0, y: 0, w: src.width, h: src.height};
            const tmp = new OffscreenCanvas(crop.w, crop.h);
            const tctx = tmp.getContext('2d', {willReadFrequently: true})!;

            tctx.save();
            tctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
            tctx.restore();

            // If we need to resize the crop result to finalW/H
            if (crop.w !== finalW || crop.h !== finalH) {
                const resizeCanvas = new OffscreenCanvas(finalW, finalH);
                const rctx = resizeCanvas.getContext('2d')!;
                rctx.drawImage(tmp, 0, 0, finalW, finalH);
                finalRgba = rctx.getImageData(0, 0, finalW, finalH).data;
            } else {
                finalRgba = tctx.getImageData(0, 0, crop.w, crop.h).data;
            }
        }

        // 3. Apply Filters
        if (req.filter !== 'original') {
            if (req.filter === 'grayscale') {
                for (let i = 0; i < finalRgba.length; i += 4) {
                    const y = (0.299 * finalRgba[i] + 0.587 * finalRgba[i + 1] + 0.114 * finalRgba[i + 2]) | 0;
                    finalRgba[i] = finalRgba[i + 1] = finalRgba[i + 2] = y;
                }
            } else if (req.filter === 'bw') {
                const bw = adaptiveBwFromRgba(finalRgba, finalW, finalH);
                finalRgba.set(bw);
            } else if (req.filter === 'magic') {
                const magic = magicColorFromRgba(finalRgba, finalW, finalH);
                finalRgba.set(magic);
            } else if (req.filter === 'whiteboard') {
                const wb = whiteboardFromRgba(finalRgba, finalW, finalH);
                finalRgba.set(wb);
            }
        }

        // 3b. Optional sharpening policy (keeps backward compatibility for older callers).
        const sharpenAmount = req.sharpenAmount ?? (req.filter === 'original' ? 0 : 0.5);
        if (sharpenAmount > 0) applyUnsharpMask(finalRgba, finalW, finalH, sharpenAmount);

        // 4. Encoding
        if (req.masterJpegQuality !== undefined && req.thumbMax !== undefined) {
            // Mode B: Batch Save
            const mBytes = await encodeJpeg(finalRgba, finalW, finalH, req.masterJpegQuality);

            const tScale = Math.min(1, req.thumbMax / Math.max(finalW, finalH));
            const tW = Math.max(1, Math.round(finalW * tScale));
            const tH = Math.max(1, Math.round(finalH * tScale));

            const fullCanvas = new OffscreenCanvas(finalW, finalH);
            const fctx = fullCanvas.getContext('2d')!;
            fctx.putImageData(new ImageData(finalRgba as any, finalW, finalH), 0, 0);
            const tCanvas = downscaleProgressive(fullCanvas, tW, tH);

            // Encode thumbs as WebP for significantly smaller size at same visual quality.
            const tBlob = await tCanvas.convertToBlob({type: 'image/webp', quality: req.thumbJpegQuality ?? 0.82});
            const tBytes = new Uint8Array(await tBlob.arrayBuffer());

            const res: WorkerResponse = {
                id: req.id, ok: true,
                master: {bytes: mBytes, width: finalW, height: finalH},
                thumb: {bytes: tBytes, width: tW, height: tH}
            };
            (self as unknown as Worker).postMessage(res, [mBytes.buffer, tBytes.buffer]);

        } else if (req.encode) {
            // Mode A: Single Save
            const bytes = await encodeImage(finalRgba, finalW, finalH, req.outputMime ?? 'image/jpeg', req.quality ?? 0.85);
            const res: WorkerResponse = {id: req.id, ok: true, bytes, width: finalW, height: finalH};
            (self as unknown as Worker).postMessage(res, [bytes.buffer]);

        } else {
            // Preview Mode (Bitmap)
            const outC = new OffscreenCanvas(finalW, finalH);
            const ctx = outC.getContext('2d')!;
            ctx.putImageData(new ImageData(finalRgba as any, finalW, finalH), 0, 0);
            const outBmp = outC.transferToImageBitmap();

            const res: WorkerResponse = {id: req.id, ok: true, bitmap: outBmp, width: finalW, height: finalH};
            (self as unknown as Worker).postMessage(res, [outBmp]);
        }

    } catch (e) {
        const res: WorkerResponse = {id: req.id, ok: false, error: String(e)};
        (self as unknown as Worker).postMessage(res);
    } finally {
        src?.close();
    }
};

async function encodeJpeg(rgba: Uint8ClampedArray, w: number, h: number, q: number): Promise<Uint8Array> {
    return encodeImage(rgba, w, h, 'image/jpeg', q);
}

async function encodeImage(
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    mime: 'image/jpeg' | 'image/webp',
    q: number
): Promise<Uint8Array> {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d')!;
    ctx.putImageData(new ImageData(rgba as any, w, h), 0, 0);
    const blob = await c.convertToBlob({type: mime, quality: q});
    return new Uint8Array(await blob.arrayBuffer());
}

function downscaleProgressive(source: OffscreenCanvas, targetW: number, targetH: number): OffscreenCanvas {
    let curr = source;
    let currW = source.width;
    let currH = source.height;

    while (currW / 2 >= targetW && currH / 2 >= targetH) {
        const nextW = Math.max(targetW, Math.floor(currW / 2));
        const nextH = Math.max(targetH, Math.floor(currH / 2));
        const next = new OffscreenCanvas(nextW, nextH);
        const nctx = next.getContext('2d')!;
        nctx.imageSmoothingEnabled = true;
        nctx.imageSmoothingQuality = 'high';
        nctx.drawImage(curr, 0, 0, currW, currH, 0, 0, nextW, nextH);
        curr = next;
        currW = nextW;
        currH = nextH;
    }

    if (currW !== targetW || currH !== targetH) {
        const finalCanvas = new OffscreenCanvas(targetW, targetH);
        const fctx = finalCanvas.getContext('2d')!;
        fctx.imageSmoothingEnabled = true;
        fctx.imageSmoothingQuality = 'high';
        fctx.drawImage(curr, 0, 0, currW, currH, 0, 0, targetW, targetH);
        return finalCanvas;
    }
    return curr;
}

/**
 * Fast Unsharp Mask (Sharpening)
 * amount: 0.0 to 1.0 (Strength)
 */
function applyUnsharpMask(data: Uint8ClampedArray, w: number, h: number, amount: number) {
    if (amount <= 0) return;

    // Simple 3x3 convolution kernel for sharpening
    //  0 -1  0
    // -1  5 -1
    //  0 -1  0
    // But implemented efficiently without a full matrix copy

    // We clone the data to read original values while writing new ones
    const copy = new Uint8ClampedArray(data);

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const idx = (y * w + x) * 4;

            // Neighbors
            const up = ((y - 1) * w + x) * 4;
            const down = ((y + 1) * w + x) * 4;
            const left = (y * w + (x - 1)) * 4;
            const right = (y * w + (x + 1)) * 4;

            for (let c = 0; c < 3; c++) {
                const val = copy[idx + c];
                const neighbors = copy[up + c] + copy[down + c] + copy[left + c] + copy[right + c];

                // Formula: Original + (Original - Blurred) * Amount
                // Approximation: 5*Center - Neighbors
                const sharpened = (5 * val - neighbors);

                // Blend based on amount
                const final = val + (sharpened - val) * amount;

                data[idx + c] = final < 0 ? 0 : (final > 255 ? 255 : final);
            }
        }
    }
}
