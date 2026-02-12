import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {App} from '@capacitor/app';
import {Capacitor} from '@capacitor/core';
import {NativeBiometric} from '@capgo/capacitor-native-biometric'; // FIX: Correct package
import {settings} from "../services/settings";

import '../pages/scan-page';
import '../pages/library-page';
import '../pages/doc-page';
import '../pages/settings-page';
import '../components/auth-lock';
import '../components/toast-notification'

import {ConfirmModal} from '../components/confirm-modal';
import {getPersistenceStatus, type PersistenceStatus} from '../services/storage-persistence';
import {garbageCollectOpfsDocs} from '../services/opfs-gc';
import {AuthService} from '../services/auth-service';
import {resetAllStorage} from '../services/reset-storage';
import {showToast} from "../components/toast-notification";

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
    @state() private _isLoading = true;
    @state() private _isLocked = true;
    private _isPrompting = false;

    createRenderRoot() {
        return this;
    }

    @state() private route: Route = parseHash();
    @state() private fatal: Fatal | null = null;
    @state() private persist: PersistenceStatus | null = null;
    @state() private resetting = false;

    connectedCallback(): void {
        super.connectedCallback();

        // 1. Initial Check
        this._checkAuth();

        // 2. Listen for App Resume
        App.addListener('appStateChange', async (state) => {
            const prefs = await settings.get();
            if (!prefs.requireAuth) return;

            if (state.isActive) {
                if (this._isPrompting) return;
                // APP RESUMED: Check if we are currently unlocked in the service
                const isAuth = await AuthService.isAuthenticated();
                if (!isAuth) {
                    this._isLocked = true;
                    this.requestUpdate();
                    void this._triggerNativeUnlock();
                }
            } else {
                // APP BACKGROUNDED: Immediately reset the service lock
                // so it requires a new scan when the user returns.
                AuthService.lock();
            }
        });

        window.addEventListener('hashchange', this._onHash);
        window.addEventListener('error', this._onGlobalError);
        window.addEventListener('unhandledrejection', this._onUnhandled);

        if (!location.hash) location.hash = '#/library';

        void (async () => {
            if (Capacitor.isNativePlatform()) {
                this.persist = {supported: true, persisted: true, grantedThisCall: false};
                return;
            }
            try {
                this.persist = await getPersistenceStatus();
            } catch {
                this.persist = null;
            }
        })();

        const runGC = async () => {
            try {
                await garbageCollectOpfsDocs();
            } catch {
            }
        };

        const runWarmup = async () => {
            if (location.hash.includes('scan')) return;
            const prefs = await settings.get();
            if (!prefs.enableOcr) return;
            try {
                const {warmupOcr} = await import('../lib/ocr');
                await warmupOcr();
            } catch (e) {
            }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ric = (window as any).requestIdleCallback;
        if (typeof ric === 'function') {
            ric(() => void runGC(), {timeout: 2500});
            ric(() => void runWarmup(), {timeout: 10000});
        } else {
            setTimeout(() => void runGC(), 800);
            setTimeout(() => void runWarmup(), 3000);
        }
    }

    private async _checkAuth() {
        try {
            const isAuth = await AuthService.isAuthenticated();
            this._isLocked = !isAuth;

            if (this._isLocked) {
                void this._triggerNativeUnlock();
            }
        } catch (e) {
            console.error("Auth check failed", e);
            this._isLocked = true;
        } finally {
            this._isLoading = false;
        }
    }

    private async _triggerNativeUnlock() {
        if (!Capacitor.isNativePlatform()) return;

        if (this._isPrompting) return;

        try {
            const result = await NativeBiometric.isAvailable();
            if (!result.isAvailable) return;

            this._isPrompting = true;

            // This calls the system prompt and sets _isUnlocked = true inside the service
            const success = await AuthService.promptAuth();

            if (success) {
                this._isLocked = false;
                this.requestUpdate();
            }
        } catch (e) {
            console.log('Native unlock failed', e);
        } finally {
            // Wait a tiny bit before unlocking the guard to let
            // the Android "resume" events finish firing.
            setTimeout(() => {
                this._isPrompting = false;
            }, 500);
        }
    }

    disconnectedCallback(): void {
        window.removeEventListener('hashchange', this._onHash);
        window.removeEventListener('error', this._onGlobalError);
        window.removeEventListener('unhandledrejection', this._onUnhandled);
        App.removeAllListeners();
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
            showToast('Reset failed: ' + String(e), 'error')
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
            <div class="mb-4 p-3 rounded-xl border border-amber-900 bg-amber-950/40 text-amber-100 flex items-start justify-between gap-3">
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
        if (this._isLoading) {
            return html`
                <div class="fixed inset-0 z-[9999] bg-slate-950 flex flex-col items-center justify-center space-y-8">
                    <div class="w-24 h-24 bg-slate-900 rounded-3xl flex items-center justify-center shadow-2xl shadow-emerald-900/20 animate-pulse">
                        <svg class="w-12 h-12 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        </svg>
                    </div>
                </div>
            `;
        }

        if (this._isLocked) {
            return html`
                <auth-lock @unlocked=${() => {
                    this._isLocked = false;
                    this.requestUpdate();
                }}></auth-lock>`;
        }

        if (this.fatal) return this.renderFatal();

        const r = this.route;
        const showNav = r.name !== 'doc';

        return html`
            <div class="min-h-dvh flex flex-col bg-slate-950">
                <main class="flex-1 w-full max-w-7xl mx-auto px-4 pt-[env(safe-area-inset-top)] pb-28 relative">
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
                ${showNav ? html`
                    <nav class="fixed bottom-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-md border-t border-slate-800 pb-[env(safe-area-inset-bottom)]">
                        <div class="max-w-7xl mx-auto flex items-center justify-around h-16 px-2">
                            <a href="#/library"
                               class="flex flex-col items-center gap-1 w-16 py-1 ${r.name === 'library' ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'} transition-colors">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                                </svg>
                                <span class="text-[10px] font-medium">Library</span>
                            </a>
                            <a id="MainScanBtn" href="#/scan?new=1"
                               class="flex flex-col items-center justify-center -mt-6 p-1 rounded-full bg-slate-950 border-4 border-slate-950 relative group">
                                <div class="w-14 h-14 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/20 group-active:scale-95 transition-transform">
                                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                              d="M12 4v16m8-8H4"></path>
                                    </svg>
                                </div>
                            </a>
                            <a href="#/settings"
                               class="flex flex-col items-center gap-1 w-16 py-1 ${r.name === 'settings' ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'} transition-colors">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                </svg>
                                <span class="text-[10px] font-medium">Settings</span>
                            </a>
                        </div>
                    </nav>
                ` : null}
            </div>
            <toast-notification></toast-notification>
        `;
    }
}