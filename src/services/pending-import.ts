let pending: File[] | null = null;

export function setPendingImport(files: File[]) {
    pending = files;
}

export function takePendingImport(): File[] | null {
    const out = pending;
    pending = null;
    return out;
}
