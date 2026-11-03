import {db} from './db';
import {ScanRepo} from '../pages/scan/scan-repo';
import {showToast} from '../components/toast-notification';
import {t} from '../lib/i18n';

/** How long Undo stays possible after a delete. */
export const UNDO_MS = 5000;

/** Fired when documents or pages are hidden or come back, so screens reload. */
export const LIBRARY_CHANGED = 'sahifah-library-changed';

let repoInstance: ScanRepo | null = null;
const repo = () => (repoInstance ??= new ScanRepo()); // created on first use, not at import
const timers = new Map<string, number>();

function changed() {
    window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED));
}

/**
 * Delete documents or pages with Undo instead of a question first.
 *
 * They are marked deleted at once (hidden on every screen), and a toast offers Undo for a
 * few seconds. Only then are the files and records removed. If the app is closed before
 * that, purgeDeleted() finishes the job at the next start. Nothing undone is ever lost,
 * nothing deleted ever comes back by itself. Nov 2026, replaces "Are you sure?" dialogs.
 */
export async function deleteWithUndo(kind: 'doc' | 'page', ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const table = kind === 'doc' ? db.docs : db.pages;
    const now = Date.now();
    await db.transaction('rw', table, async () => {
        for (const id of ids) await table.update(id, {deletedAt: now});
    });
    changed();

    const key = `${kind}:${ids.join(',')}:${now}`;
    const message = kind === 'page'
        ? (ids.length === 1 ? t('undo.page_deleted') : t('undo.pages_deleted', {count: ids.length}))
        : (ids.length === 1 ? t('undo.doc_deleted') : t('undo.docs_deleted', {count: ids.length}));
    showToast(message, 'info', UNDO_MS, {
        label: t('undo.undo'),
        run: () => void undo(key, kind, ids),
    });
    timers.set(key, window.setTimeout(() => void purge(key, kind, ids), UNDO_MS));
}

async function undo(key: string, kind: 'doc' | 'page', ids: string[]) {
    window.clearTimeout(timers.get(key));
    timers.delete(key);
    const table = kind === 'doc' ? db.docs : db.pages;
    await db.transaction('rw', table, async () => {
        for (const id of ids) await table.update(id, {deletedAt: undefined});
    });
    changed();
}

async function purge(key: string, kind: 'doc' | 'page', ids: string[]) {
    timers.delete(key);
    for (const id of ids) {
        const rec = kind === 'doc' ? await db.docs.get(id) : await db.pages.get(id);
        if (!rec?.deletedAt) continue; // undone meanwhile
        if (kind === 'doc') await repo().deleteDocCompletely(id);
        else await removePage(id);
    }
    changed();
}

/** Remove a page for good; a document left with no pages goes too. */
async function removePage(pageId: string) {
    const page = await db.pages.get(pageId);
    await repo().deletePage(pageId);
    if (!page) return;
    const doc = await db.docs.get(page.docId);
    if (doc && doc.pageIds.length === 0) await repo().deleteDocCompletely(doc.id);
}

/** At start: finish deletes whose Undo time ended while the app was closed. */
export async function purgeDeleted(): Promise<void> {
    const docs = (await db.docs.toArray()).filter(d => d.deletedAt);
    const pages = (await db.pages.toArray()).filter(p => p.deletedAt);
    for (const d of docs) await repo().deleteDocCompletely(d.id);
    for (const p of pages) if (await db.pages.get(p.id)) await removePage(p.id);
    if (docs.length || pages.length) changed();
}
