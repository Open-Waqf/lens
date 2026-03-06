import {describe, expect, it} from 'vitest';
import {__warpInternals} from '../../src/lib/image/warp';

describe('warp border sampling', () => {
    it('clamps out-of-bounds samples instead of returning opaque black', () => {
        const w = 2;
        const h = 2;
        const src = new Uint8ClampedArray([
            255, 0, 0, 255,   255, 0, 0, 255,
            255, 0, 0, 255,   255, 0, 0, 255,
        ]);

        const rgba = __warpInternals.sampleBilinear(src, w, h, -1.25, -0.4);
        expect(rgba[0]).toBeGreaterThan(200);
        expect(rgba[1]).toBeLessThan(10);
        expect(rgba[2]).toBeLessThan(10);
        expect(rgba[3]).toBe(255);
    });
});

