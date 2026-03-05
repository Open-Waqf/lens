export class DetectGovernor {
    maxDim = 480;       // start lower to guarantee speed (downscale target)
    intervalMs = 60;    // aim for ~16fps (1000/16 = 62.5ms)

    private ema = 0;    // exp moving avg worker time
    private ticks = 0;

    // tune these for mid-range baseline (Snapdragon 665)
    private readonly MIN_DIM = 240; 
    private readonly MAX_DIM = 640;
    private readonly MIN_INT = 40;  // 25fps max
    private readonly MAX_INT = 100; // 10fps min

    onResult(workerMs: number) {
        this.ema = this.ema === 0 ? workerMs : (0.8 * this.ema + 0.2 * workerMs);
        this.ticks++;

        // adjust every ~8 frames to avoid oscillation
        if (this.ticks % 8 !== 0) return;

        // If worker takes > 50ms, we risk missing 15fps target (66ms total budget)
        if (this.ema > 50) {
            // too slow -> reduce load
            this.maxDim = Math.max(this.MIN_DIM, Math.round(this.maxDim * 0.85));
            this.intervalMs = Math.min(this.MAX_INT, this.intervalMs + 10);
        } else if (this.ema < 30) {
            // plenty fast -> increase quality
            this.maxDim = Math.min(this.MAX_DIM, Math.round(this.maxDim * 1.08));
            this.intervalMs = Math.max(this.MIN_INT, this.intervalMs - 10);
        }
    }

    get isTooSlowForAutoCapture(): boolean {
        return this.ema > 70; // hard cutoff for reliable auto-capture
    }
}
