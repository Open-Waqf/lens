import {beforeEach, describe, expect, it, vi} from 'vitest';

const runtime = {native: false};

const fsWriteFile = vi.fn();
const fsAppendFile = vi.fn();
const fsReadFile = vi.fn();
const fsDeleteFile = vi.fn();

const opfsOpen = vi.fn();
const opfsWrite = vi.fn();
const opfsClose = vi.fn();
const opfsRemove = vi.fn();

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => runtime.native
    }
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: {
        Data: 'DATA'
    },
    Filesystem: {
        writeFile: (...args: any[]) => fsWriteFile(...args),
        appendFile: (...args: any[]) => fsAppendFile(...args),
        readFile: (...args: any[]) => fsReadFile(...args),
        deleteFile: (...args: any[]) => fsDeleteFile(...args),
    }
}));

vi.mock('../../src/services/filestore/opfs-store', () => ({
    OPFSStreamWriter: class {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        constructor(_path: string) {
        }

        open = (...args: any[]) => opfsOpen(...args);
        write = (...args: any[]) => opfsWrite(...args);
        close = (...args: any[]) => opfsClose(...args);
    },
    opfsRemoveEntry: (...args: any[]) => opfsRemove(...args),
}));

vi.mock('../../src/lib/bytes', () => ({
    bytesToBase64: async (_bytes: Uint8Array) => 'AQID',
}));

describe('backup temp writer platform branch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtime.native = false;
        opfsClose.mockResolvedValue(new File([new Uint8Array([1, 2, 3])], 'tmp.slbk'));
        fsReadFile.mockResolvedValue({data: 'AQID'});
    });

    it('uses OPFS writer on web', async () => {
        const {createTempBackupWriter} = await import('../../src/services/backup-temp-store');
        const writer = createTempBackupWriter('exports/tmp.slbk');
        await writer.open();
        await writer.write(new Uint8Array([1]));
        await writer.close();
        await writer.cleanup();

        expect(opfsOpen).toHaveBeenCalledTimes(1);
        expect(opfsWrite).toHaveBeenCalledTimes(1);
        expect(opfsClose).toHaveBeenCalledTimes(1);
        expect(opfsRemove).toHaveBeenCalledWith('exports/tmp.slbk');
        expect(fsWriteFile).not.toHaveBeenCalled();
    });

    it('uses native filesystem writer on capacitor', async () => {
        runtime.native = true;
        const {createTempBackupWriter} = await import('../../src/services/backup-temp-store');
        const writer = createTempBackupWriter('exports/tmp.slbk');
        await writer.open();
        await writer.write(new Uint8Array([1]));
        await writer.write(new Uint8Array([2]));
        const file = await writer.close();
        await writer.cleanup();

        expect(fsWriteFile).toHaveBeenCalledTimes(1);
        expect(fsAppendFile).toHaveBeenCalledTimes(1);
        expect(fsReadFile).toHaveBeenCalledTimes(1);
        expect(fsDeleteFile).toHaveBeenCalled();
        expect(file.name).toBe('tmp.slbk');
        expect(opfsOpen).not.toHaveBeenCalled();
        expect(opfsWrite).not.toHaveBeenCalled();
        expect(opfsClose).not.toHaveBeenCalled();
        expect(opfsRemove).not.toHaveBeenCalled();
    });
});
