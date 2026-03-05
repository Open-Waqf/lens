import {describe, expect, it, vi, beforeEach} from 'vitest';
import {ScanRepo} from '../../src/pages/scan/scan-repo';

const mockState = vi.hoisted(() => ({
    docs: [] as any[],
}));

vi.mock('../../src/services/db', () => ({
    db: {
        transaction: vi.fn(async (_mode: string, _tables: any, fn: () => Promise<void>) => {
            await fn();
        }),
        docs: {
            where: vi.fn((key: string) => ({
                equals: vi.fn((val: string) => ({
                    modify: vi.fn(async (patch: any) => {
                        mockState.docs.forEach(d => {
                            if (d[key] === val) {
                                Object.assign(d, patch);
                            }
                        });
                    })
                }))
            })),
            toArray: vi.fn(async () => mockState.docs)
        }
    }
}));

describe('ScanRepo Folder Deletion', () => {
    beforeEach(() => {
        mockState.docs = [
            {id: '1', title: 'Doc 1', folder: 'Taxes', updatedAt: 0},
            {id: '2', title: 'Doc 2', folder: 'Taxes', updatedAt: 0},
            {id: '3', title: 'Doc 3', folder: 'Work', updatedAt: 0},
            {id: '4', title: 'Doc 4', folder: null, updatedAt: 0}
        ];
    });

    it('reassigns all docs in a folder to null (uncategorized)', async () => {
        const repo = new ScanRepo();
        await repo.deleteFolder('Taxes');

        const doc1 = mockState.docs.find(d => d.id === '1');
        const doc2 = mockState.docs.find(d => d.id === '2');
        const doc3 = mockState.docs.find(d => d.id === '3');

        expect(doc1.folder).toBeNull();
        expect(doc1.updatedAt).toBeGreaterThan(0);
        
        expect(doc2.folder).toBeNull();
        expect(doc2.updatedAt).toBeGreaterThan(0);

        expect(doc3.folder).toBe('Work');
        expect(doc3.updatedAt).toBe(0);
    });
});
