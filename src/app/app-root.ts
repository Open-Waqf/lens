import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';

import '../pages/scan-page';
import '../pages/library-page';
import '../pages/doc-page';
import '../pages/settings-page';
import '../components/auth-lock';

import {ConfirmModal} from '../components/confirm-modal';
import {getPersistenceStatus, type PersistenceStatus} from '../services/storage-persistence';
import {garbageCollectOpfsDocs} from '../services/opfs-gc';
import {AuthService} from '../services/auth-service';
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
    // 1. Add Loading State (True by default)
    @state() private _isLoading = true;
    @state() private _isLocked = true;

    createRenderRoot() {
        return this;
    }

    @state() private route: Route = parseHash();
    @state() private fatal: Fatal | null = null;
    @state() private persist: PersistenceStatus | null = null;
    @state() private resetting = false;

    connectedCallback(): void {
        super.connectedCallback();
        // Start the check immediately
        this._checkAuth();

        window.addEventListener('hashchange', this._onHash);
        window.addEventListener('error', this._onGlobalError);
        window.addEventListener('unhandledrejection', this._onUnhandled);

        if (!location.hash) location.hash = '#/library';

        // 1. Check Persistence (Immediate)
        void (async () => {
            try {
                this.persist = await getPersistenceStatus();
            } catch {
                this.persist = null;
            }
        })();

        // 2. Define Background Tasks
        const runGC = async () => {
            try {
                await garbageCollectOpfsDocs();
            } catch {
            }
        };

        const runWarmup = async () => {
            // Don't warm up if the user is already on the scan page (priority conflict)
            if (location.hash.includes('scan')) return;

            try {
                // Dynamically import OCR to avoid loading 1.5MB immediately
                const {warmupOcr} = await import('../lib/ocr');
                console.log('App: Warming up OCR engine in background...');
                await warmupOcr();
            } catch (e) {
                // Ignore warmup errors (offline, etc)
            }
        };

        // 3. Schedule Tasks when Browser is Idle
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ric = (window as any).requestIdleCallback;

        if (typeof ric === 'function') {
            // GC runs first (cleanup)
            ric(() => void runGC(), {timeout: 2500});
            // OCR runs later (network heavy)
            ric(() => void runWarmup(), {timeout: 10000});
        } else {
            // Fallback for browsers without requestIdleCallback
            setTimeout(() => void runGC(), 800);
            setTimeout(() => void runWarmup(), 3000);
        }
    }

    private async _checkAuth() {
        try {
            // 2. Wait for the check to complete
            const isAuth = await AuthService.isAuthenticated();
            this._isLocked = !isAuth;
        } catch (e) {
            console.error("Auth check failed", e);
            this._isLocked = false; // Fail open or closed depending on preference (Open is safer for UX bugs)
        } finally {
            // 3. Stop loading only after we know the status
            this._isLoading = false;
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
            this.fatal = {message: err?.message ?? 'Render error', detail: err?.stack};
        }
    }

    private _onHash = () => {
        this.route = parseHash();
    };

    private _onGlobalError = (ev: Event) => {
        const e = ev as ErrorEvent;
        if (e.message?.includes('ResizeObserver')) return;
        this.fatal = {message: e.message || 'Error', detail: e.error?.stack};
    };

    private _onUnhandled = (ev: PromiseRejectionEvent) => {
        const reason = ev.reason;
        this.fatal = {
            message: (reason as Error)?.message ?? String(reason),
            detail: (reason as Error)?.stack
        };
    };

    private navLink(href: string, label: string, active: boolean) {
        return html`
            <a class=${['px-3 py-2 rounded-lg text-sm', active ? 'bg-slate-800 text-slate-50' : 'text-slate-300 hover:bg-slate-900'].join(' ')}
               href=${href}>
                ${label}
            </a>
        `;
    }

    private async resetAndReload(): Promise<void> {
        const ok = await ConfirmModal.ask({
            title: 'Factory Reset?',
            description: 'This will erase ALL local documents and settings.\nCannot be undone.',
            confirm: 'Reset Everything',
            destructive: true
        });

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
                    <div class="text-[10px] text-red-400 bg-black/50 p-4 rounded-lg overflow-x-auto max-w-sm mx-auto text-left whitespace-pre-wrap max-h-48">
                        ${this.fatal.message} ${this.fatal.detail || ''}
                    </div>
                </div>
                <button class="w-full max-w-xs py-3 rounded-xl bg-emerald-600 text-white font-bold"
                        @click=${() => location.reload()}>Reload
                </button>
                <button class="w-full max-w-xs py-3 rounded-xl bg-slate-900 text-red-400 text-sm"
                        ?disabled=${this.resetting} @click=${() => this.resetAndReload()}>
                    ${this.resetting ? 'Erasing...' : 'Factory Reset'}
                </button>
            </div>
        `;
    }

    private renderPersistenceBanner() {
        const p = this.persist;
        if (!p || !p.supported || p.persisted) return null;
        return html`
            <div class="p-3 rounded-xl border border-amber-900 bg-amber-950/40 text-amber-100 flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-sm font-medium">Storage is not persistent</div>
                    <div class="text-xs text-amber-200/80">OS may clear storage. Export backup to be safe.</div>
                </div>
                <a class="shrink-0 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-sm"
                   href="#/settings">Settings</a>
            </div>
        `;
    }

    render() {
        // 4. Render NOTHING (or a spinner) while loading.
        // This prevents <auth-lock> from ever being created if disabled.
        if (this._isLoading) {
            return html`
                <div class="fixed inset-0 bg-slate-950 z-[9999]"></div>`;
        }

        if (this._isLocked) {
            return html`
                <auth-lock @unlocked=${() => this._isLocked = false}></auth-lock>`;
        }

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