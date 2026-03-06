import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {Share} from "@capacitor/share";
import {showToast} from "../components/toast-notification";
import {t} from '../lib/i18n';

// 1. Support function to write a file to temp storage (Native only)
async function writeTempFile(file: File): Promise<{ uri: string, path: string }> {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempPath = `share_${Date.now()}_${cleanName}`;

    // Chunked Write to prevent Out-Of-Memory on large files
    const CHUNK_SIZE = 1024 * 512; // 512KB chunks
    let offset = 0;
    let firstChunk = true;

    while (offset < file.size) {
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

    return {uri: result.uri, path: tempPath};
}

// 2. Main function for Batch Sharing (Multiple Files)
export async function shareFiles(files: File[], title: string = t('common.share_now')): Promise<void> {
    const tempPaths: string[] = [];
    if (Capacitor.isNativePlatform()) {
        try {
            const uris: string[] = [];
            // Write all files to temp storage first
            for (const f of files) {
                const {uri, path} = await writeTempFile(f);
                uris.push(uri);
                tempPaths.push(path);
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
            // CRITICAL: Securely delete unencrypted temp files immediately
            for (const path of tempPaths) {
                try {
                    await Filesystem.deleteFile({
                        path,
                        directory: Directory.Cache
                    });
                } catch (err) {
                    console.warn('Failed to delete temp share file', path, err);
                }
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
