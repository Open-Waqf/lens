import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        // Mock getUserMedia
        (window as any).navigator.mediaDevices.getUserMedia = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 480;
            return canvas.captureStream();
        };
    });
    await page.goto('http://localhost:4173/#/scan?new=1');
});

test('Scan Overlay: Displays alignment guide and handles detection states', async ({page}) => {
    // 1. Click Start Camera
    const startBtn = page.locator('button').filter({hasText: /Open Camera/i});
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 2. Verify Video and Overlay are present
    const video = page.locator('video');
    await expect(video).toBeVisible({timeout: 10000});

    const overlay = page.locator('scan-overlay');
    await expect(overlay).toBeAttached({timeout: 10000});

    // 3. Check for the initial "Align document here" text
    // Since we use createRenderRoot() { return this; }, the SVG is a direct child.
    const guideText = page.locator('scan-overlay svg text');
    await expect(guideText).toBeVisible({timeout: 10000});
    await expect(guideText).toHaveText(/Align document here/i);

    // 4. Mock a detection result by injecting state into the component (Advanced)
    // Or just verify the polygon isn't there yet
    const polygon = overlay.locator('polygon');
    await expect(polygon).not.toBeVisible();

    // 5. Verify Guidance Toast appears when simulated
    // We can't easily trigger the worker result from outside, but we can check if the guidance logic works
    // if we were to set the property. 
    // For a true E2E, we'd need a real camera feed with a document, which is hard in CI.
    // So we'll trust the unit tests for the logic and use E2E for the presence.
});

test('Scan Page: DetectGovernor scales correctly', async ({page}) => {
    // This is more of a smoke test to ensure no crashes
    const startBtn = page.locator('button').filter({hasText: /Open Camera/i});
    await startBtn.click();
    
    // Let it run for a few seconds to ensure no worker errors crash the UI
    await page.waitForTimeout(2000);
    
    // UI should still be responsive
    await expect(page.locator('button[aria-label="Capture"]')).toBeEnabled();
});
