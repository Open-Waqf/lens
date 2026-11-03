/**
 * A file name that is safe on Android, Windows, macOS and in email, and still readable.
 *
 * Only characters that break file systems are replaced (/ \ : * ? " < > | and control
 * characters). Letters in any script stay: an Arabic title stays Arabic. Before Nov 2026
 * every non-Latin letter became "_", so "عقد" was shared as "___".
 */
/**
 * The file name for one page shared on its own: its own first words once OCR has read
 * them, otherwise the document's name and the page number ("Invoice p2"). One rule for the
 * editor and the viewer (Nov 2026). Without the extension.
 */
export function pageFileBase(docTitle: string, pageNo: number, ownTitle: string | null): string {
    return safeFileName(ownTitle || `${docTitle} p${Math.max(1, pageNo)}`);
}

export function safeFileName(name: string, fallback = 'document'): string {
    const cleaned = name
        .normalize('NFC')
        .replace(/[\u0000-\u001F\u007F/\\:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.-]+|[\s.]+$/g, '')
        .slice(0, 120)
        .trim();
    return cleaned || fallback;
}
