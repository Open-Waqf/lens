import {expect, test} from '@playwright/test';

function findUnnamedVisibleButtons() {
    const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
    const offenders: string[] = [];
    for (const btn of buttons) {
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = btn.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const aria = (btn.getAttribute('aria-label') || '').trim();
        const title = (btn.getAttribute('title') || '').trim();
        const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
        const named = aria.length > 0 || title.length > 0 || text.length > 0;
        if (!named) {
            offenders.push(btn.outerHTML.slice(0, 120));
        }
    }
    return offenders;
}

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        (window as any).navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    });
});

test('primary flow controls are discoverable by role/name', async ({page}) => {
    await page.goto('http://localhost:4173/#/library');

    await expect(page.getByRole('link', {name: 'Library'})).toBeVisible();
    await expect(page.getByRole('link', {name: 'New Scan'})).toBeVisible();
    await expect(page.getByRole('link', {name: 'Settings'}).first()).toBeVisible();

    const libraryUnnamed = await page.evaluate(findUnnamedVisibleButtons);
    expect(libraryUnnamed).toEqual([]);

    await page.goto('http://localhost:4173/#/scan?new=1');
    await page.getByRole('button', {name: /Open Camera|Start Scanner/i}).click();

    await expect(page.getByRole('button', {name: 'Capture', exact: true})).toBeVisible({timeout: 10000});
    await expect(page.getByRole('button', {name: 'Import from Files'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Done'})).toBeVisible();

    const scanUnnamed = await page.evaluate(findUnnamedVisibleButtons);
    expect(scanUnnamed).toEqual([]);

    await page.goto('http://localhost:4173/#/settings');
    await expect(page.getByRole('heading', {name: 'Settings'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Show Destructive Options'})).toBeVisible();

    const settingsUnnamed = await page.evaluate(findUnnamedVisibleButtons);
    expect(settingsUnnamed).toEqual([]);
});
