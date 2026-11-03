import {describe, expect, it, vi} from 'vitest';

// purgeDeleted runs at every start. It must find deleted records by index, never by
// loading every page with all its OCR words (Nov 2026 deep dive, P3).
const deletedDoc = {id: 'd1', deletedAt: 5};
const deletedPage = {id: 'p1', docId: 'd2', deletedAt: 5};
const fullScan = () => { throw new Error('full table scan'); };
const where = (rows: object[]) => vi.fn(() => ({above: () => ({toArray: async () => rows})}));

vi.mock('../../src/services/db', () => ({
    db: {
        docs: {toArray: fullScan, where: where([deletedDoc]), get: async () => ({id: 'd2', pageIds: ['p9']})},
        pages: {toArray: fullScan, where: where([deletedPage]), get: async () => deletedPage},
    },
}));
const deleteDocCompletely = vi.fn(async () => undefined);
const deletePage = vi.fn(async () => undefined);
vi.mock('../../src/pages/scan/scan-repo', () => ({ScanRepo: class { deleteDocCompletely = deleteDocCompletely; deletePage = deletePage; }}));
vi.mock('../../src/components/toast-notification', () => ({showToast: vi.fn()}));
vi.mock('../../src/lib/i18n', () => ({t: (k: string) => k}));

describe('purgeDeleted at start', () => {
    it('finishes pending deletes by index, without loading every record', async () => {
        const {purgeDeleted} = await import('../../src/services/pending-delete');
        await purgeDeleted();
        expect(deleteDocCompletely).toHaveBeenCalledWith('d1');
        expect(deletePage).toHaveBeenCalledWith('p1');
    });
});
