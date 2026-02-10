import {db} from './db';
import {getFileStore} from './filestore';
// 1. Add this import
import {toArrayBuffer} from '../lib/bytes';

export async function repairLibrary(
    onProgress: (current: number, total: number, msg: string) => void
): Promise<void> {
    const store = getFileStore();
    const pages = await db.pages.toArray();
    let fixedCount = 0;

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        onProgress(i + 1, pages.length, `Checking page ${i + 1}/${pages.length}`);

        const thumbExists = await store.exists(page.thumbPath);

        if (!thumbExists) {
            console.warn(`Missing thumbnail for page ${page.id}. Regenerating...`);
            try {
                const originalBytes = await store.get(page.imagePath);
                const thumbBytes = await generateThumbnail(originalBytes);
                await store.put(page.thumbPath, thumbBytes, 'image/jpeg');
                fixedCount++;
            } catch (e) {
                console.error(`Failed to repair page ${page.id}`, e);
            }
        }
    }

    onProgress(pages.length, pages.length, `Repair complete. Fixed ${fixedCount} thumbnails.`);
}

async function generateThumbnail(originalBytes: Uint8Array): Promise<Uint8Array> {
    // 2. Fix: Use toArrayBuffer() to satisfy TypeScript
    const blob = new Blob([toArrayBuffer(originalBytes)]);
    const bmp = await createImageBitmap(blob);

    const MAX_WIDTH = 300;
    const scale = Math.min(1, MAX_WIDTH / bmp.width);
    const width = Math.round(bmp.width * scale);
    const height = Math.round(bmp.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context failed');

    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();

    return new Promise<Uint8Array>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    if (reader.result) resolve(new Uint8Array(reader.result as ArrayBuffer));
                    else reject(new Error('Blob read failed'));
                };
                reader.readAsArrayBuffer(blob);
            } else {
                reject(new Error('Thumbnail generation failed'));
            }
        }, 'image/jpeg', 0.8);
    });
}