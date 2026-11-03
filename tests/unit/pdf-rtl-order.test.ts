import {describe, expect, it} from 'vitest';
import {groupWordsIntoLines} from '../../src/lib/pdf';
import type {OcrWord} from '../../src/domain/types';

describe('PDF OCR text ordering', () => {
    it('orders Arabic words right-to-left within the same line', () => {
        const words: OcrWord[] = [
            {text: 'سلام', box: [0.10, 0.10, 0.08, 0.05], confidence: 95},
            {text: 'عليكم', box: [0.80, 0.10, 0.08, 0.05], confidence: 95},
        ];

        const lines = groupWordsIntoLines(words);
        expect(lines).toHaveLength(1);
        expect(lines[0].rtl).toBe(true);
        expect(lines[0].text).toBe('عليكم سلام');
    });

    it('orders Latin words left-to-right within the same line', () => {
        const words: OcrWord[] = [
            {text: 'world', box: [0.80, 0.10, 0.08, 0.05], confidence: 95},
            {text: 'hello', box: [0.10, 0.10, 0.08, 0.05], confidence: 95},
        ];

        const lines = groupWordsIntoLines(words);
        expect(lines).toHaveLength(1);
        expect(lines[0].rtl).toBe(false);
        expect(lines[0].text).toBe('hello world');
    });

    it('preserves visual order on mixed Arabic/English lines without reversing Latin words', () => {
        // Regression: previously all words sorted RTL when any Arabic word present,
        // causing "Hello مرحبا" to export as "مرحبا Hello" in the PDF text layer.
        const words: OcrWord[] = [
            {text: 'Hello', box: [0.05, 0.10, 0.10, 0.05], confidence: 90},
            {text: 'مرحبا', box: [0.50, 0.10, 0.10, 0.05], confidence: 90},
        ];

        const lines = groupWordsIntoLines(words);
        expect(lines).toHaveLength(1);
        expect(lines[0].rtl).toBe(true); // Arabic font still required
        expect(lines[0].text).toBe('Hello مرحبا'); // visual LTR order preserved
    });

    it('still sorts pure Arabic line right-to-left', () => {
        const words: OcrWord[] = [
            {text: 'الأول', box: [0.60, 0.10, 0.10, 0.05], confidence: 90},
            {text: 'الثاني', box: [0.30, 0.10, 0.10, 0.05], confidence: 90},
            {text: 'الثالث', box: [0.05, 0.10, 0.10, 0.05], confidence: 90},
        ];

        const lines = groupWordsIntoLines(words);
        expect(lines).toHaveLength(1);
        expect(lines[0].rtl).toBe(true);
        expect(lines[0].text).toBe('الأول الثاني الثالث');
    });

    it('keeps an Arabic line with numbers right-to-left (digits are not Latin)', () => {
        // Regression (Nov 2026): "المبلغ: 1250 درهم" counted the digits as Latin, treated the
        // line as mixed and reversed its word order, in the PDF text layer and in copied text.
        const words: OcrWord[] = [
            {text: 'المبلغ:', box: [0.70, 0.10, 0.10, 0.05], confidence: 90},
            {text: '1250', box: [0.50, 0.10, 0.08, 0.05], confidence: 90},
            {text: 'درهم.', box: [0.30, 0.10, 0.08, 0.05], confidence: 90},
        ];

        const lines = groupWordsIntoLines(words);
        expect(lines).toHaveLength(1);
        expect(lines[0].rtl).toBe(true);
        expect(lines[0].text).toBe('المبلغ: 1250 درهم.');
    });
});
