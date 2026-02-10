import {Zip, ZipPassThrough, zipSync} from 'fflate';

export type ZipFileEntry = {
    name: string;
    data: Uint8Array;
};

export function makeZip(files: Record<string, Uint8Array>): Uint8Array {
    return zipSync(files, {level: 6});
}

/**
 * Generators a ZIP file stream from a stream of files.
 */
export async function* zipFilesToStream(
    files: AsyncGenerator<ZipFileEntry>,
    onProgress?: (bytes: number) => void
): AsyncGenerator<Uint8Array> {
    const chunks: Uint8Array[] = [];

    // Removed unused 'final' argument
    const zip = new Zip((err, dat) => {
        if (err) throw err;
        if (dat && dat.length > 0) {
            chunks.push(dat);
        }
    });

    for await (const file of files) {
        const f = new ZipPassThrough(file.name);
        zip.add(f);
        f.push(file.data, true);

        onProgress?.(file.data.length);

        while (chunks.length > 0) {
            yield chunks.shift()!;
        }
    }

    zip.end();
    while (chunks.length > 0) {
        yield chunks.shift()!;
    }
}

export function jsonFile(name: string, data: unknown): ZipFileEntry {
    return {
        name,
        data: new TextEncoder().encode(JSON.stringify(data, null, 2))
    };
}