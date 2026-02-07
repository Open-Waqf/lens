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
    }
}

export const db = new SahifahDB();
