import {beforeEach, describe, expect, it} from 'vitest';
import {
    __resetSeenDocsCacheForTests,
    clearDocSeen,
    isDocNew,
    markDocSeen,
    pruneSeenDocs
} from '../../src/services/seen-docs';

describe('seen-docs caching and pruning', () => {
    beforeEach(() => {
        localStorage.clear();
        __resetSeenDocsCacheForTests();
    });

    it('marks a doc seen and reports not-new for same updatedAt', () => {
        const doc = {id: 'd1', updatedAt: 100} as any;
        expect(isDocNew(doc)).toBe(true);
        markDocSeen('d1', 100);
        expect(isDocNew(doc)).toBe(false);
    });

    it('prunes stale seen-doc entries not present in valid ids', () => {
        markDocSeen('d1', 10);
        markDocSeen('d2', 20);
        pruneSeenDocs(['d2']);
        clearDocSeen('d2');

        const raw = localStorage.getItem('sahifah.seenDocs.v1') || '{}';
        expect(JSON.parse(raw)).toEqual({});
    });
});
