import {beforeEach, describe, expect, it, vi} from 'vitest';

type Doc = { id: string; pageIds: string[]; updatedAt: number; searchIndex?: string };
type Page = { id: string; docId: string; imagePath: string; thumbPath: string; words?: Array<{ text: string }> };

const state = vi.hoisted(() => ({
    docs: new Map<string, Doc>(),
    pages: new Map<string, Page>(),
    files: new Map<string, Uint8Array>(),
    failPutPath: null as string | null,
}));

vi.mock('../../src/services/settings', () => ({
    settings: {get: vi.fn(async () => ({enableOcr: true, ocrLang: 'ara+eng'}))}
}));

vi.mock('../../src/services/ocr-queue', () => ({
    ocrQueue: {addJob: vi.fn(), completeJob: vi.fn()}
}));

vi.mock('../../src/services/filestore', () => ({
    getFileStore: () => ({
        get: vi.fn(async (path: string) => {
            const v = state.files.get(path);
            if (!v) throw new Error(`missing file: ${path}`);
            return v;
        }),
        put: vi.fn(async (path: string, bytes: Uint8Array) => {
            if (state.failPutPath && path === state.failPutPath) throw new Error(`put failed: ${path}`);
            state.files.set(path, new Uint8Array(bytes));
        }),
        del: vi.fn(async (path: string) => {
            state.files.delete(path);
        }),
    })
}));

vi.mock('../../src/services/db', () => {
    const whereDocId = (docId: string) => ({
        toArray: vi.fn(async () => Array.from(state.pages.values()).filter(p => p.docId === docId)),
        delete: vi.fn(async () => {
            for (const [id, page] of state.pages.entries()) {
                if (page.docId === docId) state.pages.delete(id);
            }
        }),
        modify: vi.fn(async (patch: Partial<Page>) => {
            for (const [id, page] of state.pages.entries()) {
                if (page.docId !== docId) continue;
                state.pages.set(id, {...page, ...patch});
            }
        })
    });

    return {
        db: {
            transaction: vi.fn(async (...args: unknown[]) => {
                const cb = args[args.length - 1] as () => Promise<void>;
                await cb();
            }),
            docs: {
                get: vi.fn(async (id: string) => state.docs.get(id)),
                put: vi.fn(async (doc: Doc) => state.docs.set(doc.id, doc)),
                update: vi.fn(async (id: string, patch: Partial<Doc>) => {
                    const doc = state.docs.get(id);
                    if (!doc) return 0;
                    state.docs.set(id, {...doc, ...patch});
                    return 1;
                }),
                delete: vi.fn(async (id: string) => state.docs.delete(id)),
            },
            pages: {
                get: vi.fn(async (id: string) => state.pages.get(id)),
                update: vi.fn(async (id: string, patch: Partial<Page>) => {
                    const page = state.pages.get(id);
                    if (!page) return 0;
                    state.pages.set(id, {...page, ...patch});
                    return 1;
                }),
                where: vi.fn((key: string) => ({
                    equals: vi.fn((value: string) => {
                        if (key !== 'docId') throw new Error(`Unexpected where key: ${key}`);
                        return whereDocId(value);
                    })
                }))
            }
        }
    };
});

import {ScanRepo} from '../../src/pages/scan/scan-repo';

describe('ScanRepo mergeDocuments file migration', () => {
    beforeEach(() => {
        state.docs.clear();
        state.pages.clear();
        state.files.clear();
        state.failPutPath = null;

        state.docs.set('d1', {id: 'd1', pageIds: ['p1'], updatedAt: 1});
        state.docs.set('d2', {id: 'd2', pageIds: ['p2'], updatedAt: 2});

        state.pages.set('p1', {
            id: 'p1',
            docId: 'd1',
            imagePath: 'docs/d1/pages/p1.jpg',
            thumbPath: 'docs/d1/thumbs/p1.jpg',
            words: [{text: 'alpha'}]
        });
        state.pages.set('p2', {
            id: 'p2',
            docId: 'd2',
            imagePath: 'docs/d2/pages/p2.jpg',
            thumbPath: 'docs/d2/thumbs/p2.jpg',
            words: [{text: 'beta'}]
        });

        state.files.set('docs/d1/pages/p1.jpg', new Uint8Array([1]));
        state.files.set('docs/d1/thumbs/p1.jpg', new Uint8Array([2]));
        state.files.set('docs/d2/pages/p2.jpg', new Uint8Array([3]));
        state.files.set('docs/d2/thumbs/p2.jpg', new Uint8Array([4]));
    });

    it('moves page files and rewrites page paths to target doc directory', async () => {
        const repo = new ScanRepo();
        const target = await repo.mergeDocuments(['d1', 'd2']);

        expect(target).toBe('d1');
        expect(state.docs.has('d2')).toBe(false);

        const movedPage = state.pages.get('p2');
        expect(movedPage?.docId).toBe('d1');
        expect(movedPage?.imagePath).toBe('docs/d1/pages/p2.jpg');
        expect(movedPage?.thumbPath).toBe('docs/d1/thumbs/p2.jpg');

        expect(state.files.has('docs/d2/pages/p2.jpg')).toBe(false);
        expect(state.files.has('docs/d2/thumbs/p2.jpg')).toBe(false);
        expect(state.files.has('docs/d1/pages/p2.jpg')).toBe(true);
        expect(state.files.has('docs/d1/thumbs/p2.jpg')).toBe(true);
    });

    it('keeps merged files removable by deleteDocCompletely on target doc', async () => {
        const repo = new ScanRepo();
        await repo.mergeDocuments(['d1', 'd2']);
        await repo.deleteDocCompletely('d1');

        expect(state.docs.size).toBe(0);
        expect(state.pages.size).toBe(0);
        expect(Array.from(state.files.keys())).toEqual([]);
    });

    it('rolls back file migration when target write fails', async () => {
        state.failPutPath = 'docs/d1/thumbs/p2.jpg';
        const repo = new ScanRepo();

        await expect(repo.mergeDocuments(['d1', 'd2'])).rejects.toThrow('put failed');

        // DB unchanged
        expect(state.docs.has('d1')).toBe(true);
        expect(state.docs.has('d2')).toBe(true);
        expect(state.pages.get('p2')?.docId).toBe('d2');
        expect(state.pages.get('p2')?.imagePath).toBe('docs/d2/pages/p2.jpg');
        expect(state.pages.get('p2')?.thumbPath).toBe('docs/d2/thumbs/p2.jpg');

        // Source files preserved
        expect(state.files.has('docs/d2/pages/p2.jpg')).toBe(true);
        expect(state.files.has('docs/d2/thumbs/p2.jpg')).toBe(true);
        // Partially created target artifacts cleaned up
        expect(state.files.has('docs/d1/pages/p2.jpg')).toBe(false);
        expect(state.files.has('docs/d1/thumbs/p2.jpg')).toBe(false);
    });
});
