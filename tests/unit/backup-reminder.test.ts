import {beforeEach, describe, expect, it} from 'vitest';
import {recordSuccessfulSaveAndShouldRemind} from '../../src/services/backup-reminder';

describe('backup-reminder', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('does not remind before threshold', () => {
        for (let i = 0; i < 9; i++) {
            expect(recordSuccessfulSaveAndShouldRemind()).toBe(false);
        }
    });

    it('reminds on every 10th save when no backup exists', () => {
        for (let i = 0; i < 9; i++) recordSuccessfulSaveAndShouldRemind();
        expect(recordSuccessfulSaveAndShouldRemind()).toBe(true);
        for (let i = 0; i < 9; i++) recordSuccessfulSaveAndShouldRemind();
        expect(recordSuccessfulSaveAndShouldRemind()).toBe(true);
    });

    it('tracks reminders by saves since the last backup', () => {
        localStorage.setItem('sahifah.lastBackup', String(Date.now()));
        for (let i = 0; i < 9; i++) {
            expect(recordSuccessfulSaveAndShouldRemind()).toBe(false);
        }
        expect(recordSuccessfulSaveAndShouldRemind()).toBe(true);

        localStorage.setItem('sahifah.lastBackup', String(Date.now() + 1));
        expect(recordSuccessfulSaveAndShouldRemind()).toBe(false);
        for (let i = 0; i < 8; i++) {
            expect(recordSuccessfulSaveAndShouldRemind()).toBe(false);
        }
        expect(recordSuccessfulSaveAndShouldRemind()).toBe(true);
    });
});
