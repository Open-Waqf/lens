import {beforeEach, describe, expect, it, vi} from 'vitest';

const createWorkerMock = vi.hoisted(() => vi.fn());

vi.mock('tesseract.js', () => ({
    PSM: {AUTO: 3},
    createWorker: (...args: any[]) => createWorkerMock(...args),
}));

vi.mock('../../src/lib/hash', () => ({
    sha256Hex: async () => '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
}));

describe('ocr worker init race guard', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        createWorkerMock.mockReset();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            statusText: 'OK',
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        } as any);
    });

    it('reuses in-flight initialization for concurrent same-lang warmups', async () => {
        createWorkerMock.mockResolvedValue({
            setParameters: async () => undefined,
            terminate: async () => undefined,
        });

        const mod = await import('../../src/lib/ocr');
        const p1 = mod.warmupOcr('eng');
        const p2 = mod.warmupOcr('eng');

        await Promise.all([p1, p2]);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(createWorkerMock).toHaveBeenCalledTimes(1);
        mod.terminateOcr();
    });
});
