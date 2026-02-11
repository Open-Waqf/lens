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
        // 1. Existing Guidance Toast
        const toast = this.guidance ? html`
            <div class="absolute top-24 left-0 right-0 flex justify-center pointer-events-none">
                <div class="px-4 py-2 bg-black/60 backdrop-blur-md rounded-full border border-white/10 text-white font-medium text-sm shadow-lg flex items-center gap-2">
                    ${this.guidance}
                </div>
            </div>
        ` : null;

        const det = this.detected;
        const q = this.quad;

        // 2. NEW: The "Ghost Frame" (Static Guide)
        // Helps user center the camera BEFORE detection starts
        const ghostFrame = html`
            <svg class="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
                <rect x="15%" y="20%" width="70%" height="60%"
                      fill="none"
                      stroke="rgba(255,255,255,0.2)"
                      stroke-width="2"
                      stroke-dasharray="10 5"
                      rx="20"/>
                <text x="50%" y="85%" fill="white" font-size="14" text-anchor="middle" opacity="0.6"
                      style="text-shadow: 0 1px 3px black;">
                    Align document here
                </text>
            </svg>
        `;

        // If no detection, just show Guide + Toast
        if (!det || !q || !det.width || !det.height || !this.videoW || !this.videoH) {
            return html`${ghostFrame} ${toast}`;
        }

        // 3. Draw the Active Detection (Green/Yellow Polygon)
        const sx = this.videoW / det.width;
        const sy = this.videoH / det.height;

        if (!isFinite(sx) || !isFinite(sy)) return html`${ghostFrame} ${toast}`;

        const pts = q.map(p => `${p.x * sx},${p.y * sy}`).join(' ');
        const isGood = det.confidence >= 0.75;
        const stroke = isGood ? 'rgba(16,185,129,0.9)' : 'rgba(251,191,36,0.8)';
        const fill = isGood ? 'rgba(16,185,129,0.1)' : 'rgba(251,191,36,0.05)';

        return html`
            ${ghostFrame}
            ${toast}
            <svg class="absolute inset-0 w-full h-full pointer-events-none"
                 viewBox=${`0 0 ${this.videoW} ${this.videoH}`} preserveAspectRatio="none">
                <polygon points=${pts} fill=${fill} stroke=${stroke} stroke-width="4" stroke-linejoin="round"
                         stroke-dasharray=${isGood ? 'none' : '8,4'}/>
            </svg>
        `;
    }
}