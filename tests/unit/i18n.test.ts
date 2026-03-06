import {beforeEach, describe, expect, it} from 'vitest';
import {i18n} from '../../src/lib/i18n';

describe('i18n single-file registry behavior', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('applies html lang/dir from locale metadata', () => {
        i18n.setLocale('en');
        expect(document.documentElement.lang).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');

        i18n.setLocale('ar');
        expect(document.documentElement.lang).toBe('ar');
        expect(document.documentElement.dir).toBe('rtl');
    });

    it('exposes available locale metadata', () => {
        const locales = i18n.getAvailableLocales();
        expect(locales.some(l => l.code === 'en' && l.dir === 'ltr')).toBe(true);
        expect(locales.some(l => l.code === 'ar' && l.dir === 'rtl')).toBe(true);
    });
});
