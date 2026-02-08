import {html, LitElement} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';

@customElement('confirm-modal')
export class ConfirmModal extends LitElement {
    createRenderRoot() {
        return this;
    }

    @property({type: Boolean}) open = false;
    @property({type: String}) title = '';
    @property({type: String}) description = '';
    @property({type: String}) confirmLabel = 'Confirm';
    @property({type: String}) cancelLabel = 'Cancel';
    @property({type: Boolean}) destructive = false;
    @property({type: Boolean}) input = false; // Is this a prompt?
    @property({type: String}) inputValue = '';
    @property({type: String}) inputPlaceholder = '';

    @query('input') inputEl!: HTMLInputElement;

    private resolve: ((value: boolean | string | null) => void) | null = null;

    // Static helper to call it like a function
    static async ask(opts: {
        title: string;
        description?: string;
        confirm?: string;
        cancel?: string;
        destructive?: boolean;
    }): Promise<boolean> {
        const modal = document.createElement('confirm-modal') as ConfirmModal;
        document.body.appendChild(modal);
        return modal.show(opts) as Promise<boolean>;
    }

    static async prompt(opts: {
        title: string;
        description?: string;
        placeholder?: string;
        confirm?: string;
    }): Promise<string | null> {
        const modal = document.createElement('confirm-modal') as ConfirmModal;
        modal.input = true;
        document.body.appendChild(modal);
        return modal.show(opts) as Promise<string | null>;
    }

    show(opts: any): Promise<boolean | string | null> {
        this.title = opts.title;
        this.description = opts.description || '';
        this.confirmLabel = opts.confirm || 'Confirm';
        this.cancelLabel = opts.cancel || 'Cancel';
        this.destructive = !!opts.destructive;
        this.inputPlaceholder = opts.placeholder || '';
        this.open = true;

        if (this.input) {
            setTimeout(() => this.inputEl?.focus(), 50);
        }

        return new Promise((res) => {
            this.resolve = (val) => {
                this.open = false;
                setTimeout(() => this.remove(), 200); // Cleanup DOM
                res(val);
            };
        });
    }

    private onConfirm() {
        if (this.input) {
            this.resolve?.(this.inputValue);
        } else {
            this.resolve?.(true);
        }
    }

    private onCancel() {
        this.resolve?.(null); // For prompt, null means cancel. For confirm, it's false-ish.
        if (!this.input) this.resolve?.(false);
    }

    render() {
        if (!this.open) return null;

        return html`
            <div class="fixed inset-0 z-[100] flex items-center justify-center px-4" role="dialog">
                <div class="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
                     @click=${() => this.onCancel()}></div>

                <div class="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
                    <div class="space-y-1 text-center">
                        <h3 class="text-lg font-bold text-slate-100">${this.title}</h3>
                        ${this.description ? html`<p class="text-sm text-slate-400">${this.description}</p>` : null}
                    </div>

                    ${this.input ? html`
                        <input class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-500 transition-colors"
                               placeholder=${this.inputPlaceholder}
                               .value=${this.inputValue}
                               @input=${(e: Event) => this.inputValue = (e.target as HTMLInputElement).value}
                               @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this.onConfirm()}
                        />
                    ` : null}

                    <div class="grid grid-cols-2 gap-3 pt-2">
                        <button class="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
                                @click=${() => this.onCancel()}>
                            ${this.cancelLabel}
                        </button>
                        <button class="px-4 py-3 rounded-xl font-bold text-white transition-colors ${this.destructive ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}"
                                @click=${() => this.onConfirm()}>
                            ${this.confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
}