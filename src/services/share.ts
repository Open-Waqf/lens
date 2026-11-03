import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {Share} from "@capacitor/share";
import {showToast} from "../components/toast-notification";
import {t} from '../lib/i18n';
import {safeFileName} from '../lib/file-name';
import {bytesToBase64} from '../lib/bytes';

// Temporary copies for the share sheet live here, in the app's cache (never in shared
// storage). Each share gets its own folder, so the file keeps its real name: the person
// receiving it sees "Invoice.pdf", not "share_1793703235098_Invoice.pdf".
const SHARE_DIR = 'share';

// 1. Write a file to a temporary share folder (Native only)
async function writeTempFile(file: File, folder: string): Promise<string> {
    const tempPath = `${folder}/${safeFileName(file.name)}`;

    // Chunked Write to prevent Out-Of-Memory on large files
    const CHUNK_SIZE = 1024 * 512; // 512KB chunks
    let offset = 0;
    let firstChunk = true;

    while (offset < file.size || firstChunk) {
        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const base64Data = await blobToBase64(chunk);

        if (firstChunk) {
            await Filesystem.writeFile({
                path: tempPath,
                data: base64Data,
                directory: Directory.Cache,
                recursive: true
            });
            firstChunk = false;
        } else {
            await Filesystem.appendFile({
                path: tempPath,
                data: base64Data,
                directory: Directory.Cache
            });
        }
        offset += CHUNK_SIZE;
    }

    const result = await Filesystem.getUri({
        path: tempPath,
        directory: Directory.Cache
    });
    return result.uri;
}

/**
 * Write a file into a fresh temporary share folder in the cache (Android) and return its
 * path there, for handing to another app directly (Sign with Signer). sweepTempFiles()
 * removes it at the next start.
 */
export async function writeShareTemp(file: File): Promise<string> {
    const folder = `${SHARE_DIR}/${Date.now()}`;
    await writeTempFile(file, folder);
    return `${folder}/${safeFileName(file.name)}`;
}

/**
 * Delete temporary files left by earlier shares, backups and restores.
 *
 * Normally each one is deleted when it is done. But on Android the app can be closed while
 * the share sheet is open, and then that cleanup never runs (seen on a phone, Nov 2026:
 * a 5.6 MB backup copy stayed in the cache). Run at start, when nothing is in progress.
 * Only these temporary places are touched, never documents (docs/).
 */
export async function sweepTempFiles(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    const quiet = async (fn: () => Promise<unknown>) => {
        try {
            await fn();
        } catch {
            // Missing folder: nothing to clean.
        }
    };
    await quiet(() => Filesystem.rmdir({path: SHARE_DIR, directory: Directory.Cache, recursive: true}));
    // Files from versions before Nov 2026 sat directly in the cache as share_<time>_<name>.
    await quiet(async () => {
        const {files} = await Filesystem.readdir({path: '', directory: Directory.Cache});
        for (const f of files) {
            if (f.type !== 'directory' && f.name.startsWith('share_')) {
                await quiet(() => Filesystem.deleteFile({path: f.name, directory: Directory.Cache}));
            }
        }
    });
    // Backup export and restore work files (settings page): exports/ and imports/.
    await quiet(() => Filesystem.rmdir({path: 'exports', directory: Directory.Data, recursive: true}));
    await quiet(() => Filesystem.rmdir({path: 'imports', directory: Directory.Data, recursive: true}));
}

// 2. Main function for Batch Sharing (Multiple Files)
export async function shareFiles(files: File[], title: string = t('common.share_now')): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        const folder = `${SHARE_DIR}/${Date.now()}`;
        try {
            const uris: string[] = [];
            // Write all files to temp storage first
            for (const f of files) {
                uris.push(await writeTempFile(f, folder));
            }

            // Share all URIs at once
            await Share.share({
                title: title,
                files: uris,
                dialogTitle: title
            });

        } catch (e) {
            console.error('Native sharing failed', e);
            if (files.length === 1) downloadFileFallback(files[0], files[0].name);
            else showToast(t('doc.share_failed_zip'), 'error');
        } finally {
            // Delete the unencrypted temporary copies at once. If the app is closed before
            // this runs, sweepTempFiles() removes them at the next start.
            try {
                await Filesystem.rmdir({path: folder, directory: Directory.Cache, recursive: true});
            } catch (err) {
                console.warn('Failed to delete temp share folder', folder, err);
            }
        }
    } else {
        // Web Fallback
        if (navigator.share && navigator.canShare && navigator.canShare({files})) {
            try {
                await navigator.share({files, title});
            } catch (e) {
                // Ignore AbortError (user cancelled)
                if ((e as Error).name !== 'AbortError') {
                    if (files.length === 1) downloadFileFallback(files[0], files[0].name);
                }
            }
        } else {
            if (files.length === 1) downloadFileFallback(files[0], files[0].name);
            else showToast(t('doc.browser_share_zip'), 'info');
        }
    }
}

/**
 * Share a file that is produced as a stream (the encrypted backup). On Android the chunks
 * go straight into the temporary share folder and the file is shared by its path, so the
 * backup is never held in memory. On the web the chunks become a File for the browser.
 */
export async function shareStream(chunks: AsyncIterable<Uint8Array>, filename: string, mime = 'application/octet-stream'): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
        const parts: Uint8Array[] = [];
        for await (const c of chunks) parts.push(c);
        await shareFiles([new File(parts as BlobPart[], filename, {type: mime})], filename);
        return;
    }
    const folder = `${SHARE_DIR}/${Date.now()}`;
    const path = `${folder}/${safeFileName(filename)}`;
    try {
        let first = true;
        for await (const chunk of chunks) {
            const data = await bytesToBase64(chunk);
            if (first) {
                await Filesystem.writeFile({path, data, directory: Directory.Cache, recursive: true});
                first = false;
            } else {
                await Filesystem.appendFile({path, data, directory: Directory.Cache});
            }
        }
        if (first) await Filesystem.writeFile({path, data: '', directory: Directory.Cache, recursive: true});
        const {uri} = await Filesystem.getUri({path, directory: Directory.Cache});
        await Share.share({title: filename, files: [uri], dialogTitle: filename});
    } finally {
        try {
            await Filesystem.rmdir({path: folder, directory: Directory.Cache, recursive: true});
        } catch (err) {
            console.warn('Failed to delete temp share folder', folder, err);
        }
    }
}

// 3. Backward compatibility for Single File
export async function shareFile(file: File, filename: string): Promise<void> {
    // Ensure the file object has the correct name property
    const namedFile = new File([file], filename, {type: file.type});
    await shareFiles([namedFile], filename);
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const res = reader.result as string;
            const comma = res.indexOf(',');
            resolve(comma > -1 ? res.substring(comma + 1) : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function downloadFileFallback(file: File, filename: string) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Firefox (especially mobile/emulated) may resolve blob downloads asynchronously.
    // Immediate revoke can produce a blob: error page instead of a file save dialog.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
