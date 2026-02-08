import {PDFDocument, rgb} from 'pdf-lib';
import type {PageRecord} from '../domain/types';
import type {FileStore} from '../services/filestore/opfs-store';
import {bytesToBlob} from './bytes';

const MAX_PAGES_SAFE = 50;

export type PdfQuality = 'original' | 'email';

export interface PdfOptions {
    quality: PdfQuality;
    onProgress?: (curr: number, total: number) => void;
}

export async function buildPdfForDoc(
    store: FileStore,
    pages: PageRecord[],
    opts: PdfOptions = {quality: 'original'}
): Promise<Uint8Array> {
    if (pages.length > MAX_PAGES_SAFE) {
        throw new Error(`PDF too large (${pages.length} pages). Please split the document.`);
    }

    const pdf = await PDFDocument.create();
    const total = pages.length;

    for (let i = 0; i < total; i++) {
        const p = pages[i];
        if (opts.onProgress) opts.onProgress(i + 1, total);

        let jpgBytes: Uint8Array | null = await store.get(p.imagePath);

        try {
            // #18 PDF Quality Toggle logic
            if (opts.quality === 'email') {
                jpgBytes = await compressForEmail(jpgBytes);
            }

            const img = await pdf.embedJpg(jpgBytes);
            jpgBytes = null; // Release memory

            const page = pdf.addPage([img.width, img.height]);

            // 1. Draw the image (Visual Layer)
            page.drawImage(img, {x: 0, y: 0, width: img.width, height: img.height});

            // 2. Draw invisible text (Search Layer)
            if (p.words && p.words.length > 0) {
                const h = img.height;
                const w = img.width;

                for (const word of p.words) {
                    const [nx, ny, _nw, nh] = word.box;

                    // Denormalize to PDF units
                    const px = nx * w;
                    const py = ny * h; // Top-left Y
                    const ph = nh * h;

                    // PDF Coordinate System is Bottom-Left.
                    page.drawText(word.text, {
                        x: px,
                        y: h - (py + ph), // Flip Y
                        size: ph, // Font size ~ bounding box height
                        opacity: 0, // INVISIBLE
                        color: rgb(0, 0, 0),
                    });
                }
            }

        } catch (e) {
            console.error(`Failed to embed page ${p.id}`, e);
            throw new Error('Failed to generate PDF. One or more pages may be corrupted.');
        }
    }

    return await pdf.save();
}

// Helper: Resize to max 1200px and compress to 0.6 quality
async function compressForEmail(originalBytes: Uint8Array): Promise<Uint8Array> {
    const blob = bytesToBlob(originalBytes, 'image/jpeg');
    const bitmap = await createImageBitmap(blob);

    const maxDim = 1200;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);

    // Release bitmap memory immediately
    bitmap.close();

    const blobOut = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.6});
    return new Uint8Array(await blobOut.arrayBuffer());
}