import {describe, expect, it} from 'vitest';
import {isQuadConvex, type Quad} from '../../src/lib/scan/quad';

describe('isQuadConvex', () => {
    it('returns true for a perfect rectangle', () => {
        const q: Quad = [
            {x: 0, y: 0},
            {x: 100, y: 0},
            {x: 100, y: 100},
            {x: 0, y: 100}
        ];
        expect(isQuadConvex(q)).toBe(true);
    });

    it('returns true for a convex trapezoid', () => {
        const q: Quad = [
            {x: 20, y: 10},
            {x: 80, y: 10},
            {x: 100, y: 90},
            {x: 0, y: 90}
        ];
        expect(isQuadConvex(q)).toBe(true);
    });

    it('returns false for a bow-tie shape (self-intersecting)', () => {
        const q: Quad = [
            {x: 0, y: 0},
            {x: 100, y: 100}, // TR crossed with BR
            {x: 100, y: 0},
            {x: 0, y: 100}
        ];
        expect(isQuadConvex(q)).toBe(false);
    });

    it('returns false for a concave quad', () => {
        const q: Quad = [
            {x: 0, y: 0},
            {x: 100, y: 0},
            {x: 50, y: 50}, // Middle point pushed in
            {x: 0, y: 100}
        ];
        expect(isQuadConvex(q)).toBe(false);
    });

    it('returns false for collapsed/tiny quads', () => {
        const q: Quad = [
            {x: 0, y: 0},
            {x: 5, y: 0},
            {x: 5, y: 5},
            {x: 0, y: 5}
        ];
        expect(isQuadConvex(q)).toBe(false); // Area < 500
    });
});
