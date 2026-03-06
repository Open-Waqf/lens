import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {db} from './db';
import {opfsListFiles, opfsRemoveEntry} from './filestore/opfs-store';

async function listNativeFilesRecursive(rootPath: string): Promise<string[]> {
    const out: string[] = [];
    const seen = new Set<string>();

    const walk = async (path: string): Promise<void> => {
        if (seen.has(path)) return;
        seen.add(path);

        let listing: Awaited<ReturnType<typeof Filesystem.readdir>> | null = null;
        try {
            listing = await Filesystem.readdir({
                path,
                directory: Directory.Data
            });
        } catch {
            listing = null;
        }
        if (!listing) return;

        for (const entry of listing.files) {
            const child = path ? `${path}/${entry.name}` : entry.name;

            if (entry.type === 'directory') {
                await walk(child);
                continue;
            }
            if (entry.type === 'file') {
                out.push(child);
                continue;
            }

            // Some Android builds omit entry.type; probe as directory first.
            try {
                await Filesystem.readdir({
                    path: child,
                    directory: Directory.Data
                });
                await walk(child);
            } catch {
                out.push(child);
            }
        }
    };

    await walk(rootPath);
    return out;
}

async function listStoredDocFiles(): Promise<string[]> {
    if (Capacitor.isNativePlatform()) {
        return await listNativeFilesRecursive('docs');
    }
    return await opfsListFiles('docs');
}

async function getKnownPaths(): Promise<Set<string>> {
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
    return knownPaths;
}

export async function findOrphanStorageFiles(): Promise<string[]> {
    const files = await listStoredDocFiles();
    if (files.length === 0) return [];

    const knownPaths = await getKnownPaths();
    return files.filter(path => path.startsWith('docs/') && !knownPaths.has(path));
}

async function removeStorageFile(path: string): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
        try {
            await Filesystem.deleteFile({
                path,
                directory: Directory.Data
            });
            return true;
        } catch {
            // Best effort delete.
            return false;
        }
    }

    try {
        await opfsRemoveEntry(path);
        return true;
    } catch {
        return false;
    }
}

export async function deleteOrphanStorageFiles(orphanPaths: string[]): Promise<number> {
    let deleted = 0;
    for (const path of orphanPaths) {
        if (await removeStorageFile(path)) deleted++;
    }
    return deleted;
}
