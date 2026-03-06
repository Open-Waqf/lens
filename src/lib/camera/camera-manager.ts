import {Capacitor, registerPlugin} from '@capacitor/core';

export type CameraStartResult = {
    stream: MediaStream;
    width: number;
    height: number;
};

export class CameraManager {
    private _stream: MediaStream | null = null;
    private _videoTrack: MediaStreamTrack | null = null;

    private _torchSupported = false;
    private _torchOn = false;
    private _aeAfLocked = false;

    get isRunning(): boolean {
        return !!this._stream;
    }

    /** Whether the active camera track reports torch support. */
    get torchSupported(): boolean {
        return this._torchSupported;
    }

    /** Best-effort state (some browsers may not reflect actual torch state). */
    get torchOn(): boolean {
        return this._torchOn;
    }

    async start(video: HTMLVideoElement): Promise<CameraStartResult> {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Camera not supported in this browser.');
        }

        const tries: MediaStreamConstraints[] = [
            {
                audio: false,
                video: {
                    facingMode: {ideal: 'environment'},
                    width: {ideal: 4096},
                    height: {ideal: 2160},
                },
            },
            {audio: false, video: {facingMode: {ideal: 'environment'}}},
            {audio: false, video: true},
        ];

        let lastErr: unknown = null;

        for (const c of tries) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia(c);

                // attach
                video.srcObject = stream;

                // Some browsers require explicit play()
                try {
                    await video.play();
                } catch {
                    // ignore; we still verify metadata next
                }

                await waitForVideoReady(video, 1500);

                // success
                this._stream = stream;
                this._videoTrack = stream.getVideoTracks?.()[0] ?? null;

                // torch capability detection (best effort)
                this._torchSupported = false;
                this._torchOn = false;
                try {
                    const caps = (this._videoTrack as any)?.getCapabilities?.();
                    this._torchSupported = !!caps?.torch;
                } catch {
                    this._torchSupported = false;
                }

                return {stream, width: video.videoWidth, height: video.videoHeight};
            } catch (e) {
                lastErr = e;
                // cleanup any partial stream
                const s = video.srcObject as MediaStream | null;
                if (s) stopStream(s);
                video.srcObject = null;
            }
        }

        const msg = (lastErr as Error)?.message ?? String(lastErr);
        throw new Error(`Failed to start camera: ${msg}`);
    }

    async stop(): Promise<void> {
        if (!this._stream) return;

        // turn off torch if it was on (best effort)
        try {
            if (this._torchSupported && this._torchOn) {
                await this.setTorch(false);
            }
        } catch {
            // ignore
        }

        stopStream(this._stream);
        this._stream = null;
        this._videoTrack = null;
        this._torchSupported = false;
        this._torchOn = false;
    }

    async toggleTorch(): Promise<void> {
        if (!this._torchSupported) return;
        await this.setTorch(!this._torchOn);
    }

    /**
     * Best-effort lock before capture to reduce focus/exposure flicker in native WebViews.
     * Returns true when lock constraints were applied.
     */
    async lockExposureAndFocus(): Promise<boolean> {
        if (!this._videoTrack) return false;
        const track: any = this._videoTrack as any;

        if (Capacitor.isNativePlatform()) {
            try {
                await NativeCameraControl.lockExposureAndFocus();
                this._aeAfLocked = true;
                return true;
            } catch {
                // Fallback to track constraints below.
            }
        }

        const caps = safeGetCapabilities(track);
        const advanced: Record<string, unknown> = {};

        if (arrayHas(caps?.focusMode, 'manual') || arrayHas(caps?.focusMode, 'single-shot')) {
            advanced.focusMode = arrayHas(caps?.focusMode, 'manual') ? 'manual' : 'single-shot';
        }
        if (arrayHas(caps?.exposureMode, 'manual') || arrayHas(caps?.exposureMode, 'single-shot')) {
            advanced.exposureMode = arrayHas(caps?.exposureMode, 'manual') ? 'manual' : 'single-shot';
        }

        if (Object.keys(advanced).length === 0) return false;
        try {
            await track.applyConstraints({advanced: [advanced]});
            this._aeAfLocked = true;
            return true;
        } catch {
            this._aeAfLocked = false;
            return false;
        }
    }

    async unlockExposureAndFocus(): Promise<void> {
        if (!this._videoTrack || !this._aeAfLocked) return;
        const track: any = this._videoTrack as any;

        if (Capacitor.isNativePlatform()) {
            try {
                await NativeCameraControl.unlockExposureAndFocus();
                this._aeAfLocked = false;
                return;
            } catch {
                // Fallback to track constraints below.
            }
        }

        const caps = safeGetCapabilities(track);
        const advanced: Record<string, unknown> = {};

        if (arrayHas(caps?.focusMode, 'continuous')) advanced.focusMode = 'continuous';
        if (arrayHas(caps?.exposureMode, 'continuous')) advanced.exposureMode = 'continuous';
        if (Object.keys(advanced).length === 0) {
            this._aeAfLocked = false;
            return;
        }

        try {
            await track.applyConstraints({advanced: [advanced]});
        } catch {
            // ignore
        } finally {
            this._aeAfLocked = false;
        }
    }

    async setTorch(on: boolean): Promise<void> {
        if (!this._videoTrack) return;
        if (!this._torchSupported) return;

        // Some browsers only accept torch in advanced constraints.
        try {
            await (this._videoTrack as any).applyConstraints({advanced: [{torch: on}]});
            this._torchOn = on;
        } catch (e) {
            const msg = (e as Error)?.message ?? String(e);
            throw new Error(`Failed to toggle torch: ${msg}`);
        }
    }
}

type NativeCameraControlPlugin = {
    lockExposureAndFocus(): Promise<void>;
    unlockExposureAndFocus(): Promise<void>;
};

const NativeCameraControl = registerPlugin<NativeCameraControlPlugin>('NativeCameraControl');

function stopStream(stream: MediaStream) {
    for (const t of stream.getTracks()) {
        try {
            t.stop();
        } catch {
        }
    }
}

function safeGetCapabilities(track: any): any {
    try {
        return track?.getCapabilities?.();
    } catch {
        return null;
    }
}

function arrayHas(value: unknown, wanted: string): boolean {
    return Array.isArray(value) && value.includes(wanted);
}

function waitForVideoReady(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
    // must get non-zero dimensions
    return new Promise((resolve, reject) => {
        const t0 = Date.now();

        const tick = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) return resolve();
            if (Date.now() - t0 > timeoutMs) return reject(new Error('Camera started but no frames were delivered.'));
            setTimeout(tick, 50);
        };

        // ensure metadata starts loading
        if (video.readyState >= 1) tick();
        else video.addEventListener('loadedmetadata', tick, {once: true});
    });
}
