import {describe, expect, it, vi} from 'vitest';

vi.mock('../../src/lib/i18n', () => ({t: (k: string) => k}));

import {ScanSessionState} from '../../src/pages/scan/scan-session-state';

describe('leaving the scan screen', () => {
    it('never offers to discard a document whose pages are saved (Nov 2026)', () => {
        const s = new ScanSessionState();
        s.setCurrentDocId('d1');
        s.setPageCount(2);
        expect(s.decideExit()).toEqual({kind: 'nav-library', markJustSavedDocId: 'd1'});
        expect(s.exitLabel).toBe('scan.back_to_library');
    });

    it('goes back to the document when adding pages, and to the library with nothing scanned', () => {
        const a = new ScanSessionState();
        a.setAppend('d2');
        expect(a.decideExit()).toEqual({kind: 'nav-doc', docId: 'd2'});
        const b = new ScanSessionState();
        expect(b.decideExit()).toEqual({kind: 'nav-library'});
        expect(b.exitLabel).toBe('common.cancel');
    });
});
