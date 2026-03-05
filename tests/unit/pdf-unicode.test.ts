import {describe, expect, it, vi, beforeEach} from 'vitest';
import {buildPdfForDoc} from '../../src/lib/pdf';
import type {PageRecord} from '../../src/domain/types';

describe('PDF Unicode support', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        global.fetch = vi.fn();
    });

    it('attempts to load the custom Unicode font for Arabic support', async () => {
        // Mock font fetch
        (global.fetch as any).mockResolvedValue({
            ok: true,
            arrayBuffer: () => Promise.resolve(new Uint8Array([0, 1, 2, 3]).buffer)
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
        } catch (e) {
            // It might fail during PDF generation because our font bytes are fake,
            // but we want to verify that FETCH was called for the correct URL.
        }

        expect(global.fetch).toHaveBeenCalledWith('/fonts/noto-arabic.ttf');
    });
});
