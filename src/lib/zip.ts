import {strToU8, zipSync} from 'fflate';

export function makeZip(files: Record<string, Uint8Array>): Uint8Array {
    return zipSync(files, {level: 6});
}

export function jsonFile(name: string, data: unknown): Record<string, Uint8Array> {
    return {[name]: strToU8(JSON.stringify(data, null, 2))};
}
