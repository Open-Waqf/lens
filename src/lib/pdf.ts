import {PDFDocument} from 'pdf-lib';
import type {PageRecord} from '../domain/types';
import type {FileStore} from '../services/filestore/opfs-store';

export async function buildPdfForDoc(
    store: FileStore,
    pages: PageRecord[]
): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();

    for (const p of pages) {
        const jpgBytes = await store.get(p.imagePath);
        const img = await pdf.embedJpg(jpgBytes);
        const page = pdf.addPage([img.width, img.height]);
        page.drawImage(img, {x: 0, y: 0, width: img.width, height: img.height});
    }

    return await pdf.save();
}
