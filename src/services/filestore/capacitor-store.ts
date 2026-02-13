import {Directory, Filesystem} from '@capacitor/filesystem';
import type {FileStore} from './opfs-store'; // Ensure this path is correct
import {base64ToBytes, bytesToBase64} from '../../lib/bytes';

export class CapacitorFileStore implements FileStore {

    async put(path: string, bytes: Uint8Array, _mime: string): Promise<void> {
        // 1. Convert to Base64 (Fast, Non-blocking)
        const data = await bytesToBase64(bytes);

        // 2. Write file
        await Filesystem.writeFile({
            path,
            data,
            directory: Directory.Data,
            recursive: true // Automatically creates parent folders
        });
    }

    async get(path: string): Promise<Uint8Array> {
        const file = await Filesystem.readFile({
            path,
            directory: Directory.Data
        });

        // Capacitor returns 'data' as a Base64 string for binary files
        if (typeof file.data === 'string') {
            return await base64ToBytes(file.data);
        } else {
            throw new Error('Unexpected data format from Capacitor');
        }
    }

    async del(path: string): Promise<void> {
        try {
            await Filesystem.deleteFile({
                path,
                directory: Directory.Data
            });
        } catch {
            // Ignore if missing
        }
    }

    async exists(path: string): Promise<boolean> {
        try {
            // REGRESSION FIX: Use 'stat' instead of 'getUri'.
            // 'stat' is the only guaranteed way to check actual disk existence.
            await Filesystem.stat({
                path,
                directory: Directory.Data
            });
            return true;
        } catch {
            return false;
        }
    }

    async clearFolder(path: string): Promise<void> {
        try {
            // 1. Wipe
            await Filesystem.rmdir({
                path,
                directory: Directory.Data,
                recursive: true
            });
        } catch {
            // Ignore error if folder didn't exist
        }

        // 2. Recreate (Safety improvement)
        try {
            await Filesystem.mkdir({
                path,
                directory: Directory.Data,
                recursive: true
            });
        } catch (e) {
            console.error('Failed to recreate folder', path, e);
        }
    }

    async getUsageEstimate(): Promise<number> {
        let total = 0;
        try {
            // 1. Measure 'pages' folder (Images)
            const pages = await Filesystem.readdir({
                path: 'pages',
                directory: Directory.Data
            });
            for (const file of pages.files) {
                total += file.size;
            }

            // 2. Measure 'docs' folder (PDF exports etc)
            // We use a try-catch because 'docs' might not exist yet
            try {
                const docs = await Filesystem.readdir({
                    path: 'docs',
                    directory: Directory.Data
                });
                for (const file of docs.files) {
                    total += file.size;
                }
            } catch {
            }

        } catch (e) {
            console.warn('Failed to calculate storage size', e);
        }
        return total;
    }
}