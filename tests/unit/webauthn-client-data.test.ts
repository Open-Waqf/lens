import {describe, expect, it} from 'vitest';
import {verifyWebAuthnClientData} from '../../src/services/auth-service';

function makeClientDataJSON(overrides: Record<string, string> = {}): ArrayBuffer {
    const obj = {
        type: 'webauthn.get',
        challenge: overrides.challenge ?? 'dGVzdGNoYWxsZW5nZXBhZGRpbmcxMjM0NTY3OA',
        origin: overrides.origin ?? 'http://localhost',
        ...overrides,
    };
    return new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer;
}

function makeChallenge(base64url: string): Uint8Array {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

const VALID_CHALLENGE_B64URL = 'dGVzdGNoYWxsZW5nZXBhZGRpbmcxMjM0NTY3OA';
const VALID_CHALLENGE = makeChallenge(VALID_CHALLENGE_B64URL);

describe('verifyWebAuthnClientData', () => {
    it('accepts valid clientDataJSON with matching challenge and origin', () => {
        Object.defineProperty(window, 'location', {value: {origin: 'http://localhost'}, configurable: true});
        const json = makeClientDataJSON({challenge: VALID_CHALLENGE_B64URL, origin: 'http://localhost'});
        expect(verifyWebAuthnClientData(json, VALID_CHALLENGE)).toBe(true);
    });

    it('rejects wrong type (webauthn.create instead of webauthn.get)', () => {
        Object.defineProperty(window, 'location', {value: {origin: 'http://localhost'}, configurable: true});
        const json = makeClientDataJSON({type: 'webauthn.create', challenge: VALID_CHALLENGE_B64URL, origin: 'http://localhost'});
        expect(verifyWebAuthnClientData(json, VALID_CHALLENGE)).toBe(false);
    });

    it('rejects mismatched challenge — prevents replay attacks', () => {
        Object.defineProperty(window, 'location', {value: {origin: 'http://localhost'}, configurable: true});
        const differentChallenge = new Uint8Array(32).fill(0xff);
        const json = makeClientDataJSON({challenge: VALID_CHALLENGE_B64URL, origin: 'http://localhost'});
        expect(verifyWebAuthnClientData(json, differentChallenge)).toBe(false);
    });

    it('rejects mismatched origin — prevents cross-origin attacks', () => {
        Object.defineProperty(window, 'location', {value: {origin: 'http://localhost'}, configurable: true});
        const json = makeClientDataJSON({challenge: VALID_CHALLENGE_B64URL, origin: 'https://evil.example.com'});
        expect(verifyWebAuthnClientData(json, VALID_CHALLENGE)).toBe(false);
    });

    it('rejects malformed JSON', () => {
        const json = new TextEncoder().encode('not-json{{{').buffer as ArrayBuffer;
        expect(verifyWebAuthnClientData(json, VALID_CHALLENGE)).toBe(false);
    });
});
