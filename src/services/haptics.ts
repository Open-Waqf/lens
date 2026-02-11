import {Haptics, ImpactStyle} from '@capacitor/haptics';
import {getPlatformCaps} from './platform';

const caps = getPlatformCaps();

export const haptics = {
    async impact(style: ImpactStyle = ImpactStyle.Light) {
        if (caps.isCapacitor) {
            // Native Path
            await Haptics.impact({style});
        } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
            // Browser Path (Android Chrome supports this, iOS Safari does not)
            const duration = style === ImpactStyle.Heavy ? 40 : 15;
            navigator.vibrate(duration);
        }
    },

    async selection() {
        if (caps.isCapacitor) {
            await Haptics.selectionStart();
        } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(10);
        }
    }
};