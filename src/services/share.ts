import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import {Share} from "@capacitor/share";

export async function shareFile(file: File, filename: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        try {
            const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
            const tempPath = `share_${Date.now()}_${cleanName}`;

            // 1. Chunked Write (RAM Friendly)
            // We use Directory.ExternalStorage on Android to hit the "Downloads" or "Documents" folder
            const CHUNK_SIZE = 1024 * 512;
            let offset = 0;
            let firstChunk = true;

            while (offset < file.size) {
                const chunk = file.slice(offset, offset + CHUNK_SIZE);
                const base64Data = await blobToBase64(chunk);

                if (firstChunk) {
                    await Filesystem.writeFile({
                        path: tempPath,
                        data: base64Data,
                        directory: Directory.Cache
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

            await new Promise(r => setTimeout(r, 250));

            // 5. Share with explicit file array
            await Share.share({
                title: filename,
                url: result.uri,
                files: [result.uri], // Essential for Android
                dialogTitle: 'Save Backup'
            });

        } catch (e) {
            console.error('Native sharing failed', e);
            downloadFileFallback(file, filename);
        }
    } else {
        // Web Fallback
        if (navigator.share && navigator.canShare && navigator.canShare({files: [file]})) {
            try {
                await navigator.share({files: [file], title: filename});
            } catch (e) {
                if ((e as Error).name !== 'AbortError') downloadFileFallback(file, filename);
            }
        } else {
            downloadFileFallback(file, filename);
        }
    }
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
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}