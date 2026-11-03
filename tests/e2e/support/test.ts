// test.ts: the `test` every e2e spec uses. Same as Playwright's, plus a network guard.
//
// Lens promises that nothing leaves the device. So every test, on every screen, fails if
// the page asks for anything other than the local test server (or data:/blob: URLs).
// Two signals, because the app's Content Security Policy (index.html) usually blocks an
// outside call before any request exists: real requests, and policy violations (an attempt
// the policy stopped). Either one fails the test.
// This replaces the old mitmproxy job: privacy is checked on every run, not once in CI.
// A test that must allow a host can call `allowHost(page, 'example.org')` (none does today).
import {test as base, expect, type Page} from '@playwright/test';

export type {Page, Download, Locator} from '@playwright/test';
export {expect};

const LOCAL = new Set(['localhost', '127.0.0.1']);
const allowed = new WeakMap<Page, Set<string>>();

export function allowHost(page: Page, host: string) {
    allowed.get(page)?.add(host);
}

export const test = base.extend<{networkGuard: void}>({
    networkGuard: [async ({page}, use) => {
        const extra = new Set<string>();
        allowed.set(page, extra);
        const outside: string[] = [];
        await page.exposeBinding('__lensReportCsp', (_source, uri: string) => {
            if (!/^(data|blob|inline|eval)/.test(uri)) outside.push(`blocked by CSP: ${uri}`);
        });
        await page.addInitScript(() => {
            document.addEventListener('securitypolicyviolation', (e) => {
                (window as any).__lensReportCsp?.(e.blockedURI || e.violatedDirective);
            });
        });
        page.on('request', (req) => {
            const url = req.url();
            if (/^(data|blob|about|chrome-extension):/.test(url)) return;
            let host = '';
            try {
                host = new URL(url).hostname;
            } catch {
                return;
            }
            if (!LOCAL.has(host) && !extra.has(host)) outside.push(url);
        });
        await use();
        expect(outside, 'The app tried to reach the network (Lens must stay on the device)').toEqual([]);
    }, {auto: true}],
});
