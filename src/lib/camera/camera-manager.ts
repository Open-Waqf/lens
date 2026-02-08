export type CameraStartOptions = {
    constraints?: MediaStreamConstraints;
};

export type CameraStartResult = {
    stream: MediaStream;
    width: number;
    height: number;
};

export class CameraManager {
    private _stream: MediaStream | null = null;
    private _video: HTMLVideoElement | null = null;

    get stream(): MediaStream | null {
        return this._stream;
    }

    get isRunning(): boolean {
        return !!this._stream;
    }

    /**
     * Starts camera, attaches to video element, waits for metadata, and starts playback.
     * Resolves with video dimensions once ready.
     */
    async start(videoEl: HTMLVideoElement, opts: CameraStartOptions = {}): Promise<CameraStartResult> {
        if (this._stream) return this._readyResult(videoEl, this._stream);

        const constraints =
            opts.constraints ?? ({
                video: {facingMode: {ideal: 'environment'}},
                audio: false
            } as MediaStreamConstraints);

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        this._stream = stream;
        this._video = videoEl;

        videoEl.srcObject = stream;

        await new Promise<void>((resolve, reject) => {
            const onLoaded = async () => {
                cleanup();
                try {
                    await videoEl.play();
                } catch {
                    // ignore play() failures; still usable for capture in some browsers
                }
                resolve();
            };

            const onError = () => {
                cleanup();
                reject(new Error('Camera metadata load failed'));
            };

            const cleanup = () => {
                videoEl.removeEventListener('loadedmetadata', onLoaded);
                videoEl.removeEventListener('error', onError as any);
            };

            videoEl.addEventListener('loadedmetadata', onLoaded, {once: true});
            videoEl.addEventListener('error', onError as any, {once: true});
        });

        return this._readyResult(videoEl, stream);
    }

    async stop(): Promise<void> {
        const s = this._stream;
        this._stream = null;

        if (s) {
            for (const t of s.getTracks()) {
                try {
                    t.stop();
                } catch {
                    // ignore
                }
            }
        }

        if (this._video) {
            try {
                this._video.srcObject = null;
            } catch {
                // ignore
            }
        }

        this._video = null;
    }

    /**
     * Captures current frame into a canvas, already scaled to maxDim.
     * Does NOT do any warping/cropping; ScanPage can apply quad warp after.
     */
    captureFrameCanvas(maxDim = 1800): HTMLCanvasElement {
        if (!this._video) throw new Error('No video element attached');
        const v = this._video;

        if (!v.videoWidth || !v.videoHeight) {
            throw new Error('Video not ready');
        }

        const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.max(1, Math.round(v.videoWidth * scale));
        const h = Math.max(1, Math.round(v.videoHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(v, 0, 0, w, h);

        return canvas;
    }

    private _readyResult(videoEl: HTMLVideoElement, stream: MediaStream): CameraStartResult {
        return {
            stream,
            width: videoEl.videoWidth || 0,
            height: videoEl.videoHeight || 0
        };
    }
}
