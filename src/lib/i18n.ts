// src/lib/i18n.ts

import {en} from './locales/en';

export type LocaleKey = keyof typeof en;

// We use a simple singleton pattern for now.
// Per Open Waqf guidelines, we must use translation keys.
class I18nService {
    private currentLocale = 'en';
    private locales: Record<string, Record<string, string>> = {
        en: en
    };

    t(key: LocaleKey, params?: Record<string, string | number>): string {
        let text = this.locales[this.currentLocale][key] || key;
        if (params) {
            Object.entries(params).forEach(([k, v]) => {
                text = text.replace(`{{${k}}}`, String(v));
            });
        }
        return text;
    }

    setLocale(l: string) {
        if (this.locales[l]) this.currentLocale = l;
    }
}

export const i18n = new I18nService();
export const t = (key: LocaleKey, params?: Record<string, string | number>) => i18n.t(key, params);
