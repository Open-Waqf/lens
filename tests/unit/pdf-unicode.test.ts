import {describe, expect, it, vi, beforeEach} from 'vitest';
import {buildPdfForDoc} from '../../src/lib/pdf';
import type {PageRecord} from '../../src/domain/types';

describe('PDF Unicode support', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        global.fetch = vi.fn();
    });

    it('loads bundled Arabic font URL when Arabic OCR text exists', async () => {
        // Mock font fetch
        (global.fetch as any).mockResolvedValue({
            ok: true,
            arrayBuffer: () => Promise.resolve(new Uint8Array(2048).buffer)
        });

        const mockStore = {
            get: vi.fn().mockResolvedValue(new Uint8Array([255, 216, 255])) // Dummy JPG bytes
        };

        const mockPages: PageRecord[] = [{
            id: 'p1',
            docId: 'd1',
            imagePath: 'docs/p1.jpg',
            thumbPath: 'docs/p1_t.jpg',
            width: 100,
            height: 100,
            rotation: 0,
            createdAt: Date.now(),
            words: [{ text: 'مرحباً', box: [0.1, 0.1, 0.2, 0.2], confidence: 99 }]
        }];

        try {
            await buildPdfForDoc(mockStore as any, mockPages);
        } catch {
            // Ignore downstream PDF parsing errors from mocked JPG bytes.
        }

        expect(global.fetch).toHaveBeenCalledWith('/fonts/noto-arabic.ttf');
    });

    it('fails fast when Arabic text exists but bundled Arabic font cannot be loaded', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 404,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
        });

        const mockStore = {
            get: vi.fn().mockResolvedValue(new Uint8Array([255, 216, 255]))
        };

        const mockPages: PageRecord[] = [{
            id: 'p1',
            docId: 'd1',
            imagePath: 'docs/p1.jpg',
            thumbPath: 'docs/p1_t.jpg',
            width: 100,
            height: 100,
            rotation: 0,
            createdAt: Date.now(),
            words: [{ text: 'مرحبا', box: [0.1, 0.1, 0.2, 0.2], confidence: 99 }]
        }];

        await expect(buildPdfForDoc(mockStore as any, mockPages)).rejects.toThrow(
            'Arabic OCR text layer requires bundled Arabic font.'
        );
    });
});
