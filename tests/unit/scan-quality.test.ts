import {describe, expect, it} from 'vitest';
import {resolveScanQualityPlan} from '../../src/lib/image/quality';

describe('scan quality policy', () => {
    it('keeps original preset unsharpened and without upscaling', () => {
        const plan = resolveScanQualityPlan({
            action: 'save',
            preset: 'original',
            filter: 'original',
            rawWidth: 1000,
            rawHeight: 700,
        });
        expect(plan.masterWidth).toBe(1000);
        expect(plan.masterHeight).toBe(700);
        expect(plan.sharpenAmount).toBe(0);
    });

    it('upscales small scans in share preset and uses lower jpeg quality', () => {
        const plan = resolveScanQualityPlan({
            action: 'share',
            preset: 'share',
            filter: 'original',
            rawWidth: 1000,
            rawHeight: 700,
        });
        expect(plan.masterWidth).toBeGreaterThan(1000);
        expect(plan.masterHeight).toBeGreaterThan(700);
        expect(plan.masterJpegQuality).toBeLessThan(0.9);
    });

    it('gives archive preset higher quality than share preset', () => {
        const share = resolveScanQualityPlan({
            action: 'save',
            preset: 'share',
            filter: 'original',
            rawWidth: 1800,
            rawHeight: 1200,
        });
        const archive = resolveScanQualityPlan({
            action: 'save',
            preset: 'archive',
            filter: 'original',
            rawWidth: 1800,
            rawHeight: 1200,
        });
        expect(archive.masterJpegQuality).toBeGreaterThan(share.masterJpegQuality);
        expect(archive.sharpenAmount).toBeGreaterThan(share.sharpenAmount);
    });

    it('reduces sharpening for magic filter to avoid over-sharpen artifacts', () => {
        const plain = resolveScanQualityPlan({
            action: 'save',
            preset: 'archive',
            filter: 'original',
            rawWidth: 2000,
            rawHeight: 1400,
        });
        const magic = resolveScanQualityPlan({
            action: 'save',
            preset: 'archive',
            filter: 'magic',
            rawWidth: 2000,
            rawHeight: 1400,
        });
        expect(magic.sharpenAmount).toBeLessThan(plain.sharpenAmount);
    });
});
