import {Capacitor, registerPlugin} from '@capacitor/core';
import {writeShareTemp} from './share';

type SignerHandoffPlugin = {
    isAvailable(): Promise<{available: boolean}>;
    open(options: {path: string}): Promise<void>;
};

const SignerHandoff = registerPlugin<SignerHandoffPlugin>('SignerHandoff');

/** Is Open Waqf Signer installed on this phone (Android only)? */
export async function signerAvailable(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
        return (await SignerHandoff.isAvailable()).available;
    } catch {
        return false;
    }
}

/** Open a PDF in Signer, ready to sign (android/.../SignerHandoffPlugin.java). */
export async function openInSigner(pdf: File): Promise<void> {
    const path = await writeShareTemp(pdf);
    await SignerHandoff.open({path});
}
