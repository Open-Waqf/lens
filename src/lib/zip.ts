import {Zip, ZipPassThrough, zipSync} from 'fflate';

export type ZipFileEntry = {
    name: string;
    data: Uint8Array;
};

// ---------- Helpers ----------

function isUint8Array(v: unknown): v is Uint8Array {
    return v instanceof Uint8Array;
}

function normalizeToFileMap(
    input: Record<string, Uint8Array> | ZipFileEntry[] | Iterable<ZipFileEntry>
): Record<string, Uint8Array> {
    if (!Array.isArray(input) && !(Symbol.iterator in input)) {
        const files = input as any;

        // Auto-fix: Object.assign(files, jsonFile('meta.json', data))
        // would create { name: 'meta.json', data: Uint8Array(...) } keys.
        // If we detect that pattern, convert it into a real file entry.
        if (typeof files.name === 'string' && isUint8Array(files.data)) {
            const filename = files.name;
            // Only do this fix for likely “real filenames” to avoid surprises.
            if (/\.(json|txt|md|csv)$/i.test(filename)) {
                files[filename] = files.data;
                delete files.name;
                delete files.data;
            }
        }

        return input as Record<string, Uint8Array>;
    }

    // Otherwise, build a map from entries
    const out: Record<string, Uint8Array> = {};
    for (const e of input as Iterable<ZipFileEntry>) {
        out[e.name] = e.data;
    }
    return out;
}

export function addEntry(map: Record<string, Uint8Array>, entry: ZipFileEntry): void {
    map[entry.name] = entry.data;
}

// ---------- ZIP (sync) ----------

export function makeZip(
    input: Record<string, Uint8Array> | ZipFileEntry[] | Iterable<ZipFileEntry>
): Uint8Array {
    const files = normalizeToFileMap(input);
    return zipSync(files, {level: 6});
}

// ---------- ZIP (streaming) ----------

/**
 * Generates a ZIP file stream from a stream of files.
 */
export async function* zipFilesToStream(
    files: AsyncGenerator<ZipFileEntry>,
    onProgress?: (bytes: number) => void
): AsyncGenerator<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let zipError: Error | null = null;

    const zip = new Zip((err, dat) => {
        if (err) {
            zipError = err instanceof Error ? err : new Error(String(err));
            return;
        }
        if (dat && dat.length > 0) chunks.push(dat);
    });

    for await (const file of files) {
        if (zipError) throw zipError;
        const f = new ZipPassThrough(file.name);
        zip.add(f);
        f.push(file.data, true);

        onProgress?.(file.data.length);

        while (chunks.length > 0) {
            if (zipError) throw zipError;
            yield chunks.shift()!;
        }
    }

    zip.end();
    while (chunks.length > 0) {
        if (zipError) throw zipError;
        yield chunks.shift()!;
    }
    if (zipError) throw zipError;
}

// ---------- JSON helpers ----------

export function jsonFile(name: string, data: unknown): ZipFileEntry {
    return {
        name,
        data: new TextEncoder().encode(JSON.stringify(data, null, 2)),
    };
}

// For the map-based zipSync path
export function jsonFileMap(name: string, data: unknown): Record<string, Uint8Array> {
    return {[name]: jsonFile(name, data).data};
}
