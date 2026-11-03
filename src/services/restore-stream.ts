import {Unzip, UnzipInflate, UnzipPassThrough} from 'fflate';

export type RestoreMode = 'merge' | 'replace';

export type BackupMetadata = {docs: unknown[]; pages: unknown[]};

export type RestoreHandlers = {
    /** Called once, with the parsed metadata.json, before any file is written. Return null to cancel. */
    onMetadata(meta: BackupMetadata): Promise<RestoreMode | null>;
    /** Called for every other file in the backup, in order. */
    onFile(path: string, bytes: Uint8Array): Promise<void>;
};

export type RestoreResult = {mode: RestoreMode | null; files: number};

export class InvalidBackupError extends Error {
    constructor() {
        super('invalid_backup');
        this.name = 'InvalidBackupError';
    }
}

/** The backup ended before every page it lists had arrived (cut off, or made from a broken library). */
export class IncompleteBackupError extends Error {
    constructor(public readonly missing: number, public readonly total: number) {
        super(`incomplete_backup: ${missing} of ${total} page files missing`);
        this.name = 'IncompleteBackupError';
    }
}

export function isBackupMetadata(v: unknown): v is BackupMetadata {
    const m = v as {docs?: unknown; pages?: unknown} | null;
    if (!m || !Array.isArray(m.docs) || !Array.isArray(m.pages)) return false;
    const hasId = (x: unknown) => !!x && typeof (x as {id?: unknown}).id === 'string';
    return m.docs.every(hasId) && m.pages.every(hasId);
}

type Entry = {name: string; bytes: Uint8Array};

/**
 * Restore a backup from a stream of zip bytes, one file at a time.
 *
 * The whole backup is never held in memory: only the file being unpacked (a page image,
 * a few MB), plus any files that arrive before metadata.json (Lens always writes it first).
 * Before Nov 2026 the decrypted zip was written to a temp file, read back whole as base64
 * and parsed in memory: three copies of the backup, which could kill the app on a phone.
 *
 * Nothing is written before onMetadata has returned a mode; a null (cancel) stops the
 * restore with nothing changed.
 */
export async function restoreFromZipStream(
    chunks: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
    handlers: RestoreHandlers,
): Promise<RestoreResult> {
    const ready: Entry[] = [];
    let error: Error | null = null;
    const unzip = new Unzip((file) => {
        if (file.name.endsWith('/')) return; // folder entry
        const parts: Uint8Array[] = [];
        file.ondata = (err, data, final) => {
            if (err) {
                error = err instanceof Error ? err : new Error(String(err));
                return;
            }
            if (data.length) parts.push(data);
            if (final) ready.push({name: file.name, bytes: concat(parts)});
        };
        file.start();
    });
    unzip.register(UnzipPassThrough);
    unzip.register(UnzipInflate);

    let mode: RestoreMode | null | undefined; // undefined = metadata not seen yet
    let files = 0;
    const pending: Entry[] = []; // files that arrived before metadata.json

    const handle = async (entry: Entry): Promise<boolean> => {
        if (entry.name === 'metadata.json') {
            if (mode !== undefined) throw new InvalidBackupError(); // two metadata files
            let meta: unknown;
            try {
                meta = JSON.parse(new TextDecoder().decode(entry.bytes));
            } catch {
                throw new InvalidBackupError();
            }
            if (!isBackupMetadata(meta)) throw new InvalidBackupError();
            mode = await handlers.onMetadata(meta);
            if (mode === null) return false;
            for (const p of pending.splice(0)) {
                await handlers.onFile(p.name, p.bytes);
                files++;
            }
            return true;
        }
        if (mode === undefined) {
            pending.push(entry);
            return true;
        }
        await handlers.onFile(entry.name, entry.bytes);
        files++;
        return true;
    };

    const push = async (chunk: Uint8Array, final: boolean): Promise<boolean> => {
        unzip.push(chunk, final);
        if (error) throw error;
        while (ready.length) {
            if (!(await handle(ready.shift()!))) return false;
        }
        return true;
    };

    if (chunks instanceof ReadableStream) {
        const reader = chunks.getReader();
        try {
            for (;;) {
                const {done, value} = await reader.read();
                if (done) break;
                if (!(await push(value, false))) return {mode: null, files: 0};
            }
        } finally {
            reader.releaseLock();
        }
    } else {
        for await (const chunk of chunks) {
            if (!(await push(chunk, false))) return {mode: null, files: 0};
        }
    }
    if (!(await push(new Uint8Array(0), true))) return {mode: null, files: 0};
    if (mode === undefined) throw new InvalidBackupError(); // no metadata.json at all
    return {mode, files};
}

function concat(parts: Uint8Array[]): Uint8Array {
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}
