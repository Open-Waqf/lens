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
    return err instanceof DOMException && err.name === 'NotFoundError';
}

let rootDirPromise: Promise<FileSystemDirectoryHandle> | null = null;

async function getRootDir(): Promise<FileSystemDirectoryHandle> {
    if (!navigator.storage?.getDirectory) {
        throw new Error('OPFS not supported in this browser.');
    }
    rootDirPromise ??= navigator.storage.getDirectory();
    try {
        return await rootDirPromise;
    } catch (e) {
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

        await writable.write({type: 'write', data: toArrayBuffer(bytes)});
        await writable.close();
    }

    async get(path: string): Promise<Uint8Array> {
        const root = await getRootDir();
        const parts = splitPath(path);
        const fileName = parts.pop();
        if (!fileName) throw new Error('Invalid path');

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
            const dir = await ensureDir(root, parts, false);
            await dir.removeEntry(fileName);
        } catch (e) {
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
            throw e;
        }
    }
}

// ---- Stream Writer (New) ----

export class OPFSStreamWriter {
    private fileHandle: FileSystemFileHandle | null = null;
    private writable: FileSystemWritableFileStream | null = null;

    constructor(private path: string) {
    }

    async open(): Promise<void> {
        const root = await getRootDir();
        const parts = splitPath(this.path);
        const fileName = parts.pop();
        if (!fileName) throw new Error('Invalid path');

        const dir = await ensureDir(root, parts, true);
        this.fileHandle = await dir.getFileHandle(fileName, {create: true});
        this.writable = await this.fileHandle.createWritable();
    }

    async write(chunk: Uint8Array): Promise<void> {
        if (!this.writable) throw new Error('Stream not open');
        // FIX: Use toArrayBuffer to satisfy TypeScript strict types
        await this.writable.write({type: 'write', data: toArrayBuffer(chunk)});
    }

    async close(): Promise<File> {
        if (this.writable) {
            await this.writable.close();
            this.writable = null;
        }
        if (!this.fileHandle) throw new Error('No file handle');
        return await this.fileHandle.getFile();
    }
}

// ---- Helpers ----

export async function opfsRemoveEntry(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const root = await getRootDir();
    const parts = splitPath(path);
    const name = parts.pop();
    if (!name) return;

    try {
        const dir = await ensureDir(root, parts, false);
        await dir.removeEntry(name, {recursive: !!opts?.recursive});
    } catch (e) {
        if (isNotFound(e)) return;
        throw e;
    }
}

export async function opfsRemoveTree(prefixDir: string): Promise<void> {
    await opfsRemoveEntry(prefixDir, {recursive: true});
}

/**
 * MANDATE FR-VAULT-004: Securely wipe OPFS tree by overwriting file contents 
 * with zeros before removing them.
 */
export async function secureOverwriteAndRemoveOpfsTree(prefixDir: string): Promise<void> {
    const root = await getRootDir();
    const parts = splitPath(prefixDir);
    let dir: FileSystemDirectoryHandle;
    try {
        dir = await ensureDir(root, parts, false);
    } catch (e) {
        if (isNotFound(e)) return;
        throw e;
    }

    await secureWipeRecursive(dir);
    
    // After wiping contents, remove the tree
    const name = parts.pop();
    if (name) {
        const parent = await ensureDir(root, parts, false);
        await parent.removeEntry(name, {recursive: true});
    } else {
        // We are at root, remove everything inside
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const [name, handle] of (dir as any).entries()) {
            await dir.removeEntry(name, {recursive: handle.kind === 'directory'});
        }
    }
}

async function secureWipeRecursive(dir: FileSystemDirectoryHandle): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind === 'file') {
            const fileHandle = handle as FileSystemFileHandle;
            try {
                const file = await fileHandle.getFile();
                const size = file.size;
                if (size > 0) {
                    const writable = await fileHandle.createWritable();
                    // Overwrite with zeros
                    const zeros = new Uint8Array(Math.min(size, 1024 * 1024)); // Chunked if very large
                    zeros.fill(0);
                    let written = 0;
                    while (written < size) {
                        const toWrite = Math.min(zeros.length, size - written);
                        await writable.write({
                            type: 'write',
                            position: written,
                            data: toWrite === zeros.length ? zeros.buffer : zeros.slice(0, toWrite).buffer
                        });
                        written += toWrite;
                    }
                    await writable.close();
                }
            } catch (e) {
                console.warn(`Failed to securely wipe ${name}`, e);
            }
        } else if (handle.kind === 'directory') {
            await secureWipeRecursive(handle as FileSystemDirectoryHandle);
        }
    }
}

async function listFilesRecursive(dir: FileSystemDirectoryHandle, prefix: string, out: string[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name, handle] of (dir as any).entries()) {
        if (handle.kind === 'file') {
            out.push(prefix ? `${prefix}/${name}` : name);
        } else if (handle.kind === 'directory') {
            const nextPrefix = prefix ? `${prefix}/${name}` : name;
            await listFilesRecursive(handle as FileSystemDirectoryHandle, nextPrefix, out);
        }
    }
}

export async function opfsListFiles(prefixDir = ''): Promise<string[]> {
    const root = await getRootDir();
    const out: string[] = [];
    if (!prefixDir) {
        await listFilesRecursive(root, '', out);
        return out;
    }

    const parts = splitPath(prefixDir);
    try {
        const dir = await ensureDir(root, parts, false);
        await listFilesRecursive(dir, prefixDir.replace(/\/+$/, ''), out);
        return out;
    } catch (e) {
        if (isNotFound(e)) return [];
        throw e;
    }
}