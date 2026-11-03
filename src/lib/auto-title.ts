/**
 * A document name made from the text OCR read on its first page: the first line that
 * looks like words, e.g. "Facture" + the next line if the first is very short.
 * Returns null when nothing usable was read (the date title then stays).
 *
 * Rules: skip lines that are mostly digits or punctuation (dates, amounts, page numbers),
 * keep at most 60 characters, cut at a word boundary, no trailing punctuation.
 */
export function titleFromText(text: string): string | null {
    const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const wordy = (l: string) => {
        const letters = (l.match(/\p{L}/gu) || []).length;
        return letters >= 3 && letters >= l.replace(/\s/g, '').length * 0.5;
    };
    const first = lines.findIndex(wordy);
    if (first < 0) return null;
    let title = lines[first];
    if (title.length < 12 && lines[first + 1] && wordy(lines[first + 1])) title += ' ' + lines[first + 1];
    if (title.length > 60) {
        const cut = title.slice(0, 60);
        const space = cut.lastIndexOf(' ');
        title = space > 20 ? cut.slice(0, space) : cut;
    }
    title = title.replace(/[\s.,;:!?،؛\-–]+$/u, '').trim();
    return title.length >= 3 ? title : null;
}
