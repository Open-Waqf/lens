import {describe, expect, it, beforeEach} from 'vitest';
import {DetectGovernor} from '../../src/lib/scan/detect-governor';

describe('DetectGovernor', () => {
    let gov: DetectGovernor;

    beforeEach(() => {
        gov = new DetectGovernor();
    });

    it('starts with reasonable defaults', () => {
        expect(gov.maxDim).toBe(480);
        expect(gov.intervalMs).toBe(60);
    });

    it('increases load when processing is fast', () => {
        const initialDim = gov.maxDim;
        const initialInt = gov.intervalMs;

        // Simulate 8 fast frames
        for (let i = 0; i < 8; i++) {
            gov.onResult(10); // 10ms is very fast
        }

        expect(gov.maxDim).toBeGreaterThan(initialDim);
        expect(gov.intervalMs).toBeLessThanOrEqual(initialInt);
    });

    it('decreases load when processing is slow', () => {
        const initialDim = gov.maxDim;
        const initialInt = gov.intervalMs;

        // Simulate 8 slow frames
        for (let i = 0; i < 8; i++) {
            gov.onResult(100); // 100ms is too slow for 15fps
        }

        expect(gov.maxDim).toBeLessThan(initialDim);
        expect(gov.intervalMs).toBeGreaterThan(initialInt);
    });

    it('detects when too slow for auto-capture', () => {
        expect(gov.isTooSlowForAutoCapture).toBe(false);
        
        // Simulate very slow worker
        for (let i = 0; i < 16; i++) {
            gov.onResult(150);
        }
        
        expect(gov.isTooSlowForAutoCapture).toBe(true);
    });

    it('caps the adaptation within bounds', () => {
        // Test lower bounds
        for (let i = 0; i < 200; i++) {
            gov.onResult(500); // Super slow
        }
        expect(gov.maxDim).toBeGreaterThanOrEqual(240);
        expect(gov.intervalMs).toBeLessThanOrEqual(100);

        // Test upper bounds
        for (let i = 0; i < 200; i++) {
            gov.onResult(1); // Super fast
        }
        expect(gov.maxDim).toBeLessThanOrEqual(640);
        expect(gov.intervalMs).toBeGreaterThanOrEqual(40);
    });
});
