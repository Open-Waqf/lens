import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = {native: false};
const calls: Array<string> = [];

const fsReaddir = vi.fn();
const fsStat = vi.fn();
const fsWriteFile = vi.fn();
const fsDeleteFile = vi.fn();
const fsRmdir = vi.fn();

const dbDelete = vi.fn();
const dbTxn = vi.fn();
const opfsWipe = vi.fn();

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => state.native
    }
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: {
        Data: 'DATA'
    },
    Filesystem: {
        readdir: (...args: any[]) => fsReaddir(...args),
        stat: (...args: any[]) => fsStat(...args),
        writeFile: (...args: any[]) => fsWriteFile(...args),
        deleteFile: (...args: any[]) => fsDeleteFile(...args),
        rmdir: (...args: any[]) => fsRmdir(...args),
    }
}));

vi.mock('../../src/services/db', () => ({
    db: {
        delete: (...args: any[]) => dbDelete(...args),
        transaction: (...args: any[]) => dbTxn(...args),
        pages: {clear: vi.fn()},
        docs: {clear: vi.fn()},
    }
}));

vi.mock('../../src/services/filestore/opfs-store', () => ({
    secureOverwriteAndRemoveOpfsTree: (...args: any[]) => opfsWipe(...args),
}));

vi.mock('../../src/lib/bytes', () => ({
    bytesToBase64: async (_bytes: Uint8Array) => 'AA==',
}));

describe('resetAllStorage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        calls.length = 0;
        state.native = false;
        dbDelete.mockResolvedValue(undefined);
        dbTxn.mockResolvedValue(undefined);
        fsRmdir.mockResolvedValue(undefined);
        fsDeleteFile.mockImplementation(async ({path}: { path: string }) => {
            calls.push(`delete:${path}`);
        });
        fsWriteFile.mockImplementation(async ({path}: { path: string }) => {
            calls.push(`write:${path}`);
        });
        fsStat.mockResolvedValue({size: 512});
        fsReaddir.mockImplementation(async ({path}: { path: string }) => {
            if (path === 'docs') return {files: [{name: 'a.jpg', type: 'file'}]};
            if (path === 'exports') return {files: [{name: 'b.slbk', type: 'file'}]};
            return {files: []};
        });
        opfsWipe.mockResolvedValue(undefined);
    });

    it('uses native overwrite before delete on capacitor', async () => {
        state.native = true;
        const {resetAllStorage} = await import('../../src/services/reset-storage');
        await resetAllStorage();

        expect(calls).toContain('write:docs/a.jpg');
        expect(calls).toContain('delete:docs/a.jpg');
        expect(calls).toContain('write:exports/b.slbk');
        expect(calls).toContain('delete:exports/b.slbk');

        expect(calls.indexOf('write:docs/a.jpg')).toBeLessThan(calls.indexOf('delete:docs/a.jpg'));
        expect(calls.indexOf('write:exports/b.slbk')).toBeLessThan(calls.indexOf('delete:exports/b.slbk'));

        expect(opfsWipe).not.toHaveBeenCalled();
    });

    it('uses OPFS secure wipe on web', async () => {
        state.native = false;
        const {resetAllStorage} = await import('../../src/services/reset-storage');
        await resetAllStorage();

        expect(opfsWipe).toHaveBeenCalledWith('docs');
        expect(opfsWipe).toHaveBeenCalledWith('exports');
        expect(fsWriteFile).not.toHaveBeenCalled();
    });
});
