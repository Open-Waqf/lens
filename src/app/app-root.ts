import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';

import '../pages/scan-page';
import '../pages/library-page';
import '../pages/doc-page';
import '../pages/settings-page';

import {getPersistenceStatus, type PersistenceStatus} from '../services/storage-persistence';
import {db} from '../services/db';

type Route =
    | { name: 'library' }
    | { name: 'scan' }
    | { name: 'doc'; id: string }
    | { name: 'settings' };

function parseHash(): Route {
    const rawHash = location.hash || '#/library';
    const [hashPath] = rawHash.split('?');
    const path = hashPath.replace(/^#/, '');
    const parts = path.split('/').filter(Boolean);

    if (parts[0] === 'scan') return {name: 'scan'};
    if (parts[0] === 'settings') return {name: 'settings'};
    if (parts[0] === 'doc' && parts[1]) return {name: 'doc', id: decodeURIComponent(parts[1])};
    return {name: 'library'};
}

type Fatal = { message: string; detail?: string };

@customElement('app-root')
export class AppRoot extends LitElement {
    createRenderRoot() {
        return this;
    }

    @state() private route: Route = parseHash();
    @state() private fatal: Fatal | null = null;
    @state() private persist: PersistenceStatus | null = null;
    @state() private resetting = false;
    @state() private resetErr: string | null = null;

    connectedCallback(): void {
        super.connectedCallback();
        window.addEventListener('hashchange', this._onHash);

        // Global crash catcher (prevents white screen)
        window.addEventListener('error', this._onGlobalError);
        window.addEventListener('unhandledrejection', this._onUnhandled);

        if (!location.hash) location.hash = '#/library';

        // Storage persistence check (best effort)
        void (async () => {
            try {
                this.persist = await getPersistenceStatus();
            } catch {
                this.persist = null;
            }
        })();
    }

    disconnectedCallback(): void {
        window.removeEventListener('hashchange', this._onHash);
        window.removeEventListener('error', this._onGlobalError);
        window.removeEventListener('unhandledrejection', this._onUnhandled);
        super.disconnectedCallback();
    }

    protected override performUpdate(): void {
        try {
            super.performUpdate();
        } catch (e) {
            const err = e as Error;
            const message = err?.message ?? String(e);
            const detail = err?.stack ? String(err.stack) : undefined;
            console.error('app-root render error', e);
            this.fatal = {message, detail};
            // ensure we re-render with the fallback UI
            this.requestUpdate();
        }
    }

    private _onHash = () => {
        this.route = parseHash();
    };

    private _onGlobalError = (ev: Event) => {
        const e = ev as ErrorEvent;
        const message = e.message || 'Unexpected error';
        const detail = e.error?.stack ? String(e.error.stack) : undefined;
        this.fatal = {message, detail};
    };

    private _onUnhandled = (ev: PromiseRejectionEvent) => {
        const reason = ev.reason;
        const message = (reason as Error)?.message ?? String(reason ?? 'Unhandled rejection');
        const detail = (reason as Error)?.stack ? String((reason as Error).stack) : undefined;
        this.fatal = {message, detail};
    };

    private async resetStorage(): Promise<void> {
        if (this.resetting) return;

        const ok = confirm(
            'Reset storage will delete ALL documents stored on this device (Dexie + OPFS) and clear Sahifah Lens settings. Continue?',
        );
        if (!ok) return;

        this.resetting = true;
        this.resetErr = null;

        try {
            // 1) IndexedDB (Dexie)
            try {
                db.close();
                await db.delete();
            } catch (e) {
                console.warn('Failed to delete IndexedDB', e);
            }

            // 2) OPFS (best effort)
            try {
                await this.wipeOPFSRoot();
            } catch (e) {
                console.warn('Failed to wipe OPFS', e);
            }

            // 3) local/session storage (only our keys)
            this.clearAppStorageKeys();

            // 4) Cache Storage (best effort)
            try {
                if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map((k) => caches.delete(k)));
                }
            } catch {
                // ignore
            }

            // Back to a known-good route + reload
            location.hash = '#/library';
            location.reload();
        } catch (e) {
            this.resetErr = (e as Error)?.message ?? String(e);
        } finally {
            this.resetting = false;
        }
    }

    private clearAppStorageKeys(): void {
        const clearPrefix = (s: Storage, prefix: string) => {
            try {
                for (let i = s.length - 1; i >= 0; i--) {
                    const k = s.key(i);
                    if (k && k.startsWith(prefix)) s.removeItem(k);
                }
            } catch {
                // ignore
            }
        };

        clearPrefix(localStorage, 'sahifah.');
        clearPrefix(sessionStorage, 'sahifah.');
    }

    private async wipeOPFSRoot(): Promise<void> {
        const getDir = (navigator.storage as any)?.getDirectory;
        if (!getDir) return; // OPFS not supported

        const root = (await getDir.call(navigator.storage)) as FileSystemDirectoryHandle;

        // Iterate and delete everything under OPFS root.
        // Use `any` to avoid TS lib differences across environments.
        for await (const entry of (root as any).entries()) {
            const name = entry?.[0] as string | undefined;
            if (!name) continue;
            await root.removeEntry(name, {recursive: true} as any);
        }
    }

    private navLink(href: string, label: string, active: boolean) {
        return html`
            <a
                    class=${[
                        'px-3 py-2 rounded-lg text-sm',
                        active ? 'bg-slate-800 text-slate-50' : 'text-slate-300 hover:bg-slate-900',
                    ].join(' ')}
                    href=${href}
            >
                ${label}
            </a>
        `;
    }

    private renderFatal() {
        if (!this.fatal) return null;

        return html`
            <div class="p-4 rounded-xl border border-red-900 bg-red-950/40 text-red-200 space-y-3">
                <div class="font-semibold">Something went wrong</div>
                <div class="text-sm">${this.fatal.message}</div>

                ${this.fatal.detail
                        ? html`
                            <pre class="text-xs overflow-auto max-h-56 p-3 rounded-lg bg-black/40 border border-red-900/40">${this.fatal.detail}</pre>`
                        : null}

                ${this.resetErr
                        ? html`
                            <div class="text-sm text-red-100">Reset failed: ${this.resetErr}</div>`
                        : null}

                <div class="flex flex-wrap gap-2">
                    <button
                            class="px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 disabled:opacity-60"
                            ?disabled=${this.resetting}
                            @click=${() => {
                                this.fatal = null;
                                location.hash = '#/library';
                            }}
                    >
                        Go to Library
                    </button>

                    <button
                            class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold disabled:opacity-60"
                            ?disabled=${this.resetting}
                            @click=${() => location.reload()}
                    >
                        Reload
                    </button>

                    <button
                            class="px-4 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-slate-50 font-semibold disabled:opacity-60"
                            ?disabled=${this.resetting}
                            @click=${() => void this.resetStorage()}
                    >
                        ${this.resetting ? 'Resetting…' : 'Reset storage'}
                    </button>
                </div>

                <div class="text-xs text-red-200/80">
                    Reset storage removes all local documents and app state on this device. Exported backups (.slbk)
                    are not affected.
                </div>
            </div>
        `;
    }

    private renderPersistenceBanner() {
        const p = this.persist;
        if (!p || !p.supported) return null;
        if (p.persisted) return null;

        return html`
            <div class="p-3 rounded-xl border border-amber-900 bg-amber-950/40 text-amber-100 flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-sm font-medium">Storage is not persistent</div>
                    <div class="text-xs text-amber-200/80">
                        On iOS / low-storage devices, the OS may clear browser storage. Export an encrypted backup to
                        stay safe.
                    </div>
                </div>
                <a
                        class="shrink-0 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm"
                        href="#/settings"
                >
                    Open Settings
                </a>
            </div>
        `;
    }

    render() {
        const r = this.route;
        const active = (name: Route['name']) => r.name === name;

        return html`
            <div class="min-h-dvh flex flex-col">
                <header class="sticky top-0 z-10 bg-slate-950/80 backdrop-blur border-b border-slate-800">
                    <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
                        <div class="font-semibold tracking-tight">Sahifah Lens</div>
                        <nav class="flex gap-2">
                            ${this.navLink('#/library', 'Library', active('library'))}
                            ${this.navLink('#/scan?new=1', 'Scan', active('scan'))}
                            ${this.navLink('#/settings', 'Settings', active('settings'))}
                        </nav>
                    </div>
                </header>

                <main class="flex-1 max-w-3xl mx-auto w-full px-4 py-4 space-y-3">
                    ${this.renderPersistenceBanner()}
                    ${this.renderFatal()}

                    ${!this.fatal
                            ? html`
                                ${r.name === 'library' ? html`
                                    <library-page></library-page>` : null}
                                ${r.name === 'scan' ? html`
                                    <scan-page></scan-page>` : null}
                                ${r.name === 'doc' ? html`
                                    <doc-page .docId=${r.id}></doc-page>` : null}
                                ${r.name === 'settings' ? html`
                                    <settings-page></settings-page>` : null}
                            `
                            : null}
                </main>
            </div>
        `;
    }
}