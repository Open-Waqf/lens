import {beforeEach, describe, expect, it, vi} from 'vitest';

type Doc = { id: string; pageIds: string[]; updatedAt: number; pdfPath?: string | null };
type Page = { id: string; docId: string; imagePath: string; thumbPath: string; words?: Array<{ text: string }> };

const state = vi.hoisted(() => ({
    docs: new Map<string, Doc>(),
    pages: new Map<string, Page>(),
    deleteShouldFail: false,
    deletedPaths: [] as string[],
}));

vi.mock('../../src/services/settings', () => ({
    settings: {
        get: vi.fn(async () => ({enableOcr: true, ocrLang: 'ara+eng'})),
    }
}));

vi.mock('../../src/services/ocr-queue', () => ({
    ocrQueue: {
        addJob: vi.fn(),
        completeJob: vi.fn(),
    }
}));

vi.mock('../../src/services/filestore', () => ({
    getFileStore: () => ({
        del: vi.fn(async (path: string) => {
            if (state.deleteShouldFail) throw new Error(`fail ${path}`);
            state.deletedPaths.push(path);
        }),
        put: vi.fn(),
        get: vi.fn(),
    }),
}));

vi.mock('../../src/services/db', () => {
    const pagesWhere = (docId: string) => ({
        toArray: vi.fn(async () => Array.from(state.pages.values()).filter(p => p.docId === docId)),
        delete: vi.fn(async () => {
            for (const [id, page] of state.pages.entries()) {
                if (page.docId === docId) state.pages.delete(id);
            }
        }),
        modify: vi.fn(async (_patch: unknown) => undefined),
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
                delete: vi.fn(async (id: string) => state.pages.delete(id)),
                where: vi.fn((key: string) => ({
                    equals: vi.fn((value: string) => {
                        if (key !== 'docId') throw new Error(`Unexpected where key: ${key}`);
                        return pagesWhere(value);
                    })
                }))
            }
        }
    };
});

import {ScanRepo} from '../../src/pages/scan/scan-repo';
import {
    clearStorageCleanupPending,
    hasStorageCleanupPending
} from '../../src/services/storage-cleanup-flag';

describe('ScanRepo storage consistency signaling', () => {
    beforeEach(() => {
        localStorage.clear();
        clearStorageCleanupPending();
        state.docs.clear();
        state.pages.clear();
        state.deletedPaths = [];
        state.deleteShouldFail = false;

        state.docs.set('d1', {id: 'd1', pageIds: ['p1'], updatedAt: 0, pdfPath: 'docs/d1/final.pdf'});
        state.pages.set('p1', {
            id: 'p1',
            docId: 'd1',
            imagePath: 'docs/d1/pages/p1.jpg',
            thumbPath: 'docs/d1/thumbs/p1.jpg',
            words: [{text: 'hello'}]
        });
    });

    it('marks cleanup pending when page file deletion fails', async () => {
        state.deleteShouldFail = true;
        const repo = new ScanRepo();

        await repo.deletePage('p1');

        expect(hasStorageCleanupPending()).toBe(true);
    });

    it('marks cleanup pending when document file deletion fails', async () => {
        state.deleteShouldFail = true;
        const repo = new ScanRepo();

        await repo.deleteDocCompletely('d1');

        expect(hasStorageCleanupPending()).toBe(true);
    });
});
