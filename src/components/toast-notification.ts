import {css, html, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

export interface ToastOptions {
    message: string;
    type?: 'success' | 'error' | 'info';
    duration?: number;
}

@customElement('toast-notification')
export class ToastNotification extends LitElement {
    @property({type: Boolean, reflect: true}) shifted = false;
    @state() private toasts: Array<ToastOptions & { id: number }> = [];
    private counter = 0;

    static styles = css`
        :host {
            position: fixed;
            /* Default position for pages WITHOUT a bottom bar */
            bottom: calc(16px + env(safe-area-inset-bottom));
            left: 0;
            right: 0;
            z-index: 100;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            transition: bottom 0.3s ease; /* Smooth move when nav appears/disappears */
        }

        :host([shifted]) {
            /* 64px (nav height) + 16px (gap) + safe area */
            bottom: calc(64px + 16px + env(safe-area-inset-bottom));
        }

        .toast {
            background: #0f172a; /* Slate 900 */
            color: white;
            padding: 12px 24px;
            pointer-events: auto;
            border-radius: 99px;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.1);
            opacity: 0;
            transform: translateY(20px);
            animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            display: flex;
            align-items: center;
            gap: 10px;
            max-width: 90%;
        }

        .toast.success {
            border-color: #10b981;
            color: #ecfdf5;
        }

        .toast.error {
            border-color: #ef4444;
            color: #fef2f2;
        }

        .toast.info {
            border-color: #3b82f6;
            color: #eff6ff;
        }

        @keyframes slideIn {
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    `;

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('show-toast', this.handleToast as EventListener);
    }

    disconnectedCallback() {
        window.removeEventListener('show-toast', this.handleToast as EventListener);
        super.disconnectedCallback();
    }

    private handleToast = (e: CustomEvent<ToastOptions>) => {
        const id = this.counter++;
        const toast = {...e.detail, id};
        this.toasts = [...this.toasts, toast];

        // Auto-remove
        setTimeout(() => {
            this.toasts = this.toasts.filter(t => t.id !== id);
        }, e.detail.duration || 3000);
    };

    render() {
        return html`
            ${this.toasts.map(t => html`
                <div class="toast ${t.type || 'info'}">
                    ${t.type === 'success' ? html`<span style="color:#10b981">✓</span>` : ''}
                    ${t.type === 'error' ? html`<span style="color:#ef4444">✕</span>` : ''}
                    ${t.message}
                </div>
            `)}
        `;
    }
}

// Helper to trigger toasts from anywhere in the app
export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000) {
    window.dispatchEvent(new CustomEvent('show-toast', {detail: {message, type, duration}}));
}