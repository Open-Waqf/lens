import {detectQuadFromRgba} from './detect';

console.warn('%c[Worker] 🚀 WORKER STARTED', 'color: lime; background: black; font-size: 14px;');

type Req = { type: 'detect'; width: number; height: number; rgba: Uint8ClampedArray };

self.onmessage = (ev: MessageEvent<Req>) => {
    const msg = ev.data;

    // 1. Debug log: Did we get a message?
    if (msg.type === 'detect') {
        console.log(`[Worker] 📥 Received frame ${msg.width}x${msg.height}`);
    } else {
        console.warn('[Worker] ❓ Unknown message type:', msg);
        return;
    }

    const t0 = performance.now();

    // Run detection
    const r = detectQuadFromRgba(msg.rgba, msg.width, msg.height);

    const tMs = performance.now() - t0;

    // 2. Debug log: Did we finish?
    if (r.confidence > 0) {
        console.log(`[Worker] ✅ Found quad (Conf: ${r.confidence.toFixed(2)}) in ${tMs.toFixed(0)}ms`);
    } else {
        // Even if we found nothing, say so!
        console.log(`[Worker] ❌ No quad found (${tMs.toFixed(0)}ms)`);
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