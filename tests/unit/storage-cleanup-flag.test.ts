import {beforeEach, describe, expect, it} from 'vitest';
import {
    clearStorageCleanupPending,
    hasStorageCleanupPending,
    markStorageCleanupPending
} from '../../src/services/storage-cleanup-flag';

describe('storage-cleanup-flag', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('marks and clears pending cleanup state', () => {
        expect(hasStorageCleanupPending()).toBe(false);
        markStorageCleanupPending();
        expect(hasStorageCleanupPending()).toBe(true);
        clearStorageCleanupPending();
        expect(hasStorageCleanupPending()).toBe(false);
    });
});

