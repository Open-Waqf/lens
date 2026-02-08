// "Magic Color" filter: Removes shadows/background while keeping color.

export function magicColorFromRgba(
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    radius = 20
): Uint8ClampedArray {
    const n = w * h;
    const len = n * 4;
    const out = new Uint8ClampedArray(len);

    const channels = [0, 1, 2];
    const integral = new Uint32Array((w + 1) * (h + 1));
    const iw = w + 1;

    for (const c of channels) {
        integral.fill(0);
        for (let y = 1; y <= h; y++) {
            let rowSum = 0;
            const rowOffset = (y - 1) * w;
            const iRowOffset = y * iw;
            const prevIRowOffset = (y - 1) * iw;

            for (let x = 1; x <= w; x++) {
                const val = rgba[(rowOffset + (x - 1)) * 4 + c];
                rowSum += val;
                integral[iRowOffset + x] = integral[prevIRowOffset + x] + rowSum;
            }
        }

        for (let y = 0; y < h; y++) {
            const y0 = Math.max(0, y - radius);
            const y1 = Math.min(h - 1, y + radius);
            const hSide = y1 - y0 + 1;

            const I_D_Base = (y1 + 1) * iw;
            const I_B_Base = y0 * iw;

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

                const idx = (y * w + x) * 4 + c;
                const val = rgba[idx];

                let norm = (val * 255) / (bg + 1);

                // Magic Color Curve: Gentle contrast
                if (norm > 210) norm = 255;
                else norm = (norm - 30) * 1.3;

                if (norm < 0) norm = 0;
                if (norm > 255) norm = 255;

                out[idx] = norm;
            }
        }
    }

    for (let i = 3; i < len; i += 4) {
        out[i] = rgba[i];
    }

    return out;
}

export function whiteboardFromRgba(
    rgba: Uint8ClampedArray,
    w: number,
    h: number
): Uint8ClampedArray {
    // 1. Get the base "Magic" result (flattened background)
    const cleaned = magicColorFromRgba(rgba, w, h);

    // 2. Whiteboard Specific: Aggressive Clipping & Saturation
    const len = cleaned.length;
    const satBoost = 2.2; // 220% saturation (Heavy boost for faint markers)

    for (let i = 0; i < len; i += 4) {
        let r = cleaned[i];
        let g = cleaned[i + 1];
        let b = cleaned[i + 2];

        // 2a. Aggressive White Clip
        // If it's kinda light, make it pure white to remove whiteboard smudge/glare
        if (r > 200 && g > 200 && b > 200) {
            cleaned[i] = 255;
            cleaned[i + 1] = 255;
            cleaned[i + 2] = 255;
            continue;
        }

        // 2b. Saturation Boost
        // Luma
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // Difference from grey
        const dr = r - lum;
        const dg = g - lum;
        const db = b - lum;

        // Apply boost
        r = lum + (dr * satBoost);
        g = lum + (dg * satBoost);
        b = lum + (db * satBoost);

        cleaned[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        cleaned[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        cleaned[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }

    return cleaned;
}