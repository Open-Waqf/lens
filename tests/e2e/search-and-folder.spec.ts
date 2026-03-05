import {expect, test} from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sahifah.welcomeSeen', '1');
        (window as any).Capacitor = {isNativePlatform: () => false, platform: 'web'};
        (window as any).navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    });
    // Use a longer timeout for initial load
    await page.goto('http://localhost:4173', { waitUntil: 'networkidle' });
});

test('Search, Folder Cascade, and Share Warning', async ({page}) => {
    // 1. Create a document with specific text and folder
    await page.goto('#/scan');
    const importBtn = page.locator('button').filter({hasText: /Import/i});
    await expect(importBtn).toBeVisible({timeout: 15000});

    const fileChooserPromise = page.waitForEvent('filechooser');
    await importBtn.click();
    const fileChooser = await fileChooserPromise;
    
    const imagePath = path.join(__dirname, '../test-images/page1.jpg');
    const imageBuffer = fs.readFileSync(imagePath);

    await fileChooser.setFiles({
        name: 'test.jpg',
        mimeType: 'image/jpeg',
        buffer: imageBuffer
    });
    
    // Wait for editor to appear and button to be enabled
    // Increased timeout because OCR/Processing might take a second
    const saveBtn = page.locator('button').filter({hasText: /Save/i});
    await expect(saveBtn).toBeEnabled({timeout: 15000});
    await saveBtn.click();
    await expect(page.locator('page-editor')).not.toBeVisible({timeout: 10000});

    // 2. Edit doc title, folder and notes in Library/DocPage
    await page.goto('#/library');
    await expect(page.locator('h3', {hasText: /Scan/i}).first()).toBeVisible({timeout: 10000});
    await page.locator('h3', {hasText: /Scan/i}).first().click();
    
    await page.waitForURL('**/#/doc/**');
    const titleInput = page.locator('input').first();
    await titleInput.fill('Searchable Doc');
    await titleInput.dispatchEvent('change');
    
    const folderInput = page.getByPlaceholder('e.g. Finance');
    await folderInput.fill('Taxes');
    await folderInput.dispatchEvent('change');
    
    const notesArea = page.getByPlaceholder(/Add details/i);
    await notesArea.fill('This contains the word Amanah for searching.');
    await notesArea.dispatchEvent('change');

    // 3. Test Search Snippet in Library
    await page.goto('#/library');
    const searchInput = page.getByPlaceholder(/Search docs/i);
    await searchInput.fill('Amanah');
    
    // Snipet should be visible
    const snippet = page.locator('library-page b', {hasText: 'Amanah'});
    await expect(snippet).toBeVisible({timeout: 5000});
    await expect(snippet).toHaveClass(/text-emerald-400/);

    // 4. Test Folder Cascade Deletion
    await searchInput.fill('');
    await page.locator('button[title="Group by Folder"]').click();
    
    await expect(page.locator('h2', {hasText: /Taxes/i})).toBeVisible();
    await page.locator('button[title="Unsort Folder"]').click();
    
    // Confirm modal
    await expect(page.locator('text=Delete Folder?')).toBeVisible();
    await page.locator('button').filter({hasText: /Unsort Documents/i}).click();
    
    await expect(page.locator('h2', {hasText: /Taxes/i})).not.toBeVisible();
    await expect(page.locator('h2', {hasText: /Unsorted/i})).toBeVisible({timeout: 10000});

    // 5. Test Share Warning
    // Turn off grouping to make locator easier
    await page.locator('button[title="Group by Folder"]').click();

    const docInLibrary = page.locator('h3', {hasText: 'Searchable Doc'}).first();
    await expect(docInLibrary).toBeVisible({timeout: 15000});
    await docInLibrary.click();
    
    await page.waitForURL('**/#/doc/**');
    await page.locator('button', {hasText: 'Export PDF'}).click();
    const cancelBtn = page.locator('button').filter({hasText: /Cancel/i});
    await cancelBtn.click();
    await expect(page.locator('text=Share Decrypted Copy?')).not.toBeVisible();
});
