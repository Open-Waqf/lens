/**
 * A file name that is safe on Android, Windows, macOS and in email, and still readable.
 *
 * Only characters that break file systems are replaced (/ \ : * ? " < > | and control
 * characters). Letters in any script stay: an Arabic title stays Arabic. Before Nov 2026
 * every non-Latin letter became "_", so "عقد" was shared as "___".
 */
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
