import {PDFDocument, rgb} from 'pdf-lib';
import type {OcrWord, PageRecord} from '../domain/types';
import type {FileStore} from '../services/filestore/opfs-store';
import {bytesToBlob} from './bytes';

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
    // Limit removed to support large documents.
    // Memory is managed by processing pages one-by-one and grouping text lines.
    const pdf = await PDFDocument.create();
    const total = pages.length;

    for (let i = 0; i < total; i++) {
        const p = pages[i];
        if (opts.onProgress) opts.onProgress(i + 1, total);

        let jpgBytes: Uint8Array | null = await store.get(p.imagePath);

        try {
            if (opts.quality === 'email') {
                const compressed = await compressForEmail(jpgBytes);
                jpgBytes = compressed;
            }

            const img = await pdf.embedJpg(jpgBytes);
            jpgBytes = null; // Immediate memory release

            const page = pdf.addPage([img.width, img.height]);
            const h = img.height;
            const w = img.width;

            // 1. Draw Visual Layer
            page.drawImage(img, {x: 0, y: 0, width: w, height: h});

            // 2. Draw Optimized Search Layer (Grouped by lines)
            if (p.words && p.words.length > 0) {
                const lines = groupWordsIntoLines(p.words);

                for (const line of lines) {
                    // Use the average height of words in the line for font size
                    const avgHeight = line.words.reduce((sum, w) => sum + w.box[3], 0) / line.words.length;
                    const fontSize = avgHeight * h;

                    // PDF Coordinate System is Bottom-Left.
                    // Y = PageHeight - (TopOffset + LineHeight)
                    const firstWord = line.words[0];
                    const px = firstWord.box[0] * w;
                    const py = firstWord.box[1] * h;
                    const ph = firstWord.box[3] * h;

                    page.drawText(line.text, {
                        x: px,
                        y: h - (py + ph),
                        size: fontSize,
                        opacity: 0, // Keep invisible
                        color: rgb(0, 0, 0),
                    });
                }
            }

        } catch (e) {
            console.error(`Failed to embed page ${p.id}`, e);
            throw new Error(`Failed to generate PDF at page ${i + 1}.`);
        }
    }

    return await pdf.save();
}

/**
 * Groups individual OCR words into lines to reduce PDF object count.
 * This significantly shrinks the file size for text-heavy documents.
 */
function groupWordsIntoLines(words: OcrWord[]): Array<{ text: string, words: OcrWord[] }> {
    const lines: Array<{ text: string, words: OcrWord[] }> = [];
    if (words.length === 0) return lines;

    // Sort words: Top-to-Bottom, then Left-to-Right
    const sorted = [...words].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);

    let currentLine: OcrWord[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];

        // If the vertical start of the current word is within the height of the previous word,
        // they likely belong to the same visual line.
        const verticalOverlap = Math.abs(curr.box[1] - prev.box[1]) < (prev.box[3] * 0.5);

        if (verticalOverlap) {
            currentLine.push(curr);
        } else {
            lines.push({
                text: currentLine.map(w => w.text).join(' '),
                words: currentLine
            });
            currentLine = [curr];
        }
    }

    // Push last line
    lines.push({
        text: currentLine.map(w => w.text).join(' '),
        words: currentLine
    });

    return lines;
}

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
    bitmap.close();

    const blobOut = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.6});
    return new Uint8Array(await blobOut.arrayBuffer());
}