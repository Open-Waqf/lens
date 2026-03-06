import type {DocRecord} from '../domain/types';

const KEY = 'sahifah.seenDocs.v1';

// stores: { [docId]: lastSeenUpdatedAt }
let cacheLoaded = false;
let cacheMap: Record<string, number> = {};

function readMapFromStorage(): Record<string, number> {
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

function getMap(): Record<string, number> {
    if (!cacheLoaded) {
        cacheMap = readMapFromStorage();
        cacheLoaded = true;
    }
    return cacheMap;
}

function writeMap(map: Record<string, number>) {
    cacheMap = map;
    cacheLoaded = true;
    try {
        localStorage.setItem(KEY, JSON.stringify(map));
    } catch {
        // ignore
    }
}

export function isDocNew(doc: DocRecord): boolean {
    const map = getMap();
    const seen = map[doc.id];
    if (!seen) return true;
    return doc.updatedAt > seen;
}

export function markDocSeen(docId: string, updatedAt: number): void {
    const map = getMap();
    if (map[docId] === updatedAt) return;
    writeMap({...map, [docId]: updatedAt});
}

export function clearDocSeen(docId: string): void {
    const map = getMap();
    if (map[docId]) {
        const next = {...map};
        delete next[docId];
        writeMap(next);
    }
}

export function pruneSeenDocs(validDocIds: Iterable<string>): void {
    const valid = new Set(validDocIds);
    const map = getMap();
    let changed = false;
    const next: Record<string, number> = {};
    for (const [docId, ts] of Object.entries(map)) {
        if (!valid.has(docId)) {
            changed = true;
            continue;
        }
        next[docId] = ts;
    }
    if (changed) writeMap(next);
}

export function __resetSeenDocsCacheForTests(): void {
    cacheLoaded = false;
    cacheMap = {};
}
