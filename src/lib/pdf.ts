import {PDFDocument} from 'pdf-lib';
import type {PageRecord} from '../domain/types';
import type {FileStore} from '../services/filestore/opfs-store';

const MAX_PAGES_SAFE = 50;

export async function buildPdfForDoc(
    store: FileStore,
    pages: PageRecord[]
): Promise<Uint8Array> {
    if (pages.length > MAX_PAGES_SAFE) {
        throw new Error(`PDF too large (${pages.length} pages). Please split the document or export efficiently.`);
    }

    const pdf = await PDFDocument.create();

    for (const p of pages) {
        // Load bytes only when needed
        let jpgBytes: Uint8Array | null = await store.get(p.imagePath);

        try {
            const img = await pdf.embedJpg(jpgBytes);

            // Explicitly release source buffer before adding page
            jpgBytes = null;

            // Default to A4 or fit to image?
            // Lens usually fits page to image size to preserve resolution.
            const page = pdf.addPage([img.width, img.height]);
            page.drawImage(img, {x: 0, y: 0, width: img.width, height: img.height});
        } catch (e) {
            console.error(`Failed to embed page ${p.id}`, e);
            // Continue best-effort? No, failed PDF is useless.
            throw new Error('Failed to generate PDF. One or more pages may be corrupted.');
        }
    }

    const pdfBytes = await pdf.save();
    return pdfBytes;
}