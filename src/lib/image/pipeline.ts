import {nanoid} from 'nanoid';
import type {FilterMode} from '../../domain/types';
import type {Rotation, WorkerResponse} from './worker';

export type PipelineInput = {
    blob: Blob;
    rotation: Rotation;
    filter: FilterMode;
    masterJpegQuality?: number;
};

export type PipelineOutput = {
    master: { bytes: Uint8Array; width: number; height: number };
    thumb: { bytes: Uint8Array; width: number; height: number };
};

export function processPhoto(opts: PipelineInput): Promise<PipelineOutput> {
    return new Promise((resolve, reject) => {
        const id = nanoid();
        const worker = new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});

        const onMsg = (ev: MessageEvent<WorkerResponse>) => {
            if (ev.data.id !== id) return;
            worker.terminate();
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
        worker.postMessage({
            id,
            blob: opts.blob,
            rotation: opts.rotation,
            filter: opts.filter,
            masterJpegQuality: opts.masterJpegQuality ?? 0.82,
            thumbMax: 360,
        });
    });
}
