import {createWorker, PSM, type Worker} from 'tesseract.js';
import type {OcrWord} from '../domain/types';
import {sha256Hex} from './hash';
import type {LocaleKey} from './i18n';

let currentWorker: Worker | null = null;
let currentLang: string | null = null;
let workerInitPromise: Promise<Worker> | null = null;
let workerInitLang: string | null = null;

const LANG_MANIFEST: Record<string, string> = {
    'eng': '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
    'ara': 'e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729',
};

export const OCR_LANG_OPTIONS = [
    {code: 'ara+eng', labelKey: 'settings.ocr_lang_ara_eng'},
    {code: 'ara', labelKey: 'settings.ocr_lang_ara'},
    {code: 'eng', labelKey: 'settings.ocr_lang_eng'},
] as const satisfies ReadonlyArray<{ code: string; labelKey: LocaleKey }>;

function splitLangCodes(lang: string): string[] {
    return lang
        .split('+')
        .map(v => v.trim())
        .filter(Boolean);
}

async function getWorker(lang = 'eng'): Promise<Worker> {
    if (currentWorker && currentLang === lang) {
        return currentWorker;
    }

    // If the same language is already being initialized, await that in-flight init.
    if (workerInitPromise && workerInitLang === lang) {
        return await workerInitPromise;
    }

    // If another language is initializing, wait for it to finish first to avoid overlap.
    if (workerInitPromise && workerInitLang !== lang) {
        try {
            await workerInitPromise;
        } catch {
            // Ignore failed in-flight init; continue with requested language init.
        }
    }

    if (currentWorker && currentLang !== lang) {
        await currentWorker.terminate();
        currentWorker = null;
        currentLang = null;
    }

    workerInitLang = lang;
    workerInitPromise = (async () => {
        const base = import.meta.env.BASE_URL || '/';
        const tessPath = `${base}tesseract/`.replace('//', '/');

        // 1. Verify Integrity per language pack
        for (const code of splitLangCodes(lang)) {
            if (LANG_MANIFEST[code]) {
                console.log(`OCR: Verifying integrity for ${code}...`);
                try {
                    const res = await fetch(`${tessPath}${code}.traineddata`);
                    if (!res.ok) throw new Error(`Failed to fetch language pack: ${res.statusText}`);
                    const buffer = await res.arrayBuffer();
                    const hash = await sha256Hex(new Uint8Array(buffer));

                    if (hash !== LANG_MANIFEST[code]) {
                        console.error(`OCR Integrity Mismatch! Expected ${LANG_MANIFEST[code]}, got ${hash}`);
                        throw new Error("OCR Data corrupted or modified. Initialization blocked for security.");
                    }
                    console.log(`OCR: ${code} integrity verified.`);
                } catch (e) {
                    console.error("OCR Integrity Check Failed", e);
                    throw e;
                }
            } else {
                console.warn(`OCR: No integrity hash for ${code}. Proceeding without verification.`);
            }
        }

        console.log(`OCR: Initializing Tesseract (${lang})...`);

        const w = await createWorker(lang, 1, {
            workerPath: `${tessPath}worker.min.js`,
            corePath: `${tessPath}tesseract-core.wasm.js`,
            langPath: tessPath,
            gzip: false,
            logger: m => {
                if (m.status === 'loading tesseract core') console.log('OCR: Loading Core...');
                if (m.status === 'loading language traineddata') console.log('OCR: Loading Language...');
            }
        });

        await w.setParameters({
            tessedit_pageseg_mode: PSM.AUTO,
            tessedit_create_tsv: '1',
            user_defined_dpi: '300',
        });

        currentWorker = w;
        currentLang = lang;
        return w;
    })();

    try {
        return await workerInitPromise;
    } finally {
        if (workerInitLang === lang) {
            workerInitPromise = null;
            workerInitLang = null;
        }
    }
}

export async function recognizeText(
    imageBlob: Blob,
    width: number,
    height: number,
    lang = 'eng'
): Promise<OcrWord[]> {
    let url: string | null = null;
    try {
        const w = await getWorker(lang);
        url = URL.createObjectURL(imageBlob);

        console.log(`OCR: Recognizing... (${width}x${height}) [${lang}]`);
        const ret = await w.recognize(url);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = ret.data as any;
        const words: OcrWord[] = [];

        if (data.tsv) {
            const lines = (data.tsv as string).split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const row = lines[i].split('\t');
                if (row.length < 12 || row[0] !== '5') continue;

                const conf = parseFloat(row[10]);
                const text = row[11].trim();

                if (text.length > 0 && conf >= 0) {
                    words.push({
                        text: text,
                        box: [
                            parseInt(row[6]) / width,
                            parseInt(row[7]) / height,
                            parseInt(row[8]) / width,
                            parseInt(row[9]) / height
                        ],
                        confidence: conf
                    });
                }
            }
        }

        if (words.length === 0 && data.text?.length > 0) {
            words.push({
                text: data.text,
                box: [0, 0, 1, 1],
                confidence: 100
            });
        }

        return words;
    } catch (e) {
        console.error('OCR Failed', e);
        terminateOcr();
        return [];
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
}

export function terminateOcr() {
    workerInitPromise = null;
    workerInitLang = null;
    if (currentWorker) {
        void currentWorker.terminate();
        currentWorker = null;
        currentLang = null;
    }
}

export async function warmupOcr(lang = 'eng') {
    await getWorker(lang);
}
