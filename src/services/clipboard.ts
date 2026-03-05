import {settings} from './settings';

const DEFAULT_CLIPBOARD_CLEAR_MS = 60_000;
let lastWriteToken = 0;

function getClipboardClearDelayMs(): number {
    const override = (window as unknown as { __sahifahClipboardClearDelayMs?: number }).__sahifahClipboardClearDelayMs;
    if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
        return override;
    }
    return DEFAULT_CLIPBOARD_CLEAR_MS;
}

export async function writeClipboardWithAutoClear(text: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
    }

    await navigator.clipboard.writeText(text);

    const cfg = await settings.get();
    if (!cfg.clearClipboardAfter60s) return;

    const token = ++lastWriteToken;
    const expected = text;
    const delay = getClipboardClearDelayMs();

    window.setTimeout(async () => {
        if (token !== lastWriteToken) return;
        try {
            if (!navigator.clipboard?.readText || !navigator.clipboard?.writeText) return;
            const current = await navigator.clipboard.readText();
            if (current === expected) {
                await navigator.clipboard.writeText('');
            }
        } catch {
            // Clipboard access may be denied by browser policy; fail closed without crashing.
        }
    }, delay);
}

