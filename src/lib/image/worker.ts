import type {FilterMode} from '../../domain/types';
import {adaptiveBwFromRgba} from './adaptive-bw';

export type Rotation = 0 | 90 | 180 | 270;

export type WorkerRequest = {
    id: string;
    blob: Blob;
    crop?: { x: number; y: number; w: number; h: number };
    rotation: Rotation;
    filter: FilterMode;
    masterJpegQuality: number;
    thumbMax: number;
};

export type WorkerResponse =
    | {
    id: string;
    ok: true;
    master: { bytes: Uint8Array; width: number; height: number };
    thumb: { bytes: Uint8Array; width: number; height: number };
}
    | { id: string; ok: false; error: string };

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
    const req = ev.data;

    try {
        const img = await createImageBitmap(req.blob);

        // crop box in source image coords
        const crop = req.crop ?? {x: 0, y: 0, w: img.width, h: img.height};

        // output size after rotation
        const rot = req.rotation;
        const outW = rot === 90 || rot === 270 ? crop.h : crop.w;
        const outH = rot === 90 || rot === 270 ? crop.w : crop.h;

        const masterCanvas = new OffscreenCanvas(outW, outH);
        const mctx = masterCanvas.getContext('2d', {willReadFrequently: true})!;
        mctx.imageSmoothingEnabled = true;

        // draw cropped + rotated into master canvas
        mctx.save();
        if (rot === 0) {
            mctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
        } else {
            // rotate about origin with translations
            if (rot === 90) {
                mctx.translate(outW, 0);
                mctx.rotate(Math.PI / 2);
            } else if (rot === 180) {
                mctx.translate(outW, outH);
                mctx.rotate(Math.PI);
            } else if (rot === 270) {
                mctx.translate(0, outH);
                mctx.rotate(-Math.PI / 2);
            }
            // after rotation, draw with swapped dimensions where needed
            mctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
        }
        mctx.restore();

        // apply filter on master pixels
        applyFilter(mctx, outW, outH, req.filter);

        const masterBlob = await canvasToJpeg(masterCanvas, req.masterJpegQuality);
        const masterBytes = new Uint8Array(await masterBlob.arrayBuffer());

        // thumbnail
        const scale = Math.min(1, req.thumbMax / Math.max(outW, outH));
        const tw = Math.max(1, Math.round(outW * scale));
        const th = Math.max(1, Math.round(outH * scale));

        const thumbCanvas = new OffscreenCanvas(tw, th);
        const tctx = thumbCanvas.getContext('2d', {willReadFrequently: true})!;
        tctx.imageSmoothingEnabled = true;
        tctx.drawImage(masterCanvas, 0, 0, outW, outH, 0, 0, tw, th);

        // Optional: keep thumb consistent with master’s filter
        // (master is already filtered, so this draw preserves it)

        const thumbBlob = await canvasToJpeg(thumbCanvas, 0.72);
        const thumbBytes = new Uint8Array(await thumbBlob.arrayBuffer());

        const res: WorkerResponse = {
            id: req.id,
            ok: true,
            master: {bytes: masterBytes, width: outW, height: outH},
            thumb: {bytes: thumbBytes, width: tw, height: th}
        };

        (self as unknown as Worker).postMessage(res, [masterBytes.buffer, thumbBytes.buffer]);
    } catch (e) {
        const res: WorkerResponse = {
            id: req.id,
            ok: false,
            error: (e as Error)?.message ?? String(e)
        };
        (self as unknown as Worker).postMessage(res);
    }
};

function applyFilter(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, filter: FilterMode): void {
    if (filter === 'original') return;

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    if (filter === 'grayscale') {
        for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const y = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
            d[i] = y;
            d[i + 1] = y;
            d[i + 2] = y;
        }
        ctx.putImageData(img, 0, 0);
        return;
    }

    if (filter === 'bw') {
        const bw = adaptiveBwFromRgba(d, w, h, 18, 12);
        const out = ctx.createImageData(w, h);
        out.data.set(bw);
        ctx.putImageData(out, 0, 0);
        return;
    }
}

async function canvasToJpeg(canvas: OffscreenCanvas, quality: number): Promise<Blob> {
    // OffscreenCanvas.convertToBlob is widely supported in modern Chromium/Firefox.
    // If you hit a browser that lacks it, we can add a fallback later.
    return await canvas.convertToBlob({type: 'image/jpeg', quality});
}
