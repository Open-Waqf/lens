import {beforeEach, describe, expect, it, vi} from 'vitest';

const mockIsNative = vi.fn(() => false);
const mockOpfsListFiles = vi.fn<() => Promise<string[]>>();
const mockOpfsRemoveEntry = vi.fn<() => Promise<void>>();

const mockDocsToArray = vi.fn<() => Promise<Array<{ pdfPath?: string | null }>>>();
const mockPagesToArray = vi.fn<() => Promise<Array<{ imagePath: string; thumbPath: string }>>>();
const mockTransaction = vi.fn(async (_mode: string, _docs: unknown, _pages: unknown, cb: () => Promise<void>) => cb());

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => mockIsNative(),
    }
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: {Data: 'DATA'},
    Filesystem: {
        readdir: vi.fn(),
        deleteFile: vi.fn(),
    }
}));

vi.mock('../../src/services/filestore/opfs-store', () => ({
    opfsListFiles: (...args: unknown[]) => mockOpfsListFiles(...args as []),
    opfsRemoveEntry: (...args: unknown[]) => mockOpfsRemoveEntry(...args as []),
}));

vi.mock('../../src/services/db', () => ({
    db: {
        docs: {toArray: (...args: unknown[]) => mockDocsToArray(...args as [])},
        pages: {toArray: (...args: unknown[]) => mockPagesToArray(...args as [])},
        transaction: (...args: unknown[]) => mockTransaction(...args as [string, unknown, unknown, () => Promise<void>]),
    }
}));

import {deleteOrphanStorageFiles, findOrphanStorageFiles} from '../../src/services/storage-audit';

describe('storage-audit service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsNative.mockReturnValue(false);
        mockDocsToArray.mockResolvedValue([]);
        mockPagesToArray.mockResolvedValue([]);
        mockOpfsListFiles.mockResolvedValue([]);
        mockOpfsRemoveEntry.mockResolvedValue();
    });

    it('finds OPFS files not referenced by Dexie metadata', async () => {
        mockPagesToArray.mockResolvedValue([
            {imagePath: 'docs/doc-1/pages/p1.jpg', thumbPath: 'docs/doc-1/thumbs/p1.jpg'},
        ]);
        mockDocsToArray.mockResolvedValue([
            {pdfPath: 'docs/doc-1/final.pdf'},
        ]);
        mockOpfsListFiles.mockResolvedValue([
            'docs/doc-1/pages/p1.jpg',
            'docs/doc-1/thumbs/p1.jpg',
            'docs/doc-1/final.pdf',
            'docs/doc-1/pages/p2.jpg',
            'docs/orphan.jpg',
        ]);

        const orphans = await findOrphanStorageFiles();
        expect(orphans).toEqual(['docs/doc-1/pages/p2.jpg', 'docs/orphan.jpg']);
    });

    it('deletes provided orphan list and returns deleted count', async () => {
        const count = await deleteOrphanStorageFiles(['docs/o1.jpg', 'docs/o2.jpg']);
        expect(count).toBe(2);
        expect(mockOpfsRemoveEntry).toHaveBeenCalledTimes(2);
        expect(mockOpfsRemoveEntry).toHaveBeenCalledWith('docs/o1.jpg');
        expect(mockOpfsRemoveEntry).toHaveBeenCalledWith('docs/o2.jpg');
    });
});

