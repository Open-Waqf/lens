import {beforeEach, describe, expect, it, vi} from 'vitest';

const mockState = vi.hoisted(() => ({
    isNative: false,
    opfsFiles: [] as string[],
    writtenDocs: [] as Array<Record<string, unknown>>,
    writtenPages: [] as Array<Record<string, unknown>>,
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => mockState.isNative
    }
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: {Data: 'DATA'},
    Filesystem: {
        readdir: vi.fn(async () => ({files: []}))
    }
}));

vi.mock('../../src/services/filestore/opfs-store', () => ({
    opfsListFiles: vi.fn(async () => mockState.opfsFiles)
}));

vi.mock('../../src/services/db', () => ({
    db: {
        docs: {
            clear: vi.fn(async () => {
                mockState.writtenDocs = [];
            }),
            bulkPut: vi.fn(async (docs: Array<Record<string, unknown>>) => {
                mockState.writtenDocs = docs;
            })
        },
        pages: {
            clear: vi.fn(async () => {
                mockState.writtenPages = [];
            }),
            bulkPut: vi.fn(async (pages: Array<Record<string, unknown>>) => {
                mockState.writtenPages = pages;
            })
        },
        transaction: vi.fn(async (_mode: string, _docs: unknown, _pages: unknown, fn: () => Promise<void>) => {
            await fn();
        })
    }
}));

describe('rebuild-index', () => {
    beforeEach(() => {
        mockState.isNative = false;
        mockState.opfsFiles = [];
        mockState.writtenDocs = [];
        mockState.writtenPages = [];
    });

    it('rebuilds docs/pages records from files', async () => {
        mockState.opfsFiles = [
            'docs/docA/pages/p1.jpg',
            'docs/docA/thumbs/p1.jpg',
            'docs/docA/pages/p2.jpg',
            'docs/docB/pages/x1.jpg',
            'docs/docB/exports/final.pdf',
            'docs/docB/thumbs/x1.jpg',
        ];

        const svc = await import('../../src/services/rebuild-index');
        const result = await svc.rebuildLibraryIndexFromFiles();

        expect(result.docsRecovered).toBe(2);
        expect(result.pagesRecovered).toBe(3);

        expect(mockState.writtenDocs).toHaveLength(2);
        expect(mockState.writtenPages).toHaveLength(3);

        const docB = mockState.writtenDocs.find((d) => d.id === 'docB');
        expect(docB?.pdfPath).toBe('docs/docB/exports/final.pdf');
    });

    it('ignores non-page files and docs with no recoverable pages', async () => {
        mockState.opfsFiles = [
            'docs/docC/thumbs/orphan.jpg',
            'docs/docC/exports/only.pdf',
            'docs/docD/misc/note.txt',
        ];

        const svc = await import('../../src/services/rebuild-index');
        const result = await svc.rebuildLibraryIndexFromFiles();

        expect(result.docsRecovered).toBe(0);
        expect(result.pagesRecovered).toBe(0);
        expect(mockState.writtenDocs).toHaveLength(0);
        expect(mockState.writtenPages).toHaveLength(0);
    });
});
