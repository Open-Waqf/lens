import {describe, expect, it} from 'vitest';
import {pageText} from '../../src/lib/ocr-text';
import type {OcrWord} from '../../src/domain/types';

const w = (text: string, x: number, y: number): OcrWord => ({text, box: [x, y, 0.08, 0.02], confidence: 90});

describe('pageText: OCR words back into lines', () => {
    it('keeps line breaks between lines and word order inside a line', () => {
        const words = [w('Paris', 0.3, 0.2), w('Facture', 0.1, 0.1), w('2026', 0.2, 0.1), w('75011', 0.1, 0.2)];
        expect(pageText(words)).toBe('Facture 2026\n75011 Paris');
    });

    it('reads an Arabic line right to left', () => {
        const words = [w('الرحيم', 0.1, 0.1), w('بسم', 0.7, 0.1), w('الله', 0.5, 0.1), w('الرحمن', 0.3, 0.1)];
        expect(pageText(words)).toBe('بسم الله الرحمن الرحيم');
    });

    it('is empty for a page without words', () => {
        expect(pageText(undefined)).toBe('');
        expect(pageText([])).toBe('');
    });
});
