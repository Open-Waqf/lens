import {nanoid} from 'nanoid';

import type {DocRecord, PageRecord} from '../../domain/types';
import {db} from '../../services/db';
import {getFileStore} from '../../services/filestore';

type Encoded = { bytes: Uint8Array; width: number; height: number };

export class ScanRepo {
    async getDoc(docId: string): Promise<DocRecord | null> {
        return (await db.docs.get(docId)) ?? null;
    }

    async createDoc(title: string): Promise<DocRecord> {
        const id = nanoid();
        const now = Date.now();

        const doc: DocRecord = {
            id,
            title,
            folder: null,
            tags: [],
            createdAt: now,
            updatedAt: now,
            pageIds: []
        };

        await db.docs.add(doc);
        return doc;
    }

    async getPage(pageId: string): Promise<PageRecord | null> {
        return (await db.pages.get(pageId)) ?? null;
    }

    async getPageImageBytes(pageId: string): Promise<Uint8Array | null> {
        const page = await this.getPage(pageId);
        if (!page) return null;
        const store = getFileStore();
        return await store.get(page.imagePath);
    }

    async addNewPage(docId: string, master: Encoded, thumb: Encoded): Promise<string> {
        const store = getFileStore();
        const pageId = nanoid();

        const imagePath = `docs/${docId}/pages/${pageId}.jpg`;
        const thumbPath = `docs/${docId}/thumbs/${pageId}.jpg`;

        await store.put(imagePath, master.bytes, 'image/jpeg');
        await store.put(thumbPath, thumb.bytes, 'image/jpeg');

        const page: PageRecord = {
            id: pageId,
            docId,
            imagePath,
            thumbPath,
            width: master.width,
            height: master.height,
            rotation: 0,
            createdAt: Date.now()
        };

        await db.pages.add(page);

        const doc = await db.docs.get(docId);
        if (!doc) throw new Error('Doc missing');
        doc.pageIds = [...doc.pageIds, pageId];
        doc.updatedAt = Date.now();
        await db.docs.put(doc);

        return pageId;
    }

    async updateExistingPage(pageId: string, master: Encoded, thumb: Encoded): Promise<void> {
        const store = getFileStore();
        const page = await db.pages.get(pageId);
        if (!page) throw new Error('Page missing');

        await store.put(page.imagePath, master.bytes, 'image/jpeg');
        await store.put(page.thumbPath, thumb.bytes, 'image/jpeg');

        await db.pages.put({
            ...page,
            width: master.width,
            height: master.height,
            rotation: 0
        });

        const doc = await db.docs.get(page.docId);
        if (doc) {
            doc.updatedAt = Date.now();
            await db.docs.put(doc);
        }
    }

    async getDocStrip(docId: string, lastN = 16): Promise<{
        title: string;
        pageCount: number;
        items: Array<{ id: string; thumbBytes: Uint8Array }>;
    } | null> {
        const doc = await db.docs.get(docId);
        if (!doc) return null;

        const pageCount = doc.pageIds.length;
        const ids = doc.pageIds.slice(-lastN);

        const pages = await db.pages.where('docId').equals(docId).toArray();
        const pageMap = new Map(pages.map((p) => [p.id, p]));
        const store = getFileStore();

        const items: Array<{ id: string; thumbBytes: Uint8Array }> = [];
        for (const id of ids) {
            const p = pageMap.get(id);
            if (!p) continue;
            const bytes = await store.get(p.thumbPath);
            items.push({id, thumbBytes: bytes});
        }

        return {title: doc.title, pageCount, items};
    }

    async deleteDocCompletely(docId: string): Promise<void> {
        const store = getFileStore();
        const pages = await db.pages.where('docId').equals(docId).toArray();

        for (const p of pages) {
            try {
                await store.del(p.imagePath);
            } catch {
            }
            try {
                await store.del(p.thumbPath);
            } catch {
            }
        }

        await db.pages.where('docId').equals(docId).delete();
        await db.docs.delete(docId);
    }
}