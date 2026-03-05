import {beforeEach, describe, expect, it} from 'vitest';
import {settings} from '../../src/services/settings';

describe('settings OCR language', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults OCR language to ara+eng', async () => {
        const s = await settings.get();
        expect(s.ocrLang).toBe('ara+eng');
    });

    it('persists OCR language changes', async () => {
        settings.setOcrLang('eng');
        const s = await settings.get();
        expect(s.ocrLang).toBe('eng');
    });
});

