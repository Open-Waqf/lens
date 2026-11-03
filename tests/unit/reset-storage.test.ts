import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = {native: false};
const fsRmdir = vi.fn();
const fsWriteFile = vi.fn();
const dbDelete = vi.fn();
const opfsRemoveTree = vi.fn();

vi.mock('@capacitor/core', () => ({Capacitor: {isNativePlatform: () => state.native}}));
vi.mock('@capacitor/filesystem', () => ({
    Directory: {Data: 'DATA'},
    Filesystem: {
        rmdir: (...args: any[]) => fsRmdir(...args),
        writeFile: (...args: any[]) => fsWriteFile(...args),
    },
}));
vi.mock('../../src/services/db', () => ({
    db: {delete: (...args: any[]) => dbDelete(...args), transaction: vi.fn(), pages: {clear: vi.fn()}, docs: {clear: vi.fn()}},
}));
vi.mock('../../src/services/filestore/opfs-store', () => ({
    opfsRemoveTree: (...args: any[]) => opfsRemoveTree(...args),
}));

describe('resetAllStorage: Erase Everything', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.native = false;
        localStorage.clear();
        localStorage.setItem('sahifah.lastBackup', '1');
        localStorage.setItem('other.app.key', 'keep');
    });

    it('Android: deletes the database and the docs, exports and imports folders, without overwriting', async () => {
        state.native = true;
        const {resetAllStorage} = await import('../../src/services/reset-storage');
        await resetAllStorage();
        expect(dbDelete).toHaveBeenCalledTimes(1);
        expect(fsRmdir.mock.calls.map((c) => c[0].path)).toEqual(['docs', 'exports', 'imports']);
        expect(fsRmdir.mock.calls.every((c) => c[0].recursive === true && c[0].directory === 'DATA')).toBe(true);
        expect(fsWriteFile).not.toHaveBeenCalled(); // no zero-overwrite pass
    });

    it('web: removes the same folders from the browser storage', async () => {
        const {resetAllStorage} = await import('../../src/services/reset-storage');
        await resetAllStorage();
        expect(opfsRemoveTree.mock.calls.map((c) => c[0])).toEqual(['docs', 'exports', 'imports']);
    });

    it('a missing folder does not stop the rest of the erase', async () => {
        state.native = true;
        fsRmdir.mockRejectedValueOnce(new Error('Folder does not exist'));
        const {resetAllStorage} = await import('../../src/services/reset-storage');
        await resetAllStorage();
        expect(fsRmdir).toHaveBeenCalledTimes(3);
        expect(localStorage.getItem('sahifah.lastBackup')).toBeNull();
        expect(localStorage.getItem('other.app.key')).toBe('keep');
    });
});
