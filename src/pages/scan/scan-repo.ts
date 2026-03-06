import {nanoid} from 'nanoid';

import type {DocRecord, PageRecord} from '../../domain/types';
import type {PageEditorSaveDetail} from '../../components/page-editor';

import {db} from '../../services/db';
import {getFileStore} from '../../services/filestore';
import {bytesToBlob} from "../../lib/bytes";
import {ocrQueue} from '../../services/ocr-queue';
import {settings} from '../../services/settings';
import {markStorageCleanupPending} from '../../services/storage-cleanup-flag';
import {detectImageMime} from '../../lib/image/mime';

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
        doOcr: boolean = true
    ): Promise<string> {
        const store = getFileStore();
        const pageId = nanoid();

        // 1. Prepare Paths
        const imagePath = `docs/${docId}/pages/${pageId}.jpg`;
        const thumbPath = `docs/${docId}/thumbs/${pageId}.jpg`;

        // 2. Write Files OUTSIDE the Transaction
        try {
            await store.put(imagePath, master.bytes, 'image/jpeg');
            await store.put(thumbPath, thumb.bytes, detectImageMime(thumb.bytes));
        } catch (e) {
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
                    ocrStatus: 'pending', // Mark as needing OCR
                } as any;

                await db.pages.add(page);

                doc.pageIds = [...doc.pageIds, pageId];
                doc.updatedAt = Date.now();
                await db.docs.put(doc);
            });
        } catch (e) {
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

        if (doOcr) {
            const doc = await db.docs.get(docId);
            ocrQueue.addJob(pageId, doc?.title || 'Document');
            this.runBackgroundOcr(pageId, master.bytes, master.width, master.height);
        }

        return pageId;
    }

    async getAllFolders(): Promise<string[]> {
        const docs = await db.docs.toArray();
        const folders = docs.map(d => d.folder).filter((f): f is string => !!f);
        return Array.from(new Set(folders)).sort();
    }

    async getAllTags(): Promise<string[]> {
        const docs = await db.docs.toArray();
        const tags = docs.flatMap(d => d.tags);
        return Array.from(new Set(tags)).sort();
    }

    async deleteFolder(folderName: string): Promise<void> {
        await db.transaction('rw', db.docs, async () => {
            await db.docs.where('folder').equals(folderName).modify({
                folder: null,
                updatedAt: Date.now()
            });
        });
    }

    async updateExistingPage(
        pageId: string,
        master: PageEditorSaveDetail['master'],
        thumb: PageEditorSaveDetail['thumb'],
        doOcr: boolean = true
    ): Promise<void> {
        const store = getFileStore();

        const oldPage = await db.pages.get(pageId);
        if (!oldPage) throw new Error('Page missing');
        const docId = oldPage.docId;

        const version = nanoid(6);
        const newImagePath = `docs/${docId}/pages/${pageId}_${version}.jpg`;
        const newThumbPath = `docs/${docId}/thumbs/${pageId}_${version}.jpg`;

        try {
            await store.put(newImagePath, master.bytes, 'image/jpeg');
            await store.put(newThumbPath, thumb.bytes, detectImageMime(thumb.bytes));
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
            await db.transaction('rw', db.docs, db.pages, async () => {
                const page = await db.pages.get(pageId);
                if (!page) throw new Error('Page missing');

                const doc = await db.docs.get(page.docId);
                if (!doc) throw new Error('Doc missing');

                await db.pages.put({
                    ...page,
                    imagePath: newImagePath,
                    thumbPath: newThumbPath,
                    width: master.width,
                    height: master.height,
                    rotation: 0,
                    ocrStatus: 'pending', // Reset OCR status on edit
                    words: [], // Clear old words immediately so search doesn't match old text
                });

                doc.updatedAt = Date.now();
                await db.docs.put(doc);
            });

            // Clean up old files
            try {
                await store.del(oldPage.imagePath);
            } catch {
                markStorageCleanupPending();
            }
            try {
                await store.del(oldPage.thumbPath);
            } catch {
                markStorageCleanupPending();
            }

            // Since we cleared words, we should rebuild index immediately to remove old text
            await this.rebuildDocIndex(docId);

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

        if (doOcr) {
            const doc = await db.docs.get(docId);
            ocrQueue.addJob(pageId, doc?.title || 'Document');
            this.runBackgroundOcr(pageId, master.bytes, master.width, master.height);
        }
    }

    async deletePage(pageId: string): Promise<void> {
        const page = await db.pages.get(pageId);
        if (!page) return;
        const {docId} = page;

        const store = getFileStore();

        // 1. DB Updates
        await db.transaction('rw', db.docs, db.pages, async () => {
            await db.pages.delete(pageId);
            const doc = await db.docs.get(docId);
            if (doc) {
                doc.pageIds = doc.pageIds.filter(id => id !== pageId);
                doc.updatedAt = Date.now();
                await db.docs.put(doc);
            }
        });

        // 2. File Cleanup
        try {
            await store.del(page.imagePath);
        } catch {
            markStorageCleanupPending();
        }
        try {
            await store.del(page.thumbPath);
        } catch {
            markStorageCleanupPending();
        }

        // 3. Rebuild Index (Removes text of deleted page)
        await this.rebuildDocIndex(docId);
    }

    async deleteDocCompletely(docId: string): Promise<void> {
        const store = getFileStore();
        const [doc, pages] = await Promise.all([
            db.docs.get(docId),
            db.pages.where('docId').equals(docId).toArray(),
        ]);

        await db.transaction('rw', db.docs, db.pages, async () => {
            await db.pages.where('docId').equals(docId).delete();
            await db.docs.delete(docId);
        });

        for (const p of pages) {
            try {
                await store.del(p.imagePath);
            } catch {
                markStorageCleanupPending();
            }
            try {
                await store.del(p.thumbPath);
            } catch {
                markStorageCleanupPending();
            }
        }
        if (doc?.pdfPath) {
            try {
                await store.del(doc.pdfPath);
            } catch {
                markStorageCleanupPending();
            }
        }
    }

    /**
     * CRITICAL FIX: Rebuilds the search index from scratch using all current pages.
     * This prevents "ghost text" from lingering after edits/deletes.
     */
    private async rebuildDocIndex(docId: string): Promise<void> {
        const pages = await db.pages.where('docId').equals(docId).toArray();
        // Sort by their order in the doc if needed, but for search 'bag of words' is fine.
        // If we want exact phrase search, we should respect doc.pageIds order.

        const fullText = pages
            .map(p => p.words?.map(w => w.text).join(' ') ?? '')
            .join(' ')
            .trim();

        await db.docs.update(docId, {searchIndex: fullText});
    }

    async mergeDocuments(docIds: string[]): Promise<string> {
        if (docIds.length < 2) return docIds[0];

        const [targetId, ...others] = docIds;
        const targetDoc = await db.docs.get(targetId);
        if (!targetDoc) throw new Error("Target document not found");

        const store = getFileStore();
        type MovePlan = {
            pageId: string;
            oldImagePath: string;
            oldThumbPath: string;
            newImagePath: string;
            newThumbPath: string;
            imageBytes: Uint8Array;
            thumbBytes: Uint8Array;
            imageMime: string;
            thumbMime: string;
        };

        const moves: MovePlan[] = [];
        const otherDocs: DocRecord[] = [];
        const combinedPageIds = [...targetDoc.pageIds];
        for (const otherId of others) {
            const otherDoc = await db.docs.get(otherId);
            if (!otherDoc) continue;
            otherDocs.push(otherDoc);
            combinedPageIds.push(...otherDoc.pageIds);

            const pages = await db.pages.where('docId').equals(otherId).toArray();
            for (const page of pages) {
                const imageBytes = await store.get(page.imagePath);
                const thumbBytes = await store.get(page.thumbPath);
                const imageExt = pathExt(page.imagePath, '.jpg');
                const thumbExt = pathExt(page.thumbPath, '.jpg');
                moves.push({
                    pageId: page.id,
                    oldImagePath: page.imagePath,
                    oldThumbPath: page.thumbPath,
                    newImagePath: `docs/${targetId}/pages/${page.id}${imageExt}`,
                    newThumbPath: `docs/${targetId}/thumbs/${page.id}${thumbExt}`,
                    imageBytes,
                    thumbBytes,
                    imageMime: detectImageMime(imageBytes),
                    thumbMime: detectImageMime(thumbBytes),
                });
            }
        }

        const createdPaths: string[] = [];
        try {
            for (const move of moves) {
                await store.put(move.newImagePath, move.imageBytes, move.imageMime);
                createdPaths.push(move.newImagePath);
                await store.put(move.newThumbPath, move.thumbBytes, move.thumbMime);
                createdPaths.push(move.newThumbPath);
            }

            await db.transaction('rw', [db.docs, db.pages], async () => {
                for (const move of moves) {
                    await db.pages.update(move.pageId, {
                        docId: targetId,
                        imagePath: move.newImagePath,
                        thumbPath: move.newThumbPath,
                    });
                }

                for (const otherDoc of otherDocs) {
                    await db.docs.delete(otherDoc.id);
                }

                await db.docs.update(targetId, {
                    pageIds: combinedPageIds,
                    updatedAt: Date.now()
                });
            });
        } catch (e) {
            for (const path of createdPaths) {
                try {
                    await store.del(path);
                } catch {
                    markStorageCleanupPending();
                }
            }
            throw e;
        }

        for (const move of moves) {
            try {
                await store.del(move.oldImagePath);
            } catch {
                markStorageCleanupPending();
            }
            try {
                await store.del(move.oldThumbPath);
            } catch {
                markStorageCleanupPending();
            }
        }

        await this.rebuildDocIndex(targetId);

        return targetId;
    }

    private async runBackgroundOcr(pageId: string, bytes: Uint8Array, w: number, h: number) {
        try {
            const blob = bytesToBlob(bytes, 'image/jpeg');

            const {recognizeText} = await import('../../lib/ocr');
            const prefs = await settings.get();
            const ocrLang = prefs.ocrLang || 'ara+eng';

            // 1. Run Intelligence
            const words = await recognizeText(blob, w, h, ocrLang);

            // 2. Commit to Memory (DB)
            await db.transaction('rw', db.pages, db.docs, async () => {
                const p = await db.pages.get(pageId);
                if (!p) return;

                if (p.ocrStatus === 'pending') {
                    // Update Page
                    await db.pages.update(pageId, {
                        words,
                        ocrStatus: 'done'
                    });
                }
            });

            // 3. Rebuild Index (Cleanest way to handle the new text)
            // We fetch the latest state of all pages and update the doc.
            // We do this OUTSIDE the transaction above to keep it short,
            // and because rebuildDocIndex starts its own transaction.
            const p = await db.pages.get(pageId);
            if (p) {
                await this.rebuildDocIndex(p.docId);
            }

            ocrQueue.completeJob(pageId, true);
        } catch (e) {
            console.error('Background OCR failed', e);
            try {
                await db.pages.update(pageId, {ocrStatus: 'error'});
            } catch {
            }
            ocrQueue.completeJob(pageId, false);
        }
    }
}

function pathExt(path: string, fallback: string): string {
    const dot = path.lastIndexOf('.');
    if (dot <= -1 || dot < path.lastIndexOf('/')) return fallback;
    return path.slice(dot);
}
