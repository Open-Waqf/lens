import {db} from './db';
import {opfsListFiles, opfsRemoveEntry} from './filestore/opfs-store';

export async function garbageCollectOpfsDocs(): Promise<number> {
    // 1. Get all files currently on disk
    const allFiles = await opfsListFiles('docs');
    if (allFiles.length === 0) return 0;

    // 2. Get all known files from Database
    const knownPaths = new Set<string>();

    await db.transaction('r', db.docs, db.pages, async () => {
        const pages = await db.pages.toArray();
        const docs = await db.docs.toArray();

        for (const p of pages) {
            knownPaths.add(p.imagePath);
            knownPaths.add(p.thumbPath);
        }
        for (const d of docs) {
            if (d.pdfPath) knownPaths.add(d.pdfPath);
        }
    });

    // 3. Identify Orphans (Files on disk but not in DB)
    const orphans = allFiles.filter(f => !knownPaths.has(f));
    let deletedCount = 0;

    // 4. Safely Delete Orphans
    for (const orphan of orphans) {
        const pageExists = await db.pages.where('imagePath').equals(orphan)
            .or('thumbPath').equals(orphan)
            .count();

        const docExists = await db.docs.where('pdfPath').equals(orphan).count();

        if (pageExists === 0 && docExists === 0) {
            await opfsRemoveEntry(orphan);
            console.log('GC: Deleted orphan file', orphan);
            deletedCount++;
        } else {
            console.warn('GC: Saved file from race condition', orphan);
        }
    }

    return deletedCount;
}
