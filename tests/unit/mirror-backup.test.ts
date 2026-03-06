import {describe, expect, it} from 'vitest';
import {shouldMirrorAfterExport} from '../../src/services/mirror-backup';

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
