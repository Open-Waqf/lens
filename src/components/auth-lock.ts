import {css, html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {AuthService} from '../services/auth-service';

@customElement('auth-lock')
export class AuthLock extends LitElement {
    @state() private error = false;

    static styles = css`
        .overlay {
            position: fixed;
            inset: 0;
            background: var(--bg-default, #09090b);
            color: var(--text-default, #ffffff);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            padding: 2rem;
        }

        .logo {
            width: 80px;
            margin-bottom: 2rem;
            opacity: 0.8;
        }

        h2 {
            margin: 0 0 0.5rem 0;
            font-weight: 600;
        }

        p {
            margin-bottom: 2rem;
            opacity: 0.7;
            font-size: 0.9rem;
            max-width: 300px;
            text-align: center;
        }

        button {
            background: var(--primary, #2563eb);
            color: white;
            border: none;
            padding: 0.75rem 2rem;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            font-size: 1rem;
            transition: opacity 0.2s;
        }

        button:active {
            opacity: 0.8;
        }

        .error-msg {
            color: #ef4444;
            margin-top: 1rem;
            font-size: 0.9rem;
        }
    `;

    async connectedCallback() {
        super.connectedCallback();
        // Try to unlock immediately on load (smoother UX)
        this._tryUnlock();
    }

    render() {
        return html`
            <div class="overlay">
                <img src="/icons/icon-192.png" class="logo" alt="Locked">
                <h2>Sahifah is Locked</h2>
                <p>Use your device security (Fingerprint, FaceID, or PIN) to unlock.</p>

                <button aria-label="Unlock Vault" @click=${this._tryUnlock}>Unlock Vault</button>

                ${this.error ? html`
                    <div class="error-msg">Authentication failed. Try again.</div>` : null}
            </div>
        `;
    }

    private async _tryUnlock() {
        this.error = false;
        const success = await AuthService.promptAuth();
        if (success) {
            this.dispatchEvent(new CustomEvent('unlocked', {bubbles: true, composed: true}));
        } else {
            this.error = true;
        }
    }
}