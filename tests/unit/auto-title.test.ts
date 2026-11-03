import {describe, expect, it} from 'vitest';
import {titleFromText} from '../../src/lib/auto-title';

describe('titleFromText: a document name from its OCR text', () => {
    it('takes the first line of words, and the next one when the first is short', () => {
        expect(titleFromText('Facture\nFacture n° 2026-1103. Société Exemple SARL')).toBe('Facture Facture n° 2026-1103. Société Exemple SARL');
        expect(titleFromText('Rental agreement between the parties\nSecond line')).toBe('Rental agreement between the parties');
    });

    it('skips dates, amounts and page numbers at the top', () => {
        expect(titleFromText('03/11/2026\n1 250,00 €\nContrat de location du logement')).toBe('Contrat de location du logement');
    });

    it('works for Arabic', () => {
        expect(titleFromText('٢٠٢٦/١١/٠٣\nعقد إيجار المحل التجاري')).toBe('عقد إيجار المحل التجاري');
    });

    it('cuts long lines at a word and drops trailing punctuation', () => {
        const t = titleFromText('This is a very long first line of a letter that keeps going on and on without end.')!;
        expect(t.length).toBeLessThanOrEqual(60);
        expect(t.endsWith(' ')).toBe(false);
        expect(/[.,:;]$/.test(t)).toBe(false);
    });

    it('returns null when nothing readable was found', () => {
        expect(titleFromText('')).toBeNull();
        expect(titleFromText('12 34\n-- / --')).toBeNull();
    });
});
