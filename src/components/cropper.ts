import {html, LitElement} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {t} from '../lib/i18n';

@customElement('sl-cropper')
export class Cropper extends LitElement {
    createRenderRoot() {
        return this;
    }

    @property({attribute: false}) blob!: Blob;

    @state() private imgUrl: string | null = null;
    @state() private dragging = false;
    @state() private start: { x: number; y: number } | null = null;
    @state() private rect: { x: number; y: number; w: number; h: number } | null = null;

    @query('#img') private imgEl!: HTMLImageElement;
    @query('#container') private container!: HTMLDivElement;

    disconnectedCallback(): void {
        super.disconnectedCallback();
        if (this.imgUrl) URL.revokeObjectURL(this.imgUrl);
    }

    protected updated(): void {
        if (!this.imgUrl && this.blob) {
            this.imgUrl = URL.createObjectURL(this.blob);
        }
    }

    private pos(ev: PointerEvent): { x: number; y: number } {
        const r = this.container.getBoundingClientRect();
        return {x: ev.clientX - r.left, y: ev.clientY - r.top};
    }

    private down(ev: PointerEvent) {
        this.dragging = true;
        this.start = this.pos(ev);
        this.rect = {x: this.start.x, y: this.start.y, w: 1, h: 1};
        (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    }

    private move(ev: PointerEvent) {
        if (!this.dragging || !this.start) return;
        const p = this.pos(ev);
        const x = Math.min(this.start.x, p.x);
        const y = Math.min(this.start.y, p.y);
        const w = Math.abs(p.x - this.start.x);
        const h = Math.abs(p.y - this.start.y);
        this.rect = {x, y, w, h};
    }

    private up() {
        this.dragging = false;
        this.start = null;
    }

    public async getCropRectPixels(): Promise<{ x: number; y: number; w: number; h: number } | null> {
        if (!this.rect || this.rect.w < 10 || this.rect.h < 10) return null;

        const containerR = this.container.getBoundingClientRect();
        const imgR = this.imgEl.getBoundingClientRect();

        const ix = imgR.left - containerR.left;
        const iy = imgR.top - containerR.top;

        const rx = this.rect.x - ix;
        const ry = this.rect.y - iy;

        const scaleX = this.imgEl.naturalWidth / imgR.width;
        const scaleY = this.imgEl.naturalHeight / imgR.height;

        const x = Math.max(0, Math.round(rx * scaleX));
        const y = Math.max(0, Math.round(ry * scaleY));
        const w = Math.round(this.rect.w * scaleX);
        const h = Math.round(this.rect.h * scaleY);

        return {x, y, w, h};
    }

    render() {
        return html`
            <div class="w-full">
                <div
                        id="container"
                        class="relative w-full rounded-xl overflow-hidden bg-slate-900 touch-none select-none"
                        style="aspect-ratio: 3/4;"
                        @pointerdown=${this.down}
                        @pointermove=${this.move}
                        @pointerup=${this.up}
                        @pointercancel=${this.up}
                >
                    ${this.imgUrl
                            ? html`<img id="img" src=${this.imgUrl}
                                        class="absolute inset-0 w-full h-full object-contain" alt=${t('cropper.captured_alt')}/>`
                            : html`
                                <div class="absolute inset-0 grid place-items-center text-slate-400 text-sm">${t('common.loading')}
                                </div>`}

                    ${this.rect
                            ? html`
                                <div
                                        class="absolute border-2 border-emerald-400 bg-emerald-400/10"
                                        style="left:${this.rect.x}px; top:${this.rect.y}px; width:${this.rect.w}px; height:${this.rect.h}px;"
                                ></div>`
                            : html`
                                <div class="absolute inset-0 grid place-items-center text-slate-400 text-sm">
                                    ${t('cropper.drag_hint')}
                                </div>`}
                </div>
            </div>
        `;
    }
}
