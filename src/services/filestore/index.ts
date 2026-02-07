import {getPlatformCaps} from '../platform';
import {type FileStore, OPFSFileStore} from './opfs-store';

// v0.1: OPFS on web. (Capacitor can still use OPFS inside WebView,
// but you can swap to Filesystem later.)
let store: FileStore | null = null;

export function getFileStore(): FileStore {
    if (store) return store;
    const caps = getPlatformCaps();
    if (!caps.hasOPFS) {
        throw new Error('OPFS not available in this browser. For v0.1, use Chromium-based browsers or ship via APK.');
    }
    store = new OPFSFileStore();
    return store;
}
