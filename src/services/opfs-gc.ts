import {db} from './db';
import {getPlatformCaps} from './platform';
import {opfsListFiles, opfsRemoveEntry} from './filestore/opfs-store';

/**
 * Best-effort garbage collector:
 * deletes OPFS files under docs/ that are not referenced by IndexedDB.
 *
 * This mitigates "ghost files" when OPFS writes succeed but the DB transaction fails.
 */
export async function garbageCollectOpfsDocs(): Promise<{deleted: number}> {
    const caps = getPlatformCaps();
    if (!caps.hasOPFS) return {deleted: 0};

    const referenced = new Set<string>();

    const [pages, docs] = await Promise.all([db.pages.toArray(), db.docs.toArray()]);

    for (const p of pages) {
        if (p.imagePath?.startsWith('docs/')) referenced.add(p.imagePath);
        if (p.thumbPath?.startsWith('docs/')) referenced.add(p.thumbPath);
    }
    for (const d of docs) {
        if (d.pdfPath && d.pdfPath.startsWith('docs/')) referenced.add(d.pdfPath);
    }

    const files = await opfsListFiles('docs');
    let deleted = 0;

    // delete unreferenced files
    for (const path of files) {
        if (!referenced.has(path)) {
            try {
                await opfsRemoveEntry(path);
                deleted++;
            } catch {
                // ignore; GC is best-effort
            }
        }
    }

    return {deleted};
}
