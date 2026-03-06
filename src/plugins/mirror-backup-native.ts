import {registerPlugin} from '@capacitor/core';

export interface MirrorBackupNativePlugin {
    isSupported(): Promise<{ supported: boolean }>;
    hasDirectory(): Promise<{ hasDirectory: boolean }>;
    pickDirectory(): Promise<{ ok: boolean; uri?: string }>;
    writeBackup(options: { displayName: string; base64: string }): Promise<{ ok: boolean; filename?: string }>;
}

export const MirrorBackupNative = registerPlugin<MirrorBackupNativePlugin>('MirrorBackup');
