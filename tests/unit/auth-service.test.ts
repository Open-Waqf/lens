import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AuthService} from '../../src/services/auth-service';

describe('AuthService resume bypass tokens', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-05T00:00:00.000Z'));
        (AuthService as any)._isUnlocked = true;
        (AuthService as any)._promptInFlight = null;
        AuthService.setIgnoreNextResume(false);
    });

    afterEach(() => {
        vi.useRealTimers();
        AuthService.setIgnoreNextResume(false);
    });

    it('locks immediately when no bypass token exists', () => {
        AuthService.lock();
        expect((AuthService as any)._isUnlocked).toBe(false);
    });

    it('consumes bypass token exactly once', () => {
        AuthService.setIgnoreNextResume(true);

        AuthService.lock();
        expect((AuthService as any)._isUnlocked).toBe(true);

        AuthService.lock();
        expect((AuthService as any)._isUnlocked).toBe(false);
    });

    it('does not bypass lock after token expiry', () => {
        AuthService.ignoreNextResumeForExternalAction('test-expiry', 1000);
        vi.advanceTimersByTime(1200);

        AuthService.lock();
        expect((AuthService as any)._isUnlocked).toBe(false);
    });
});

