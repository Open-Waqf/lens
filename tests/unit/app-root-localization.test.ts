import {describe, expect, it} from 'vitest';
import {t} from '../../src/lib/i18n';

describe('app-root localization keys', () => {
    it('translates storage auto-clean toast with count', () => {
        expect(t('storage.audit.auto_cleaned', {count: 3})).toBe('Cleaned up 3 leftover file(s).');
    });

    it('provides localized nav labels and fatal actions', () => {
        expect(t('nav.library')).toBe('Library');
        expect(t('nav.settings')).toBe('Settings');
        expect(t('app.fatal_title')).toBe('Something went wrong');
        expect(t('app.reload')).toBe('Reload App');
        expect(t('app.factory_reset')).toBe('Factory Reset');
    });
});
