import {PDFDocument, rgb} from 'pdf-lib';
import type {PageRecord} from '../domain/types';
import type {FileStore} from '../services/filestore/opfs-store';

const MAX_PAGES_SAFE = 50;

export async function buildPdfForDoc(
    store: FileStore,
    pages: PageRecord[]
): Promise<Uint8Array> {
    if (pages.length > MAX_PAGES_SAFE) {
        throw new Error(`PDF too large (${pages.length} pages). Please split the document.`);
    }

    const pdf = await PDFDocument.create();

    for (const p of pages) {
        let jpgBytes: Uint8Array | null = await store.get(p.imagePath);

        try {
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
                    // const pw = nw * w; // Unused
                    const ph = nh * h;

                    // PDF Coordinate System is Bottom-Left.
                    // Tesseract is Top-Left.
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