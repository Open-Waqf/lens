import {beforeEach, describe, expect, it, vi} from 'vitest';
import {CapacitorFileStore} from '../../src/services/filestore/capacitor-store';
import {Filesystem} from '@capacitor/filesystem';

vi.mock('@capacitor/filesystem', () => ({
    Directory: {Data: 'DATA'},
    Filesystem: {
        readdir: vi.fn(),
        stat: vi.fn(),
    }
}));

describe('CapacitorFileStore Usage Accuracy', () => {
    let store: CapacitorFileStore;

    beforeEach(() => {
        vi.clearAllMocks();
        store = new CapacitorFileStore();
    });

    it('should recursively calculate size of all files in Directory.Data', async () => {
        vi.mocked(Filesystem.readdir).mockImplementation(async ({path}) => {
            if (path === '' || path === '/') {
                return {
                    files: [
                        {name: 'pages', type: 'directory', size: 0, uri: '', mtime: 0},
                        {name: 'docs', type: 'directory', size: 0, uri: '', mtime: 0},
                        {name: 'exports', type: 'directory', size: 0, uri: '', mtime: 0},
                    ]
                } as any;
            } else if (path === 'pages') {
                return {
                    files: [
                        {name: 'p1.jpg', type: 'file', size: 100, uri: '', mtime: 0},
                        {name: 'p2.jpg', type: 'file', size: 200, uri: '', mtime: 0},
                        {name: 'thumbnails', type: 'directory', size: 0, uri: '', mtime: 0},
                    ]
                } as any;
            } else if (path === 'pages/thumbnails') {
                return {
                    files: [
                        {name: 't1.jpg', type: 'file', size: 10, uri: '', mtime: 0},
                    ]
                } as any;
            } else if (path === 'exports') {
                return {
                    files: [
                        {name: 'export1.pdf', type: 'file', size: 500, uri: '', mtime: 0},
                    ]
                } as any;
            } else if (path === 'docs') {
                return {files: []} as any;
            }
            throw new Error(`Path not mocked: ${path}`);
        });

        const total = await store.getUsageEstimate();
        expect(total).toBe(810);
    });

    it('falls back to stat size when readdir entry size is missing', async () => {
        vi.mocked(Filesystem.readdir).mockImplementation(async ({path}) => {
            if (path === '' || path === '/') {
                return {
                    files: [{name: 'docs', type: 'directory', size: 0, uri: '', mtime: 0}]
                } as any;
            }
            if (path === 'docs') {
                return {
                    files: [{name: 'a.jpg', type: 'file', uri: '', mtime: 0}]
                } as any;
            }
            throw new Error(`Path not mocked: ${path}`);
        });

        vi.mocked(Filesystem.stat as any).mockResolvedValue({size: 321});
        const total = await store.getUsageEstimate();
        expect(total).toBe(321);
        expect((Filesystem.stat as any)).toHaveBeenCalledWith({
            path: 'docs/a.jpg',
            directory: 'DATA',
        });
    });
});
