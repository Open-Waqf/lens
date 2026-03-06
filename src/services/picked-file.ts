import {Filesystem} from '@capacitor/filesystem';
import {base64ToBytes, bytesToBlob} from '../lib/bytes';

type PickedFileLike = {
    name?: string;
    path?: string;
    mimeType?: string;
    data?: string;
    blob?: Blob;
};

export async function pickedFileToBlob(file: PickedFileLike): Promise<Blob | null> {
    if (file.blob instanceof Blob) return file.blob;

    if (typeof file.data === 'string' && file.data.length > 0) {
        const bytes = await base64ToBytes(file.data);
        return bytesToBlob(bytes, file.mimeType || 'application/octet-stream');
    }

    const rawPath = typeof file.path === 'string' ? file.path : '';
    if (!rawPath) return null;

    // Android SAF returns content:// URIs, which are blocked by web fetch/CSP.
    if (rawPath.startsWith('content://')) {
        const out = await Filesystem.readFile({path: rawPath});
        if (typeof out.data === 'string' && out.data.length > 0) {
            const bytes = await base64ToBytes(out.data);
            return bytesToBlob(bytes, file.mimeType || 'application/octet-stream');
        }
        return null;
    }

    const res = await fetch(rawPath);
    return await res.blob();
}

