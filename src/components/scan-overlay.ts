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

    @property({type: Number}) videoW = 0;
    @property({type: Number}) videoH = 0;

    render() {
        const det = this.detected;
        const q = this.quad;

        if (!det || !q || !det.width || !det.height || this.videoW === 0 || this.videoH === 0) return null;

        const sx = this.videoW / det.width;
        const sy = this.videoH / det.height;

        const pts = q.map(p => `${p.x * sx},${p.y * sy}`).join(' ');
        const stroke = det.confidence >= 0.65 ? 'rgba(16,185,129,0.9)' : 'rgba(234,179,8,0.9)';

        return html`
            <svg
                    class="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox=${`0 0 ${this.videoW} ${this.videoH}`}
                    preserveAspectRatio="none"
            >
                <polygon
                        points=${pts}
                        fill="none"
                        stroke=${stroke}
                        stroke-width="6"
                        stroke-linejoin="round"
                ></polygon>
            </svg>
        `;
    }
}
