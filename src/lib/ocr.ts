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
                logger: (m) => {
                    if (m.status === 'recognizing text') {
                        // Keep progress logs if you want
                        console.debug(m.progress);
                    }
                }
            });
            await w.setParameters({
                tessedit_pageseg_mode: PSM.AUTO,
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

        const ret = await w.recognize(url);
        console.log('OCR Raw Result:', ret.data); // DEBUG: See what Tesseract actually found

        const words: OcrWord[] = [];

        // Strategy 1: Try Lines (Structure preserved)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lines = (ret.data as any).lines || [];

        if (lines.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const line of lines as any[]) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const word of (line.words || []) as any[]) {
                    addWordIfValid(word, words, width, height);
                }
            }
        }
            // Strategy 2: Fallback to flat words list
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else if ((ret.data as any).words && (ret.data as any).words.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const word of (ret.data as any).words) {
                addWordIfValid(word, words, width, height);
            }
        }

        console.log(`OCR Final: Extracted ${words.length} valid words.`);
        return words;

    } catch (e) {
        console.error('OCR Failed', e);
        return [];
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
}

// Helper to normalize and filter
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addWordIfValid(word: any, list: OcrWord[], imgW: number, imgH: number) {
    // Lower threshold to 30 to catch faint text
    if (word.confidence < 30) return;

    const text = word.text.trim();
    if (text.length === 0) return;

    const bbox = word.bbox;
    const bw = bbox.x1 - bbox.x0;
    const bh = bbox.y1 - bbox.y0;

    list.push({
        text: text,
        box: [
            bbox.x0 / imgW,
            bbox.y0 / imgH,
            bw / imgW,
            bh / imgH
        ],
        confidence: word.confidence
    });
}

export function terminateOcr() {
    if (workerPromise) {
        workerPromise.then(w => w.terminate());
        workerPromise = null;
    }
}