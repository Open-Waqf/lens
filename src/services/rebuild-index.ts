import {Capacitor} from '@capacitor/core';
import {Directory, Filesystem} from '@capacitor/filesystem';
import type {DocRecord, PageRecord} from '../domain/types';
import {db} from './db';
import {opfsListFiles} from './filestore/opfs-store';

type PageCandidate = {
    imagePath?: string;
    thumbPath?: string;
};

type DocCandidate = {
    pageByStem: Map<string, PageCandidate>;
    pdfPath?: string;
};

export type RebuildIndexResult = {
    docsRecovered: number;
    pagesRecovered: number;
};

type NativeReaddirResult = Awaited<ReturnType<typeof Filesystem.readdir>>;

async function safeNativeReaddir(path: string): Promise<NativeReaddirResult | null> {
    try {
        return await Filesystem.readdir({
            path,
            directory: Directory.Data
        });
    } catch {
        return null;
    }
}

async function listNativeFilesRecursive(rootPath: string): Promise<string[]> {
    const out: string[] = [];
    const seen = new Set<string>();

    const walk = async (path: string): Promise<void> => {
        if (seen.has(path)) return;
        seen.add(path);

        const listing = await safeNativeReaddir(path);
        if (!listing) return;

        for (const entry of listing.files) {
            const name = entry.name;
            const child = path ? `${path}/${name}` : name;

            if (entry.type === 'directory') {
                await walk(child);
                continue;
            }
            if (entry.type === 'file') {
                out.push(child);
                continue;
            }

            const sub = await safeNativeReaddir(child);
            if (sub) await walk(child);
            else out.push(child);
        }
    };

    await walk(rootPath);
    return out;
}

async function listDocFiles(): Promise<string[]> {
    if (Capacitor.isNativePlatform()) {
        return await listNativeFilesRecursive('docs');
    }
    return await opfsListFiles('docs');
}

function upsertDocCandidate(map: Map<string, DocCandidate>, docId: string): DocCandidate {
    const existing = map.get(docId);
    if (existing) return existing;
    const created: DocCandidate = {pageByStem: new Map()};
    map.set(docId, created);
    return created;
}

function parseCandidates(paths: string[]): Map<string, DocCandidate> {
    const docs = new Map<string, DocCandidate>();

    const pageRe = /^docs\/([^/]+)\/pages\/([^/]+)\.jpg$/i;
    const thumbRe = /^docs\/([^/]+)\/thumbs\/([^/]+)\.jpg$/i;
    const pdfRe = /^docs\/([^/]+)\/.+\.pdf$/i;

    for (const path of paths) {
        const pageMatch = path.match(pageRe);
        if (pageMatch) {
            const doc = upsertDocCandidate(docs, pageMatch[1]);
            const stem = pageMatch[2];
            const candidate = doc.pageByStem.get(stem) ?? {};
            candidate.imagePath = path;
            doc.pageByStem.set(stem, candidate);
            continue;
        }

        const thumbMatch = path.match(thumbRe);
        if (thumbMatch) {
            const doc = upsertDocCandidate(docs, thumbMatch[1]);
            const stem = thumbMatch[2];
            const candidate = doc.pageByStem.get(stem) ?? {};
            candidate.thumbPath = path;
            doc.pageByStem.set(stem, candidate);
            continue;
        }

        const pdfMatch = path.match(pdfRe);
        if (pdfMatch) {
            const doc = upsertDocCandidate(docs, pdfMatch[1]);
            if (!doc.pdfPath) doc.pdfPath = path;
        }
    }

    return docs;
}

export async function rebuildLibraryIndexFromFiles(): Promise<RebuildIndexResult> {
    const paths = await listDocFiles();
    const candidates = parseCandidates(paths);

    const docs: DocRecord[] = [];
    const pages: PageRecord[] = [];
    let seq = 0;

    for (const docId of Array.from(candidates.keys()).sort()) {
        const candidate = candidates.get(docId)!;
        const pageIds: string[] = [];

        for (const stem of Array.from(candidate.pageByStem.keys()).sort()) {
            const pageCandidate = candidate.pageByStem.get(stem)!;
            if (!pageCandidate.imagePath) continue;

            const pageId = `${docId}:${stem}`;
            const createdAt = Date.now() + seq++;

            pages.push({
                id: pageId,
                docId,
                imagePath: pageCandidate.imagePath,
                thumbPath: pageCandidate.thumbPath ?? `docs/${docId}/thumbs/${stem}.jpg`,
                width: 0,
                height: 0,
                rotation: 0,
                createdAt,
                ocrStatus: 'pending',
            });

            pageIds.push(pageId);
        }

        if (pageIds.length === 0) continue;

        const now = Date.now();
        docs.push({
            id: docId,
            title: `Recovered ${docId.slice(0, 8)}`,
            folder: null,
            tags: [],
            createdAt: now,
            updatedAt: now,
            pageIds,
            pdfPath: candidate.pdfPath,
        });
    }

    await db.transaction('rw', db.docs, db.pages, async () => {
        await db.docs.clear();
        await db.pages.clear();
        if (docs.length > 0) await db.docs.bulkPut(docs);
        if (pages.length > 0) await db.pages.bulkPut(pages);
    });

    return {
        docsRecovered: docs.length,
        pagesRecovered: pages.length,
    };
}
