import {describe, expect, it} from 'vitest';
import {jsonFile, zipFilesToStream} from '../../src/lib/zip';
import {InvalidBackupError, restoreFromZipStream} from '../../src/services/restore-stream';

async function* entries(list: Array<{name: string; data: Uint8Array}>) {
    for (const e of list) yield e;
}

async function zipBytes(list: Array<{name: string; data: Uint8Array}>): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    for await (const c of zipFilesToStream(entries(list))) parts.push(c);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

/** Feed the zip in small pieces, so entries straddle chunk boundaries like a real stream. */
async function* pieces(bytes: Uint8Array, size: number) {
    for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}

const META = {docs: [{id: 'd1', title: 'Doc', pageIds: ['p1']}], pages: [{id: 'p1', docId: 'd1'}]};
const PAGE = new Uint8Array(5000).map((_, i) => (i * 7) % 251);
const THUMB = new Uint8Array([1, 2, 3, 4]);

describe('restoreFromZipStream', () => {
    it('unpacks a backup made by the app, file by file, after asking once for the mode', async () => {
        const zip = await zipBytes([
            jsonFile('metadata.json', META),
            {name: 'docs/d1/pages/p1.jpg', data: PAGE},
            {name: 'docs/d1/thumbs/p1.jpg', data: THUMB},
        ]);
        const calls: string[] = [];
        const files: Record<string, Uint8Array> = {};
        const result = await restoreFromZipStream(pieces(zip, 777), {
            onMetadata: async (m) => { calls.push('meta:' + m.docs.length); return 'merge'; },
            onFile: async (path, bytes) => { calls.push('file:' + path); files[path] = bytes; },
        });
        expect(result).toEqual({mode: 'merge', files: 2});
        expect(calls).toEqual(['meta:1', 'file:docs/d1/pages/p1.jpg', 'file:docs/d1/thumbs/p1.jpg']);
        expect(files['docs/d1/pages/p1.jpg']).toEqual(PAGE);
        expect(files['docs/d1/thumbs/p1.jpg']).toEqual(THUMB);
    });

    it('writes nothing when the user cancels at the mode question', async () => {
        const zip = await zipBytes([jsonFile('metadata.json', META), {name: 'docs/d1/pages/p1.jpg', data: PAGE}]);
        let written = 0;
        const result = await restoreFromZipStream(pieces(zip, 100), {
            onMetadata: async () => null,
            onFile: async () => { written++; },
        });
        expect(result).toEqual({mode: null, files: 0});
        expect(written).toBe(0);
    });

    it('still works when metadata.json is not the first entry', async () => {
        const zip = await zipBytes([{name: 'docs/d1/pages/p1.jpg', data: PAGE}, jsonFile('metadata.json', META)]);
        const order: string[] = [];
        await restoreFromZipStream(pieces(zip, 64), {
            onMetadata: async () => { order.push('meta'); return 'replace'; },
            onFile: async (p) => { order.push(p); },
        });
        expect(order).toEqual(['meta', 'docs/d1/pages/p1.jpg']);
    });

    it('refuses a backup with no or broken metadata before writing anything', async () => {
        let written = 0;
        const noMeta = await zipBytes([{name: 'docs/d1/pages/p1.jpg', data: PAGE}]);
        await expect(restoreFromZipStream(pieces(noMeta, 50), {onMetadata: async () => 'merge', onFile: async () => { written++; }}))
            .rejects.toBeInstanceOf(InvalidBackupError);
        const badMeta = await zipBytes([{name: 'metadata.json', data: new TextEncoder().encode('{"docs": 1}')}, {name: 'docs/x.jpg', data: PAGE}]);
        await expect(restoreFromZipStream(pieces(badMeta, 50), {onMetadata: async () => 'merge', onFile: async () => { written++; }}))
            .rejects.toBeInstanceOf(InvalidBackupError);
        expect(written).toBe(0);
    });

    it('accepts a ReadableStream too (what Blob.stream() gives)', async () => {
        const zip = await zipBytes([jsonFile('metadata.json', META), {name: 'docs/d1/thumbs/p1.jpg', data: THUMB}]);
        // jsdom's Blob has no stream(); build the same kind of stream by hand.
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (let i = 0; i < zip.length; i += 333) controller.enqueue(zip.slice(i, i + 333));
                controller.close();
            },
        });
        const seen: string[] = [];
        const result = await restoreFromZipStream(stream, {onMetadata: async () => 'merge', onFile: async (p) => { seen.push(p); }});
        expect(result.files).toBe(1);
        expect(seen).toEqual(['docs/d1/thumbs/p1.jpg']);
    });
});
