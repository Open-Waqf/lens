import type {DocRecord} from '../domain/types';

const KEY = 'sahifah.seenDocs.v1';

// stores: { [docId]: lastSeenUpdatedAt }

function readMap(): Record<string, number> {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return {};
        const v = JSON.parse(raw);
        if (!v || typeof v !== 'object') return {};
        return v as Record<string, number>;
    } catch {
        return {};
    }
}

function writeMap(map: Record<string, number>) {
    try {
        localStorage.setItem(KEY, JSON.stringify(map));
    } catch {
        // ignore
    }
}

export function isDocNew(doc: DocRecord): boolean {
    const map = readMap();
    const seen = map[doc.id];
    if (!seen) return true;
    return doc.updatedAt > seen;
}

export function markDocSeen(docId: string, updatedAt: number): void {
    const map = readMap();
    map[docId] = updatedAt;
    writeMap(map);
}

export function clearDocSeen(docId: string): void {
    const map = readMap();
    if (map[docId]) {
        delete map[docId];
        writeMap(map);
    }
}
