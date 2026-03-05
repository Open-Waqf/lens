import {describe, expect, it} from 'vitest';
import {mapRestoreError} from '../../src/lib/restore-error';

describe('mapRestoreError', () => {
    it('maps wrong password errors to direct localized message', () => {
        const mapped = mapRestoreError(new Error('Incorrect password.'));
        expect(mapped.direct).toBe(true);
        expect(mapped.message).toBe('Incorrect password.');
    });

    it('maps corruption errors to direct localized message', () => {
        const mapped = mapRestoreError(new Error('Vault file is corrupted or incomplete.'));
        expect(mapped.direct).toBe(true);
        expect(mapped.message).toBe('Vault file is corrupted or incomplete.');
    });

    it('keeps unexpected errors as wrapped candidates', () => {
        const mapped = mapRestoreError(new Error('Some unknown failure'));
        expect(mapped.direct).toBe(false);
        expect(mapped.message).toBe('Some unknown failure');
    });
});

