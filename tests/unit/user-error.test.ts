import {describe, expect, it} from 'vitest';
import {toUserErrorMessage} from '../../src/lib/user-error';

describe('toUserErrorMessage', () => {
    it('maps OPFS security errors to a friendly localized message', () => {
        const msg = toUserErrorMessage(new Error('Failed to access OPFS: Security error when calling GetDirectory'));
        expect(msg).toBe('Local secure storage is blocked in this browser mode. Exit private mode and try again.');
    });

    it('returns original message for non-OPFS errors', () => {
        const msg = toUserErrorMessage(new Error('Something else failed'));
        expect(msg).toBe('Something else failed');
    });
});

