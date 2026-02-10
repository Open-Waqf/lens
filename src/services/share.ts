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
        // NATIVE PATH (iOS/Android)
        try {
            // 1. Convert File to Base64 (required by Filesystem)
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
                reader.onload = () => {
                    const res = reader.result as string;
                    resolve(res.split(',')[1]); // Strip prefix
                };
                reader.readAsDataURL(file);
            });
            const base64Data = await base64Promise;

            // 2. Write to temporary Cache directory
            // We use Cache so the OS can clean it up later automatically
            const tempPath = `share_tmp_${filename}`;
            const result = await Filesystem.writeFile({
                path: tempPath,
                data: base64Data,
                directory: Directory.Cache
            });

            // 3. Trigger Native Share Sheet
            await Share.share({
                title: filename,
                url: result.uri, // This is the 'file://' path native apps need
                dialogTitle: 'Share Backup'
            });

            // 4. Optional: Clean up immediately (Native share copies the file anyway)
            await Filesystem.deleteFile({
                path: tempPath,
                directory: Directory.Cache
            });

        } catch (e) {
            console.error('Native sharing failed', e);
            throw new Error('Could not open system share sheet.');
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
                    // Fallback to old-school download if share fails
                    downloadFileFallback(file, filename);
                }
            }
        } else {
            // No Web Share support (e.g., Desktop Chrome/Firefox)
            downloadFileFallback(file, filename);
        }
    }
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