import {html, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';

import type {DetectedQuad, Quad} from '../lib/scan/quad';

@customElement('scan-overlay')
export class ScanOverlay extends LitElement {
    createRenderRoot() {
        return this;
    }

    @property({attribute: false}) detected: DetectedQuad | null = null;
    @property({attribute: false}) quad: Quad | null = null;
    @property({type: String}) guidance: string | null = null;

    @property({type: Number}) videoW = 0;
    @property({type: Number}) videoH = 0;

    render() {
        // Guidance Toast (Always render if present, even if no quad)
        const toast = this.guidance ? html`
            <div class="absolute top-24 left-0 right-0 flex justify-center pointer-events-none">
                <div class="px-4 py-2 bg-black/60 backdrop-blur-md rounded-full border border-white/10 text-white font-medium text-sm shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
                    ${this.guidance === 'Hold steady' ? html`
                        <span class="relative flex h-2 w-2">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span class="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </span>
                    ` : null}
                    ${this.guidance}
                </div>
            </div>
        ` : null;

        const det = this.detected;
        const q = this.quad;

        if (!det || !q || !det.width || !det.height || this.videoW === 0 || this.videoH === 0) {
            return html`${toast}`;
        }

        const sx = this.videoW / det.width;
        const sy = this.videoH / det.height;

        const pts = q.map(p => `${p.x * sx},${p.y * sy}`).join(' ');

        // Green if confident, Amber if shaky/low confidence
        const isGood = det.confidence >= 0.75;
        const stroke = isGood ? 'rgba(16,185,129,0.9)' : 'rgba(251,191,36,0.8)';
        const fill = isGood ? 'rgba(16,185,129,0.1)' : 'rgba(251,191,36,0.05)';

        return html`
            ${toast}
            <svg
                    class="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox=${`0 0 ${this.videoW} ${this.videoH}`}
                    preserveAspectRatio="none"
            >
                <polygon
                        points=${pts}
                        fill=${fill}
                        stroke=${stroke}
                        stroke-width="4"
                        stroke-linejoin="round"
                        stroke-dasharray=${isGood ? 'none' : '8,4'}
                ></polygon>

                ${q.map(p => html`
                    <circle cx=${p.x * sx} cy=${p.y * sy} r="6" fill="white" stroke=${stroke} stroke-width="2"/>
                `)}
            </svg>
        `;
    }
}
