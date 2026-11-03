import {Zip, ZipPassThrough} from 'fflate';

export type ZipFileEntry = {
    name: string;
    data: Uint8Array;
};


// ---------- ZIP (streaming, for backups) ----------

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
