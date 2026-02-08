import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {keyed} from 'lit/directives/keyed.js';

import '../pages/scan-page';
import '../pages/library-page';
import '../pages/doc-page';
import '../pages/settings-page';

type Route =
    | { name: 'library' }
    | { name: 'scan' }
    | { name: 'doc'; id: string }
    | { name: 'settings' };

type FatalErrorState = {
    message: string;
    stack?: string;
    source: 'app-root' | 'window.error' | 'unhandledrejection';
    when: number;
    routeAtCrash: string;
};

// Supports hashes like:
//  - #/scan
//  - #/scan?new=1
//  - #/doc/ABC123
function parseHash(): Route {
    const rawHash = location.hash || '#/library';

    // split off querystring inside the hash
    const [hashPath] = rawHash.split('?');

    // remove leading "#"
    const path = hashPath.replace(/^#/, '');

    const parts = path.split('/').filter(Boolean);

    if (parts[0] === 'scan') return {name: 'scan'};
    if (parts[0] === 'settings') return {name: 'settings'};
    if (parts[0] === 'doc' && parts[1]) return {name: 'doc', id: parts[1]};
    return {name: 'library'};
}

function errToMessage(e: unknown): { message: string; stack?: string } {
    if (e instanceof Error) return {message: e.message || 'Unknown error', stack: e.stack};
    if (typeof e === 'string') return {message: e};
    try {
        return {message: JSON.stringify(e)};
    } catch {
        return {message: String(e)};
    }
}

@customElement('app-root')
export class AppRoot extends LitElement {
    createRenderRoot() {
        return this;
    }

    @state() private route: Route = parseHash();
    @state() private fatal: FatalErrorState | null = null;

    // used to remount route content after a crash, or whenever route changes
    @state() private routeKey = 0;

    connectedCallback(): void {
        super.connectedCallback();

        window.addEventListener('hashchange', this._onHash);
        window.addEventListener('error', this._onGlobalError);
        window.addEventListener('unhandledrejection', this._onUnhandledRejection);

        if (!location.hash) location.hash = '#/library';
    }

    disconnectedCallback(): void {
        window.removeEventListener('hashchange', this._onHash);
        window.removeEventListener('error', this._onGlobalError);
        window.removeEventListener('unhandledrejection', this._onUnhandledRejection);
        super.disconnectedCallback();
    }

    private _onHash = () => {
        this.route = parseHash();
        this.routeKey++;

        // small UX improvement: reset scroll on route change
        // (won’t break if layout container doesn’t scroll)
        try {
            window.scrollTo({top: 0, behavior: 'instant' as any});
        } catch {
            window.scrollTo(0, 0);
        }
    };

    private _onGlobalError = (ev: ErrorEvent) => {
        // If app-root itself already handled a fatal, don't spam
        if (this.fatal) return;

        const info = errToMessage(ev.error ?? ev.message ?? 'Unknown error');
        this.setFatal(info.message, info.stack, 'window.error');
    };

    private _onUnhandledRejection = (ev: PromiseRejectionEvent) => {
        if (this.fatal) return;

        const info = errToMessage(ev.reason);
        this.setFatal(info.message, info.stack, 'unhandledrejection');
    };

    private setFatal(message: string, stack: string | undefined, source: FatalErrorState['source']) {
        // Avoid infinite loops if fallback UI also fails (rare, but possible)
        if (this.fatal) return;

        this.fatal = {
            message,
            stack,
            source,
            when: Date.now(),
            routeAtCrash: location.hash || '',
        };

        // ensure we re-render into a known-safe screen
        this.requestUpdate();
    }

    // Catch crashes inside app-root's own update/render pipeline
    protected override performUpdate(): void {
        try {
            super.performUpdate();
        } catch (e) {
            const info = errToMessage(e);
            this.setFatal(info.message, info.stack, 'app-root');
        }
    }

    private navLink(href: string, label: string, active: boolean) {
        return html`
            <a
                    class=${[
                        'px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/60',
                        active ? 'bg-slate-800 text-slate-50' : 'text-slate-300 hover:bg-slate-900',
                    ].join(' ')}
                    href=${href}
                    aria-current=${active ? 'page' : 'false'}
            >
                ${label}
            </a>
        `;
    }

    private async copyDiagnostics(): Promise<void> {
        if (!this.fatal) return;

        const payload = {
            when: new Date(this.fatal.when).toISOString(),
            source: this.fatal.source,
            route: this.fatal.routeAtCrash,
            message: this.fatal.message,
            stack: this.fatal.stack ?? '',
            userAgent: navigator.userAgent,
        };

        const text = JSON.stringify(payload, null, 2);

        try {
            await navigator.clipboard.writeText(text);
            alert('Diagnostics copied to clipboard.');
            return;
        } catch {
            // fallback: old-school textarea copy
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                alert('Diagnostics copied to clipboard.');
            } catch {
                alert('Could not copy diagnostics.');
            }
        }
    }

    private renderFatal() {
        const f = this.fatal!;
        return html`
            <div class="min-h-dvh flex flex-col">
                <header class="sticky top-0 z-10 bg-slate-950/80 backdrop-blur border-b border-slate-800">
                    <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
                        <div class="font-semibold tracking-tight">Sahifah Lens</div>
                    </div>
                </header>

                <main class="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
                    <div class="p-4 rounded-xl border border-red-900 bg-red-950/30 text-red-100 space-y-3">
                        <div class="text-lg font-semibold">Something went wrong</div>
                        <div class="text-sm text-red-200">
                            The app hit an unexpected error and stopped rendering safely.
                        </div>

                        <div class="text-xs text-red-200/80 whitespace-pre-wrap break-words">
                            <div><span class="font-semibold">Message:</span> ${f.message}</div>
                            <div><span class="font-semibold">Where:</span> ${f.source}</div>
                            <div><span class="font-semibold">Route:</span> ${f.routeAtCrash || '(none)'}</div>
                            <div><span class="font-semibold">Time:</span> ${new Date(f.when).toLocaleString()}</div>
                        </div>

                        ${f.stack
                                ? html`
                                    <details class="text-xs text-red-200/80">
                                        <summary class="cursor-pointer select-none">Stack trace</summary>
                                        <pre class="mt-2 whitespace-pre-wrap break-words">${f.stack}</pre>
                                    </details>
                                `
                                : null}

                        <div class="flex flex-wrap gap-2 pt-2">
                            <button
                                    class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold"
                                    @click=${() => location.reload()}
                            >
                                Reload
                            </button>

                            <button
                                    class="px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-100"
                                    @click=${() => {
                                        // try to recover without full reload
                                        this.fatal = null;
                                        location.hash = '#/library';
                                        this.route = parseHash();
                                        this.routeKey++;
                                    }}
                            >
                                Go to Library
                            </button>

                            <button
                                    class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100"
                                    @click=${() => void this.copyDiagnostics()}
                            >
                                Copy diagnostics
                            </button>
                        </div>

                        <div class="text-xs text-slate-400 pt-2">
                            Tip: if this happens during scanning, try disabling auto-capture or reopening the camera.
                        </div>
                    </div>
                </main>
            </div>
        `;
    }

    private renderShell() {
        const r = this.route;
        const active = (name: Route['name']) => r.name === name;

        // route key ensures a clean remount when changing pages (and also after recovering from fatal)
        const routeKey = r.name === 'doc' ? `doc:${r.id}:${this.routeKey}` : `${r.name}:${this.routeKey}`;

        return html`
      <a class="sr-only focus:not-sr-only focus:block focus:p-2 focus:bg-slate-900" href="#main">
        Skip to content
      </a>

      <div class="min-h-dvh flex flex-col">
        <header class="sticky top-0 z-10 bg-slate-950/80 backdrop-blur border-b border-slate-800">
          <div class="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
            <div class="font-semibold tracking-tight">Sahifah Lens</div>
            <nav class="flex gap-2" aria-label="Primary">
              ${this.navLink('#/library', 'Library', active('library'))}
              ${this.navLink('#/scan?new=1', 'Scan', active('scan'))}
              ${this.navLink('#/settings', 'Settings', active('settings'))}
            </nav>
          </div>
        </header>

        <main id="main" class="flex-1 max-w-3xl mx-auto w-full px-4 py-4">
          ${keyed(
            routeKey,
            html`
                ${r.name === 'library' ? html`
                    <library-page></library-page>` : null}
                ${r.name === 'scan' ? html`
                    <scan-page></scan-page>` : null}
                ${r.name === 'doc' ? html`
                    <doc-page .docId=${r.id}></doc-page>` : null}
                ${r.name === 'settings' ? html`
                    <settings-page></settings-page>` : null}
            `,
        )}
        </main>
      </div>
    `;
    }

    render() {
        // last line of defense if something throws inside render
        try {
            if (this.fatal) return this.renderFatal();
            return this.renderShell();
        } catch (e) {
            const info = errToMessage(e);
            this.setFatal(info.message, info.stack, 'app-root');
            return null;
        }
    }
}