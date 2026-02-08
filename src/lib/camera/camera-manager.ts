export type CameraStartResult = {
    stream: MediaStream;
    width: number;
    height: number;
};

export class CameraManager {
    private _stream: MediaStream | null = null;

    get isRunning(): boolean {
        return !!this._stream;
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
                    width: {ideal: 1280},
                    height: {ideal: 720},
                },
            },
            {audio: false, video: {facingMode: 'environment'}},
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
        stopStream(this._stream);
        this._stream = null;
    }
}

function stopStream(stream: MediaStream) {
    for (const t of stream.getTracks()) {
        try {
            t.stop();
        } catch {
        }
    }
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