import {createWorker, PSM, type Worker} from 'tesseract.js';
import type {OcrWord} from '../domain/types';

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
    if (!workerPromise) {
        workerPromise = (async () => {
            const w = await createWorker('eng', 1, {
                // Point to the local files we copied to /public/tesseract/
                workerPath: '/tesseract/worker.min.js',
                corePath: '/tesseract/tesseract-core.wasm.js',
                langPath: '/tesseract/',
                logger: (m) => {
                    // Debug logs if needed
                    if (m.status === 'recognizing text') console.debug(m.progress);
                }
            });
            await w.setParameters({
                tessedit_pageseg_mode: PSM.AUTO,
                user_defined_dpi: '300', // FIX: Force DPI to prevent "box outside rectangle" errors
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

        // FIX: Convert Blob to ObjectURL for safer transport to WASM
        url = URL.createObjectURL(imageBlob);

        const ret = await w.recognize(url);

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
                        bbox.x0 / width,  // Normalize x
                        bbox.y0 / height, // Normalize y
                        bw / width,       // Normalize w
                        bh / height       // Normalize h
                    ],
                    confidence: word.confidence
                });
            }
        }

        return words;
    } catch (e) {
        console.error('OCR Failed', e);
        return [];
    } finally {
        // Cleanup the URL object to prevent memory leaks
        if (url) URL.revokeObjectURL(url);
    }
}

export function terminateOcr() {
    if (workerPromise) {
        workerPromise.then(w => w.terminate());
        workerPromise = null;
    }
}