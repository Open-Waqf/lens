import type {OcrWord} from '../domain/types';
import {groupWordsIntoLines} from './pdf';

/**
 * The text of one page, line by line, from its OCR words.
 *
 * OCR stores each word with its position. Joining them with spaces would turn a page into
 * one long line, so words are grouped into lines by position (the same grouping as the
 * PDF text layer), and lines are joined with line breaks. Arabic lines read right to left.
 */
export function pageText(words: OcrWord[] | undefined): string {
    if (!words || words.length === 0) return '';
    return groupWordsIntoLines(words).map((l) => l.text.trim()).filter(Boolean).join('\n');
}
