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
});
