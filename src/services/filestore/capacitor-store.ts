import {Directory, Filesystem} from '@capacitor/filesystem';
import type {FileStore} from './opfs-store';

// Helper: Uint8Array -> Base64 String
function u8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// Helper: Base64 String -> Uint8Array
function base64ToU8(base64: string): Uint8Array {
    const binStr = atob(base64);
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
}

export class CapacitorFileStore implements FileStore {
    // Directory.Data is the private app sandbox (persistent)
    private mount = Directory.Data;

    async put(path: string, bytes: Uint8Array, _mime: string): Promise<void> {
        await Filesystem.writeFile({
            path,
            data: u8ToBase64(bytes),
            directory: this.mount,
            recursive: true // Automatically create parent folders
        });
    }

    async get(path: string): Promise<Uint8Array> {
        const res = await Filesystem.readFile({
            path,
            directory: this.mount
        });
        // Capacitor returns data as a Base64 string for binary files
        return base64ToU8(res.data as string);
    }

    async del(path: string): Promise<void> {
        try {
            await Filesystem.deleteFile({
                path,
                directory: this.mount
            });
        } catch (e) {
            // Ignore "File not found" errors
        }
    }

    async exists(path: string): Promise<boolean> {
        try {
            await Filesystem.stat({
                path,
                directory: this.mount
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    // Native specific helper to clear a whole folder (used for restore/reset)
    async clearFolder(path: string): Promise<void> {
        try {
            await Filesystem.rmdir({
                path,
                directory: this.mount,
                recursive: true
            });
        } catch (e) {
            // Ignore if folder doesn't exist
        }
    }
}