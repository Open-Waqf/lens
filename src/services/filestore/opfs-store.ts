import {toArrayBuffer} from '../../lib/bytes';

export interface FileStore {
    put(path: string, bytes: Uint8Array, mime: string): Promise<void>;

    get(path: string): Promise<Uint8Array>;

    del(path: string): Promise<void>;

    exists(path: string): Promise<boolean>;
}

function splitPath(path: string): string[] {
    return path.split('/').filter(Boolean);
}

async function getRootDir(): Promise<FileSystemDirectoryHandle> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (navigator.storage as any).getDirectory();
}

async function ensureDir(root: FileSystemDirectoryHandle, parts: string[]): Promise<FileSystemDirectoryHandle> {
    let dir = root;
    for (const p of parts) {
        dir = await dir.getDirectoryHandle(p, {create: true});
    }
    return dir;
}

export class OPFSFileStore implements FileStore {
    async put(path: string, bytes: Uint8Array, _mime: string): Promise<void> {
        const root = await getRootDir();
        const parts = splitPath(path);
        const fileName = parts.pop();
        if (!fileName) throw new Error('Invalid path');

        const dir = await ensureDir(root, parts);
        const fileHandle = await dir.getFileHandle(fileName, {create: true});
        const writable = await fileHandle.createWritable();

        // IMPORTANT: avoid overload confusion + ArrayBufferLike typing issues
        await writable.write({type: 'write', data: toArrayBuffer(bytes)});
        await writable.close();
    }

    async get(path: string): Promise<Uint8Array> {
        const root = await getRootDir();
        const parts = splitPath(path);
        const fileName = parts.pop();
        if (!fileName) throw new Error('Invalid path');

        const dir = await ensureDir(root, parts);
        const fileHandle = await dir.getFileHandle(fileName, {create: false});
        const file = await fileHandle.getFile();
        return new Uint8Array(await file.arrayBuffer());
    }

    async del(path: string): Promise<void> {
        const root = await getRootDir();
        const parts = splitPath(path);
        const fileName = parts.pop();
        if (!fileName) return;

        const dir = await ensureDir(root, parts);
        await dir.removeEntry(fileName);
    }

    async exists(path: string): Promise<boolean> {
        try {
            await this.get(path);
            return true;
        } catch {
            return false;
        }
    }
}
