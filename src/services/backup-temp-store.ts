import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {OPFSStreamWriter, opfsRemoveEntry} from './filestore/opfs-store';
import {bytesToBase64} from '../lib/bytes';

export interface TempBackupWriter {
    open(): Promise<void>;
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<File>;
    cleanup(): Promise<void>;
}

class OpfsTempBackupWriter implements TempBackupWriter {
    private writer: OPFSStreamWriter;

    constructor(private readonly path: string) {
        this.writer = new OPFSStreamWriter(path);
    }

    async open(): Promise<void> {
        await this.writer.open();
    }

    async write(chunk: Uint8Array): Promise<void> {
        await this.writer.write(chunk);
    }

    async close(): Promise<File> {
        return await this.writer.close();
    }

    async cleanup(): Promise<void> {
        await opfsRemoveEntry(this.path);
    }
}

class NativeTempBackupWriter implements TempBackupWriter {
    private firstChunk = true;

    constructor(private readonly path: string) {
    }

    async open(): Promise<void> {
        this.firstChunk = true;
        try {
            await Filesystem.deleteFile({
                path: this.path,
                directory: Directory.Data
            });
        } catch {
        }
    }

    async write(chunk: Uint8Array): Promise<void> {
        const data = await bytesToBase64(chunk);
        if (this.firstChunk) {
            this.firstChunk = false;
            await Filesystem.writeFile({
                path: this.path,
                data,
                directory: Directory.Data,
                recursive: true
            });
            return;
        }
        await Filesystem.appendFile({
            path: this.path,
            data,
            directory: Directory.Data
        });
    }

    async close(): Promise<File> {
        const read = await Filesystem.readFile({
            path: this.path,
            directory: Directory.Data
        });
        const base64 = typeof read.data === 'string' ? read.data : '';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const name = this.path.split('/').pop() || 'temp.bin';
        return new File([bytes], name, {type: 'application/octet-stream', lastModified: Date.now()});
    }

    async cleanup(): Promise<void> {
        try {
            await Filesystem.deleteFile({
                path: this.path,
                directory: Directory.Data
            });
        } catch {
        }
    }
}

export function createTempBackupWriter(path: string): TempBackupWriter {
    if (Capacitor.isNativePlatform()) return new NativeTempBackupWriter(path);
    return new OpfsTempBackupWriter(path);
}
