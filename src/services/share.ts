import {Capacitor} from '@capacitor/core';
import {Share} from '@capacitor/share';
import {Directory, Filesystem} from '@capacitor/filesystem';

/**
 * Robust Sharing Service
 * Handles both Web (navigator.share) and Native (@capacitor/share)
 */
export async function shareFile(file: File, filename: string): Promise<void> {
    const isNative = Capacitor.isNativePlatform();

    if (isNative) {
        try {
            // 1. Convert File to Base64 (Filesystem.writeFile requirement)
            const base64Data = await fileToBase64(file);

            // 2. Write to temporary Cache directory
            const tempPath = `share_tmp_${filename}`;
            const result = await Filesystem.writeFile({
                path: tempPath,
                data: base64Data,
                directory: Directory.Cache
            });

            // 3. Trigger Native Share Sheet using the internal URI
            await Share.share({
                title: filename,
                url: result.uri,
                dialogTitle: 'Share Backup'
            });

            // 4. Cleanup: Delete the temp file from cache
            await Filesystem.deleteFile({
                path: tempPath,
                directory: Directory.Cache
            });

        } catch (e) {
            console.error('Native sharing failed', e);
            // If native fails, try a silent fallback to web behavior just in case
            downloadFileFallback(file, filename);
        }
    } else {
        // WEB PATH (Browser)
        if (navigator.share && navigator.canShare && navigator.canShare({files: [file]})) {
            try {
                await navigator.share({
                    files: [file],
                    title: filename,
                });
            } catch (e) {
                if ((e as Error).name !== 'AbortError') {
                    downloadFileFallback(file, filename);
                }
            }
        } else {
            downloadFileFallback(file, filename);
        }
    }
}

/**
 * Helper to convert File/Blob to Base64 string
 */
function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = reader.result as string;
            resolve(res.split(',')[1]); // Remove the 'data:...;base64,' prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Standard anchor-tag download fallback for desktop browsers
 */
function downloadFileFallback(file: File, filename: string) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}