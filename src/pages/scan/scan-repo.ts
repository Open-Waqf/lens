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

        const pages = await db.pages.bulkGet(ids);
        const store = getFileStore();

        const items: DocStripItem[] = [];
        for (let i = 0; i < ids.length; i++) {
            const p = pages[i];
            if (!p) continue;
            try {
                const thumbBytes = await store.get(p.thumbPath);
                items.push({id: p.id, thumbBytes});
            } catch {
                // aggregate even if one thumb is missing
            }
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

        // 1. Prepare Paths
        const imagePath = `docs/${docId}/pages/${pageId}.jpg`;
        const thumbPath = `docs/${docId}/thumbs/${pageId}.jpg`;

        // 2. Write Files OUTSIDE the Transaction (Prevents "Committed Too Early" crash)
        try {
            await store.put(imagePath, master.bytes, 'image/jpeg');
            await store.put(thumbPath, thumb.bytes, 'image/jpeg');
        } catch (e) {
            // If file write fails, we haven't touched DB, so just cleanup and abort.
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

        // 3. Commit to DB
        try {
            await db.transaction('rw', db.docs, db.pages, async () => {
                const doc = await db.docs.get(docId);
                if (!doc) throw new Error('Doc missing');

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
            // 4. Rollback: If DB fails, delete the "Ghost" files
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

        // Get docId without transaction first
        const oldPage = await db.pages.get(pageId);
        if (!oldPage) throw new Error('Page missing');
        const docId = oldPage.docId;

        // Use versioning to avoid overwriting the valid file before DB success
        const version = nanoid(6);
        const newImagePath = `docs/${docId}/pages/${pageId}_${version}.jpg`;
        const newThumbPath = `docs/${docId}/thumbs/${pageId}_${version}.jpg`;

        // 1. Write NEW files (Safe Phase)
        try {
            await store.put(newImagePath, master.bytes, 'image/jpeg');
            await store.put(newThumbPath, thumb.bytes, 'image/jpeg');
        } catch (e) {
            try {
                await store.del(newImagePath);
            } catch {
            }
            try {
                await store.del(newThumbPath);
            } catch {
            }
            throw e;
        }

        try {
            // 2. Update DB (Critical Phase)
            await db.transaction('rw', db.docs, db.pages, async () => {
                const page = await db.pages.get(pageId);
                if (!page) throw new Error('Page missing'); // Was deleted mid-flight

                const doc = await db.docs.get(page.docId);
                if (!doc) throw new Error('Doc missing');

                await db.pages.put({
                    ...page,
                    imagePath: newImagePath, // Point to new version
                    thumbPath: newThumbPath,
                    width: master.width,
                    height: master.height,
                    rotation: 0,
                });

                doc.updatedAt = Date.now();
                await db.docs.put(doc);
            });

            // 3. Cleanup OLD files (Success Phase)
            // If this fails, the Startup GC will eventually catch them.
            try {
                await store.del(oldPage.imagePath);
            } catch {
            }
            try {
                await store.del(oldPage.thumbPath);
            } catch {
            }

        } catch (e) {
            // 4. Rollback: If DB fails, delete the NEW files. Old files remain valid.
            try {
                await store.del(newImagePath);
            } catch {
            }
            try {
                await store.del(newThumbPath);
            } catch {
            }
            throw e;
        }
    }

    async deleteDocCompletely(docId: string): Promise<void> {
        const store = getFileStore();

        // Read paths first
        const [doc, pages] = await Promise.all([
            db.docs.get(docId),
            db.pages.where('docId').equals(docId).toArray(),
        ]);

        // Delete from DB first (Source of Truth)
        await db.transaction('rw', db.docs, db.pages, async () => {
            await db.pages.where('docId').equals(docId).delete();
            await db.docs.delete(docId);
        });

        // Best-effort file cleanup
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