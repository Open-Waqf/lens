import {toArrayBuffer} from '../lib/bytes';

/**
 * Shares or downloads a file efficiently.
 * Accepts a File object (from OPFS) to avoid loading everything into RAM.
 */
export async function shareFile(file: File, filename: string): Promise<void> {
    // 1. Try Native Share (Mobile/PWA)
    try {
        if (navigator.canShare && navigator.canShare({files: [file]})) {
            await navigator.share({
                files: [file],
                title: 'Sahifah Backup',
                text: 'Backup of my Sahifah library'
            });
            return;
        }
    } catch (e) {
        console.warn('Share failed, falling back to download', e);
    }

    // 2. Fallback: Browser Download
    // URL.createObjectURL is efficient; it points to the disk-backed Blob/File
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    // Revoke after a short delay to allow the download to start
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Backward compatibility wrapper.
 * Converts bytes to a File object safely using toArrayBuffer.
 */
export async function shareOrDownload(bytes: Uint8Array, filename: string, mime: string): Promise<void> {
    // FIX: Use toArrayBuffer to convert Uint8Array to a standard BufferSource
    const file = new File([toArrayBuffer(bytes)], filename, {type: mime});
    await shareFile(file, filename);
}