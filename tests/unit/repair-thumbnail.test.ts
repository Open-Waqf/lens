import {beforeEach, describe, expect, it, vi} from 'vitest';
import {__repairInternals} from '../../src/services/repair';

describe('repair thumbnail generation', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('uses OffscreenCanvas path without document dependency', async () => {
        const close = vi.fn();
        (globalThis as any).createImageBitmap = vi.fn(async () => ({
            width: 1200,
            height: 800,
            close,
        }));

        class MockOffscreenCanvas {
            width: number;
            height: number;
            constructor(width: number, height: number) {
                this.width = width;
                this.height = height;
            }
            getContext() {
                return {
                    drawImage: vi.fn(),
                };
            }
            async convertToBlob() {
                return new Blob([new Uint8Array([1, 2, 3])], {type: 'image/jpeg'});
            }
        }
        (globalThis as any).OffscreenCanvas = MockOffscreenCanvas;

        const createElementSpy = vi.spyOn(document, 'createElement');
        const out = await __repairInternals.generateThumbnail(new Uint8Array([9, 8, 7]));
        expect(out.length).toBe(3);
        expect(close).toHaveBeenCalledTimes(1);
        expect(createElementSpy).not.toHaveBeenCalledWith('canvas');
    });
});

