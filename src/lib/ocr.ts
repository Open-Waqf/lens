import {createWorker, PSM, type Worker} from 'tesseract.js';
import type {OcrWord} from '../domain/types';

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
    if (!workerPromise) {
        workerPromise = (async () => {
            // We configure the worker to load from our local /public/tesseract folder
            // instead of the default CDN.
            const w = await createWorker('eng', 1, {
                workerPath: '/tesseract/worker.min.js',
                corePath: '/tesseract/tesseract-core.wasm.js',
                langPath: '/tesseract/', // Point to folder containing eng.traineddata.gz
                logger: (m) => {
                    if (m.status === 'recognizing text') {
                        // console.debug(`OCR Progress: ${(m.progress * 100).toFixed(0)}%`);
                    }
                }
            });

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
                        bbox.x0 / width,
                        bbox.y0 / height,
                        bw / width,
                        bh / height
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