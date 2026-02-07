import {Capacitor} from '@capacitor/core';

export interface PlatformCaps {
    isCapacitor: boolean;
    hasOPFS: boolean;
    hasWebShare: boolean;
    hasCameraStream: boolean;
}

export function getPlatformCaps(): PlatformCaps {
    const isCapacitor = !!Capacitor?.isNativePlatform?.();

    const hasOPFS =
        typeof navigator !== 'undefined' &&
        'storage' in navigator &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof (navigator.storage as any).getDirectory === 'function';

    const hasWebShare = typeof navigator !== 'undefined' && 'share' in navigator;

    const hasCameraStream =
        typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia;

    return {isCapacitor, hasOPFS, hasWebShare, hasCameraStream};
}
