import {describe, expect, it} from 'vitest';
import {processPhoto} from '../../src/lib/image/pipeline';

class MockWorker {
    private listeners = new Map<string, Set<(ev: any) => void>>();
    private mode: 'ok' | 'error' | 'messageerror';

    constructor() {
        this.mode = (globalThis as any).__mockWorkerMode || 'ok';
    }

    addEventListener(type: string, cb: (ev: any) => void) {
        const set = this.listeners.get(type) ?? new Set();
        set.add(cb);
        this.listeners.set(type, set);
    }

    removeEventListener(type: string, cb: (ev: any) => void) {
        this.listeners.get(type)?.delete(cb);
    }

    postMessage(data: any) {
        queueMicrotask(() => {
            if (this.mode === 'error') {
                this.emit('error', {message: 'worker exploded'});
                return;
            }
            if (this.mode === 'messageerror') {
                this.emit('messageerror', {});
                return;
            }
            this.emit('message', {
                data: {
                    id: data.id,
                    ok: true,
                    master: {bytes: new Uint8Array([1]), width: 1, height: 1},
                    thumb: {bytes: new Uint8Array([2]), width: 1, height: 1},
                },
            });
        });
    }

    terminate() {
    }

    private emit(type: string, ev: any) {
        const set = this.listeners.get(type);
        if (!set) return;
        for (const cb of set) cb(ev);
    }
}

(globalThis as any).Worker = MockWorker as any;

describe('processPhoto', () => {
    it('rejects when worker emits error', async () => {
        (globalThis as any).__mockWorkerMode = 'error';
        await expect(processPhoto({
            blob: new Blob(['x'], {type: 'image/jpeg'}),
            rotation: 0,
            filter: 'original',
        })).rejects.toThrow('worker exploded');
    });

    it('rejects when worker emits messageerror', async () => {
        (globalThis as any).__mockWorkerMode = 'messageerror';
        await expect(processPhoto({
            blob: new Blob(['x'], {type: 'image/jpeg'}),
            rotation: 0,
            filter: 'original',
        })).rejects.toThrow('Pipeline worker message error');
    });

    it('resolves on normal worker response', async () => {
        (globalThis as any).__mockWorkerMode = 'ok';
        const out = await processPhoto({
            blob: new Blob(['x'], {type: 'image/jpeg'}),
            rotation: 0,
            filter: 'original',
        });
        expect(out.master.width).toBe(1);
        expect(out.thumb.width).toBe(1);
    });
});
