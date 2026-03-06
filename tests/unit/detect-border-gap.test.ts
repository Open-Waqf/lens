import {describe, expect, it} from 'vitest';
import {__detectInternals} from '../../src/lib/scan/detect';

describe('detect side gap border handling', () => {
    it('treats out-of-bounds side samples as boundary samples (no false full-gap)', () => {
        const w = 32;
        const h = 32;
        const mags = new Uint16Array(w * h);

        // Strong edge exactly on left boundary x=0.
        for (let y = 0; y < h; y++) mags[y * w] = 180;

        const res = __detectInternals.checkSideZ(
            {x: -3, y: 0},
            {x: -3, y: h - 1},
            w,
            h,
            mags,
            40,
            20
        );

        expect(res.score).toBeGreaterThan(0);
        expect(res.maxGap).toBeLessThan(0.3);
    });
});

