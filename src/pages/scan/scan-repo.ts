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

    /**
     * Returns a lightweight strip for the Scan UI.
     * Important: must be O(limit), not O(total pages).
     */
    async getDocStrip(docId: string, limit = 16): Promise<DocStripInfo | null> {
        const doc = await db.docs.get(docId);
        if (!doc) return null;

        const ids = doc.pageIds.slice(-limit);
        if (ids.length === 0) {
            return {id: doc.id, title: doc.title, pageCount: doc.pageIds.length, items: []};
        }

        // Fetch only the needed page records (primary key lookup).
        const pages = await db.pages.bulkGet(ids);
        const store = getFileStore();

        const items: DocStripItem[] = [];
        for (let i = 0; i < ids.length; i++) {
            const p = pages[i];
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

    async addNewPage(
        docId: string,
        master: PageEditorSaveDetail['master'],
        thumb: PageEditorSaveDetail['thumb'],
    ): Promise<string> {
        const store = getFileStore();
        const pageId = nanoid();

        const imagePath = `docs/${docId}/pages/${pageId}.jpg`;
        const thumbPath = `docs/${docId}/thumbs/${pageId}.jpg`;

        try {
            await db.transaction('rw', db.docs, db.pages, async () => {
                const doc = await db.docs.get(docId);
                if (!doc) throw new Error('Doc missing');

                // NOTE: OPFS writes inside a DB transaction can cause "ghost files"
                // if the DB transaction later fails. We mitigate this with:
                // 1) best-effort rollback on exception (below)
                // 2) startup GC (services/opfs-gc.ts)
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
        } catch (e) {
            // best-effort OPFS cleanup if DB transaction failed
            try {
                await store.del(imagePath);
            } catch {
            }
            try {
                await store.del(thumbPath);
            } catch {
            }
            throw e;
        }

        return pageId;
    }

    async updateExistingPage(
        pageId: string,
        master: PageEditorSaveDetail['master'],
        thumb: PageEditorSaveDetail['thumb'],
    ): Promise<void> {
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

        // Read paths first (so we can delete DB first for consistency)
        const [doc, pages] = await Promise.all([
            db.docs.get(docId),
            db.pages.where('docId').equals(docId).toArray(),
        ]);

        await db.transaction('rw', db.docs, db.pages, async () => {
            await db.pages.where('docId').equals(docId).delete();
            await db.docs.delete(docId);
        });

        // Best-effort delete blobs after DB deletion.
        // Any leftovers are handled by startup OPFS GC.
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
        if (doc?.pdfPath) {
            try {
                await store.del(doc.pdfPath);
            } catch {
            }
        }
    }
}
