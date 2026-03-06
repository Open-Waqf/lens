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

    it('defaults clipboard auto-clear to disabled', async () => {
        const s = await settings.get();
        expect(s.clearClipboardAfter60s).toBe(false);
    });

    it('persists clipboard auto-clear setting', async () => {
        settings.setClipboardAutoClear(true);
        const s = await settings.get();
        expect(s.clearClipboardAfter60s).toBe(true);
    });

    it('defaults mirror backup settings to disabled/manual', async () => {
        const s = await settings.get();
        expect(s.mirrorBackupEnabled).toBe(false);
        expect(s.mirrorBackupMode).toBe('manual');
    });

    it('persists mirror backup settings', async () => {
        settings.setMirrorBackupEnabled(true);
        settings.setMirrorBackupMode('after_export');
        const s = await settings.get();
        expect(s.mirrorBackupEnabled).toBe(true);
        expect(s.mirrorBackupMode).toBe('after_export');
    });
});
