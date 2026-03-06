import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {db} from './db';
import {secureOverwriteAndRemoveOpfsTree} from './filestore/opfs-store';
import {bytesToBase64} from '../lib/bytes';

const MAX_NATIVE_OVERWRITE_BYTES = 8 * 1024 * 1024; // best-effort cap per file

/**
 * MANDATE FR-VAULT-004: Nuclear Reset kill-switch.
 * Best-effort "factory reset" for Sahifah Lens:
 * - overwrites OPFS file contents with zeros (on web)
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
        // Fallback: clear tables if delete fails
        try {
            await db.transaction('rw', db.docs, db.pages, async () => {
                await db.pages.clear();
                await db.docs.clear();
            });
        } catch {
        }
    }

    // 2) OPFS (MANDATED SECURE WIPE)
    if (Capacitor.isNativePlatform()) {
        await nativeSecureEraseAndRemoveTree('docs');
        await nativeSecureEraseAndRemoveTree('exports');
    } else {
        // WEB: Wipes OPFS with zero-overwrite
        try {
            await secureOverwriteAndRemoveOpfsTree('docs');
        } catch {
        }
        try {
            await secureOverwriteAndRemoveOpfsTree('exports');
        } catch {
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

async function nativeSecureEraseAndRemoveTree(rootPath: string): Promise<void> {
    const files = await listNativeFilesRecursive(rootPath);
    let wiped = 0;
    let deleted = 0;
    for (const path of files) {
        try {
            const didWipe = await bestEffortOverwriteNativeFile(path);
            if (didWipe) wiped++;
        } catch {
        }
        try {
            await Filesystem.deleteFile({
                path,
                directory: Directory.Data
            });
            deleted++;
        } catch {
        }
    }

    try {
        await Filesystem.rmdir({
            path: rootPath,
            directory: Directory.Data,
            recursive: true
        });
    } catch {
    }
    console.info(`[reset-storage] native erase ${rootPath}: wiped=${wiped}, deleted=${deleted}`);
}

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
            try {
                await Filesystem.readdir({path: child, directory: Directory.Data});
                await walk(child);
            } catch {
                out.push(child);
            }
        }
    };

    await walk(rootPath);
    return out;
}

async function bestEffortOverwriteNativeFile(path: string): Promise<boolean> {
    try {
        const stat = await Filesystem.stat({
            path,
            directory: Directory.Data
        });
        const size = Number((stat as any)?.size ?? 0);
        if (!Number.isFinite(size) || size <= 0) return false;
        const wipeLen = Math.max(1, Math.min(size, MAX_NATIVE_OVERWRITE_BYTES));
        const zeros = new Uint8Array(wipeLen);
        const data = await bytesToBase64(zeros);
        await Filesystem.writeFile({
            path,
            data,
            directory: Directory.Data,
            recursive: true
        });
        return true;
    } catch {
        return false;
    }
}
