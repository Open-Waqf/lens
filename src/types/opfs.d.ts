// src/types/opfs.d.ts
export {};

declare global {
    interface StorageManager {
        /**
         * Origin Private File System (OPFS)
         * Supported in Chromium-based browsers.
         */
        getDirectory?: () => Promise<FileSystemDirectoryHandle>;
    }
}
