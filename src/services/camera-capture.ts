// camera-capture.ts: one photo from the phone's own camera app (Android).
//
// The fallback when Google's document scanner is not on the phone (no Google Play
// services). Lens has no camera permission: the camera app takes the picture and hands it
// over as a file in Lens's cache, which is deleted once the photo is in the editor.
import {Capacitor, registerPlugin} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';

const CameraCapture = registerPlugin<{takePhoto(): Promise<{path: string}>}>('CameraCapture');

/** The photo as a File, or null when the user closed the camera app without a photo. */
export async function takePhotoWithCameraApp(): Promise<File | null> {
    let path: string;
    try {
        ({path} = await CameraCapture.takePhoto());
    } catch (e: any) {
        if (e?.code === 'USER_CANCELLED' || /cancel/i.test(e?.message || '')) return null;
        throw e;
    }
    const res = await fetch(Capacitor.convertFileSrc(path));
    const blob = await res.blob();
    const name = path.split('/').pop() || 'photo.jpg';
    void Filesystem.deleteFile({path: `camera/${name}`, directory: Directory.Cache}).catch(() => {});
    return new File([blob], name, {type: 'image/jpeg'});
}
