import type {DetectedQuad, Point, Quad} from './quad';
import {lerpQuad, quadArea} from './quad';

export type EdgeDetectorCallbacks = {
    onUpdate?: (det: DetectedQuad, smoothed: Quad | null) => void;
    onAutoCapture?: () => void;
};

export type EdgeDetectorOptions = {
    intervalMs?: number;
    maxDim?: number;
    smoothAlpha?: number;
    minConfidence?: number;
    minAreaNorm?: number;
    maxJitter?: number;
    stableMs?: number;
    cooldownMs?: number;
};

export class EdgeDetector {
    private worker: Worker | null = null;
    private offscreen: HTMLCanvasElement | null = null;
    private offCtx: CanvasRenderingContext2D | null = null;
    private video: HTMLVideoElement | null = null;
    private running = false;
    private detecting = false; // This flag prevents overlapping scans
    private lastDetect: DetectedQuad | null = null;
    private smoothedQuad: Quad | null = null;
    private stableSince = 0;
    private cooldownUntil = 0;
    private autoEnabled = false;
    private opts: Required<EdgeDetectorOptions>;
    private cb: EdgeDetectorCallbacks;

    constructor(cb: EdgeDetectorCallbacks = {}, opts: EdgeDetectorOptions = {}) {
        this.cb = cb;
        this.opts = {
            intervalMs: opts.intervalMs ?? 150, // slightly slower to read logs
            maxDim: opts.maxDim ?? 640,
            smoothAlpha: opts.smoothAlpha ?? 0.35,
            minConfidence: opts.minConfidence ?? 0.72,
            minAreaNorm: opts.minAreaNorm ?? 0.18,
            maxJitter: opts.maxJitter ?? 0.012,
            stableMs: opts.stableMs ?? 650,
            cooldownMs: opts.cooldownMs ?? 1200
        };
    }

    setAutoCaptureEnabled(v: boolean) {
        this.autoEnabled = v;
        if (!v) {
            this.stableSince = 0;
            this.cooldownUntil = 0;
        }
    }

    setCallbacks(cb: EdgeDetectorCallbacks) {
        this.cb = cb;
    }

    start(videoEl: HTMLVideoElement) {
        if (this.running) return;
        console.warn('[Detector] ▶️ START called');
        this.running = true;
        this.video = videoEl;
        this.ensureWorker();

        this.offscreen = document.createElement('canvas');
        this.offCtx = this.offscreen.getContext('2d', {willReadFrequently: true});

        const tick = () => {
            if (!this.running) return;
            this.grabAndDetect();
            window.setTimeout(tick, this.opts.intervalMs);
        };
        tick();
    }

    stop() {
        console.warn('[Detector] ⏹️ STOP called');
        this.running = false;
        this.detecting = false;
        this.video = null;
        this.offscreen = null;
        this.offCtx = null;
        this.worker?.terminate();
        this.worker = null;
        this.lastDetect = null;
        this.smoothedQuad = null;
    }

    getLast() {
        return {det: this.lastDetect, smoothed: this.smoothedQuad};
    }

    private ensureWorker() {
        if (this.worker) return;
        this.worker = new Worker(new URL('./edge-worker.ts', import.meta.url), {type: 'module'});

        this.worker.onmessage = (ev: MessageEvent<any>) => {
            const msg = ev.data;
            // LOG: Worker replied
            if (msg.type === 'result') {
                console.log(`[Detector] 📩 Result received (Conf: ${msg.confidence.toFixed(2)})`);
            } else {
                console.warn('[Detector] 📩 Unknown msg:', msg);
            }

            if (msg?.type !== 'result') return;

            this.detecting = false; // UNLOCK the loop

            const quad = (msg.quad as Point[] | null);
            const confidence = Number(msg.confidence ?? 0);

            const det: DetectedQuad = {
                quad: quad ? (quad as any) : null,
                confidence,
                width: Number(msg.width ?? 0),
                height: Number(msg.height ?? 0)
            };

            this.lastDetect = det;

            if (det.quad && det.confidence >= 0.35) {
                const q = det.quad as Quad;
                this.smoothedQuad = this.smoothedQuad ? lerpQuad(this.smoothedQuad, q, this.opts.smoothAlpha) : q;
            } else {
                this.smoothedQuad = null;
                this.stableSince = 0;
            }

            this.cb.onUpdate?.(det, this.smoothedQuad);
            this.maybeAutoCapture();
        };

        this.worker.onerror = (err) => {
            console.error('[Detector] 💥 Worker Error:', err);
            this.detecting = false; // Unlock if worker crashes
        };
    }

    private grabAndDetect() {
        if (!this.worker || !this.offCtx || !this.offscreen || !this.video) {
            console.warn('[Detector] ⚠️ Loop skipped: Components missing');
            return;
        }

        // 1. CHECK LOCK
        if (this.detecting) {
            console.warn('[Detector] ⏳ Busy (Worker hasn\'t replied yet)');
            return;
        }

        const v = this.video;
        // 2. CHECK VIDEO READY
        if (!v.videoWidth || !v.videoHeight) {
            console.warn('[Detector] ⚠️ Video not ready (0x0)');
            return;
        }

        const maxDim = this.opts.maxDim;
        const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.max(1, Math.round(v.videoWidth * scale));
        const h = Math.max(1, Math.round(v.videoHeight * scale));

        this.offscreen.width = w;
        this.offscreen.height = h;

        this.offCtx.drawImage(v, 0, 0, w, h);
        const img = this.offCtx.getImageData(0, 0, w, h);

        this.detecting = true; // LOCK

        // 3. LOG: SENDING
        console.log(`[Detector] 📤 Sending frame ${w}x${h} to worker...`);

        this.worker.postMessage({type: 'detect', width: w, height: h, rgba: img.data}, [img.data.buffer]);
    }

    // ... (Keep quadStabilityScore and maybeAutoCapture as is, they are fine)
    private quadStabilityScore(q: Quad, det: DetectedQuad): number {
        if (!this.smoothedQuad) return 1;
        const norm = (p: Point) => ({x: p.x / det.width, y: p.y / det.height});
        const a = this.smoothedQuad!.map(norm) as Quad;
        const b = q.map(norm) as Quad;
        let sum = 0;
        for (let i = 0; i < 4; i++) sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
        return sum / 4;
    }

    private maybeAutoCapture() {
        if (!this.autoEnabled) return;
        if (Date.now() < this.cooldownUntil) return;
        const det = this.lastDetect;
        const q = this.smoothedQuad;
        if (!det?.quad || !q || det.confidence < this.opts.minConfidence) {
            this.stableSince = 0;
            return;
        }
        const area = quadArea(q) / (det.width * det.height);
        if (area < this.opts.minAreaNorm) {
            this.stableSince = 0;
            return;
        }
        const jitter = this.quadStabilityScore(q, det);
        if (jitter > this.opts.maxJitter) {
            this.stableSince = 0;
            return;
        }
        if (this.stableSince === 0) this.stableSince = Date.now();
        if (Date.now() - this.stableSince > this.opts.stableMs) {
            console.warn('[Detector] 📸 AUTO CAPTURE!');
            this.cb.onAutoCapture?.();
            this.cooldownUntil = Date.now() + this.opts.cooldownMs;
            this.stableSince = 0;
        }
    }
}