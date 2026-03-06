import {PDFDocument, rgb} from 'pdf-lib';
import type {OcrWord, PageRecord} from '../domain/types';
import type {FileStore} from '../services/filestore/opfs-store';
import {bytesToBlob} from './bytes';
import fontkit from '@pdf-lib/fontkit';

export type PdfQuality = 'original' | 'email';

export interface PdfOptions {
    quality: PdfQuality;
    onProgress?: (curr: number, total: number) => void;
}

const UNICODE_FONT_URL = '/fonts/noto-arabic.ttf'; // Expected location for Arabic/Unicode support
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const MIN_FONT_BYTES = 1024;

let cachedUnicodeFontBytes: Uint8Array | null = null;

async function loadBundledArabicFontBytes(): Promise<Uint8Array> {
    if (cachedUnicodeFontBytes) return cachedUnicodeFontBytes;
    const fontRes = await fetch(UNICODE_FONT_URL);
    if (!fontRes.ok) throw new Error(`Failed to load bundled Arabic font (${fontRes.status}).`);
    const bytes = new Uint8Array(await fontRes.arrayBuffer());
    if (bytes.byteLength < MIN_FONT_BYTES) {
        throw new Error('Bundled Arabic font file is invalid or truncated.');
    }
    cachedUnicodeFontBytes = bytes;
    return bytes;
}

function pageContainsArabic(page: PageRecord): boolean {
    return !!page.words?.some(w => ARABIC_SCRIPT_RE.test(w.text));
}

export async function buildPdfForDoc(
    store: FileStore,
    pages: PageRecord[],
    opts: PdfOptions = {quality: 'original'}
): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const needsArabicFont = pages.some(pageContainsArabic);

    // Load bundled Unicode font; Arabic text layers are blocked if unavailable.
    let customFont: any = null;
    try {
        const fontBytes = await loadBundledArabicFontBytes();
        customFont = await pdf.embedFont(fontBytes);
    } catch (e) {
        if (needsArabicFont) {
            throw new Error('Arabic OCR text layer requires bundled Arabic font. Please reinstall app assets.');
        }
        console.warn('PDF: Custom font not available; continuing with standard font for non-Arabic text.');
    }

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
            jpgBytes = null;

            const page = pdf.addPage([img.width, img.height]);
            const h = img.height;
            const w = img.width;

            page.drawImage(img, {x: 0, y: 0, width: w, height: h});

            if (p.words && p.words.length > 0) {
                const lines = groupWordsIntoLines(p.words);

                for (const line of lines) {
                    const avgHeight = line.words.reduce((sum, w) => sum + w.box[3], 0) / line.words.length;
                    const fontSize = Math.max(2, avgHeight * h);

                    const firstWord = line.words[0];
                    const px = firstWord.box[0] * w;
                    const py = firstWord.box[1] * h;
                    const ph = firstWord.box[3] * h;

                    try {
                        if (line.rtl && !customFont) {
                            throw new Error('Arabic line requires embedded Unicode font.');
                        }
                        page.drawText(line.text, {
                            x: px,
                            y: h - (py + ph),
                            size: fontSize,
                            font: customFont || undefined,
                            opacity: 0, 
                            color: rgb(0, 0, 0),
                        });
                    } catch (fontErr) {
                        if (line.rtl) throw fontErr;
                        page.drawText(line.text, {
                            x: px, y: h - (py + ph), size: fontSize, opacity: 0, color: rgb(0, 0, 0)
                        });
                    }
                }
            }

        } catch (e) {
            console.error(`Failed to embed page ${p.id}`, e);
            throw new Error(`Failed to generate PDF at page ${i + 1}.`);
        }
    }

    return await pdf.save();
}

export function groupWordsIntoLines(words: OcrWord[]): Array<{ text: string, words: OcrWord[], rtl: boolean }> {
    const lines: Array<{ text: string, words: OcrWord[], rtl: boolean }> = [];
    if (words.length === 0) return lines;

    const sorted = [...words].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
    let currentLine: OcrWord[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const verticalOverlap = Math.abs(curr.box[1] - prev.box[1]) < (prev.box[3] * 0.5);

        if (verticalOverlap) {
            currentLine.push(curr);
        } else {
            const rtl = currentLine.some(w => ARABIC_SCRIPT_RE.test(w.text));
            const orderedWords = [...currentLine].sort((a, b) => rtl ? b.box[0] - a.box[0] : a.box[0] - b.box[0]);
            lines.push({
                text: orderedWords.map(w => w.text).join(' '),
                words: orderedWords,
                rtl,
            });
            currentLine = [curr];
        }
    }
    const rtl = currentLine.some(w => ARABIC_SCRIPT_RE.test(w.text));
    const orderedWords = [...currentLine].sort((a, b) => rtl ? b.box[0] - a.box[0] : a.box[0] - b.box[0]);
    lines.push({
        text: orderedWords.map(w => w.text).join(' '),
        words: orderedWords,
        rtl,
    });
    return lines;
}

async function compressForEmail(originalBytes: Uint8Array): Promise<Uint8Array> {
    const blob = bytesToBlob(originalBytes, 'image/jpeg');
    const bitmap = await createImageBitmap(blob);
    const maxDim = 1200;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) {
        // Already within email export dimensions; avoid a second lossy re-encode.
        bitmap.close();
        return originalBytes;
    }
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blobOut = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.6});
    return new Uint8Array(await blobOut.arrayBuffer());
}
