import Dexie, { type Table } from 'dexie';
import type { DocRecord, PageRecord } from '../domain/types';

export class SahifahDB extends Dexie {
    docs!: Table<DocRecord, string>;
    pages!: Table<PageRecord, string>;

    constructor() {
        super('sahifah-lens');
        this.version(1).stores({
            docs: 'id, updatedAt, createdAt, title, *tags, folder',
            pages: 'id, docId, createdAt'
        });
        // v2 (Nov 2026): indexes only, no data change. The start-up purge of deletes and the
        // OCR catch-up find their few records by index instead of loading every page with
        // all its OCR words. Old backups restore unchanged.
        this.version(2).stores({
            docs: 'id, updatedAt, createdAt, title, *tags, folder, deletedAt',
            pages: 'id, docId, createdAt, deletedAt, ocrStatus'
        });
    }
}

export const db = new SahifahDB();
