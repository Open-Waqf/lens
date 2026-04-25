import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const createWorkerMock = vi.hoisted(() => vi.fn());

vi.mock('tesseract.js', () => ({
    PSM: {AUTO: 3},
    createWorker: (...args: any[]) => createWorkerMock(...args),
}));

vi.mock('../../src/lib/hash', () => ({
    sha256Hex: async () => '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
}));

function makeWorker(recognizeResult: object) {
    return {
        setParameters: async () => undefined,
        recognize: async () => ({data: recognizeResult}),
        terminate: async () => undefined,
    };
}

describe('OCR TSV fallback', () => {
    beforeEach(() => {
        vi.resetModules();
        createWorkerMock.mockReset();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            statusText: 'OK',
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as any);
        global.URL.createObjectURL = vi.fn(() => 'blob:mock');
        global.URL.revokeObjectURL = vi.fn();
    });

    afterEach(async () => {
        const mod = await import('../../src/lib/ocr');
        mod.terminateOcr();
    });

    it('uses bounded box and low confidence when TSV is empty but text exists', async () => {
        // Regression: previously produced box [0,0,1,1] with confidence 100,
        // creating a full-page invisible block that broke the PDF text layer.
        createWorkerMock.mockResolvedValue(makeWorker({
            tsv: 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n',
            text: 'some extracted text',
        }));

        const mod = await import('../../src/lib/ocr');
        const words = await mod.recognizeText(new Blob(['']), 100, 100, 'eng');

        expect(words).toHaveLength(1);
        expect(words[0].confidence).toBe(30);
        expect(words[0].box[0]).toBeGreaterThan(0); // not at page edge
        expect(words[0].box[1]).toBeGreaterThan(0);
        expect(words[0].box[2]).toBeLessThan(1);
        expect(words[0].box[3]).toBeLessThan(1);
    });

    it('returns empty array when TSV is empty and text is only whitespace', async () => {
        createWorkerMock.mockResolvedValue(makeWorker({
            tsv: 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n',
            text: '   \n  ',
        }));

        const mod = await import('../../src/lib/ocr');
        const words = await mod.recognizeText(new Blob(['']), 100, 100, 'eng');

        expect(words).toHaveLength(0);
    });
});
