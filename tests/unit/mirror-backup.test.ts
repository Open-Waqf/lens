import {describe, expect, it} from 'vitest';
import {buildMirrorFilename, shouldMirrorAfterExport} from '../../src/services/mirror-backup';

describe('mirror backup policy', () => {
    it('enables auto mirror only when enabled + after_export mode', () => {
        expect(shouldMirrorAfterExport({
            mirrorBackupEnabled: true,
            mirrorBackupMode: 'after_export'
        })).toBe(true);
    });

    it('skips when disabled', () => {
        expect(shouldMirrorAfterExport({
            mirrorBackupEnabled: false,
            mirrorBackupMode: 'after_export'
        })).toBe(false);
    });

    it('skips in manual mode', () => {
        expect(shouldMirrorAfterExport({
            mirrorBackupEnabled: true,
            mirrorBackupMode: 'manual'
        })).toBe(false);
    });
});

describe('buildMirrorFilename', () => {
    it('produces unique filenames when called multiple times within the same second', () => {
        // Regression: previously timestamp-only names collided if two backups ran within 1s.
        const names = new Set(Array.from({length: 20}, () => buildMirrorFilename('backup')));
        expect(names.size).toBe(20);
    });

    it('preserves the base name and .slbk extension', () => {
        const name = buildMirrorFilename('my-backup.slbk');
        expect(name).toMatch(/^my-backup-\d{8}-\d{6}-[a-z0-9]{3}\.slbk$/);
    });
});
