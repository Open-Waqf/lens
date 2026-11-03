import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {db} from './db';
import {opfsRemoveTree} from './filestore/opfs-store';

/**
 * Erase everything: the "Erase Everything" button in Settings and the reset on the error screen.
 * - deletes the IndexedDB database (document list, pages, OCR text)
 * - deletes the stored files: docs/ (page images), exports/ and imports/ (backup work files)
 * - clears Lens's localStorage and sessionStorage keys, and Cache Storage (web)
 *
 * Files are deleted, not overwritten with zeros first. Overwriting does not reliably erase
 * anything on phone flash storage (the storage moves writes elsewhere), so earlier versions
 * claimed more than they did. Android's own file-based encryption protects deleted data.
 */
export async function resetAllStorage(): Promise<void> {
    // 1) IndexedDB
    try {
        await db.delete();
    } catch {
        // Fallback: clear tables if delete fails
        try {
            await db.transaction('rw', db.docs, db.pages, async () => {
                await db.pages.clear();
                await db.docs.clear();
            });
        } catch {
        }
    }

    // 2) Stored files
    for (const folder of ['docs', 'exports', 'imports']) {
        try {
            if (Capacitor.isNativePlatform()) {
                await Filesystem.rmdir({path: folder, directory: Directory.Data, recursive: true});
            } else {
                await opfsRemoveTree(folder);
            }
        } catch {
            // Folder does not exist: nothing to delete.
        }
    }

    // 3) local/session storage (best effort)
    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('sahifah.')) keys.push(k);
        }
        for (const k of keys) localStorage.removeItem(k);
    } catch {
    }

    try {
        const keys: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith('sahifah.')) keys.push(k);
        }
        for (const k of keys) sessionStorage.removeItem(k);
    } catch {
    }

    // 4) Cache Storage (best effort)
    try {
        if ('caches' in window) {
            const names = await caches.keys();
            await Promise.all(names.map((n) => caches.delete(n)));
        }
    } catch {
    }
}
