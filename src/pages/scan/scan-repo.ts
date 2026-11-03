import {nanoid} from 'nanoid';

import type {DocRecord, PageRecord} from '../../domain/types';
import type {PageEditorSaveDetail} from '../../components/page-editor';

import {db} from '../../services/db';
import {getFileStore} from '../../services/filestore';
import {bytesToBlob} from "../../lib/bytes";
import {ocrQueue} from '../../services/ocr-queue';
import {settings} from '../../services/settings';
import {detectImageMime} from '../../lib/image/mime';
import {titleFromText} from '../../lib/auto-title';
import {i18n} from '../../lib/i18n';
import {pageText} from '../../lib/ocr-text';
import type {OcrWord} from '../../domain/types';

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
            autoTitle: true, // renamed from the OCR text later, unless the user renames it
        };

        await db.docs.add(doc);
        return doc;
    }

    async getDocStrip(docId: string, limit = 16): Promise<DocStripInfo | null> {
        const doc = await db.docs.get(docId);
        if (!doc) return null;

        // Pages deleted with Undo still pending are not shown or counted.
        const all = await db.pages.bulkGet(doc.pageIds);
        const visibleIds = doc.pageIds.filter((_, i) => all[i] && !all[i]!.deletedAt);
        const ids = visibleIds.slice(-limit);
        if (ids.length === 0) {
            return {id: doc.id, title: doc.title, pageCount: visibleIds.length, items: []};
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

        return {id: doc.id, title: doc.title, pageCount: visibleIds.length, items};
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
                };

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
                // Left behind: the storage check at start removes orphan files.
            }
            try {
                await store.del(oldPage.thumbPath);
            } catch {
                // Left behind: the storage check at start removes orphan files.
            }

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
        } else {
            // OCR disabled: clear old indexed text immediately and rebuild from current persisted words.
            await this.rebuildDocIndex(docId);
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
            // Left behind: the storage check at start removes orphan files.
        }
        try {
            await store.del(page.thumbPath);
        } catch {
            // Left behind: the storage check at start removes orphan files.
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
                // Left behind: the storage check at start removes orphan files.
            }
            try {
                await store.del(p.thumbPath);
            } catch {
                // Left behind: the storage check at start removes orphan files.
            }
        }
        if (doc?.pdfPath) {
            try {
                await store.del(doc.pdfPath);
            } catch {
                // Left behind: the storage check at start removes orphan files.
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

    /**
     * A document still named by the app takes its name from its first page's text. When
     * another document already has that name (the same letterhead, the same form), the
     * scan's date and time stay in the name, so two shared files never look the same.
     */
    private async titleFromFirstPage(docId: string, pageId: string, words: OcrWord[]): Promise<void> {
        const doc = await db.docs.get(docId);
        if (!doc?.autoTitle || doc.pageIds[0] !== pageId) return;
        let title = titleFromText(pageText(words));
        if (!title) return;
        const taken = await db.docs.where('title').startsWith(title).filter(d => d.id !== docId && !d.deletedAt).count();
        if (taken > 0) {
            const when = new Date(doc.createdAt).toLocaleString(i18n.getLocale(), {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
            title = `${title} · ${when}`;
        }
        if (title !== doc.title) await db.docs.update(docId, {title});
    }

    /** A name for one page from its own text, or null while OCR has not read it yet. */
    async pageTitle(pageId: string): Promise<string | null> {
        const page = await db.pages.get(pageId);
        if (!page || page.ocrStatus !== 'done') return null;
        return titleFromText(pageText(page.words));
    }

    /**
     * Read the pages still marked "pending" that no job is working on: left over when the
     * app was closed during OCR, restored from a backup that had no text yet, or rebuilt
     * from files. One at a time, in the background. Nov 2026 deep dive (C4).
     */
    async resumePendingOcr(): Promise<number> {
        const pending = await db.pages.filter(p => p.ocrStatus === 'pending' && !p.deletedAt && !ocrQueue.isActive(p.id)).toArray();
        let done = 0;
        const store = getFileStore();
        for (const p of pending) {
            if (ocrQueue.isActive(p.id)) continue;
            let bytes: Uint8Array;
            try {
                bytes = await store.get(p.imagePath);
            } catch {
                await db.pages.update(p.id, {ocrStatus: 'error'}); // the file is gone
                continue;
            }
            let {width, height} = p;
            if (!width || !height) {
                // Rebuilt from files: the size is not known yet.
                const bmp = await createImageBitmap(bytesToBlob(bytes, 'image/jpeg'));
                width = bmp.width;
                height = bmp.height;
                bmp.close();
                await db.pages.update(p.id, {width, height});
            }
            const doc = await db.docs.get(p.docId);
            ocrQueue.addJob(p.id, doc?.title || 'Document');
            await this.runBackgroundOcr(p.id, bytes, width, height);
            done++;
        }
        return done;
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
                await this.titleFromFirstPage(p.docId, pageId, words);
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
