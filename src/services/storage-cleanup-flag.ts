const STORAGE_CLEANUP_PENDING_KEY = 'sahifah.storageCleanup.pending';

export function markStorageCleanupPending(): void {
    localStorage.setItem(STORAGE_CLEANUP_PENDING_KEY, '1');
}

export function clearStorageCleanupPending(): void {
    localStorage.removeItem(STORAGE_CLEANUP_PENDING_KEY);
}

export function hasStorageCleanupPending(): boolean {
    return localStorage.getItem(STORAGE_CLEANUP_PENDING_KEY) === '1';
}

