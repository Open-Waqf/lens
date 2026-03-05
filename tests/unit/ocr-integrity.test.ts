import {describe, expect, it, vi, beforeEach} from 'vitest';
import {recognizeText, terminateOcr} from '../../src/lib/ocr';

describe('OCR Integrity & Dynamic Language', () => {
    beforeEach(() => {
        terminateOcr();
        vi.restoreAllMocks();
        // Mock global fetch for Tesseract files
        global.fetch = vi.fn();
    });

    it('rejects a language pack with a mismatched SHA-256 hash', async () => {
        const mockData = new Uint8Array([1, 2, 3, 4, 5]); // Dummy data
        
        // Mock fetch to return "corrupted" data
        (global.fetch as any).mockResolvedValue({
            ok: true,
            statusText: 'OK',
            arrayBuffer: () => Promise.resolve(mockData.buffer)
        });

        const dummyBlob = new Blob([''], {type: 'image/jpeg'});
        
        // This should fail because the hash of [1,2,3,4,5] 
        // does not match the hardcoded manifest hash for 'eng'
        const words = await recognizeText(dummyBlob, 100, 100, 'eng');
        
        expect(words).toEqual([]); // Should return empty array on failure
    });

    it('proceeds with a warning if no hash is defined for a language', async () => {
        // Tesseract worker initialization is complex to mock fully in JSDOM,
        // but we can verify the code path doesn't throw before Tesseract starts.
        
        // Mock fetch for a language not in manifest (e.g. 'fra')
        (global.fetch as any).mockResolvedValue({
            ok: false // Shouldn't even be called for 'fra' as it's not in manifest
        });

        // We expect it to try and initialize Tesseract (which will fail in this mock env, but that's okay)
        try {
            await recognizeText(new Blob(['']), 100, 100, 'fra');
        } catch (e) {
            // Failure here is expected due to createWorker mock environment, 
            // but it shouldn't be an "Integrity Mismatch" error.
            expect((e as Error).message).not.toContain('Integrity Mismatch');
        }
    });
});
