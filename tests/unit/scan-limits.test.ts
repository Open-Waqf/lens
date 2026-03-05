import {describe, expect, it} from 'vitest';
import {ScanSessionState, MAX_PAGES_PER_BATCH} from '../../src/pages/scan/scan-session-state';

describe('ScanSessionState - Limits', () => {
    it('enforces MAX_PAGES_PER_BATCH', () => {
        const state = new ScanSessionState();
        state.setPageCount(MAX_PAGES_PER_BATCH - 1);
        expect(state.canAddPage).toBe(true);

        state.setPageCount(MAX_PAGES_PER_BATCH);
        expect(state.canAddPage).toBe(false);

        state.setPageCount(MAX_PAGES_PER_BATCH + 1);
        expect(state.canAddPage).toBe(false);
    });
});
