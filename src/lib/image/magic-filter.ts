export function magicColorFromRgba(
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    radius = 20 // Large radius for background estimation
): Uint8ClampedArray {
    const n = w * h;
    const len = n * 4;
    const out = new Uint8ClampedArray(len);

    // We process R, G, B separately to achieve White Balance (remove yellow paper tint)
    const channels = [0, 1, 2]; // R, G, B offsets

    // Reusable buffers to avoid GC thrashing
    const integral = new Uint32Array((w + 1) * (h + 1));
    const iw = w + 1;

    for (const c of channels) {
        // 1. Compute Integral Image for this channel
        integral.fill(0);
        for (let y = 1; y <= h; y++) {
            let rowSum = 0;
            const rowOffset = (y - 1) * w;
            const iRowOffset = y * iw;
            const prevIRowOffset = (y - 1) * iw;

            for (let x = 1; x <= w; x++) {
                // Read channel c
                const val = rgba[(rowOffset + (x - 1)) * 4 + c];
                rowSum += val;
                integral[iRowOffset + x] = integral[prevIRowOffset + x] + rowSum;
            }
        }

        // 2. Apply division and contrast stretch
        for (let y = 0; y < h; y++) {
            const y0 = Math.max(0, y - radius);
            const y1 = Math.min(h - 1, y + radius);
            const hSide = y1 - y0 + 1;

            // Optimization: pre-calculate Y indices for integral
            const I_D_Base = (y1 + 1) * iw;
            const I_B_Base = y0 * iw;
            // We want Mean of box: D - B - C + A
            // A = (y0, x0), B = (y0, x1+1), C = (y1+1, x0), D = (y1+1, x1+1)

            for (let x = 0; x < w; x++) {
                const x0 = Math.max(0, x - radius);
                const x1 = Math.min(w - 1, x + radius);

                const D = I_D_Base + (x1 + 1);
                const B = I_B_Base + (x1 + 1);
                const C = I_D_Base + x0;
                const A = I_B_Base + x0;

                const count = (x1 - x0 + 1) * hSide;
                const sum = integral[D] - integral[B] - integral[C] + integral[A];
                const bg = sum / count;

                // Pixel value
                const idx = (y * w + x) * 4 + c;
                const val = rgba[idx];

                // Division: (Val / Bg) scales Bg -> 1.0 (255)
                // We add a small epsilon to bg to avoid division by zero (though sum >= val usually)
                // Gain factor: 255.
                // We also want to boost contrast.
                // Formula: Target = (Val / Bg) * 255.

                let norm = (val * 255) / (bg + 1);

                // Contrast Stretch (S-Curve or Levels)
                // Black point at 0.5 (128), White point at 0.9 (230)
                // Simple linear stretch: Input < 100 -> Darker, Input > 200 -> White

                // Empirical "Scanner" curve:
                // Push darks down slightly, push lights to pure white aggressively.
                if (norm > 210) norm = 255;
                else norm = (norm - 30) * 1.3;

                if (norm < 0) norm = 0;
                if (norm > 255) norm = 255;

                out[idx] = norm;
            }
        }
    }

    // Copy Alpha channel
    for (let i = 3; i < len; i += 4) {
        out[i] = rgba[i];
    }

    return out;
}