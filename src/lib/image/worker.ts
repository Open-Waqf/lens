import type {FilterMode} from '../../domain/types';
import type {Quad} from '../scan/quad';
import {adaptiveBwFromRgba} from './adaptive-bw';
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
    quality?: number;

    // --- Mode B: Dual Encode (Batch / Pipeline compatibility) ---
    // If these are present, we generate BOTH master and thumb
    masterJpegQuality?: number;
    thumbMax?: number;
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
    try {
        let src: ImageBitmap;
        if (req.bitmap) src = req.bitmap;
        else if (req.blob) src = await createImageBitmap(req.blob);
        else throw new Error('No source image');

        let finalW = req.outW ?? src.width;
        let finalH = req.outH ?? src.height;
        let finalRgba: Uint8ClampedArray;

        if (req.quad) {
            const tmp = new OffscreenCanvas(src.width, src.height);
            const tctx = tmp.getContext('2d', {willReadFrequently: true})!;
            tctx.drawImage(src, 0, 0);
            const srcData = tctx.getImageData(0, 0, src.width, src.height).data;
            finalRgba = warpRgba(srcData, src.width, src.height, req.quad, finalW, finalH);
        } else {
            const crop = req.crop ?? {x: 0, y: 0, w: src.width, h: src.height};
            const tmp = new OffscreenCanvas(crop.w, crop.h);
            const tctx = tmp.getContext('2d', {willReadFrequently: true})!;

            tctx.save();
            tctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
            tctx.restore();

            finalRgba = tctx.getImageData(0, 0, crop.w, crop.h).data;
            finalW = crop.w;
            finalH = crop.h;
        }

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

        if (req.masterJpegQuality !== undefined && req.thumbMax !== undefined) {
            const mBytes = await encodeJpeg(finalRgba, finalW, finalH, req.masterJpegQuality);

            const tScale = Math.min(1, req.thumbMax / Math.max(finalW, finalH));
            const tW = Math.max(1, Math.round(finalW * tScale));
            const tH = Math.max(1, Math.round(finalH * tScale));

            const tCanvas = new OffscreenCanvas(tW, tH);
            const tctx = tCanvas.getContext('2d')!;
            const fullCanvas = new OffscreenCanvas(finalW, finalH);
            const fctx = fullCanvas.getContext('2d')!;
            // Fix: Cast to 'any'
            fctx.putImageData(new ImageData(finalRgba as any, finalW, finalH), 0, 0);

            tctx.drawImage(fullCanvas, 0, 0, finalW, finalH, 0, 0, tW, tH);
            const tBlob = await tCanvas.convertToBlob({type: 'image/jpeg', quality: 0.72});
            const tBytes = new Uint8Array(await tBlob.arrayBuffer());

            if (req.blob) src.close();

            const res: WorkerResponse = {
                id: req.id, ok: true,
                master: {bytes: mBytes, width: finalW, height: finalH},
                thumb: {bytes: tBytes, width: tW, height: tH}
            };
            (self as unknown as Worker).postMessage(res, [mBytes.buffer, tBytes.buffer]);

        } else if (req.encode) {
            const bytes = await encodeJpeg(finalRgba, finalW, finalH, req.quality ?? 0.85);
            if (req.blob) src.close();
            const res: WorkerResponse = {id: req.id, ok: true, bytes, width: finalW, height: finalH};
            (self as unknown as Worker).postMessage(res, [bytes.buffer]);

        } else {
            const outC = new OffscreenCanvas(finalW, finalH);
            const ctx = outC.getContext('2d')!;
            // Fix: Cast to 'any'
            ctx.putImageData(new ImageData(finalRgba as any, finalW, finalH), 0, 0);
            const outBmp = outC.transferToImageBitmap();

            if (req.blob) src.close();
            const res: WorkerResponse = {id: req.id, ok: true, bitmap: outBmp, width: finalW, height: finalH};
            (self as unknown as Worker).postMessage(res, [outBmp]);
        }

    } catch (e) {
        const res: WorkerResponse = {id: req.id, ok: false, error: String(e)};
        (self as unknown as Worker).postMessage(res);
    }
};

async function encodeJpeg(rgba: Uint8ClampedArray, w: number, h: number, q: number): Promise<Uint8Array> {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d')!;
    // Fix: Cast to 'any'
    ctx.putImageData(new ImageData(rgba as any, w, h), 0, 0);
    const blob = await c.convertToBlob({type: 'image/jpeg', quality: q});
    return new Uint8Array(await blob.arrayBuffer());
}