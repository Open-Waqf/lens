import {db} from './db';
import {opfsRemoveTree} from './filestore/opfs-store';

/**
 * Best-effort "factory reset" for Sahifah Lens:
 * - deletes IndexedDB database
 * - deletes OPFS folders (docs/, exports/)
 * - clears Sahifah-related localStorage keys
 * - clears Cache Storage (best-effort)
 */
export async function resetAllStorage(): Promise<void> {
    // 1) IndexedDB
    try {
        await db.delete();
    } catch {
        // fallback to clearing tables if delete fails
        try {
            await db.transaction('rw', db.docs, db.pages, async () => {
                await db.pages.clear();
                await db.docs.clear();
            });
        } catch {
            // ignore
        }
    }

    // 2) OPFS (best effort)
    try {
        await opfsRemoveTree('docs');
    } catch {
    }
    try {
        await opfsRemoveTree('exports');
    } catch {
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
