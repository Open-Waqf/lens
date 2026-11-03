import {describe, expect, it} from 'vitest';
import config from '../../capacitor.config';

describe('Capacitor config', () => {
    it('keeps light system bar icons, because the app is dark in phone light mode too', () => {
        // Regression (Nov 2026): with the default style, phone light mode drew dark status bar
        // icons on the dark app background, almost invisible.
        expect((config.plugins as any)?.SystemBars?.style).toBe('DARK');
    });

    it('declares no notification plugins (Lens sends no notifications)', () => {
        expect(Object.keys(config.plugins || {})).toEqual(['SystemBars']);
    });
});
