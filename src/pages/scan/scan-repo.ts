import {nanoid} from 'nanoid';

import type {DocRecord, PageRecord} from '../../domain/types';
import type {PageEditorSaveDetail} from '../../components/page-editor';

import {db} from '../../services/db';
import {getFileStore} from '../../services/filestore';

export type DocStripItem = { id: string; thumbBytes: Uint8Array };

export type DocStripInfo = {
    id: string;
    title: string;
    pageCount: number;
    items: DocStripItem[];
};

export class ScanRepo {
    async getDoc(docId: string): Promise<DocRecord | undefined> {
        return await db.docs.get(docId);
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
            pageIds: [],
        } as any;

        await db.docs.add(doc);
        return doc;
    }

    async getDocStrip(docId: string, limit = 16): Promise<DocStripInfo | null> {
        const doc = await db.docs.get(docId);
        if (!doc) return null;

        const ids = doc.pageIds.slice(-limit);
        if (ids.length === 0) {
            return {id: doc.id, title: doc.title, pageCount: doc.pageIds.length, items: []};
        }

        // Fetch all pages for doc and map by id
        const pages = await db.pages.where('docId').equals(docId).toArray();
        const pageMap = new Map(pages.map((p) => [p.id, p]));
        const store = getFileStore();

        const items: DocStripItem[] = [];
        for (const id of ids) {
            const p = pageMap.get(id);
            if (!p) continue;
            const thumbBytes = await store.get(p.thumbPath);
            items.push({id: p.id, thumbBytes});
        }

        return {id: doc.id, title: doc.title, pageCount: doc.pageIds.length, items};
    }

    async getPageImageBytes(pageId: string): Promise<Uint8Array | null> {
        const page = await db.pages.get(pageId);
        if (!page) return null;

        const store = getFileStore();
        return await store.get(page.imagePath);
    }

    async addNewPage(docId: string, master: PageEditorSaveDetail['master'], thumb: PageEditorSaveDetail['thumb']): Promise<string> {
        const store = getFileStore();
        const pageId = nanoid();

        const imagePath = `docs/${docId}/pages/${pageId}.jpg`;
        const thumbPath = `docs/${docId}/thumbs/${pageId}.jpg`;

        await db.transaction('rw', db.docs, db.pages, async () => {
            const doc = await db.docs.get(docId);
            if (!doc) throw new Error('Doc missing');

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
                createdAt: Date.now(),
            } as any;

            await db.pages.add(page);

            doc.pageIds = [...doc.pageIds, pageId];
            doc.updatedAt = Date.now();
            await db.docs.put(doc);
        });

        return pageId;
    }

    async updateExistingPage(pageId: string, master: PageEditorSaveDetail['master'], thumb: PageEditorSaveDetail['thumb']): Promise<void> {
        const store = getFileStore();

        await db.transaction('rw', db.docs, db.pages, async () => {
            const page = await db.pages.get(pageId);
            if (!page) throw new Error('Page missing');

            const doc = await db.docs.get(page.docId);
            if (!doc) throw new Error('Doc missing');

            await store.put(page.imagePath, master.bytes, 'image/jpeg');
            await store.put(page.thumbPath, thumb.bytes, 'image/jpeg');

            await db.pages.put({
                ...page,
                width: master.width,
                height: master.height,
                rotation: 0,
            });

            doc.updatedAt = Date.now();
            await db.docs.put(doc);
        });
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

        await db.transaction('rw', db.docs, db.pages, async () => {
            await db.pages.where('docId').equals(docId).delete();
            await db.docs.delete(docId);
        });
    }
}