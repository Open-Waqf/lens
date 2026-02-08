import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';

import '../pages/scan-page';
import '../pages/library-page';
import '../pages/doc-page';
import '../pages/settings-page';

import {getPersistenceStatus, type PersistenceStatus} from '../services/storage-persistence';
import {garbageCollectOpfsDocs} from '../services/opfs-gc';
import {resetAllStorage} from '../services/reset-storage';

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

    connectedCallback(): void {
        super.connectedCallback();
        window.addEventListener('hashchange', this._onHash);

        // Global crash catcher
        window.addEventListener('error', this._onGlobalError);
        window.addEventListener('unhandledrejection', this._onUnhandled);

        if (!location.hash) location.hash = '#/library';

        // Storage persistence check
        void (async () => {
            try {
                this.persist = await getPersistenceStatus();
            } catch {
                this.persist = null;
            }
        })();

        // Best-effort OPFS orphan GC
        try {
            const run = async () => {
                try {
                    await garbageCollectOpfsDocs();
                } catch {
                }
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ric: any = (window as any).requestIdleCallback;
            if (typeof ric === 'function') ric(() => void run(), {timeout: 2500});
            else setTimeout(() => void run(), 800);
        } catch {
        }
    }

    disconnectedCallback(): void {
        window.removeEventListener('hashchange', this._onHash);
        window.removeEventListener('error', this._onGlobalError);
        window.removeEventListener('unhandledrejection', this._onUnhandled);
        super.disconnectedCallback();
    }

    protected performUpdate(): void {
        try {
            super.performUpdate();
        } catch (e) {
            const err = e as Error;
            this.fatal = {
                message: err?.message ?? 'Unexpected render error',
                detail: err?.stack ? String(err.stack) : String(e),
            };
        }
    }

    private _onHash = () => {
        this.route = parseHash();
    };

    private _onGlobalError = (ev: Event) => {
        const e = ev as ErrorEvent;
        // Ignore benign ResizeObserver errors
        if (e.message?.includes('ResizeObserver')) return;

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

    private navLink(href: string, label: string, active: boolean) {
        return html`
            <a class=${['px-3 py-2 rounded-lg text-sm', active ? 'bg-slate-800 text-slate-50' : 'text-slate-300 hover:bg-slate-900'].join(' ')}
               href=${href}>
                ${label}
            </a>
        `;
    }

    // UPDATED: Renamed to match the new UI call and added safety check
    private async resetAndReload(): Promise<void> {
        const ok = confirm(
            'Reset storage will erase ALL local documents, pages, and settings on this device.\n\nThis cannot be undone.',
        );
        if (!ok) return;

        this.resetting = true;
        try {
            await resetAllStorage();
            location.reload();
        } catch (e) {
            alert('Reset failed: ' + String(e));
            this.resetting = false;
        }
    }

    // UPDATED: Better Fatal Error UI (Safe Reload)
    private renderFatal() {
        if (!this.fatal) return null;

        return html`
            <div class="fixed inset-0 z-[9999] bg-slate-950 flex flex-col items-center justify-center p-6 text-center space-y-6">
                <div class="p-4 rounded-full bg-red-900/20 text-red-500">
                    <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                    </svg>
                </div>
                <div class="space-y-2">
                    <h1 class="text-xl font-bold text-slate-100">Something went wrong</h1>
                    <p class="text-sm text-slate-400 max-w-xs mx-auto">
                        The application encountered an unexpected error. Your data is likely safe.
                    </p>
                    <div class="text-[10px] text-red-400 bg-black/50 p-4 rounded-lg overflow-x-auto max-w-sm mx-auto text-left whitespace-pre-wrap max-h-48">
                        ${this.fatal.message} ${this.fatal.detail || ''}
                    </div>
                </div>

                <div class="flex flex-col gap-3 w-full max-w-xs">
                    <button class="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                            @click=${() => location.reload()}>
                        Reload Application
                    </button>

                    <div class="relative py-2">
                        <div class="absolute inset-0 flex items-center">
                            <div class="w-full border-t border-slate-800"></div>
                        </div>
                        <div class="relative flex justify-center"><span
                                class="bg-slate-950 px-2 text-xs text-slate-500">If reloading fails</span></div>
                    </div>

                    <button class="w-full py-3 rounded-xl bg-slate-900 border border-red-900/30 text-red-400 hover:bg-red-950/30 text-sm disabled:opacity-50"
                            ?disabled=${this.resetting}
                            @click=${() => this.resetAndReload()}>
                        ${this.resetting ? 'Erasing...' : 'Factory Reset (Erase Data)'}
                    </button>
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
                <a class="shrink-0 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm"
                   href="#/settings">
                    Open Settings
                </a>
            </div>
        `;
    }

    render() {
        // Fatal error takes over everything
        if (this.fatal) return this.renderFatal();

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

                    ${r.name === 'library' ? html`
                        <library-page></library-page>` : null}
                    ${r.name === 'scan' ? html`
                        <scan-page></scan-page>` : null}
                    ${r.name === 'doc' ? html`
                        <doc-page .docId=${r.id}></doc-page>` : null}
                    ${r.name === 'settings' ? html`
                        <settings-page></settings-page>` : null}
                </main>
            </div>
        `;
    }
}