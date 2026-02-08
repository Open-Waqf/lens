import {createWorker, PSM, type Worker} from 'tesseract.js';
import type {OcrWord} from '../domain/types';

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
    if (!workerPromise) {
        workerPromise = (async () => {
            const w = await createWorker('eng', 1, {
                workerPath: '/tesseract/worker.min.js',
                corePath: '/tesseract/tesseract-core.wasm.js',
                langPath: '/tesseract/',
            });
            await w.setParameters({
                tessedit_pageseg_mode: PSM.AUTO,
                tessedit_create_tsv: '1',
                user_defined_dpi: '300',
            });
            return w;
        })();
    }
    return workerPromise;
}

export async function recognizeText(
    imageBlob: Blob,
    width: number,
    height: number
): Promise<OcrWord[]> {
    let url: string | null = null;
    try {
        const w = await getWorker();
        url = URL.createObjectURL(imageBlob);

        console.log(`OCR: Recognizing... (${width}x${height})`);
        const ret = await w.recognize(url);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = ret.data as any;
        const words: OcrWord[] = [];

        // STRATEGY: Parse TSV (Tab Separated Values)
        if (data.tsv) {
            const tsvRaw = data.tsv as string;
            // DEBUG: See the first 200 chars to confirm format
            console.log('OCR TSV Preview:', tsvRaw.substring(0, 200).replace(/\n/g, '\\n'));

            // Handle both \n and \r\n
            const lines = tsvRaw.split(/\r?\n/);

            for (let i = 0; i < lines.length; i++) {
                const row = lines[i].split('\t');
                // TSV Standard: level|page_num|block_num|par_num|line_num|word_num|left|top|width|height|conf|text
                // That is 12 columns.
                if (row.length < 12) continue;

                // We want level 5 (Word)
                if (row[0] !== '5') continue;

                const conf = parseFloat(row[10]);
                const text = row[11].trim();

                // Relaxed confidence check (some words might be 0 but valid)
                if (text.length > 0) {
                    const x = parseInt(row[6]);
                    const y = parseInt(row[7]);
                    const w = parseInt(row[8]);
                    const h = parseInt(row[9]);

                    words.push({
                        text: text,
                        box: [
                            x / width,
                            y / height,
                            w / width,
                            h / height
                        ],
                        confidence: conf
                    });
                }
            }
        }

        // EMERGENCY FALLBACK:
        // If parsing failed but we have text, return the whole text as one big block.
        // This ensures SEARCH works, even if the red boxes are missing.
        if (words.length === 0 && data.text && data.text.length > 0) {
            console.warn('OCR: Coordinate parsing failed. Falling back to full-page text.');
            words.push({
                text: data.text,
                box: [0, 0, 1, 1], // The whole page
                confidence: 100
            });
        }

        console.log(`OCR Final: Extracted ${words.length} words.`);
        return words;

    } catch (e) {
        console.error('OCR Failed', e);
        return [];
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
}

export function terminateOcr() {
    if (workerPromise) {
        workerPromise.then(w => w.terminate());
        workerPromise = null;
    }
}