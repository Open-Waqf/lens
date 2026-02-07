import {html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';

import '../pages/scan-page';
import '../pages/library-page';
import '../pages/doc-page';
import '../pages/settings-page';

type Route =
    | { name: 'library' }
    | { name: 'scan' }
    | { name: 'doc'; id: string }
    | { name: 'settings' };

/**
 * Supports hashes like:
 *  - #/scan
 *  - #/scan?new=1
 *  - #/doc/ABC123
 */
function parseHash(): Route {
    const rawHash = location.hash || '#/library';

    // split off querystring inside the hash
    // e.g. "#/scan?new=1" -> "#/scan"
    const [hashPath] = rawHash.split('?');

    // remove leading "#"
    const path = hashPath.replace(/^#/, '');

    const parts = path.split('/').filter(Boolean);

    if (parts[0] === 'scan') return {name: 'scan'};
    if (parts[0] === 'settings') return {name: 'settings'};
    if (parts[0] === 'doc' && parts[1]) return {name: 'doc', id: parts[1]};
    return {name: 'library'};
}

@customElement('app-root')
export class AppRoot extends LitElement {
    createRenderRoot() {
        return this;
    }

    @state() private route: Route = parseHash();

    connectedCallback(): void {
        super.connectedCallback();
        window.addEventListener('hashchange', this._onHash);
        if (!location.hash) location.hash = '#/library';
    }

    disconnectedCallback(): void {
        window.removeEventListener('hashchange', this._onHash);
        super.disconnectedCallback();
    }

    private _onHash = () => {
        this.route = parseHash();
    };

    private navLink(href: string, label: string, active: boolean) {
        return html`
            <a
                    class=${[
                        'px-3 py-2 rounded-lg text-sm',
                        active ? 'bg-slate-800 text-slate-50' : 'text-slate-300 hover:bg-slate-900'
                    ].join(' ')}
                    href=${href}
            >${label}</a>
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

                <main class="flex-1 max-w-3xl mx-auto w-full px-4 py-4">
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
