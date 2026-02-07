import {downloadBytes, toArrayBuffer} from '../lib/bytes';

export async function shareOrDownload(bytes: Uint8Array, filename: string, mime: string): Promise<void> {
    try {
        if ('share' in navigator && 'canShare' in navigator) {
            const file = new File([toArrayBuffer(bytes)], filename, {type: mime});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nav: any = navigator;
            if (nav.canShare?.({files: [file]})) {
                await nav.share({files: [file], title: filename});
                return;
            }
        }
    } catch {
        // fall back
    }
    downloadBytes(bytes, filename, mime);
}
