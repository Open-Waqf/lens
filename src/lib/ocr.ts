import {createWorker, PSM, type Worker} from 'tesseract.js';
import type {OcrWord} from '../domain/types';

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
    if (!workerPromise) {
        workerPromise = (async () => {
            const w = await createWorker('eng');
            await w.setParameters({
                tessedit_pageseg_mode: PSM.AUTO,
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
    try {
        const w = await getWorker();
        const ret = await w.recognize(imageBlob);

        const words: OcrWord[] = [];

        // Fix: Cast to 'any' to bypass strict type definition missing 'lines'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lines = (ret.data as any).lines || [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const line of lines as any[]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const word of (line.words || []) as any[]) {
                if (word.confidence < 50) continue;

                const bbox = word.bbox;
                const bw = bbox.x1 - bbox.x0;
                const bh = bbox.y1 - bbox.y0;

                words.push({
                    text: word.text,
                    box: [
                        bbox.x0 / width,  // x
                        bbox.y0 / height, // y
                        bw / width,       // w
                        bh / height       // h
                    ],
                    confidence: word.confidence
                });
            }
        }

        return words;
    } catch (e) {
        console.error('OCR Failed', e);
        return [];
    }
}

export function terminateOcr() {
    if (workerPromise) {
        workerPromise.then(w => w.terminate());
        workerPromise = null;
    }
}