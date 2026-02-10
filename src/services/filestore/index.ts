import {getPlatformCaps} from '../platform';
import {type FileStore, OPFSFileStore, opfsRemoveTree} from './opfs-store';
import {CapacitorFileStore} from './capacitor-store';

let store: FileStore | null = null;

export function getFileStore(): FileStore {
    if (store) return store;

    const caps = getPlatformCaps();

    // 1. Native Mobile (Priority)
    if (caps.isCapacitor) {
        store = new CapacitorFileStore();
        return store;
    }

    // 2. Web with OPFS (Fallback)
    if (caps.hasOPFS) {
        store = new OPFSFileStore();
        return store;
    }

    throw new Error('Storage not available. Requires Capacitor or OPFS browser.');
}

/**
 * Platform-agnostic helper to recursively delete a folder.
 * Used by SettingsPage for "Erase Everything" or "Restore Backup".
 */
export async function removeFileTree(path: string): Promise<void> {
    const caps = getPlatformCaps();

    if (caps.isCapacitor) {
        // We create a temporary instance to access the helper
        // (In a real app, you might cast the singleton 'store')
        const native = new CapacitorFileStore();
        await native.clearFolder(path);
    } else {
        await opfsRemoveTree(path);
    }
}