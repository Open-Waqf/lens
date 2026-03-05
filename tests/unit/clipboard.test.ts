import {beforeEach, describe, expect, it, vi} from 'vitest';

const mockSettings = vi.hoisted(() => ({
    clearClipboardAfter60s: false,
}));

let clipboardValue = '';
const mockWriteText = vi.fn(async (value: string) => {
    clipboardValue = value;
});
const mockReadText = vi.fn(async () => clipboardValue);

vi.mock('../../src/services/settings', () => ({
    settings: {
        get: vi.fn(async () => ({
            requireAuth: false,
            defaultVault: false,
            enableOcr: true,
            ocrLang: 'ara+eng',
            clearClipboardAfter60s: mockSettings.clearClipboardAfter60s,
        })),
    }
}));

import {writeClipboardWithAutoClear} from '../../src/services/clipboard';

describe('clipboard auto-clear', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mockSettings.clearClipboardAfter60s = false;
        clipboardValue = '';
        delete (window as unknown as {__sahifahClipboardClearDelayMs?: number}).__sahifahClipboardClearDelayMs;

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: mockWriteText,
                readText: mockReadText,
            },
        });
    });

    it('writes text and does not clear when setting is disabled', async () => {
        await writeClipboardWithAutoClear('alpha');
        expect(clipboardValue).toBe('alpha');

        await vi.advanceTimersByTimeAsync(60_000);
        expect(clipboardValue).toBe('alpha');
        expect(mockWriteText).toHaveBeenCalledTimes(1);
    });

    it('clears clipboard after delay when setting is enabled and content unchanged', async () => {
        mockSettings.clearClipboardAfter60s = true;
        (window as unknown as {__sahifahClipboardClearDelayMs?: number}).__sahifahClipboardClearDelayMs = 25;

        await writeClipboardWithAutoClear('beta');
        expect(clipboardValue).toBe('beta');

        await vi.advanceTimersByTimeAsync(30);
        expect(clipboardValue).toBe('');
        expect(mockWriteText).toHaveBeenCalledTimes(2);
    });

    it('does not clear clipboard if content changed before timer fires', async () => {
        mockSettings.clearClipboardAfter60s = true;
        (window as unknown as {__sahifahClipboardClearDelayMs?: number}).__sahifahClipboardClearDelayMs = 25;

        await writeClipboardWithAutoClear('gamma');
        clipboardValue = 'user-updated';

        await vi.advanceTimersByTimeAsync(30);
        expect(clipboardValue).toBe('user-updated');
        expect(mockWriteText).toHaveBeenCalledTimes(1);
    });
});
