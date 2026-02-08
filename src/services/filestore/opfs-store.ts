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

function isNotFound(err: unknown): boolean {
    // DOMException name is typically "NotFoundError"
    return err instanceof DOMException && err.name === 'NotFoundError';
}

let rootDirPromise: Promise<FileSystemDirectoryHandle> | null = null;

async function getRootDir(): Promise<FileSystemDirectoryHandle> {
    if (!navigator.storage?.getDirectory) {
        throw new Error('OPFS not supported in this browser.');
    }

    // cache root handle (safe for OPFS)
    rootDirPromise ??= navigator.storage.getDirectory();
    try {
        return await rootDirPromise;
    } catch (e) {
        // if it failed once, allow retry next time
        rootDirPromise = null;
        const msg = (e as Error)?.message ?? String(e);
        throw new Error(`Failed to access OPFS: ${msg}`);
    }
}

async function ensureDir(
    root: FileSystemDirectoryHandle,
    parts: string[],
    create: boolean,
): Promise<FileSystemDirectoryHandle> {
    let dir = root;
    for (const p of parts) {
        dir = await dir.getDirectoryHandle(p, {create});
    }
    return dir;
}

export class OPFSFileStore implements FileStore {
    async put(path: string, bytes: Uint8Array, _mime: string): Promise<void> {
        const root = await getRootDir();
        const parts = splitPath(path);
        const fileName = parts.pop();
        if (!fileName) throw new Error('Invalid path');

        const dir = await ensureDir(root, parts, true);
        const fileHandle = await dir.getFileHandle(fileName, {create: true});
        const writable = await fileHandle.createWritable();

        // avoid ArrayBufferLike typing issues
        await writable.write({type: 'write', data: toArrayBuffer(bytes)});
        await writable.close();
    }

    async get(path: string): Promise<Uint8Array> {
        const root = await getRootDir();
        const parts = splitPath(path);
        const fileName = parts.pop();
        if (!fileName) throw new Error('Invalid path');

        // IMPORTANT: create=false so reads don't create directories
        const dir = await ensureDir(root, parts, false);
        const fileHandle = await dir.getFileHandle(fileName, {create: false});
        const file = await fileHandle.getFile();
        return new Uint8Array(await file.arrayBuffer());
    }

    async del(path: string): Promise<void> {
        const root = await getRootDir();
        const parts = splitPath(path);
        const fileName = parts.pop();
        if (!fileName) return;

        try {
            // create=false so delete doesn't create directories
            const dir = await ensureDir(root, parts, false);
            await dir.removeEntry(fileName);
        } catch (e) {
            // deleting a missing file should be a no-op
            if (isNotFound(e)) return;
            throw e;
        }
    }

    async exists(path: string): Promise<boolean> {
        const root = await getRootDir();
        const parts = splitPath(path);
        const fileName = parts.pop();
        if (!fileName) return false;

        try {
            const dir = await ensureDir(root, parts, false);
            await dir.getFileHandle(fileName, {create: false});
            return true;
        } catch (e) {
            if (isNotFound(e)) return false;
            // other errors (permissions/secure context/etc) should surface
            throw e;
        }
    }
}