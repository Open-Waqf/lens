import type {FilterMode} from '../../domain/types';
import type {WorkerRequest, WorkerResponse} from './worker';
import {nanoid} from 'nanoid';

const worker = new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'});

export type Rotation = 0 | 90 | 180 | 270;

export async function processPhoto(opts: {
    blob: Blob;
    crop?: { x: number; y: number; w: number; h: number };
    rotation: Rotation;
    filter: FilterMode;
}): Promise<{
    master: { bytes: Uint8Array; width: number; height: number };
    thumb: { bytes: Uint8Array; width: number; height: number };
}> {
    const id = nanoid();
    const req: WorkerRequest = {
        id,
        blob: opts.blob,
        crop: opts.crop,
        rotation: opts.rotation,
        filter: opts.filter,
        masterJpegQuality: 0.82,
        thumbMax: 360
    };

    return await new Promise((resolve, reject) => {
        const onMsg = (ev: MessageEvent<WorkerResponse>) => {
            if (ev.data.id !== id) return;
            worker.removeEventListener('message', onMsg);
            if (!ev.data.ok) reject(new Error(ev.data.error));
            else resolve({master: ev.data.master, thumb: ev.data.thumb});
        };
        worker.addEventListener('message', onMsg);
        worker.postMessage(req);
    });
}
