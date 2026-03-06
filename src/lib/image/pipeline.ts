import {nanoid} from 'nanoid';
import type {FilterMode} from '../../domain/types';
import type {Rotation, WorkerResponse} from './worker';

export type PipelineInput = {
    blob: Blob;
    rotation: Rotation;
    filter: FilterMode;
    masterJpegQuality?: number;
    thumbMax?: number;
    thumbJpegQuality?: number;
};

export type PipelineOutput = {
    master: { bytes: Uint8Array; width: number; height: number };
    thumb: { bytes: Uint8Array; width: number; height: number };
};

export function processPhoto(opts: PipelineInput): Promise<PipelineOutput> {
    return new Promise((resolve, reject) => {
        const id = nanoid();
        const worker = new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});
        let settled = false;

        const cleanup = () => {
            worker.removeEventListener('message', onMsg);
            worker.removeEventListener('error', onErr);
            worker.removeEventListener('messageerror', onMessageErr);
            worker.terminate();
        };

        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };

        const onErr = (ev: ErrorEvent) => {
            fail(new Error(ev.message || 'Pipeline worker crashed'));
        };

        const onMessageErr = () => {
            fail(new Error('Pipeline worker message error'));
        };

        const onMsg = (ev: MessageEvent<WorkerResponse>) => {
            if (ev.data.id !== id) return;
            if (settled) return;
            settled = true;
            cleanup();
            if (!ev.data.ok) reject(new Error(ev.data.error));
            else {
                // Fix: Ensure master/thumb exist before resolving
                if (!ev.data.master || !ev.data.thumb) {
                    reject(new Error('Pipeline failed: missing output'));
                } else {
                    resolve({
                        master: ev.data.master,
                        thumb: ev.data.thumb
                    });
                }
            }
        };

        worker.addEventListener('message', onMsg);
        worker.addEventListener('error', onErr);
        worker.addEventListener('messageerror', onMessageErr);
        worker.postMessage({
            id,
            blob: opts.blob,
            rotation: opts.rotation,
            filter: opts.filter,
            masterJpegQuality: opts.masterJpegQuality ?? 0.82,
            thumbMax: opts.thumbMax ?? 800,
            thumbJpegQuality: opts.thumbJpegQuality ?? 0.82,
        });
    });
}
