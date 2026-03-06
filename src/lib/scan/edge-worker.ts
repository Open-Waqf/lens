import {detectQuadFromRgba} from './detect';
const DEBUG = false;

type Req = { type: 'detect'; width: number; height: number; rgba: Uint8ClampedArray };

let frameCount = 0;

self.onmessage = (ev: MessageEvent<Req>) => {
    const msg = ev.data;
    frameCount++;

    if (msg.type !== 'detect') {
        if (DEBUG) console.warn('[Worker] Unknown message type:', msg);
        return;
    }

    const t0 = performance.now();
    const r = detectQuadFromRgba(msg.rgba, msg.width, msg.height);
    const tMs = performance.now() - t0;

    // Debug-only worker diagnostics.
    if (DEBUG && frameCount % 30 === 0) {
        if (r.confidence > 0) console.log(`[Worker] Found quad (${r.confidence.toFixed(2)}) in ${tMs.toFixed(0)}ms`);
        else console.log(`[Worker] No quad (${tMs.toFixed(0)}ms)`);
    }

    const out = {
        type: 'result',
        width: r.width,
        height: r.height,
        confidence: r.confidence,
        quad: r.quad ? r.quad : null,
        tMs,
    };

    (self as unknown as Worker).postMessage(out);
};
