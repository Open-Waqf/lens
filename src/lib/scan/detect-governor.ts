export class DetectGovernor {
    maxDim = 640;       // downscale target
    intervalMs = 140;   // scheduling interval

    private ema = 0;    // exp moving avg worker time
    private ticks = 0;

    // tune these for your devices
    private readonly MIN_DIM = 360;
    private readonly MAX_DIM = 720;
    private readonly MIN_INT = 90;
    private readonly MAX_INT = 260;

    onResult(workerMs: number) {
        this.ema = this.ema === 0 ? workerMs : (0.8 * this.ema + 0.2 * workerMs);
        this.ticks++;

        // adjust every ~8 frames to avoid oscillation
        if (this.ticks % 8 !== 0) return;

        if (this.ema > 55) {
            // too slow -> reduce load
            this.maxDim = Math.max(this.MIN_DIM, Math.round(this.maxDim * 0.85));
            this.intervalMs = Math.min(this.MAX_INT, this.intervalMs + 20);
        } else if (this.ema < 25) {
            // plenty fast -> increase quality
            this.maxDim = Math.min(this.MAX_DIM, Math.round(this.maxDim * 1.08));
            this.intervalMs = Math.max(this.MIN_INT, this.intervalMs - 10);
        }
    }

    get isTooSlowForAutoCapture(): boolean {
        return this.ema > 80; // hard cutoff; tweak
    }
}
