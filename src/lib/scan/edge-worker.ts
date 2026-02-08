import {detectQuadFromRgba} from './detect';

type Req = { type: 'detect'; width: number; height: number; rgba: Uint8ClampedArray };

type Res = {
    type: 'result';
    width: number;
    height: number;
    confidence: number;
    quad: { x: number; y: number }[] | null;
    tMs: number;
};

self.onmessage = (ev: MessageEvent<Req>) => {
    const msg = ev.data;
    if (msg.type !== 'detect') return;

    const t0 = performance.now();
    const r = detectQuadFromRgba(msg.rgba, msg.width, msg.height);
    const tMs = performance.now() - t0;

    const out: Res = {
        type: 'result',
        width: r.width,
        height: r.height,
        confidence: r.confidence,
        quad: r.quad ? r.quad : null,
        tMs,
    };

    (self as unknown as Worker).postMessage(out);
};
